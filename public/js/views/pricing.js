import { el, money, setMeta, tickIcon, toast, celebrate } from '../ui.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { sectionHeader, openAuthDialog } from '../components.js';
import { navigate } from '../router.js';

export function renderPricing() {
  setMeta(
    'Pricing for couples and vendors, AETERNA',
    'Couples plan free with one optional £49 upgrade per wedding. Vendors pay one flat monthly fee, £29 founding or £49 standard, with no paid ranking.'
  );

  const pricing = store.pricing || {
    vendor: { foundingPricePence: 2900, standardPricePence: 4900, foundingSlots: 40, foundingLockMonths: 12, founding: { open: true } },
    couple: { upgradePricePence: 4900 },
  };
  const vendor = pricing.vendor;
  const couple = pricing.couple;

  const page = el('div');

  page.append(el('section', { class: 'section section--tight section--blush' }, [
    el('div', { class: 'wrap' }, [
      sectionHeader({
        eyebrow: 'Pricing',
        title: 'Two audiences, one page, no small print',
        lede: 'Couples plan for free. Vendors pay one flat monthly fee. There is no tier above either of these, and ranking is never for sale.',
        align: 'center',
      }),
    ]),
  ]));

  /* ---------------- couples ---------------- */

  const free = couple.freeLimits || {};
  const paid = couple.upgradedLimits || {};

  const coupleFree = el('div', { class: 'plan' }, [
    el('p', { class: 'eyebrow' }, 'Couples, free'),
    el('p', { class: 'price' }, ['Free', el('small', {}, ' to start')]),
    el('p', { class: 'muted', style: 'margin-top:14px' },
      'Enough to build a real plan and see how the routing works. It stays yours and nothing is ever taken away, but it is deliberately limited.'),
    el('h4', { style: 'margin-top:20px' }, 'What you get'),
    el('ul', { class: 'ticklist' }, [
      'The checklist, all of it',
      'The budget, with the split done for you',
      `${free.aiMessagesTotal || 20} AI planner messages in total`,
      `${free.enquiries || 1} enquiry, routed to one verified vendor`,
    ].map(tick)),
    el('h4', { style: 'margin-top:6px' }, 'What it does not include'),
    el('ul', { class: 'crosslist' }, [
      'The guest list and RSVP tracking',
      'The seating designer',
      'The day timeline',
      'The shared page with your planner and vendors',
      'Exporting your plan',
    ].map(cross)),
    el('button', {
      class: 'btn btn--quiet btn--block', type: 'button', style: 'margin-top:auto',
      onclick: () => navigate('#/planner'),
    }, 'Start free'),
  ]);

  const coupleUpgrade = el('div', { class: 'plan plan--feature' }, [
    el('p', { class: 'eyebrow' }, 'Couples, the upgrade'),
    el('p', { class: 'price' }, [money(couple.upgradePricePence), el('small', {}, ' once')]),
    el('p', { class: 'muted', style: 'margin-top:14px' },
      'Paid once per wedding. It is not a subscription, it will never renew, and there is no second charge.'),
    el('h4', { style: 'margin-top:20px' }, 'Everything in free, plus')
    ,
    el('ul', { class: 'ticklist' }, [
      'The guest list, RSVPs and dietary notes',
      'The seating designer with round, square, banquet and top tables',
      'The day timeline shared with every supplier',
      'The shared page for your planner and booked vendors',
      `${paid.aiMessagesMonthly || 400} AI planner messages a month`,
      'Unlimited enquiries, still one vendor at a time',
      'Full plan export',
    ].map(tick)),
    store.user && store.wedding && store.wedding.upgraded
      ? el('p', { class: 'badge badge--verified', style: 'margin-top:auto' }, 'This wedding is upgraded')
      : el('button', {
        class: 'btn btn--primary btn--block', type: 'button', style: 'margin-top:auto',
        onclick: async () => {
          if (!store.user) {
            openAuthDialog({ reason: 'Create your free plan first. You can upgrade whenever you are ready.', onDone: () => navigate('#/planner') });
            return;
          }
          try {
            const checkout = await api.coupleCheckout();
            if (checkout.checkoutUrl) { window.location.href = checkout.checkoutUrl; return; }
          } catch (error) {
            if (error && error.status === 409) { toast(error.message, 'bad'); return; }
          }
          try {
            const result = await api.upgrade();
            celebrate();
            toast(`Upgrade recorded. ${result.note}`, 'good');
            await store.refresh();
            navigate('#/planner?tab=details');
          } catch (error) { toast(error.message, 'bad'); }
        },
      }, `Upgrade for ${money(couple.upgradePricePence)}`),
  ]);

  page.append(el('section', { class: 'section' }, [
    el('div', { class: 'wrap' }, [
      el('h2', { style: 'margin-bottom:8px' }, 'For couples'),
      el('p', { class: 'lede', style: 'margin-bottom:22px' },
        'Start free, pay once when you need the rest. There is no monthly charge for couples and there never will be.'),
      el('div', { class: 'grid grid--2' }, [coupleFree, coupleUpgrade]),
      el('div', { class: 'notice notice--info', style: 'margin-top:20px' }, [
        el('div', {}, [
          el('strong', {}, 'What happens when you reach a free limit. '),
          'Nothing you have built is hidden, locked or deleted. Your checklist, your budget and any enquiry you sent stay exactly as they are, and stay editable. The cap only stops the next new thing.',
        ]),
      ]),
      el('p', { class: 'small muted', style: 'margin-top:16px' }, [
        'The AI planner has a published fair use allowance rather than an unlimited claim. ',
        el('a', { href: '#/fair-use', 'data-link': '' }, 'Read the policy'),
        '.',
      ]),
    ]),
  ]));

  /* ---------------- vendors ---------------- */

  const founding = vendor.founding || { open: true, remaining: vendor.foundingSlots };

  const vendorPlan = el('div', { class: 'plan plan--feature', style: 'max-width:620px;margin:0 auto' }, [
    el('p', { class: 'eyebrow' }, 'Vendors, one plan'),
    el('div', { class: 'row', style: 'gap:18px;align-items:baseline' }, [
      el('p', { class: 'price', style: 'margin:0' }, [money(vendor.foundingPricePence), el('small', {}, ' a month')]),
      el('span', { class: 'badge badge--verified' }, 'First month free'),
      el('span', { class: 'badge badge--coral' }, `Founding rate, first ${vendor.foundingSlots}`),
    ]),
    el('p', { class: 'muted', style: 'margin-top:14px' },
      `Your first month is free while we roll out, automatically. Then ${money(vendor.foundingPricePence)} a month at the founding rate, locked for ${vendor.foundingLockMonths} months for the first ${vendor.foundingSlots} vendors, then ${money(vendor.standardPricePence)} a month standard. That is the whole price list.`),
    el('ul', { class: 'ticklist' }, [
      'Every enquiry you receive was sent to you and to nobody else',
      'No bidding, no shared leads, no lead selling',
      'A monthly capacity limit you set, so you are not buried',
      'AETERNA Verified once the published checks are complete',
      'Cancel whenever you like',
    ].map(tick)),
    el('h4', { style: 'margin-top:22px' }, 'What you cannot buy'),
    el('ul', { class: 'crosslist' }, [
      'A higher position in search results',
      'A tier above this one',
      'Exclusivity over a category or a region',
    ].map(cross)),
    el('a', { class: 'btn btn--primary btn--block', href: '#/for-vendors', 'data-link': '', style: 'margin-top:22px' },
      'How it works for vendors'),
  ]);

  page.append(el('section', { class: 'section section--wash' }, [
    el('div', { class: 'wrap' }, [
      el('h2', { style: 'margin-bottom:22px' }, 'For vendors'),
      vendorPlan,
    ]),
  ]));

  /* ---------------- questions ---------------- */

  const questions = [
    ['Is the couple upgrade a subscription?', 'No. It is £49 once per wedding. It does not renew, and there is no second charge.'],
    ['What happens to my plan if I never upgrade?', 'It stays exactly where it is, permanently, and stays editable. The free plan is not a trial that expires. You keep your checklist, your budget and the enquiry you sent.'],
    ['Why is the free plan limited at all?', 'Because a marketplace that costs money to run and charges nobody either sells your data or quietly dies. We would rather publish the limits and charge once.'],
    ['Can a vendor pay to rank higher?', 'No. Results are ordered by verified status and then alphabetically. There is no field a vendor can buy, and there never will be.'],
    ['Do you sell leads?', 'No. An enquiry goes to one vendor. It is not resold, not shared with a list, and not passed to a partner network.'],
    ['What happens if a vendor does not reply?', 'After 48 hours the enquiry moves to one other matching vendor. It is still one vendor at a time.'],
    ['Is the AI planner unlimited?', 'No. There is a published fair use policy with monthly message allowances. We would rather publish the number than use the word unlimited.'],
  ];

  page.append(el('section', { class: 'section' }, [
    el('div', { class: 'wrap-narrow' }, [
      el('h2', { style: 'margin-bottom:24px' }, 'The questions people actually ask'),
      ...questions.map(([q, a]) => el('div', { class: 'panel', style: 'margin-bottom:14px' }, [
        el('h3', { style: 'font-size:1.15rem;margin-bottom:6px' }, q),
        el('p', { class: 'muted', style: 'margin:0' }, a),
      ])),
    ]),
  ]));

  return page;

  function tick(text) {
    return el('li', {}, [tickIcon('var(--sage-ink)'), el('span', {}, text)]);
  }
  function cross(text) {
    return el('li', {}, [
      el('span', { 'aria-hidden': 'true', style: 'color:var(--coral-ink);font-weight:700' }, '×'),
      el('span', {}, text),
    ]);
  }
}
