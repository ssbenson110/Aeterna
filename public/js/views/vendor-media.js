import { el, clear, setMeta, toast, shortDate, tickIcon } from '../ui.js';
import { api, ApiError } from '../api.js';
import { store } from '../store.js';
import { loadingBlock, errorBlock, verifiedBadge } from '../components.js';

/**
 * Vendor side of verification and image management.
 *
 * Two principles here:
 *
 * 1. Tell the vendor exactly which checks are outstanding and which of those are
 *    waiting on us rather than on them. "Verification in progress" with no
 *    detail is useless and makes us look slow when we might be waiting on them.
 *
 * 2. Nothing on this page can award a badge. The one thing a vendor genuinely
 *    completes is the written rights confirmation, and that is theirs to give
 *    because nobody else can honestly give it.
 */

/* ------------------------------------------------------------------ */
/* verification progress                                               */
/* ------------------------------------------------------------------ */

export function verificationPanel(onChange) {
  const host = el('div', { class: 'panel', style: 'margin-bottom:20px' }, [loadingBlock('Checking your status')]);

  const load = async () => {
    let data;
    try { data = await api.myVerification(); }
    catch (error) { host.replaceChildren(errorBlock(error.message, load)); return; }

    const yours = data.checks.filter((c) => c.yoursToDo && c.status !== 'passed');
    const ours = data.checks.filter((c) => c.waitingOnUs);

    clear(host).append(
      el('div', { class: 'row row--between', style: 'margin-bottom:12px' }, [
        el('h3', { style: 'margin:0;font-size:1.2rem' }, 'AETERNA Verified'),
        data.verified ? verifiedBadge() : el('span', { class: 'badge badge--plain' }, `${data.completed} of ${data.total} checks`),
      ]),

      data.verified
        ? el('p', { class: 'small', style: 'margin-bottom:12px;color:var(--sage-ink);font-weight:600' },
          `All six checks are complete.${data.recheckDueOn ? ` The annual re-check is due on ${data.recheckDueOn}.` : ''}`)
        : el('div', { class: 'meter meter--sage', style: 'margin-bottom:14px' }, [
          el('span', { style: `width:${Math.round((data.completed / data.total) * 100)}%` }),
        ]),

      data.badgeRemovedReason
        ? el('div', { class: 'notice notice--warn', style: 'margin-bottom:14px' }, [
          el('div', {}, [el('strong', {}, 'The badge is not showing. '), data.badgeRemovedReason]),
        ])
        : null,

      el('div', {}, data.checks.map((check) => el('div', {
        class: 'row row--between', style: 'padding:8px 0;border-top:1px solid var(--line)',
      }, [
        el('span', { class: 'small' }, check.label),
        el('span', {
          class: `badge ${check.status === 'passed' ? 'badge--verified' : check.status === 'failed' ? 'badge--coral' : 'badge--plain'}`,
        }, check.status === 'passed' ? 'Done'
          : check.status === 'failed' ? 'Needs attention'
            : check.yoursToDo ? 'Over to you' : 'With our team'),
      ]))),

      yours.length
        ? el('p', { class: 'small', style: 'margin:14px 0 0' },
          'One thing is waiting on you: confirm your image rights below.')
        : ours.length
          ? el('p', { class: 'small muted', style: 'margin:14px 0 0' },
            `${ours.length} ${ours.length === 1 ? 'check is' : 'checks are'} with our team. Nothing is needed from you on those.`)
          : null,

      data.insurance.status !== 'valid' && data.insurance.present
        ? el('p', { class: 'small', style: 'margin:12px 0 0;color:var(--coral-deep)' },
          `Insurance: ${data.insurance.label}. Send us the renewed certificate and we will update it.`)
        : null,

      el('p', { class: 'tiny muted', style: 'margin:14px 0 0' }, data.note),
      el('a', { class: 'btn btn--ghost btn--sm', href: '#/verification', 'data-link': '', style: 'margin-top:12px' },
        'What each check covers'),
    );
    if (onChange) onChange(data);
  };

  load();
  host.reload = load;
  return host;
}

/* ------------------------------------------------------------------ */
/* images                                                             */
/* ------------------------------------------------------------------ */

/**
 * Downscale in the browser before uploading.
 *
 * A phone photo is often 8MB, which would bounce off the size cap for no good
 * reason, and a profile never needs more than about 2000px. Doing this client
 * side keeps uploads fast and means the server never has to decode an image,
 * which matters because there is no image library in this project.
 */
async function prepareImage(file, maxEdge = 2000, quality = 0.85) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    throw new Error('Please choose a JPEG, PNG or WebP image.');
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { blob: file, type: file.type };

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1_500_000) return { blob: file, type: file.type };

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  // PNG is kept as PNG so graphics with flat colour do not pick up JPEG noise.
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) return { blob: file, type: file.type };
  return { blob, type };
}

export function imagesPanel() {
  const host = el('div', { class: 'panel' }, [loadingBlock('Loading your images')]);

  const load = async () => {
    let data;
    try { data = await api.myImages(); }
    catch (error) { host.replaceChildren(errorBlock(error.message, load)); return; }

    clear(host);
    host.append(
      el('div', { class: 'row row--between', style: 'margin-bottom:6px' }, [
        el('h3', { style: 'margin:0;font-size:1.2rem' }, 'Your photographs'),
        el('span', { class: 'tiny muted' }, `${data.images.length} of ${data.maxImages}`),
      ]),
      el('p', { class: 'tiny muted', style: 'margin-bottom:16px' },
        `JPEG, PNG or WebP, up to ${Math.round(data.maxBytes / (1024 * 1024))}MB each. Large photos are resized in your browser before they are sent.`)
    );

    if (!data.rightsConfirmed) {
      host.append(rightsGate(load));
      return;
    }

    /* ---- upload control ---- */
    const fileInput = el('input', {
      type: 'file', accept: data.accepts.join(','), 'aria-label': 'Choose an image',
    });
    const altInput = el('input', {
      type: 'text', maxlength: '200', placeholder: 'Describe the photograph in a few words',
      'aria-label': 'Alt text for the image',
    });
    const status = el('p', { class: 'small', style: 'margin:10px 0 0', 'aria-live': 'polite' });

    const form = el('form', { style: 'margin-bottom:20px' }, [
      el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:14px' }, [
        el('label', { class: 'field', style: 'margin:0' }, [el('span', {}, 'Image'), fileInput]),
        el('label', { class: 'field', style: 'margin:0' }, [
          el('span', {}, 'Alt text'), altInput,
          el('span', { class: 'hint' }, 'Required. It is what a screen reader reads out.'),
        ]),
      ]),
      el('button', { class: 'btn btn--primary btn--sm', type: 'submit', style: 'margin-top:12px' }, 'Upload'),
      status,
    ]);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const file = fileInput.files && fileInput.files[0];
      if (!file) { status.textContent = 'Choose an image first.'; return; }
      if (altInput.value.trim().length < 4) { status.textContent = 'Add a few words of alt text first.'; return; }

      status.textContent = 'Preparing the image';
      try {
        const { blob, type } = await prepareImage(file);
        status.textContent = `Uploading ${Math.round(blob.size / 1024)}KB`;
        await api.uploadImage(blob, type, altInput.value, data.images.length === 0);
        altInput.value = '';
        fileInput.value = '';
        status.textContent = '';
        toast('Uploaded. It is on your public profile now.', 'good');
        load();
      } catch (error) {
        status.textContent = '';
        toast(error instanceof ApiError ? error.message : error.message, 'bad');
      }
    });
    host.append(form);

    /* ---- gallery ---- */
    if (!data.images.length) {
      host.append(el('div', { class: 'empty' }, [
        el('h4', {}, 'No photographs yet'),
        el('p', { class: 'muted small' },
          'Your profile shows no imagery until you add your own. We would rather show nothing than put stock photography on your listing as though it were your work.'),
      ]));
      return;
    }

    host.append(el('div', { class: 'grid grid--3' }, data.images.map((image) => {
      const alt = el('input', { type: 'text', value: image.alt, maxlength: '200', 'aria-label': `Alt text for ${image.alt}` });
      return el('figure', { class: 'card', style: 'margin:0;padding:0' }, [
        el('div', { class: 'media media--4x3' }, [
          el('img', { src: image.url, alt: image.alt, loading: 'lazy' }),
        ]),
        el('div', { style: 'padding:14px' }, [
          image.isHero
            ? el('span', { class: 'badge badge--verified', style: 'margin-bottom:10px' }, [tickIcon(), 'Main image'])
            : el('button', {
              class: 'btn btn--quiet btn--sm', type: 'button', style: 'margin-bottom:10px',
              onclick: async () => {
                try { await api.updateImage(image.id, { isHero: true }); toast('Set as your main image.', 'good'); load(); }
                catch (error) { toast(error.message, 'bad'); }
              },
            }, 'Make this the main image'),
          el('label', { class: 'field', style: 'margin:0' }, [
            el('span', { class: 'tiny' }, 'Alt text'), alt,
          ]),
          el('div', { class: 'row', style: 'gap:10px;margin-top:10px' }, [
            el('button', {
              class: 'linkish tiny', type: 'button',
              onclick: async () => {
                try { await api.updateImage(image.id, { alt: alt.value }); toast('Saved.', 'good'); }
                catch (error) { toast(error.message, 'bad'); }
              },
            }, 'Save alt text'),
            el('button', {
              class: 'linkish tiny', type: 'button',
              onclick: async () => {
                try { await api.removeImage(image.id); toast('Removed.', 'good'); load(); }
                catch (error) { toast(error.message, 'bad'); }
              },
            }, 'Remove'),
          ]),
        ]),
      ]);
    })));
  };

  load();
  return host;
}

/**
 * The written rights confirmation. It gates uploads, and it is one of the six
 * published checks, so the wording here and the wording in the scope are the
 * same sentence coming from the same place on the server.
 */
function rightsGate(reload) {
  const box = el('input', { type: 'checkbox', id: 'rights-confirm' });
  const wrapper = el('div', { class: 'panel panel--gold' }, [
    el('h4', { style: 'margin-bottom:8px' }, 'One thing first: image rights'),
    el('p', { class: 'small', style: 'margin-bottom:14px' },
      'This is one of the six published verification checks, and it is the only one you complete yourself. We ask because a profile full of images somebody else shot is the fastest way for a marketplace to lose everyone\'s trust.'),
  ]);

  const statement = el('p', {
    class: 'small', style: 'background:var(--paper);padding:14px 16px;border-radius:var(--r-sm);margin-bottom:14px',
  }, 'Loading the confirmation wording');

  wrapper.append(statement);
  wrapper.append(el('label', { class: 'checkline' }, [box, el('span', { class: 'small' }, 'I confirm the statement above')]));

  const submit = el('button', { class: 'btn btn--primary btn--sm', type: 'button', style: 'margin-top:12px' },
    'Confirm and enable uploads');
  wrapper.append(submit);

  let statementText = '';
  api.myVerification()
    .then((data) => { statementText = data.rightsStatement; statement.textContent = statementText; })
    .catch(() => { statement.textContent = 'We could not load the confirmation wording. Please reload the page.'; });

  submit.addEventListener('click', async () => {
    if (!box.checked) { toast('Tick the box to confirm.', 'bad'); return; }
    try {
      const result = await api.confirmRights(statementText);
      toast(result.note, 'good');
      reload();
    } catch (error) { toast(error.message, 'bad'); }
  });

  return wrapper;
}
