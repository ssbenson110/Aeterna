import { el, money, setMeta, tickIcon, toast, celebrate } from '../ui.js';
import { api, ApiError } from '../api.js';
import { store } from '../store.js';
import { sectionHeader, openAuthDialog, verifiedBadge } from '../components.js';
import { navigate } from '../router.js';

export function renderForVendors() {
  setMeta(
    'For wedding vendors, one enquiry to one vendor, AETERNA',
    'One flat monthly fee. Every enquiry goes to you and to nobody else. No bidding, no lead selling, and no paid ranking, ever.'
  );

  const meta = store.meta || {};
  const pricing = store.pricing || { vendor: { foundingPricePence: 2900, standardPricePence: 4900, foundingSlots: 40, foundingLockMonths: 12 } };
  const vendor = pricing.vendor;
  const images = meta.images || {};
  const heroImage = (images.hero || [])[2] || (images.hero || [])[0] || {};

  const page = el('div');

  /* ---------------- hero ---------------- */

  page.append(el('section', { class: 'section section--tight section--blush' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'grid grid--2', style: 'align-items:center;gap:clamp(28px,5vw,56px)' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow' }, 'For vendors'),
          el('h1', { style: 'font-size:clamp(2.1rem,5vw,3.4rem)' }, 'One enquiry goes to one vendor. That vendor is you.'),
          el('p', { class: 'lede' },
            'No bidding, no shared leads, no racing four other suppliers to the inbox. You pay one flat monthly fee and every enquiry you receive was sent to you alone.'),
          el('div', { class: 'row', style: 'gap:12px;margin-top:8px' }, [
            el('button', {
              class: 'btn btn--primary btn--lg', type: 'button',
              onclick: () => startVendorSignup(),
            }, 'Join free for your first month'),
            el('a', { class: 'btn btn--quiet btn--lg', href: '#/pricing', 'data-link': '' }, 'See the full pricing'),
          ]),
          el('p', { class: 'small muted', style: 'margin-top:18px' },
            `First month free while we roll out. Then the founding rate of ${money(vendor.foundingPricePence)} a month for the first ${vendor.foundingSlots} vendors, locked for ${vendor.foundingLockMonths} months, then ${money(vendor.standardPricePence)} a month. One plan, no upsell.`),
        ]),
        el('figure', {
          class: 'media media--4x3', style: 'border-radius:var(--r-xl);margin:0;box-shadow:var(--shadow-md)',
        }, [el('img', { src: heroImage.url, alt: heroImage.alt || '', loading: 'eager', decoding: 'async' })]),
      ]),
    ]),
  ]));

  /* ---------------- the problem ---------------- */

  const comparison = [
    ['How many suppliers get the enquiry', 'Four, five, sometimes more', 'One. You.'],
    ['What you are competing on', 'Speed of reply, then price', 'Whether you are the right fit'],
    ['What happens to the couple\'s details', 'Sold as a lead, often more than once', 'Never sold, never shared'],
    ['How position is decided', 'Often by what a supplier pays', 'Verified status, then alphabetical'],
    ['What you pay', 'Per lead, whether or not it was real', 'One flat monthly fee'],
  ];

  page.append(el('section', { class: 'section' }, [
    el('div', { class: 'wrap' }, [
      sectionHeader({
        eyebrow: 'The difference',
        title: 'The model, stated plainly',
        lede: 'This is the whole pitch. If it does not suit how you work, it will not suit you at scale either, and we would rather you knew now.',
      }),
      el('div', { class: 'panel', style: 'padding:0;overflow:hidden' }, [
        el('div', { class: 'table-scroll' }, [
          el('table', { class: 'table' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', {}, ''),
              el('th', {}, 'The usual model'),
              el('th', {}, 'AETERNA'),
            ])]),
            el('tbody', {}, comparison.map(([label, usual, ours]) => el('tr', {}, [
              el('td', {}, el('strong', {}, label)),
              el('td', { class: 'muted' }, usual),
              el('td', { style: 'color:var(--coral-deep);font-weight:700' }, ours),
            ]))),
          ]),
        ]),
      ]),
    ]),
  ]));

  /* ---------------- how it works ---------------- */

  const steps = [
    ['You set your capacity', 'Tell us how many enquiries a month you can genuinely handle. We stop at that number rather than filling your inbox and calling it value.'],
    ['We route on fit, then fairness', 'Category, region, the traditions you have worked with, and whether your starting price sits inside the couple\'s budget. Then the vendor who has waited longest rises. Money is not an input.'],
    ['You get 48 hours', 'The enquiry is yours alone for 48 hours. Accept it and you get the couple\'s contact details. Decline it and it moves to one other vendor, not to a crowd.'],
  ];

  page.append(el('section', { class: 'section section--wash' }, [
    el('div', { class: 'wrap' }, [
      sectionHeader({ eyebrow: 'How routing works', title: 'How an enquiry reaches you' }),
      el('div', { class: 'grid grid--3' }, steps.map(([title, text], index) => el('div', { class: 'panel', style: 'height:100%;background:var(--paper)' }, [
        el('div', {
          style: 'width:42px;height:42px;border-radius:50%;background:var(--sage-ink);color:#fff;display:grid;place-items:center;font-family:var(--display);font-weight:700;margin-bottom:14px',
          'aria-hidden': 'true',
        }, String(index + 1)),
        el('h3', { style: 'font-size:1.2rem' }, title),
        el('p', { class: 'muted', style: 'margin:0;font-size:.97rem' }, text),
      ]))),
    ]),
  ]));

  /* ---------------- verification ---------------- */

  page.append(el('section', { class: 'section' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'grid grid--2', style: 'align-items:center;gap:clamp(28px,5vw,56px)' }, [
        el('div', {}, [
          el('p', { class: 'eyebrow eyebrow--sage' }, 'Verification'),
          el('h2', {}, 'The badge is earned through a published checklist'),
          el('p', { class: 'lede' },
            'Identity, insurance, references, portfolio rights, a live video call, and the same checks again every year. It cannot be bought and it cannot be switched on from a settings page.'),
          el('div', { class: 'row', style: 'gap:12px' }, [
            verifiedBadge(),
            el('a', { class: 'btn btn--ghost btn--sm', href: '#/verification', 'data-link': '' }, 'Read the full scope'),
          ]),
        ]),
        el('div', { class: 'panel panel--sage' }, [
          el('h3', { style: 'font-size:1.2rem' }, 'What we ask you for'),
          el('ul', { class: 'ticklist' }, [
            'A company number or photo identification',
            'A current public liability certificate',
            'Two recent clients and one industry contact',
            'Written confirmation that you hold the rights to your portfolio',
            'Thirty minutes on a video call',
          ].map((text) => el('li', {}, [tickIcon('var(--sage-ink)'), el('span', {}, text)]))),
        ]),
      ]),
    ]),
  ]));

  /* ---------------- signup ---------------- */

  page.append(el('section', { class: 'section section--blush' }, [
    el('div', { class: 'wrap-narrow center' }, [
      el('h2', {}, 'Join as a founding vendor'),
      el('p', { class: 'lede', style: 'margin-bottom:24px' },
        `Your first month is free. Then ${money(vendor.foundingPricePence)} a month, locked for ${vendor.foundingLockMonths} months, for the first ${vendor.foundingSlots} vendors. One plan. Cancel whenever you like.`),
      el('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: () => startVendorSignup() },
        'Create your vendor account'),
      el('p', { class: 'tiny muted', style: 'margin-top:16px' },
        'Card processing is not connected in this build, so nothing is charged.'),
    ]),
  ]));

  return page;

  function startVendorSignup() {
    if (!store.user) {
      openAuthDialog({
        reason: 'Create a vendor account and we will set up your listing next.',
        mode: 'register', role: 'vendor',
        onDone: () => { if (store.user && store.user.role === 'vendor') openVendorProfileForm(); },
      });
      return;
    }
    if (store.user.role !== 'vendor') {
      toast('You are signed in with a couple account. Sign out first to create a vendor account.', 'bad');
      return;
    }
    if (store.vendor) { navigate('#/account'); return; }
    openVendorProfileForm();
  }
}

export function openVendorProfileForm() {
  import('../ui.js').then(({ modal, closeModal }) => {
    const meta = store.meta || {};
    const body = el('div');
    const form = el('form', { novalidate: '' });

    form.append(
      el('label', { class: 'field' }, [
        el('span', {}, 'Business name'),
        el('input', { type: 'text', name: 'businessName', required: '', value: store.user ? store.user.displayName : '' }),
      ]),
      el('label', { class: 'field' }, [
        el('span', {}, 'Category'),
        el('select', { name: 'category' }, (meta.categories || []).map((c) => el('option', { value: c.slug }, c.label))),
      ]),
      el('label', { class: 'field' }, [
        el('span', {}, 'Region you cover'),
        el('select', { name: 'region' }, (meta.regions || []).map((r) => el('option', { value: r }, r))),
      ]),
      el('label', { class: 'field' }, [
        el('span', {}, 'Town'),
        el('input', { type: 'text', name: 'town', placeholder: 'Bromley' }),
      ]),
      el('label', { class: 'field' }, [
        el('span', {}, 'One line about what you do'),
        el('input', { type: 'text', name: 'tagline', maxlength: '200', placeholder: 'Documentary photography for long days and big families' }),
      ]),
      el('label', { class: 'field' }, [
        el('span', {}, 'Starting price in pounds'),
        el('input', { type: 'text', name: 'price', inputmode: 'numeric', placeholder: '1950' }),
      ]),
      el('label', { class: 'field' }, [
        el('span', {}, 'Enquiries a month you can handle'),
        el('input', { type: 'number', name: 'capacityPerMonth', min: '1', max: '40', value: '6' }),
        el('span', { class: 'hint' }, 'We stop routing to you once you hit this. It resets each month.'),
      ])
    );

    const error = el('div', { class: 'notice notice--warn hide', role: 'alert' });
    const submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Create my listing');
    form.append(error, submit);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.classList.add('hide');
      submit.disabled = true;
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        await api.createVendor({
          businessName: data.businessName,
          category: data.category,
          region: data.region,
          town: data.town,
          tagline: data.tagline,
          priceFromPence: Math.round(Number(String(data.price).replace(/[^0-9.]/g, '')) * 100) || 0,
          capacityPerMonth: Number(data.capacityPerMonth) || 6,
        });
        // Real card checkout when Stripe is configured; recorded intent when not.
        let sentToStripe = false;
        try {
          const checkout = await api.vendorCheckout();
          if (checkout.checkoutUrl) { sentToStripe = true; window.location.href = checkout.checkoutUrl; }
        } catch { /* falls through to the recorded intent flow */ }
        if (!sentToStripe) await api.subscribe().catch(() => null);
        await store.refresh();
        closeModal();
        celebrate();
        toast('Your listing is live. Verification is a separate set of checks and starts unverified.', 'good');
        navigate('#/account');
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : 'We could not create that listing.';
        error.classList.remove('hide');
        submit.disabled = false;
      }
    });

    body.append(
      el('p', { class: 'small muted', style: 'margin-bottom:18px' },
        'You can change all of this later. Your listing starts unverified, because AETERNA Verified is a set of checks our team completes rather than a switch you can flip.'),
      form
    );
    modal('Set up your listing', body);
  });
}
