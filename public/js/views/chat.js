import { el, clear, richText, setMeta, toast, money, longDate, countdown } from '../ui.js';
import { api, ApiError } from '../api.js';
import { store } from '../store.js';
import { openAuthDialog, sectionHeader, loadingBlock } from '../components.js';
import { navigate } from '../router.js';

const STARTERS = [
  'How should we split our budget?',
  'What should we be doing right now?',
  'What do our traditions need from a venue?',
  'How do we structure the guest list?',
  'What should we ask a venue before booking?',
];

export function renderChat() {
  setMeta(
    'The AETERNA AI wedding planner',
    'A private AI wedding planner that already knows your date, budget, guest count and cultural traditions.'
  );

  if (!store.user) return signedOutChat();
  if (store.user.role !== 'couple') {
    return el('section', { class: 'section' }, [
      el('div', { class: 'wrap-narrow' }, [
        el('div', { class: 'empty' }, [
          el('h3', {}, 'The planner is for couple accounts'),
          el('p', { class: 'muted' }, 'You are signed in as a vendor.'),
        ]),
      ]),
    ]);
  }
  return signedInChat();
}

/* ------------------------------------------------------------------ */

function signedOutChat() {
  const sample = [
    ['user', 'We have got £24,000, 140 guests, a Hindu ceremony on the Saturday and a civil ceremony on the Friday. Is that realistic?'],
    ['ai', 'It is workable, but the two days are doing most of the damage to the budget, so let us be precise about it.\n\nVenue and catering will take around £9,600 of the £24,000, which is roughly £69 a head. In South London that is a real number for a weekday or a Sunday, and it gets tight for a peak Saturday.\n\nThe two levers that actually move things are the guest count and the day of the week, in that order. Everything else is trimming.'],
    ['user', 'What does the Hindu ceremony need from the venue?'],
    ['ai', 'Three questions to ask on the first call, before you fall in love with a room.\n\n- Can they permit open flame for the havan, and do they need a fire plan in writing\n- Is a morning slot available, since the muhurtham timing usually sits early\n- Can a mandap be built in the space, and can it go up the night before\n\nIf a venue hesitates on the first one, that is your answer. Plenty of places in South London and Kent handle this comfortably.'],
  ];

  const log = el('div', { class: 'chat__log' }, sample.map(([role, text]) => el('div', {
    class: `bubble bubble--${role}`,
  }, role === 'ai' ? richText(text) : text)));

  return el('div', {}, [
    el('section', { class: 'section section--tight section--blush' }, [
      el('div', { class: 'wrap' }, [
        sectionHeader({
          eyebrow: 'The headline feature',
          title: 'A planner that already knows your wedding',
          lede: 'It reads your date, budget, guest count and traditions from your plan, so you never have to explain your own wedding twice. Create a free account to talk to it about yours.',
        }),
      ]),
    ]),
    el('section', { class: 'section' }, [
      el('div', { class: 'wrap' }, [
        el('div', { class: 'chat' }, [
          el('div', {}, [
            log,
            el('div', { class: 'panel panel--blush', style: 'margin-top:20px' }, [
              el('h3', { style: 'font-size:1.2rem' }, 'Ask it about your own wedding'),
              el('p', { style: 'margin-bottom:16px' },
                'Planning is free. Set up your plan and the planner answers using your real numbers rather than generic advice.'),
              el('div', { class: 'row', style: 'gap:12px' }, [
                el('button', {
                  class: 'btn btn--primary', type: 'button',
                  onclick: () => openAuthDialog({
                    reason: 'The planner needs a plan to read. A free account gives it your date, budget, guest count and traditions.',
                    onDone: () => navigate('#/chat'),
                  }),
                }, 'Create a free account'),
                el('a', { class: 'btn btn--quiet', href: '#/planner', 'data-link': '' }, 'Start with the plan'),
              ]),
            ]),
          ]),
          el('aside', { class: 'panel', style: 'position:sticky;top:96px' }, [
            el('h3', { style: 'font-size:1.15rem' }, 'What it knows'),
            el('ul', { style: 'list-style:none;padding:0;margin:0 0 18px' }, [
              'Your date and how far away it is',
              'Your budget and your guest count',
              'Your region',
              'The traditions you are combining',
            ].map((text) => el('li', { class: 'small', style: 'padding:8px 0;border-bottom:1px solid var(--line)' }, text))),
            el('h3', { style: 'font-size:1.15rem' }, 'What it will not do'),
            el('ul', { class: 'crosslist' }, [
              'Invent vendor names, prices or availability',
              'Quote statistics it cannot stand behind',
              'Give legal advice about notice or visas',
            ].map((text) => el('li', {}, [
              el('span', { 'aria-hidden': 'true', style: 'color:var(--coral-ink);font-weight:700' }, '×'),
              el('span', {}, text),
            ]))),
            el('a', { class: 'btn btn--ghost btn--sm btn--block', href: '#/fair-use', 'data-link': '' }, 'Read the fair use policy'),
          ]),
        ]),
      ]),
    ]),
  ]);
}

/* ------------------------------------------------------------------ */

function signedInChat() {
  const host = el('div', {}, [loadingBlock('Opening your planner')]);

  (async () => {
    let status = null;
    let messages = [];
    try {
      [status, messages] = await Promise.all([
        api.aiStatus(),
        api.aiMessages().then((d) => d.messages),
      ]);
    } catch (error) {
      toast(error.message, 'bad');
      status = {
        mode: 'offline', quota: 20, used: 0, remaining: 20, basis: 'total',
        modeReason: 'We could not reach the server to check, so this is the offline engine.',
      };
    }

    const wedding = store.wedding || {};
    const log = el('div', { class: 'chat__log', 'aria-live': 'polite', 'aria-label': 'Conversation with your planner' });

    const paint = () => {
      clear(log);
      if (!messages.length) {
        log.append(el('div', { class: 'bubble bubble--ai' },
          richText(greeting(wedding))));
      }
      for (const message of messages) {
        log.append(el('div', { class: `bubble bubble--${message.role === 'user' ? 'user' : 'ai'}` },
          message.role === 'user' ? message.content : richText(message.content)));
      }
      log.scrollTop = log.scrollHeight;
    };
    paint();

    const input = el('textarea', {
      rows: '2', placeholder: 'Ask about your budget, your timeline, your traditions, anything',
      'aria-label': 'Message the planner', maxlength: '4000',
    });
    const send = el('button', { class: 'btn btn--primary', type: 'submit' }, 'Send');

    const usageLine = el('p', { class: 'tiny muted', style: 'margin:10px 0 0' });
    const paintUsage = () => {
      const basis = status.basis === 'monthly' ? 'this month' : 'in total on the free plan';
      usageLine.textContent =
        `${status.remaining} of ${status.quota} planner messages left ${basis}, under the published fair use policy.`;
    };
    paintUsage();

    /*
     * The planner's mode, stated plainly.
     *
     * An earlier build reported "live" whenever an API key was present, which
     * was wrong: the key was being rejected and every answer came from the
     * offline engine. The server now probes the provider and reports what it
     * found, and this banner repeats it rather than assuming.
     */
    const modeBanner = status.mode === 'live'
      ? el('div', { class: 'notice notice--good', style: 'margin-bottom:18px' }, [
        el('div', {}, [
          el('strong', {}, 'The live planner is answering. '),
          `Running on ${status.model}.`,
        ]),
      ])
      : el('div', { class: 'notice notice--info', style: 'margin-bottom:18px' }, [
        el('div', {}, [
          el('strong', {}, 'The offline planning engine is answering. '),
          status.modeReason || 'No live model is connected right now.',
          ' It still does real arithmetic on your budget, date and guest count, and it will tell you when it cannot help.',
        ]),
      ]);

    const form = el('form', { class: 'chat__composer' }, [input, send]);

    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      messages = messages.concat({ role: 'user', content: text });
      paint();

      const thinking = el('div', { class: 'bubble bubble--ai' }, [
        el('span', { class: 'typing' }, [el('i'), el('i'), el('i')]),
        el('span', { class: 'sr-only' }, 'The planner is thinking'),
      ]);
      log.append(thinking);
      log.scrollTop = log.scrollHeight;
      send.disabled = true;

      try {
        const result = await api.aiChat(text);
        messages = messages.concat({ role: 'assistant', content: result.reply });
        status.remaining = result.usage.remaining;
        status.quota = result.usage.quota;
        status.mode = result.mode;
        if (result.degraded && result.degradedReason) toast(result.degradedReason);
        paintUsage();
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'The planner could not answer just then.';
        messages = messages.concat({ role: 'assistant', content: message });
        if (error instanceof ApiError && error.status === 402) {
          status.remaining = 0;
          paintUsage();
        }
      } finally {
        thinking.remove();
        send.disabled = false;
        paint();
        input.focus();
      }
    };

    form.addEventListener('submit', (event) => { event.preventDefault(); submit(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
    });

    const starters = el('div', { class: 'suggest' }, STARTERS.map((text) => el('button', {
      class: 'pill', type: 'button',
      onclick: () => { input.value = text; submit(); },
    }, text)));

    const count = countdown(wedding.weddingDate);
    const context = el('aside', { class: 'panel', style: 'position:sticky;top:96px' }, [
      el('h3', { style: 'font-size:1.15rem' }, 'What the planner can see'),
      el('dl', { style: 'margin:0 0 18px' }, [
        pair('Date', wedding.weddingDate ? longDate(wedding.weddingDate) : 'Not set'),
        count ? pair('Countdown', count.label) : null,
        pair('Budget', wedding.budgetPence ? money(wedding.budgetPence) : 'Not set'),
        pair('Guests', wedding.guestCount ? String(wedding.guestCount) : 'Not set'),
        pair('Region', wedding.region || 'Not set'),
        pair('Traditions', (wedding.traditions && wedding.traditions.length) ? wedding.traditions.join(', ') : 'None recorded'),
      ]),
      el('a', { class: 'btn btn--quiet btn--sm btn--block', href: '#/planner?tab=details', 'data-link': '' }, 'Update these details'),
      el('hr', { class: 'divider' }),
      el('p', { class: 'tiny muted' },
        'The planner will not invent vendor names, prices or availability, and it will point you at your register office for anything legal.'),
      el('a', { class: 'btn btn--ghost btn--sm btn--block', href: '#/fair-use', 'data-link': '' }, 'Fair use policy'),
      messages.length ? el('button', {
        class: 'linkish tiny', type: 'button', style: 'margin-top:16px',
        onclick: async () => {
          await api.aiClear();
          messages = [];
          paint();
          toast('Conversation cleared. Your plan is untouched.', 'good');
        },
      }, 'Clear this conversation') : null,
    ]);

    host.replaceChildren(
      el('section', { class: 'section section--tight section--blush' }, [
        el('div', { class: 'wrap' }, [
          el('p', { class: 'eyebrow' }, 'Your AI wedding planner'),
          el('h1', { style: 'font-size:clamp(1.9rem,4vw,2.8rem);margin-bottom:8px' }, 'Ask it anything about your wedding'),
          el('p', { class: 'lede' }, 'It already has your date, budget, guest count and traditions, so you can get straight to the question.'),
        ]),
      ]),
      el('section', { class: 'section' }, [
        el('div', { class: 'wrap' }, [
          el('div', { class: 'chat' }, [
            el('div', {}, [modeBanner, log, form, usageLine, starters]),
            context,
          ]),
        ]),
      ])
    );
    input.focus();
  })();

  return host;

  function pair(term, value) {
    return el('div', { style: 'padding:8px 0;border-bottom:1px solid var(--line)' }, [
      el('dt', { class: 'tiny muted', style: 'text-transform:uppercase;letter-spacing:.07em;font-weight:700' }, term),
      el('dd', { class: 'small', style: 'margin:3px 0 0;font-weight:600' }, value),
    ]);
  }
}

function greeting(wedding) {
  const bits = [];
  if (wedding.region) bits.push(wedding.region);
  if (wedding.weddingDate) bits.push(longDate(wedding.weddingDate));
  if (wedding.guestCount) bits.push(`${wedding.guestCount} guests`);
  if (wedding.budgetPence) bits.push(money(wedding.budgetPence));
  if (wedding.traditions && wedding.traditions.length) bits.push(wedding.traditions.join(' and '));

  if (!bits.length) {
    return 'I am your planner. Add your date, budget and guest count in the plan and I can do real arithmetic rather than generic advice. Ask me anything in the meantime.';
  }
  return `I have got your wedding loaded: ${bits.join(', ')}.\n\nAsk me for a budget split, a countdown from today, what your traditions need from a venue, or what to do next.`;
}
