import { el, setMeta, toast, longDate } from '../ui.js';
import { api, ApiError } from '../api.js';
import { loadingBlock, errorBlock } from '../components.js';

/**
 * A guest's personal reply page. Public by design: nobody should need an
 * account to say yes to a wedding. The token in the link is the whole secret
 * and reveals only this one guest's own row.
 */
export function renderRsvp(token) {
  setMeta('Reply to an invitation, AETERNA', 'Reply to a wedding invitation.');
  const host = el('div', {}, [loadingBlock('Finding your invitation')]);

  (async () => {
    let data;
    try { data = await api.rsvpGet(token); }
    catch (error) { host.replaceChildren(errorBlock(error.message)); return; }

    let choice = data.rsvp === 'pending' ? null : data.rsvp;

    const yesBtn = el('button', { type: 'button', class: 'pill', style: 'font-size:1.05rem;padding:12px 26px' }, 'Joyfully yes');
    const noBtn = el('button', { type: 'button', class: 'pill', style: 'font-size:1.05rem;padding:12px 26px' }, 'Sadly not');
    const paintChoice = () => {
      yesBtn.setAttribute('aria-pressed', String(choice === 'yes'));
      noBtn.setAttribute('aria-pressed', String(choice === 'no'));
    };
    yesBtn.addEventListener('click', () => { choice = 'yes'; paintChoice(); });
    noBtn.addEventListener('click', () => { choice = 'no'; paintChoice(); });
    paintChoice();

    const dietary = el('input', {
      type: 'text', maxlength: '200', value: data.dietary || '',
      placeholder: 'Vegetarian, halal, allergies, anything the kitchen should know',
    });
    const note = el('textarea', { rows: '2', maxlength: '500', placeholder: 'A note for the couple, optional' }, data.note || '');

    const form = el('form', { novalidate: '' }, [
      el('div', { class: 'row', style: 'gap:12px;margin-bottom:20px' }, [yesBtn, noBtn]),
      el('label', { class: 'field' }, [el('span', {}, 'Dietary needs'), dietary]),
      el('label', { class: 'field' }, [el('span', {}, 'Anything else'), note]),
      el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Send my reply'),
    ]);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!choice) { toast('Pick yes or no first.', 'bad'); return; }
      try {
        const result = await api.rsvpPost(token, { rsvp: choice, dietary: dietary.value, note: note.value });
        host.replaceChildren(el('section', { class: 'section' }, [
          el('div', { class: 'wrap-narrow center' }, [
            el('div', { class: 'panel panel--blush', style: 'padding:clamp(28px,5vw,48px)' }, [
              el('h1', { style: 'font-size:clamp(1.8rem,4vw,2.6rem)' },
                result.rsvp === 'yes' ? 'See you there' : 'They will miss you'),
              el('p', { class: 'lede' }, result.note),
            ]),
          ]),
        ]));
        if (result.rsvp === 'yes') {
          const { celebrate } = await import('../ui.js');
          celebrate();
        }
      } catch (error) {
        toast(error instanceof ApiError ? error.message : 'That did not send. Please try again.', 'bad');
      }
    });

    host.replaceChildren(el('section', { class: 'section section--blush' }, [
      el('div', { class: 'wrap-narrow' }, [
        el('p', { class: 'eyebrow center' }, 'You are invited'),
        el('h1', { class: 'center', style: 'font-size:clamp(2rem,5vw,3.2rem)' }, data.couple),
        el('p', { class: 'lede center', style: 'margin:0 auto 8px' },
          `${data.weddingDate ? longDate(data.weddingDate) : 'Date to be confirmed'}${data.region ? `, ${data.region}` : ''}`),
        el('p', { class: 'center muted', style: 'margin-bottom:28px' }, `Hello ${data.guestName}. Two taps and you are done.`),
        el('div', { class: 'panel', style: 'max-width:520px;margin:0 auto' }, [form]),
      ]),
    ]));
  })();

  return host;
}
