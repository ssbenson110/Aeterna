import { el, confetti, money, tickIcon, setMeta } from '../ui.js';
import { store } from '../store.js';
import { sectionHeader, promiseStrip, verifiedBadge } from '../components.js';
import { navigate } from '../router.js';

export function renderHome() {
  setMeta(
    'AETERNA, one AI planner and one verified vendor for your UK wedding',
    'AETERNA helps modern multicultural couples plan their whole UK wedding with one private AI planner, then sends each enquiry to one verified vendor, never a bidding swarm.'
  );

  const meta = store.meta || {};
  const images = meta.images || { hero: [], couples: [], categoryTiles: {} };
  const categories = meta.categories || [];
  const pricing = store.pricing || null;

  const page = el('div');

  /* ---------------- hero ---------------- */

  const hero = el('section', { class: 'hero' }, [
    el('div', { class: 'hero__inner' }, [
      el('div', {}, [
        el('p', { class: 'eyebrow' }, 'South London and Kent'),
        el('h1', {}, [
          'Plan your whole wedding with ',
          el('em', {}, 'one private AI planner'),
          ', then send each enquiry to one verified vendor.',
        ]),
        el('p', { class: 'lede', style: 'margin-bottom:28px' },
          'Built for modern multicultural couples who are combining two sets of traditions and would rather have one real conversation than ten cold calls. Never a bidding swarm.'),
        el('div', { class: 'row', style: 'gap:14px;margin-bottom:22px' }, [
          el('button', {
            class: 'btn btn--primary btn--lg', type: 'button',
            onclick: () => navigate('#/planner'),
          }, 'Start your free Wedding Reality Plan'),
          el('a', { class: 'btn btn--quiet btn--lg', href: '#/chat', 'data-link': '' }, 'Meet the AI planner'),
        ]),
        el('p', { class: 'small muted', style: 'margin:0' },
          'About 10 minutes to a real plan. You can start straight away, and saving it needs a free account.'),
      ]),
      el('div', { class: 'hero__collage' }, (images.hero || []).slice(0, 3).map((image, index) => el('figure', {}, [
        el('img', {
          src: image.url, alt: image.alt,
          loading: index === 0 ? 'eager' : 'lazy',
          fetchpriority: index === 0 ? 'high' : 'auto',
          decoding: 'async',
        }),
      ]))),
    ]),
  ]);
  confetti(hero, 48);
  page.append(hero);

  /* ---------------- the promise ---------------- */

  page.append(el('section', { class: 'section section--tight section--wash' }, [
    el('div', { class: 'wrap' }, [promiseStrip()]),
  ]));

  /* ---------------- how it works ---------------- */

  const steps = [
    ['Tell us about the wedding', 'Your date, your budget, your guest count and the traditions you are bringing together. It takes about ten minutes.'],
    ['Plan it with the AI planner', 'A private planner that already knows all of that. Budget splits, running orders, what your traditions need from a venue, and what to do next.'],
    ['Send one enquiry at a time', 'When you are ready, one enquiry goes to one verified vendor who fits. They reply, or we pass it to one other. Nobody gets your details but them.'],
  ];

  page.append(el('section', { class: 'section' }, [
    el('div', { class: 'wrap' }, [
      sectionHeader({
        eyebrow: 'How it works',
        title: 'Three steps, and no inbox full of quotes you did not ask for',
      }),
      el('div', { class: 'grid grid--3' }, steps.map(([title, text], index) => el('div', { class: 'panel', style: 'height:100%' }, [
        el('div', {
          style: 'width:44px;height:44px;border-radius:50%;background:var(--coral-cta);color:#fff;display:grid;place-items:center;font-family:var(--display);font-size:1.3rem;font-weight:700;margin-bottom:16px',
          'aria-hidden': 'true',
        }, String(index + 1)),
        el('h3', { style: 'font-size:1.25rem' }, title),
        el('p', { class: 'muted', style: 'margin:0;font-size:.97rem' }, text),
      ]))),
    ]),
  ]));

  /* ---------------- AI planner feature ---------------- */

  const chatSample = el('div', {
    class: 'card', style: 'padding:24px;background:var(--paper)',
  }, [
    el('div', { class: 'bubble bubble--user', style: 'margin-bottom:14px;max-width:100%' },
      'We are having a Hindu ceremony on the Saturday and a civil ceremony on the Friday. 140 guests, £24,000. Where does that money actually go?'),
    el('div', { class: 'bubble bubble--ai', style: 'max-width:100%' }, [
      el('p', { style: 'margin-bottom:.6em' }, 'Two days changes the arithmetic, so here is the honest version. Venue and catering will take around £9,600 of that, which is about £69 a head.'),
      el('p', { style: 'margin:0' }, 'The mandap needs open flame permission and a morning slot, so ask any venue about fire regulations on the first call rather than the third.'),
    ]),
    el('p', { class: 'tiny muted', style: 'margin:16px 0 0' },
      'An example of the kind of answer the planner gives. It uses the date, budget, guest count and traditions in your own plan.'),
  ]);

  page.append(el('section', { class: 'section section--blush' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'grid grid--2', style: 'align-items:center;gap:clamp(28px,5vw,64px)' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow' }, 'The headline feature'),
          el('h2', {}, 'An AI planner that already knows your date, your budget and your traditions'),
          el('p', { class: 'lede' },
            'You should not have to explain your own wedding every time you ask a question. The planner reads your plan, does the arithmetic and tells you what to do next.'),
          el('ul', { class: 'ticklist' }, [
            'Budget splits with a real per head figure',
            'What each of your traditions needs from a venue',
            'A countdown built from your actual date',
            'Guest list structure and RSVP timing',
          ].map((text) => el('li', {}, [tickIcon('var(--coral-ink)'), el('span', {}, text)]))),
          el('div', { class: 'row', style: 'gap:12px' }, [
            el('a', { class: 'btn btn--primary', href: '#/chat', 'data-link': '' }, 'Open the AI planner'),
            el('a', { class: 'btn btn--ghost', href: '#/fair-use', 'data-link': '' }, 'Read the fair use policy'),
          ]),
        ]),
        chatSample,
      ]),
    ]),
  ]));

  /* ---------------- categories ---------------- */

  page.append(el('section', { class: 'section' }, [
    el('div', { class: 'wrap' }, [
      sectionHeader({
        eyebrow: 'Browse vendors',
        title: 'Five categories, every one of them enquiry by enquiry',
        lede: 'Search by category, region and the traditions a vendor has worked with. Verified vendors appear first, and position is never for sale.',
      }),
      el('div', { class: 'grid grid--3' }, categories.map((category) => {
        const image = (images.categoryTiles || {})[category.slug] || {};
        return el('a', {
          class: 'card card--link', href: `#/browse?category=${category.slug}`, 'data-link': '',
        }, [
          el('div', { class: 'media media--3x2' }, [
            el('img', { src: image.url, alt: image.alt || '', loading: 'lazy', decoding: 'async' }),
          ]),
          el('div', { style: 'padding:20px 22px 24px' }, [
            el('h3', { style: 'font-size:1.25rem;margin-bottom:6px' }, category.label),
            el('p', { class: 'small muted', style: 'margin:0' }, category.blurb),
          ]),
        ]);
      })),
    ]),
  ]));

  /* ---------------- verification ---------------- */

  page.append(el('section', { class: 'section section--sage' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'grid grid--2', style: 'align-items:center;gap:clamp(28px,5vw,56px)' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow eyebrow--sage' }, 'What the badge means'),
          el('h2', {}, 'AETERNA Verified is a published checklist, not a compliment'),
          el('p', { class: 'lede' },
            'Identity, insurance, references, portfolio rights, a live video call and an annual re-check. Every check is written down, and the badge comes off if any of them lapses.'),
          el('div', { class: 'row', style: 'gap:12px;margin-top:8px' }, [
            verifiedBadge(),
            el('a', { class: 'btn btn--ghost btn--sm', href: '#/verification', 'data-link': '' }, 'Read the full scope'),
          ]),
        ]),
        el('div', { class: 'panel', style: 'background:var(--paper)' }, [
          el('h4', { style: 'margin-bottom:14px' }, 'What it does not mean'),
          el('ul', { class: 'crosslist' }, [
            'It is not a rating of quality, taste or value.',
            'It is not a guarantee of the work a vendor will produce.',
            'AETERNA is not party to the contract between you and a vendor.',
          ].map((text) => el('li', {}, [
            el('span', { 'aria-hidden': 'true', style: 'color:var(--coral-ink);font-weight:700' }, '×'),
            el('span', {}, text),
          ]))),
        ]),
      ]),
    ]),
  ]));

  /* ---------------- pricing teaser ---------------- */

  const coupleUpgrade = pricing ? money(pricing.couple.upgradePricePence) : '£49';
  const vendorFounding = pricing ? money(pricing.vendor.foundingPricePence) : '£29';
  const vendorStandard = pricing ? money(pricing.vendor.standardPricePence) : '£49';

  page.append(el('section', { class: 'section' }, [
    el('div', { class: 'wrap' }, [
      sectionHeader({
        eyebrow: 'Pricing',
        title: 'Two audiences, one honest page',
        align: 'center',
      }),
      el('div', { class: 'grid grid--2' }, [
        el('div', { class: 'plan plan--feature' }, [
          el('p', { class: 'eyebrow' }, 'Couples'),
          el('p', { class: 'price' }, ['Free', el('small', {}, ' to plan')]),
          el('p', { class: 'muted', style: 'margin-top:14px' },
            `Plan the whole wedding for nothing. One optional upgrade of ${coupleUpgrade} per wedding, paid once. It is not a subscription.`),
          el('a', { class: 'btn btn--primary', href: '#/pricing', 'data-link': '', style: 'margin-top:auto' }, 'See what the upgrade adds'),
        ]),
        el('div', { class: 'plan' }, [
          el('p', { class: 'eyebrow eyebrow--gold' }, 'Vendors'),
          el('p', { class: 'price' }, [vendorFounding, el('small', {}, ' a month')]),
          el('p', { class: 'muted', style: 'margin-top:14px' },
            `Founding rate for the first ${pricing ? pricing.vendor.foundingSlots : 40} vendors, locked for 12 months, then ${vendorStandard} a month. One plan, no higher tier, and no paid ranking.`),
          el('a', { class: 'btn btn--ink', href: '#/for-vendors', 'data-link': '', style: 'margin-top:auto' }, 'How it works for vendors'),
        ]),
      ]),
    ]),
  ]));

  /* ---------------- closing ---------------- */

  const closingImage = (images.couples || [])[2] || (images.hero || [])[0] || {};
  page.append(el('section', { class: 'section section--wash' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'card', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));align-items:stretch' }, [
        el('div', { class: 'media', style: 'min-height:320px' }, [
          el('img', { src: closingImage.url, alt: closingImage.alt || '', loading: 'lazy', decoding: 'async' }),
        ]),
        el('div', { style: 'padding:clamp(28px,4vw,48px);display:flex;flex-direction:column;justify-content:center' }, [
          el('h2', { style: 'font-size:clamp(1.7rem,3vw,2.4rem)' }, 'Start with the plan, not the phone calls'),
          el('p', { class: 'lede' },
            'Ten minutes gets you a budget split, a countdown and a checklist built around your traditions. Enquiries can wait until you actually want one.'),
          el('div', { class: 'row', style: 'gap:12px;margin-top:8px' }, [
            el('button', {
              class: 'btn btn--primary btn--lg', type: 'button', onclick: () => navigate('#/planner'),
            }, 'Start your free plan'),
            el('a', { class: 'btn btn--quiet btn--lg', href: '#/browse', 'data-link': '' }, 'Browse vendors first'),
          ]),
        ]),
      ]),
    ]),
  ]));

  return page;
}
