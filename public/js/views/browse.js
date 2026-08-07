import { el, clear, debounce, setMeta, money } from '../ui.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { vendorCard, sectionHeader, loadingBlock, errorBlock } from '../components.js';
import { navigate, currentQuery } from '../router.js';

export function renderBrowse() {
  setMeta(
    'Browse wedding vendors in South London and Kent, AETERNA',
    'Search verified venues, photographers, planners, hair and makeup artists and florists. One enquiry goes to one vendor, never a bidding swarm.'
  );

  const meta = store.meta || {};
  const categories = meta.categories || [];
  const regions = meta.regions || [];
  const traditions = meta.traditions || [];
  const images = meta.images || { categoryTiles: {} };

  const query = currentQuery();
  const state = {
    category: query.category || '',
    region: query.region || '',
    tradition: query.tradition || '',
    q: query.q || '',
  };

  const page = el('div');
  const results = el('div', { id: 'results', 'aria-live': 'polite' });

  /* ---------------- header ---------------- */

  page.append(el('section', { class: 'section section--tight section--blush', style: 'padding-bottom:clamp(20px,3vw,32px)' }, [
    el('div', { class: 'wrap' }, [
      sectionHeader({
        eyebrow: 'Browse vendors',
        title: 'Find the one vendor you actually want to talk to',
        lede: 'Twenty two categories across South London and Kent. Verified vendors appear first, then alphabetically. Position is never sold, and nothing here is ranked by what a vendor pays.',
        gap: '0',
      }),
    ]),
  ]));

  /* ---------------- category tiles, grouped by family ---------------- */

  /*
   * Twenty two categories is too many for a flat grid, so they are grouped into
   * families. Counts come from the API rather than being invented, and a family
   * with nothing in it says so instead of pretending.
   */
  const families = meta.categoryFamilies || [];
  const tilesHost = el('div', { style: 'margin-bottom:32px' });
  let counts = {};

  /*
   * The taxonomy is deliberately exhaustive, so every vendor who signs up has a
   * place. Browse does not pretend depth it lacks though: categories with
   * listings get photographic tiles, and the rest appear as plain chips with an
   * honest "no listings yet". Nothing is hidden, nothing is overstated.
   */
  function paintTiles() {
    clear(tilesHost);
    const havePhotos = Object.keys(counts).length > 0;

    for (const family of families) {
      const inFamily = categories.filter((c) => c.family === family.slug);
      if (!inFamily.length) continue;

      const populated = inFamily.filter((c) => (counts[c.slug] || 0) > 0);
      const empty = inFamily.filter((c) => !(counts[c.slug] || 0));

      const block = el('div', { style: 'margin-bottom:26px' }, [
        el('h3', {
          style: 'font-size:1rem;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-muted);margin-bottom:14px',
        }, family.label),
      ]);

      if (populated.length) {
        block.append(el('div', { class: 'grid grid--4', style: 'margin-bottom:12px' }, populated.map((category) => {
          const image = (images.categoryTiles || {})[category.slug] || {};
          const active = state.category === category.slug;
          const count = counts[category.slug];
          return el('button', {
            type: 'button',
            class: 'card card--link',
            'aria-pressed': String(active),
            title: category.blurb,
            style: `text-align:left;padding:0;cursor:pointer;font:inherit;border-width:${active ? '2px' : '1px'};border-color:${active ? 'var(--coral-cta)' : 'var(--line)'}`,
            onclick: () => { state.category = active ? '' : category.slug; paintTiles(); load(); },
          }, [
            image.url ? el('div', { class: 'media media--16x9' }, [
              el('img', { src: image.url, alt: image.alt || '', loading: 'lazy', decoding: 'async' }),
            ]) : null,
            el('div', { style: 'padding:12px 14px 16px' }, [
              el('strong', { style: 'display:block;font-size:.97rem;margin-bottom:3px' }, category.label),
              el('span', { class: 'tiny muted' },
                `${count} ${count === 1 ? 'listing' : 'listings'}${active ? ', showing' : ''}`),
            ]),
          ]);
        })));
      }

      if (empty.length && havePhotos) {
        block.append(el('div', { class: 'row', style: 'gap:8px' }, empty.map((category) => {
          const active = state.category === category.slug;
          return el('button', {
            type: 'button', class: 'pill', 'aria-pressed': String(active),
            title: `${category.blurb} No listings yet.`,
            onclick: () => { state.category = active ? '' : category.slug; paintTiles(); load(); },
          }, `${category.label}${category.catchAll ? '' : ', none yet'}`);
        })));
      }

      block.append(el('p', { class: 'tiny muted', style: 'margin:10px 0 0' }, ''));
      tilesHost.append(block);
    }

    tilesHost.append(el('p', { class: 'tiny muted', style: 'margin:4px 0 0' },
      'Every category is open to vendors from day one, including the ones with no listings yet. If a service exists, it has a place here.'));
  }
  paintTiles();

  /* ---------------- filters ---------------- */

  const searchInput = el('input', {
    type: 'search', value: state.q, placeholder: 'Search by name, town or what they do',
    'aria-label': 'Search vendors',
  });
  searchInput.addEventListener('input', debounce(() => { state.q = searchInput.value; load(); }, 300));

  const regionSelect = groupedSelect('Anywhere in the UK', meta.regionGroups || [{ label: 'Regions', items: regions }],
    state.region, (value) => { state.region = value; load(); });

  /*
   * Traditions as a search box rather than a fixed list. The presets appear as
   * suggestions, but a couple can type anything at all, because no list of
   * ours will ever cover every tradition. Matching on the server is loose in
   * both directions.
   */
  const traditionList = el('datalist', { id: 'tradition-options' },
    traditions.map((t) => el('option', { value: t })));
  const traditionSelect = el('input', {
    type: 'search', list: 'tradition-options', value: state.tradition,
    placeholder: 'Nikah, Yoruba, tea ceremony, anything',
    'aria-label': 'Search by tradition a vendor has worked with',
  });
  traditionSelect.addEventListener('input', debounce(() => {
    state.tradition = traditionSelect.value.trim();
    load();
  }, 320));

  const filters = el('form', {
    class: 'panel', style: 'margin-bottom:28px',
    onsubmit: (event) => event.preventDefault(),
  }, [
    el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:16px;align-items:end' }, [
      el('label', { class: 'field', style: 'margin:0' }, [el('span', {}, 'Search'), searchInput]),
      el('label', { class: 'field', style: 'margin:0' }, [el('span', {}, 'Region'), regionSelect]),
      el('label', { class: 'field', style: 'margin:0' }, [
        el('span', {}, 'Tradition they have worked with'), traditionSelect, traditionList,
      ]),
      el('button', {
        class: 'btn btn--quiet', type: 'button',
        onclick: () => {
          state.category = ''; state.region = ''; state.tradition = ''; state.q = '';
          searchInput.value = ''; regionSelect.value = ''; traditionSelect.value = '';
          paintTiles(); load();
        },
      }, 'Clear filters'),
    ]),
  ]);

  page.append(el('section', { class: 'section', style: 'padding-top:clamp(28px,4vw,44px)' }, [
    el('div', { class: 'wrap' }, [tilesHost, filters, results]),
  ]));

  /* ---------------- data ---------------- */

  async function load() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state)) if (value) params.set(key, value);
    const hash = `#/browse${params.toString() ? `?${params}` : ''}`;
    history.replaceState(null, '', hash);

    clear(results).append(loadingBlock('Finding vendors'));
    try {
      const data = await api.vendors(state);
      if (data.countsByCategory) { counts = data.countsByCategory; paintTiles(); }
      clear(results);

      results.append(el('div', {
        class: 'row row--between', style: 'margin-bottom:20px',
      }, [
        el('p', { class: 'small muted', style: 'margin:0' },
          data.total === 0
            ? 'No vendors match those filters yet.'
            : `${data.total} ${data.total === 1 ? 'vendor' : 'vendors'} match. ${data.ordering}`),
      ]));

      if (!data.vendors.length) {
        results.append(el('div', { class: 'empty' }, [
          el('h3', {}, 'Nothing matches that yet'),
          el('p', { class: 'muted' },
            'Try a wider region or clear a filter. AETERNA is starting in South London and Kent, so the map is deliberately small for now.'),
        ]));
        return;
      }

      results.append(el('div', { class: 'grid grid--3' }, data.vendors.map(vendorCard)));
    } catch (error) {
      clear(results).append(errorBlock(error.message, load));
    }
  }

  load();
  return page;

  function groupedSelect(placeholder, groups, value, onChange) {
    const node = el('select', {}, [
      el('option', { value: '' }, placeholder),
      ...groups.map((group) => el('optgroup', { label: group.label },
        group.items.map((item) => el('option', { value: item, selected: item === value }, item)))),
    ]);
    node.addEventListener('change', () => onChange(node.value));
    return node;
  }

  function select(placeholder, options, value, onChange) {
    const node = el('select', {}, [
      el('option', { value: '' }, placeholder),
      ...options.map((option) => el('option', { value: option, selected: option === value }, option)),
    ]);
    node.addEventListener('change', () => onChange(node.value));
    return node;
  }
}
