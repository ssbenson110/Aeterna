import { el, money, setMeta, tickIcon } from '../ui.js';
import { api } from '../api.js';
import { verifiedBadge, sampleBadge, openEnquiryDialog, loadingBlock, errorBlock } from '../components.js';

export function renderVendor(slug) {
  const page = el('div', {}, [loadingBlock('Loading this vendor')]);

  (async () => {
    let vendor;
    try {
      const data = await api.vendor(slug);
      vendor = data.vendor;
    } catch (error) {
      page.replaceChildren(errorBlock(error.message));
      return;
    }

    setMeta(
      `${vendor.businessName}, ${vendor.categoryLabel} in ${vendor.town || vendor.region}, AETERNA`,
      vendor.tagline
    );

    const gallery = vendor.gallery || [];
    const lead = gallery[0];
    const rest = gallery.slice(1);

    /* ---------------- header ---------------- */

    const header = el('section', { class: 'section section--tight' }, [
      el('div', { class: 'wrap' }, [
        el('p', { class: 'small muted', style: 'margin-bottom:18px' }, [
          el('a', { href: '#/browse', 'data-link': '' }, 'Browse vendors'),
          ' / ',
          el('a', { href: `#/browse?category=${vendor.category}`, 'data-link': '' }, vendor.categoryLabel),
        ]),
        el('div', { class: 'row', style: 'gap:10px;margin-bottom:16px' }, [
          vendor.verified ? verifiedBadge() : el('span', { class: 'badge badge--plain' }, 'Verification in progress'),
          vendor.isSample ? sampleBadge() : null,
          el('span', { class: 'badge badge--plain' }, `${vendor.town ? `${vendor.town}, ` : ''}${vendor.region}`),
        ]),
        el('h1', { style: 'font-size:clamp(2.1rem,5vw,3.4rem);margin-bottom:14px' }, vendor.businessName),
        el('p', { class: 'lede' }, vendor.tagline),
      ]),
    ]);

    /* ---------------- gallery ---------------- */

    const galleryBlock = el('section', { class: 'section section--tight', style: 'padding-top:0' }, [
      el('div', { class: 'wrap' }, [
        lead ? el('figure', {
          class: 'media media--16x9', style: 'border-radius:var(--r-xl);margin:0 0 16px;box-shadow:var(--shadow-md)',
        }, [el('img', { src: lead.url, alt: lead.alt || '', loading: 'eager', decoding: 'async' })]) : null,
        rest.length ? el('div', { class: 'grid grid--4' }, rest.map((image) => el('figure', {
          class: 'media media--1x1', style: 'border-radius:var(--r-md);margin:0;box-shadow:var(--shadow-sm)',
        }, [el('img', { src: image.url, alt: image.alt || '', loading: 'lazy', decoding: 'async' })]))) : null,
        el('p', { class: 'tiny muted', style: 'margin-top:14px' },
          'Portfolio images are supplied by the vendor, who confirms in writing that they hold the rights to them.'),
      ]),
    ]);

    /* ---------------- body ---------------- */

    const enquiryPanel = el('aside', { class: 'panel', style: 'position:sticky;top:96px' }, [
      vendor.priceFromPence
        ? el('div', { style: 'margin-bottom:18px' }, [
          el('p', { class: 'stat', style: 'margin:0' }, money(vendor.priceFromPence)),
          el('p', { class: 'stat-label', style: 'margin-top:6px' }, 'Starting price, indicative'),
        ])
        : null,
      el('button', {
        class: 'btn btn--primary btn--block', type: 'button',
        onclick: () => openEnquiryDialog(vendor),
      }, `Enquire with ${vendor.businessName}`),
      el('div', { class: 'notice notice--good', style: 'margin-top:16px' }, [
        el('div', {}, [
          el('strong', {}, 'One enquiry, one vendor. '),
          'This goes to them and to nobody else. Your details are never sold, and no other vendor is invited to bid.',
        ]),
      ]),
      el('p', { class: 'tiny muted', style: 'margin:14px 0 0' },
        'They have 48 hours to reply. If they cannot take it on, we pass it to one other matching vendor rather than opening it up.'),
    ]);

    const details = el('div', { class: 'flow' }, [
      el('h2', { style: 'font-size:1.8rem' }, `About ${vendor.businessName}`),
      el('p', { style: 'font-size:1.05rem;color:var(--ink-soft)' }, vendor.about),

      vendor.services && vendor.services.length ? el('div', { style: 'margin-top:32px' }, [
        el('h3', {}, 'What they offer'),
        el('ul', { class: 'ticklist' }, vendor.services.map((service) => el('li', {}, [
          tickIcon('var(--sage-ink)'), el('span', {}, service),
        ]))),
      ]) : null,

      vendor.traditions && vendor.traditions.length ? el('div', { style: 'margin-top:32px' }, [
        el('h3', {}, 'Traditions they have logged experience with'),
        el('div', { class: 'row', style: 'gap:8px' },
          vendor.traditions.map((tradition) => el('span', { class: 'tag' }, tradition))),
        el('p', { class: 'tiny muted', style: 'margin-top:12px' },
          'Recorded by the vendor during onboarding, and used to match enquiries. It is not a rating.'),
      ]) : null,

      vendor.verified ? el('div', { class: 'panel panel--sage', style: 'margin-top:32px' }, [
        el('h3', { style: 'font-size:1.2rem' }, 'This vendor is AETERNA Verified'),
        el('p', { class: 'small', style: 'margin-bottom:12px' },
          'Identity, insurance, references, portfolio rights and a live video call have been completed, and the checks repeat every year.'),
        el('a', { class: 'btn btn--ghost btn--sm', href: '#/verification', 'data-link': '' }, 'Read exactly what that covers'),
      ]) : el('div', { class: 'panel panel--gold', style: 'margin-top:32px' }, [
        el('h3', { style: 'font-size:1.2rem' }, 'Verification is still in progress'),
        el('p', { class: 'small', style: 'margin-bottom:12px' },
          'This vendor has not completed the full set of checks yet, so they do not carry the badge. You can still enquire.'),
        el('a', { class: 'btn btn--ghost btn--sm', href: '#/verification', 'data-link': '' }, 'What the checks cover'),
      ]),

      vendor.isSample ? el('div', { class: 'notice notice--info', style: 'margin-top:28px' }, [
        el('div', {}, [
          el('strong', {}, 'This is a sample listing. '),
          'AETERNA is in its validation phase, so this profile is here to show how the marketplace works rather than to represent a live business.',
        ]),
      ]) : null,
    ]);

    const body = el('section', { class: 'section', style: 'padding-top:0' }, [
      el('div', { class: 'wrap' }, [
        el('div', {
          class: 'grid', style: 'grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:clamp(28px,4vw,56px);align-items:start',
        }, [details, enquiryPanel]),
      ]),
    ]);

    page.replaceChildren(header, galleryBlock, body);
  })();

  return page;
}
