'use strict';

/**
 * Vendor image uploads.
 *
 * No multipart parsing and no image library, because there are no dependencies
 * in this project. The client sends the raw bytes as the request body with the
 * real content type, and the alt text as a query parameter. That is a legitimate
 * API shape, it is far less code than a multipart parser, and it means there is
 * no boundary-parsing surface to get wrong.
 *
 * What is checked, in order:
 *   1. The vendor has confirmed image rights in writing. No confirmation, no
 *      upload. This is the same confirmation the published verification scope
 *      describes, so a profile can never carry images whose rights we have not
 *      asked about.
 *   2. Size, against a published cap, streamed and aborted rather than buffered
 *      whole and then rejected.
 *   3. The actual file signature. A declared content type is a claim, not
 *      evidence, so the magic bytes decide what this is.
 *   4. Alt text is required, because an image with no alt text is unusable to
 *      anyone with a screen reader and this is a public profile.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { all, get, run, id, now } = require('../db');
const { HttpError } = require('./http');
const { UPLOADS } = require('./config');
const verification = require('./verification');

const DATA_DIR = process.env.AETERNA_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

function sniff(buffer) {
  for (const [mime, spec] of Object.entries(UPLOADS.allowed)) {
    for (const magic of spec.magic) {
      if (buffer.length < magic.length) continue;
      let matches = true;
      for (let i = 0; i < magic.length; i += 1) {
        if (buffer[i] !== magic[i]) { matches = false; break; }
      }
      if (!matches) continue;
      // RIFF is also used by other formats, so confirm this is really WebP.
      if (mime === 'image/webp') {
        if (buffer.length < 12) continue;
        const brand = buffer.subarray(8, 12).toString('ascii');
        if (brand !== 'WEBP') continue;
      }
      return { mime, ext: spec.ext };
    }
  }
  return null;
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new HttpError(413, `Images need to be under ${Math.round(limit / (1024 * 1024))}MB. Try exporting at a smaller size.`);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) throw new HttpError(400, 'No image data arrived with that request.');
  return Buffer.concat(chunks);
}

/* ------------------------------------------------------------------ */
/* store                                                               */
/* ------------------------------------------------------------------ */

async function acceptUpload({ req, vendor, alt, makeHero, actor }) {
  if (!vendor.rights_confirmed_at) {
    throw new HttpError(403, {
      message: 'Confirm that you hold the rights to your images before uploading. It takes one click and it is part of the published verification scope.',
      reason: 'rights_not_confirmed',
      rightsStatement: UPLOADS.rightsStatement,
    });
  }

  const cleanAlt = String(alt || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (cleanAlt.length < 4) {
    throw new HttpError(400, 'Describe the image in a few words. Alt text is what someone using a screen reader hears, and this is a public profile.');
  }

  const count = get('SELECT COUNT(*) AS n FROM uploads WHERE vendor_id = ?', vendor.id).n;
  if (count >= UPLOADS.maxImagesPerVendor) {
    throw new HttpError(409, `Profiles hold up to ${UPLOADS.maxImagesPerVendor} images. Remove one to add another.`);
  }

  const buffer = await readBody(req, UPLOADS.maxBytes);
  const kind = sniff(buffer);
  if (!kind) {
    throw new HttpError(415, 'That file is not a JPEG, PNG or WebP image. We check the file itself rather than trusting its name.');
  }

  const filename = `${vendor.id}-${crypto.randomBytes(8).toString('hex')}${kind.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);

  const uploadId = id('upl');
  const isHero = makeHero || count === 0;
  if (isHero) run('UPDATE uploads SET is_hero = 0 WHERE vendor_id = ?', vendor.id);

  run(
    `INSERT INTO uploads (id, vendor_id, filename, mime, bytes, alt, is_hero, sort, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    uploadId, vendor.id, filename, kind.mime, buffer.length, cleanAlt, isHero ? 1 : 0, count, now()
  );

  syncVendorImages(vendor.id);
  verification.audit(vendor.id, 'image.uploaded', `${cleanAlt} (${Math.round(buffer.length / 1024)}KB ${kind.mime})`, actor);

  return {
    id: uploadId,
    url: `/uploads/${filename}`,
    alt: cleanAlt,
    isHero,
    bytes: buffer.length,
    mime: kind.mime,
  };
}

/**
 * Keep the public gallery in step with what the vendor has uploaded.
 * An uploaded hero replaces the seeded stock image, and the seeded gallery is
 * only used while a vendor has uploaded nothing of their own.
 */
function syncVendorImages(vendorId) {
  const uploads = all('SELECT * FROM uploads WHERE vendor_id = ? ORDER BY is_hero DESC, sort', vendorId);
  if (!uploads.length) return;

  const hero = uploads.find((u) => u.is_hero) || uploads[0];
  run('UPDATE vendors SET hero_image = ?, hero_alt = ? WHERE id = ?',
    `/uploads/${hero.filename}`, hero.alt, vendorId);

  // Rebuild the gallery from the vendor's own images only.
  run('DELETE FROM vendor_images WHERE vendor_id = ?', vendorId);
  uploads.forEach((upload, index) => {
    run('INSERT INTO vendor_images (id, vendor_id, url, alt, sort) VALUES (?,?,?,?,?)',
      id('vim'), vendorId, `/uploads/${upload.filename}`, upload.alt, index);
  });
}

function listUploads(vendorId) {
  return all('SELECT * FROM uploads WHERE vendor_id = ? ORDER BY is_hero DESC, sort', vendorId)
    .map((u) => ({
      id: u.id,
      url: `/uploads/${u.filename}`,
      alt: u.alt,
      isHero: Boolean(u.is_hero),
      bytes: u.bytes,
      mime: u.mime,
      createdAt: u.created_at,
    }));
}

function removeUpload(vendorId, uploadId, actor) {
  const upload = get('SELECT * FROM uploads WHERE id = ? AND vendor_id = ?', uploadId, vendorId);
  if (!upload) throw new HttpError(404, 'We could not find that image.');

  run('DELETE FROM uploads WHERE id = ?', uploadId);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, upload.filename)); } catch { /* already gone */ }

  // Promote another image to hero if the removed one was it.
  if (upload.is_hero) {
    const next = get('SELECT id FROM uploads WHERE vendor_id = ? ORDER BY sort LIMIT 1', vendorId);
    if (next) run('UPDATE uploads SET is_hero = 1 WHERE id = ?', next.id);
  }

  const remaining = get('SELECT COUNT(*) AS n FROM uploads WHERE vendor_id = ?', vendorId).n;
  if (remaining === 0) {
    // Nothing of their own left, so clear the gallery rather than silently
    // reinstating stock imagery as if it were theirs.
    run('DELETE FROM vendor_images WHERE vendor_id = ?', vendorId);
    run(`UPDATE vendors SET hero_image = '', hero_alt = '' WHERE id = ?`, vendorId);
  } else {
    syncVendorImages(vendorId);
  }

  verification.audit(vendorId, 'image.removed', upload.alt, actor);
  return { removed: true, remaining };
}

function setAlt(vendorId, uploadId, alt, actor) {
  const cleanAlt = String(alt || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (cleanAlt.length < 4) throw new HttpError(400, 'Alt text needs to describe the image in a few words.');
  const upload = get('SELECT * FROM uploads WHERE id = ? AND vendor_id = ?', uploadId, vendorId);
  if (!upload) throw new HttpError(404, 'We could not find that image.');
  run('UPDATE uploads SET alt = ? WHERE id = ?', cleanAlt, uploadId);
  syncVendorImages(vendorId);
  verification.audit(vendorId, 'image.alt_updated', cleanAlt, actor);
  return { ok: true };
}

function makeHero(vendorId, uploadId) {
  const upload = get('SELECT * FROM uploads WHERE id = ? AND vendor_id = ?', uploadId, vendorId);
  if (!upload) throw new HttpError(404, 'We could not find that image.');
  run('UPDATE uploads SET is_hero = 0 WHERE vendor_id = ?', vendorId);
  run('UPDATE uploads SET is_hero = 1 WHERE id = ?', uploadId);
  syncVendorImages(vendorId);
  return { ok: true };
}

/**
 * Serve an uploaded file. Only ever reads from the upload directory, and only
 * ever by the exact filename recorded in the database, so a crafted path cannot
 * reach anything else.
 */
function resolveUpload(filename) {
  const row = get('SELECT * FROM uploads WHERE filename = ?', path.basename(String(filename)));
  if (!row) return null;
  const full = path.join(UPLOAD_DIR, row.filename);
  if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full)) return null;
  return { path: full, mime: row.mime };
}

module.exports = {
  acceptUpload,
  listUploads,
  removeUpload,
  setAlt,
  makeHero,
  resolveUpload,
  syncVendorImages,
  UPLOAD_DIR,
};
