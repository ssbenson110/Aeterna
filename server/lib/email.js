'use strict';

/**
 * Email delivery.
 *
 * Providers are HTTP APIs only, deliberately: Resend and Postmark both take a
 * single authenticated POST, so there is no SMTP client to maintain and it
 * works from hosts that only allow outbound HTTPS.
 *
 * Modes, decided by environment:
 *   resend    RESEND_API_KEY is set. Sends through api.resend.com.
 *   postmark  POSTMARK_TOKEN is set. Sends through api.postmarkapp.com.
 *   outbox    Neither is set. The email is written to data/outbox as JSON,
 *             nothing leaves the machine, and every response that mentions
 *             email says so honestly. This is the development default.
 *
 * Every send is fire and forget from the caller's point of view: a failed
 * email never fails the request that triggered it. The outcome is recorded in
 * the events log either way, so deliverability problems are visible rather
 * than silent.
 */

const fs = require('node:fs');
const path = require('node:path');
const { id, now, logEvent } = require('../db');

const DATA_DIR = process.env.AETERNA_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const OUTBOX_DIR = path.join(DATA_DIR, 'outbox');

const FROM = process.env.EMAIL_FROM || 'AETERNA <hello@aeterna.example>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || '';

function mode() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.POSTMARK_TOKEN) return 'postmark';
  return 'outbox';
}

/**
 * The house template: plain text first, with a light HTML wrapper in the brand
 * colours. No tracking pixels, no images, nothing clever.
 */
function wrap({ subject, bodyText, ctaLabel, ctaUrl }) {
  const paragraphs = bodyText.split('\n\n').map((p) =>
    `<p style="margin:0 0 14px;line-height:1.6">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`
  ).join('');
  const button = ctaUrl
    ? `<p style="margin:22px 0"><a href="${escapeAttr(ctaUrl)}" style="background:#D14A57;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 26px;border-radius:999px;display:inline-block">${escapeHtml(ctaLabel || 'Open AETERNA')}</a></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><body style="margin:0;background:#FFFBF4;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#2B2118">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-size:18px;letter-spacing:.14em;font-weight:700;margin:0 0 24px">&#9679; AETERNA</p>
${paragraphs}${button}
<p style="font-size:12px;color:#6B5B4E;margin:28px 0 0">AETERNA. One enquiry, one vendor, zero lead selling.</p>
</div></body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/**
 * Send an email. Returns { sent, mode, detail } and never throws.
 */
async function send({ to, subject, bodyText, ctaLabel, ctaUrl }) {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(to))) {
    return { sent: false, mode: mode(), detail: 'No valid recipient address.' };
  }
  const html = wrap({ subject, bodyText, ctaLabel, ctaUrl });
  const text = ctaUrl ? `${bodyText}\n\n${ctaLabel || 'Open'}: ${ctaUrl}` : bodyText;

  try {
    if (mode() === 'resend') {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM, to: [to], subject, text, html,
          ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
        }),
      });
      const ok = response.ok;
      logEvent(ok ? 'email.sent' : 'email.failed', to, { subject, provider: 'resend', status: response.status });
      return { sent: ok, mode: 'resend', detail: ok ? '' : `Provider returned ${response.status}.` };
    }

    if (mode() === 'postmark') {
      const response = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          From: FROM, To: to, Subject: subject, TextBody: text, HtmlBody: html,
          ...(REPLY_TO ? { ReplyTo: REPLY_TO } : {}),
        }),
      });
      const ok = response.ok;
      logEvent(ok ? 'email.sent' : 'email.failed', to, { subject, provider: 'postmark', status: response.status });
      return { sent: ok, mode: 'postmark', detail: ok ? '' : `Provider returned ${response.status}.` };
    }

    // Outbox mode: write it to disk so development can inspect exactly what
    // would have gone out, and nothing pretends to have been delivered.
    fs.mkdirSync(OUTBOX_DIR, { recursive: true });
    const filename = `${now().replace(/[:.]/g, '-')}-${id('eml')}.json`;
    fs.writeFileSync(path.join(OUTBOX_DIR, filename),
      JSON.stringify({ to, from: FROM, subject, text, html, at: now() }, null, 2));
    logEvent('email.outboxed', to, { subject });
    return {
      sent: false,
      mode: 'outbox',
      detail: 'No email provider is configured, so this was written to the outbox instead of being delivered.',
    };
  } catch (error) {
    logEvent('email.failed', to, { subject, error: String(error && error.message).slice(0, 200) });
    return { sent: false, mode: mode(), detail: 'The provider was unreachable.' };
  }
}

function status() {
  return {
    mode: mode(),
    configured: mode() !== 'outbox',
    from: FROM,
    note: mode() === 'outbox'
      ? 'No provider key is set, so emails are written to data/outbox rather than delivered. Set RESEND_API_KEY or POSTMARK_TOKEN and EMAIL_FROM to go live.'
      : `Delivering through ${mode()} as ${FROM}.`,
  };
}

module.exports = { send, status, mode, OUTBOX_DIR };
