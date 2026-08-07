import { el, clear, money, setMeta, toast, longDate, shortDate } from '../ui.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { loadingBlock, errorBlock, verifiedBadge, openAuthDialog } from '../components.js';
import { openVendorProfileForm } from './for-vendors.js';
import { verificationPanel, imagesPanel } from './vendor-media.js';
import { crmPanel } from './crm.js';
import { navigate } from '../router.js';

export function renderAccount() {
  setMeta('Your AETERNA account', 'Manage your AETERNA account.');

  if (!store.user) {
    openAuthDialog({ mode: 'login' });
    return el('section', { class: 'section' }, [
      el('div', { class: 'wrap-narrow' }, [
        el('div', { class: 'empty' }, [
          el('h3', {}, 'Sign in to see your account'),
          el('button', {
            class: 'btn btn--primary', type: 'button',
            onclick: () => openAuthDialog({ mode: 'login' }),
          }, 'Sign in'),
        ]),
      ]),
    ]);
  }

  if (store.user.role === 'couple') return coupleAccount();
  return vendorDashboard();
}

function coupleAccount() {
  return el('section', { class: 'section' }, [
    el('div', { class: 'wrap-narrow' }, [
      el('h1', { style: 'font-size:clamp(1.9rem,4vw,2.6rem)' }, 'Your account'),
      el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
        el('p', { class: 'small muted', style: 'margin-bottom:4px' }, 'Signed in as'),
        el('p', { style: 'margin:0;font-weight:700' }, store.user.email),
      ]),
      el('div', { class: 'row', style: 'gap:12px' }, [
        el('a', { class: 'btn btn--primary', href: '#/planner', 'data-link': '' }, 'Go to your plan'),
        el('a', { class: 'btn btn--quiet', href: '#/chat', 'data-link': '' }, 'Open the AI planner'),
      ]),
    ]),
  ]);
}

function vendorDashboard() {
  const host = el('div', {}, [loadingBlock('Loading your dashboard')]);

  const load = async () => {
    if (!store.vendor) {
      host.replaceChildren(el('section', { class: 'section' }, [
        el('div', { class: 'wrap-narrow' }, [
          el('div', { class: 'empty' }, [
            el('h3', {}, 'Set up your listing'),
            el('p', { class: 'muted' }, 'You have a vendor account but no listing yet. It takes about two minutes.'),
            el('button', { class: 'btn btn--primary', type: 'button', onclick: () => openVendorProfileForm() }, 'Create my listing'),
          ]),
        ]),
      ]));
      return;
    }

    let profile;
    let enquiries = [];
    try {
      [profile, enquiries] = await Promise.all([
        api.vendor(store.vendor.slug).then((d) => d.vendor),
        api.enquiries().then((d) => d.enquiries),
      ]);
    } catch (error) {
      host.replaceChildren(errorBlock(error.message, load));
      return;
    }

    const live = enquiries.filter((e) => e.status === 'awaiting_vendor');
    const accepted = enquiries.filter((e) => e.status === 'accepted');

    const header = el('section', { class: 'section section--tight section--blush' }, [
      el('div', { class: 'wrap' }, [
        el('p', { class: 'eyebrow' }, 'Vendor dashboard'),
        el('h1', { style: 'font-size:clamp(1.9rem,4vw,2.8rem);margin-bottom:12px' }, profile.businessName),
        el('div', { class: 'row', style: 'gap:10px;margin-bottom:20px' }, [
          profile.verified ? verifiedBadge() : el('span', { class: 'badge badge--plain' }, 'Verification in progress'),
          el('span', { class: 'badge badge--plain' }, profile.categoryLabel),
          el('span', { class: 'badge badge--plain' }, `${profile.town ? `${profile.town}, ` : ''}${profile.region}`),
        ]),
        el('div', { class: 'grid grid--4' }, [
          stat(String(live.length), 'Waiting on you'),
          stat(String(accepted.length), 'Accepted'),
          stat(String(profile.capacityPerMonth), 'Monthly capacity'),
          stat(money(2900), 'Your rate, founding'),
        ]),
      ]),
    ]);

    const list = el('div');
    if (!enquiries.length) {
      list.append(el('div', { class: 'empty' }, [
        el('h3', {}, 'No enquiries yet'),
        el('p', { class: 'muted' }, 'When one arrives it will be yours alone for 48 hours. It is never sent to another vendor at the same time.'),
      ]));
    } else {
      list.append(el('div', { class: 'grid grid--2' }, enquiries.map((enquiry) => enquiryCard(enquiry, load))));
    }

    const body = el('section', { class: 'section' }, [
      el('div', { class: 'wrap' }, [
        el('div', { class: 'notice notice--good', style: 'margin-bottom:24px' }, [
          el('div', {}, [
            el('strong', {}, 'Every enquiry below was sent to you and to nobody else. '),
            'There is no bidding, and the couple\'s details were not sold to anyone.',
          ]),
        ]),
        el('div', { style: 'margin-bottom:32px' }, [crmPanel()]),
        el('h2', { style: 'margin-bottom:20px' }, 'Your enquiries'),
        list,
        el('div', { class: 'admin-split', style: 'margin-top:28px' }, [
          imagesPanel(),
          el('aside', {}, [
            verificationPanel(),
            el('div', { class: 'panel' }, [
              el('h3', { style: 'font-size:1.2rem' }, 'Your listing'),
              el('p', { class: 'muted small', style: 'margin-bottom:14px' }, profile.tagline || 'No tagline yet.'),
              el('a', { class: 'btn btn--quiet btn--sm', href: `#/vendor/${profile.slug}`, 'data-link': '' }, 'View public profile'),
            ]),
          ]),
        ]),
      ]),
    ]);

    host.replaceChildren(header, body);
  };

  load();
  return host;

  function stat(value, label) {
    return el('div', { class: 'panel', style: 'text-align:center;background:var(--paper)' }, [
      el('p', { class: 'stat', style: 'margin:0;font-size:clamp(1.3rem,2.4vw,1.8rem)' }, value),
      el('p', { class: 'stat-label' }, label),
    ]);
  }
}

function enquiryCard(enquiry, reload) {
  const wedding = enquiry.wedding || {};
  const awaiting = enquiry.status === 'awaiting_vendor';

  const actions = awaiting
    ? el('div', { class: 'row', style: 'gap:10px;margin-top:16px' }, [
      el('button', {
        class: 'btn btn--primary btn--sm', type: 'button',
        onclick: async () => {
          try { await api.respondToEnquiry(enquiry.id, 'accept'); toast('Accepted. The couple\'s contact details are released to you.', 'good'); reload(); }
          catch (error) { toast(error.message, 'bad'); }
        },
      }, 'Accept'),
      el('button', {
        class: 'btn btn--quiet btn--sm', type: 'button',
        onclick: async () => {
          try {
            const result = await api.respondToEnquiry(enquiry.id, 'decline');
            toast(result.note, 'good');
            reload();
          } catch (error) { toast(error.message, 'bad'); }
        },
      }, 'Decline'),
    ])
    : el('p', { class: 'small muted', style: 'margin-top:14px' }, statusLine(enquiry));

  return el('div', { class: 'panel' }, [
    el('div', { class: 'row row--between', style: 'margin-bottom:12px' }, [
      el('span', { class: 'badge badge--coral' }, enquiry.categoryLabel),
      el('span', { class: 'tiny muted' }, enquiry.reference),
    ]),
    el('dl', { class: 'grid grid--2', style: 'gap:10px;margin:0 0 14px' }, [
      pair('Date', wedding.weddingDate ? longDate(wedding.weddingDate) : 'Not set'),
      pair('Guests', wedding.guestCount ? String(wedding.guestCount) : 'Not set'),
      pair('Region', wedding.region || 'Not set'),
      pair('Budget', wedding.budgetPence ? money(wedding.budgetPence) : 'Not set'),
    ]),
    wedding.traditions && wedding.traditions.length
      ? el('div', { class: 'row', style: 'gap:6px;margin-bottom:12px' },
        wedding.traditions.map((t) => el('span', { class: 'tag' }, t)))
      : null,
    enquiry.message ? el('p', { class: 'small', style: 'background:var(--ivory-deep);padding:12px 14px;border-radius:var(--r-sm)' }, enquiry.message) : null,
    awaiting ? el('p', { class: 'tiny muted', style: 'margin:12px 0 0' },
      `Yours alone until ${shortDate(enquiry.exclusiveUntil)}. Contact details are released when you accept.`) : null,
    actions,
  ]);

  function pair(term, value) {
    return el('div', {}, [
      el('dt', { class: 'tiny muted', style: 'text-transform:uppercase;letter-spacing:.07em;font-weight:700' }, term),
      el('dd', { class: 'small', style: 'margin:2px 0 0;font-weight:700' }, value),
    ]);
  }
}

function statusLine(enquiry) {
  const map = {
    accepted: 'You accepted this. The couple has your details.',
    declined: 'You declined this. It moved to one other vendor.',
    no_match: 'No other matching vendor was available.',
  };
  return map[enquiry.status] || enquiry.status;
}
