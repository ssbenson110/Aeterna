/**
 * Shared components: the verified badge, vendor cards, the auth dialog and the
 * enquiry dialog. Anything that appears on more than one view lives here.
 */

import { el, clear, frag, money, tickIcon, toast, modal, closeModal, celebrate } from './ui.js';
import { api, ApiError } from './api.js';
import { store } from './store.js';

/**
 * The AETERNA Verified badge. It is always a link to the published scope.
 * It never says vetted, and it never appears without the link.
 */
export function verifiedBadge({ small = false } = {}) {
  return el('a', {
    class: `badge badge--verified${small ? ' small' : ''}`,
    href: '#/verification',
    'data-link': '',
    title: 'Read what AETERNA Verified covers',
  }, [tickIcon(), 'AETERNA Verified']);
}

export function sampleBadge() {
  return el('span', {
    class: 'badge badge--sample',
    title: 'A sample listing used to show how the marketplace works',
  }, 'Sample listing');
}

export function vendorCard(vendor) {
  const meta = el('div', { class: 'row', style: 'gap:8px;margin-bottom:12px' }, [
    vendor.verified ? verifiedBadge() : el('span', { class: 'badge badge--plain' }, 'Verification in progress'),
    vendor.isSample ? sampleBadge() : null,
  ]);

  return el('a', {
    class: 'card card--link',
    href: `#/vendor/${vendor.slug}`,
    'data-link': '',
  }, [
    el('div', { class: 'media media--4x3' }, [
      el('img', { src: vendor.heroImage, alt: vendor.heroAlt || '', loading: 'lazy', decoding: 'async' }),
    ]),
    el('div', { style: 'padding:20px 22px 24px' }, [
      meta,
      el('h3', { style: 'margin-bottom:6px;font-size:1.3rem' }, vendor.businessName),
      el('p', { class: 'small muted', style: 'margin-bottom:12px' },
        `${vendor.categoryLabel}, ${vendor.town || vendor.region}`),
      el('p', { style: 'font-size:.95rem;margin-bottom:14px' }, vendor.tagline),
      vendor.priceFromPence
        ? el('p', { class: 'small', style: 'margin:0;font-weight:700;color:var(--ink)' },
          `From ${money(vendor.priceFromPence)}`)
        : null,
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

export function requireAccount(reason, onDone) {
  if (store.user) { onDone && onDone(); return; }
  openAuthDialog({ reason, mode: 'register', onDone });
}

export function openAuthDialog({ reason = '', mode = 'register', role = 'couple', onDone } = {}) {
  let currentMode = mode;
  let currentRole = role;

  const body = el('div');
  const render = () => {
    body.replaceChildren();
    const isRegister = currentMode === 'register';

    if (reason) body.append(el('p', { class: 'lede', style: 'font-size:1rem;margin-bottom:20px' }, reason));

    const form = el('form', { novalidate: '' });

    if (isRegister) {
      const roleRow = el('div', { class: 'row', style: 'margin-bottom:20px;gap:8px' }, [
        el('button', {
          type: 'button', class: 'pill', 'aria-pressed': String(currentRole === 'couple'),
          onclick: () => { currentRole = 'couple'; render(); },
        }, 'I am planning a wedding'),
        el('button', {
          type: 'button', class: 'pill', 'aria-pressed': String(currentRole === 'vendor'),
          onclick: () => { currentRole = 'vendor'; render(); },
        }, 'I am a vendor'),
      ]);
      form.append(roleRow);

      form.append(el('label', { class: 'field' }, [
        el('span', {}, currentRole === 'couple' ? 'Your name' : 'Your business name'),
        el('input', { type: 'text', name: 'displayName', required: '', autocomplete: 'name' }),
      ]));
    }

    form.append(el('label', { class: 'field' }, [
      el('span', {}, 'Email'),
      el('input', { type: 'email', name: 'email', required: '', autocomplete: 'email' }),
    ]));

    form.append(el('label', { class: 'field' }, [
      el('span', {}, 'Password'),
      el('input', {
        type: 'password', name: 'password', required: '',
        autocomplete: isRegister ? 'new-password' : 'current-password',
        minlength: isRegister ? '10' : '1',
      }),
      isRegister ? el('span', { class: 'hint' }, 'At least 10 characters.') : null,
    ]));

    const error = el('div', { class: 'notice notice--warn hide', role: 'alert' });
    form.append(error);

    const submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit', style: 'margin-top:8px' },
      isRegister ? 'Create your account' : 'Sign in');
    form.append(submit);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.classList.add('hide');
      const data = Object.fromEntries(new FormData(form).entries());
      submit.disabled = true;
      submit.textContent = isRegister ? 'Creating your account' : 'Signing in';
      try {
        const result = isRegister
          ? await api.register({ ...data, role: currentRole })
          : await api.login({ email: data.email, password: data.password });
        await store.refresh();
        closeModal();
        toast(isRegister ? 'Your account is ready. Your plan is saved from here on.' : 'Welcome back.', 'good');
        if (isRegister) celebrate();
        if (onDone) onDone(result);
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
        error.classList.remove('hide');
        submit.disabled = false;
        submit.textContent = isRegister ? 'Create your account' : 'Sign in';
      }
    });

    body.append(form);
    body.append(el('p', { class: 'small muted', style: 'margin-top:20px;text-align:center' }, [
      isRegister ? 'Already have an account? ' : 'No account yet? ',
      el('button', {
        class: 'linkish', type: 'button',
        onclick: () => { currentMode = isRegister ? 'login' : 'register'; render(); },
      }, isRegister ? 'Sign in' : 'Create one'),
    ]));

    if (isRegister && currentRole === 'couple') {
      body.append(el('p', { class: 'tiny muted', style: 'margin-top:14px;text-align:center' },
        'Planning is free. There is one optional upgrade of £49 per wedding, paid once, and it is not a subscription.'));
    }
  };

  render();
  return modal(mode === 'login' ? 'Sign in' : 'Create your account', body);
}

/* ------------------------------------------------------------------ */
/* enquiry                                                             */
/* ------------------------------------------------------------------ */

export function openEnquiryDialog(vendor) {
  requireAccount(
    'Enquiries are tied to your wedding plan, so a vendor gets your date, guest count and traditions rather than a blank message. Create a free account to send one.',
    () => {
      if (store.user && store.user.role !== 'couple') {
        toast('Enquiries come from couple accounts. This account is a vendor account.', 'bad');
        return;
      }
      showEnquiryForm(vendor);
    }
  );
}

function showEnquiryForm(vendor) {
  const wedding = store.wedding || {};
  const missing = [];
  if (!wedding.weddingDate) missing.push('a date');
  if (!wedding.guestCount) missing.push('a guest count');
  if (!wedding.budgetPence) missing.push('a budget');

  const body = el('div');

  body.append(el('div', { class: 'notice notice--good', style: 'margin-bottom:20px' }, [
    el('div', {}, [
      el('strong', {}, 'This goes to one vendor. '),
      'Nobody else receives it, your details are never sold, and no other vendor is invited to bid against them.',
    ]),
  ]));

  if (missing.length) {
    body.append(el('div', { class: 'notice notice--info', style: 'margin-bottom:20px' }, [
      el('div', {}, [
        `Your plan is still missing ${missing.join(', ')}. You can send this anyway, and adding those details in the `,
        el('a', { href: '#/planner', 'data-link': '', onclick: () => closeModal() }, 'planner'),
        ' gets you a far more useful reply.',
      ]),
    ]));
  }

  const form = el('form', { novalidate: '' });
  form.append(el('label', { class: 'field' }, [
    el('span', {}, 'Anything you would like them to know'),
    el('textarea', {
      name: 'message', rows: '5', maxlength: '2000',
      placeholder: 'What you are planning, what matters most to you, and anything specific you want to ask.',
    }),
  ]));

  const summary = el('div', { class: 'panel panel--blush', style: 'margin-bottom:18px' }, [
    el('h4', { style: 'margin-bottom:10px' }, 'What we send with it'),
    el('ul', { class: 'ticklist', style: 'margin:0' }, [
      line(`Your date, ${wedding.weddingDate || 'not set yet'}`),
      line(`Your guest count, ${wedding.guestCount || 'not set yet'}`),
      line(`Your region, ${wedding.region || 'not set yet'}`),
      line(`Your traditions, ${(wedding.traditions && wedding.traditions.length) ? wedding.traditions.join(' and ') : 'none recorded yet'}`),
    ]),
    el('p', { class: 'tiny muted', style: 'margin:12px 0 0' },
      'Your name and contact details are released to the vendor only once they accept.'),
  ]);
  form.append(summary);

  const error = el('div', { class: 'notice notice--warn hide', role: 'alert' });
  form.append(error);

  const submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit' },
    `Send one enquiry to ${vendor.businessName}`);
  form.append(submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.classList.add('hide');
    submit.disabled = true;
    submit.textContent = 'Sending';
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api.sendEnquiry({
        category: vendor.category,
        vendorId: vendor.id,
        message: data.message || '',
      });
      closeModal();
      celebrate();
      showEnquirySent(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'We could not send that. Please try again.';
      error.textContent = message;
      error.classList.remove('hide');
      submit.disabled = false;
      submit.textContent = `Send one enquiry to ${vendor.businessName}`;
    }
  });

  body.append(form);
  return modal(`Enquire with ${vendor.businessName}`, body);

  function line(text) {
    return el('li', {}, [tickIcon('var(--sage-ink)'), el('span', {}, text)]);
  }
}

function showEnquirySent(result) {
  const enquiry = result.enquiry;
  const body = el('div', {}, [
    el('p', { class: 'lede', style: 'font-size:1.05rem' },
      `Sent to ${enquiry.vendor.businessName} and to nobody else.`),
    el('div', { class: 'panel panel--sage', style: 'margin:20px 0' }, [
      el('h4', { style: 'margin-bottom:8px' }, 'Why this vendor'),
      el('p', { class: 'small', style: 'margin:0' }, enquiry.routedReason),
    ]),
    el('dl', { class: 'grid grid--2', style: 'gap:14px;margin:0 0 20px' }, [
      pair('Reference', enquiry.reference),
      pair('Vendors contacted', String(result.routing.vendorsContacted)),
      pair('They have', `${result.routing.exclusiveHours} hours to reply`),
      pair('Shared with anyone else', 'No'),
    ]),
    el('p', { class: 'small muted' },
      'If they cannot take it on, we pass it to one other matching vendor rather than opening it up to a crowd. You can follow it in your planner.'),
    el('a', {
      class: 'btn btn--primary', href: '#/planner', 'data-link': '',
      style: 'margin-top:8px', onclick: () => closeModal(),
    }, 'Back to your plan'),
  ]);
  return modal('Your enquiry is on its way', body);

  function pair(term, value) {
    return el('div', {}, [
      el('dt', { class: 'tiny muted', style: 'text-transform:uppercase;letter-spacing:.08em;font-weight:700' }, term),
      el('dd', { style: 'margin:4px 0 0;font-weight:700' }, value),
    ]);
  }
}

/* ------------------------------------------------------------------ */
/* section helpers                                                     */
/* ------------------------------------------------------------------ */

export function sectionHeader({ eyebrow, title, lede, align = 'left', accent = 'coral', gap = 'clamp(28px,4vw,44px)' }) {
  return el('div', {
    class: align === 'center' ? 'center' : '',
    style: `max-width:${align === 'center' ? '760px' : '720px'};margin:${align === 'center' ? '0 auto' : '0'} 0 ${gap}`,
  }, [
    eyebrow ? el('p', { class: `eyebrow${accent === 'sage' ? ' eyebrow--sage' : accent === 'gold' ? ' eyebrow--gold' : ''}` }, eyebrow) : null,
    el('h2', {}, title),
    lede ? el('p', { class: 'lede' }, lede) : null,
  ]);
}

export function promiseStrip() {
  const items = [
    ['One enquiry, one vendor', 'Every enquiry goes to a single verified vendor. There is no bidding and no swarm.'],
    ['Zero lead selling', 'Your details are never sold, resold or shared with a list of suppliers.'],
    ['No paid ranking, ever', 'Vendors pay one flat monthly fee. Position can never be bought.'],
  ];
  return el('div', { class: 'grid grid--3' }, items.map(([title, text]) => el('div', {
    class: 'panel', style: 'height:100%',
  }, [
    el('div', { style: 'display:flex;gap:10px;align-items:flex-start;margin-bottom:10px' }, [
      tickIcon('var(--coral-ink)'),
      el('h3', { style: 'font-size:1.15rem;margin:0' }, title),
    ]),
    el('p', { class: 'small muted', style: 'margin:0' }, text),
  ])));
}

export function loadingBlock(label = 'Loading') {
  return el('div', { class: 'loading-page' }, [
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    el('p', { class: 'muted' }, label),
  ]);
}

export function errorBlock(message, retry) {
  return el('div', { class: 'wrap section' }, [
    el('div', { class: 'empty' }, [
      el('h3', {}, 'That did not load'),
      el('p', { class: 'muted' }, message),
      retry ? el('button', { class: 'btn btn--quiet', type: 'button', onclick: retry }, 'Try again') : null,
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* traditions picker                                                   */
/* ------------------------------------------------------------------ */

/**
 * Traditions, with a way out of the list.
 *
 * A fixed list is exactly the "we did not think of you" problem this product
 * exists to solve, so the presets are grouped and collapsible and there is
 * always a free text field. Anything typed here is treated the same as a preset
 * when matching vendors and when briefing the planner.
 *
 * Returns { node, getSelected(), getCustom() }.
 */
export function traditionsPicker({ selected = [], custom = [] } = {}) {
  const meta = store.meta || {};
  const groups = meta.traditionGroups || [{ label: 'Traditions', items: meta.traditions || [] }];
  const maxLength = meta.maxCustomTraditionLength || 60;

  const chosen = new Set(selected);
  const own = custom.slice();

  const node = el('div');
  const chips = el('div', { class: 'row', style: 'gap:8px;margin-bottom:16px', 'aria-live': 'polite' });

  const paintChips = () => {
    clear(chips);
    const all = [...chosen].concat(own);
    if (!all.length) {
      chips.append(el('span', { class: 'small muted' }, 'Nothing selected yet. Pick from the lists or add your own below.'));
      return;
    }
    for (const value of all) {
      const isCustom = own.includes(value);
      chips.append(el('span', {
        class: `tag${isCustom ? ' tag--own' : ''}`,
        style: 'display:inline-flex;align-items:center;gap:8px',
      }, [
        value,
        el('button', {
          type: 'button', class: 'linkish', style: 'font-size:1rem;line-height:1',
          'aria-label': `Remove ${value}`,
          onclick: () => {
            if (isCustom) own.splice(own.indexOf(value), 1);
            else chosen.delete(value);
            paintChips();
            paintBoxes();
          },
        }, '×'),
      ]));
    }
  };

  const boxes = [];
  const groupNodes = groups.map((group) => {
    const items = el('div', {
      class: 'grid',
      style: 'grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));gap:0 18px;padding:4px 0 10px',
    });
    for (const item of group.items) {
      const input = el('input', { type: 'checkbox', value: item, checked: chosen.has(item) });
      input.addEventListener('change', () => {
        if (input.checked) chosen.add(item); else chosen.delete(item);
        paintChips();
      });
      boxes.push(input);
      items.append(el('label', { class: 'checkline' }, [input, el('span', {}, item)]));
    }
    return el('details', { class: 'tradition-group' }, [
      el('summary', {}, [
        el('span', {}, group.label),
        el('span', { class: 'tiny muted' }, ` ${group.items.length}`),
      ]),
      items,
    ]);
  });

  function paintBoxes() {
    for (const box of boxes) box.checked = chosen.has(box.value);
  }

  const ownInput = el('input', {
    type: 'text', maxlength: String(maxLength),
    placeholder: 'Ijaw boat procession, Sylheti gaye holud, anything else',
    'aria-label': 'Add a tradition that is not listed',
  });
  const addOwn = () => {
    const value = ownInput.value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
    if (value.length < 2) return;
    const lower = value.toLowerCase();
    const isPreset = (meta.traditions || []).find((t) => t.toLowerCase() === lower);
    if (isPreset) chosen.add(isPreset);
    else if (!own.some((v) => v.toLowerCase() === lower)) own.push(value);
    ownInput.value = '';
    paintChips();
    paintBoxes();
  };
  ownInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addOwn(); }
  });

  node.append(
    chips,
    el('div', { class: 'panel', style: 'padding:14px 18px;margin-bottom:14px' }, groupNodes),
    el('div', { class: 'row', style: 'gap:10px;align-items:flex-end' }, [
      el('label', { class: 'field', style: 'margin:0;flex:1 1 260px' }, [
        el('span', {}, 'Not listed? Add your own'),
        ownInput,
        el('span', { class: 'hint' }, 'We match vendors on this exactly as we do the presets.'),
      ]),
      el('button', { class: 'btn btn--quiet btn--sm', type: 'button', onclick: addOwn }, 'Add'),
    ])
  );

  paintChips();

  return {
    node,
    getSelected: () => [...chosen],
    getCustom: () => own.slice(),
  };
}

/* ------------------------------------------------------------------ */
/* upgrade prompt                                                      */
/* ------------------------------------------------------------------ */

/**
 * Shown where a free tier cap is reached. States the limit plainly, says what
 * the upgrade costs and confirms that nothing already built is affected. No
 * countdowns, no urgency, no pressure language.
 */
export function upgradePanel({ title, body, cta = 'Upgrade this wedding, £49 once', onUpgrade }) {
  return el('div', { class: 'panel panel--blush' }, [
    el('h3', { style: 'font-size:1.25rem' }, title),
    el('p', { style: 'margin-bottom:16px' }, body),
    el('button', {
      class: 'btn btn--primary', type: 'button',
      onclick: async () => {
        // Real card payment when Stripe is configured, recorded intent when not.
        try {
          const checkout = await api.coupleCheckout();
          if (checkout.checkoutUrl) { window.location.href = checkout.checkoutUrl; return; }
        } catch (error) {
          if (error && error.status === 409) { toast(error.message, 'bad'); return; }
          // Anything else means card payments are not available here, so the
          // recorded intent flow below takes over and says no payment was taken.
        }
        try {
          await api.upgrade();
          celebrate();
          toast('Upgraded. Everything is unlocked for this wedding.', 'good');
          await store.refresh();
          if (onUpgrade) onUpgrade();
        } catch (error) { toast(error.message, 'bad'); }
      },
    }, cta),
    el('p', { class: 'tiny muted', style: 'margin:14px 0 0' },
      'Paid once for this wedding. It is not a subscription and it will not renew. Card processing is not connected in this build, so nothing is charged.'),
  ]);
}
