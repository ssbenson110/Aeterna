import {
  el, clear, money, poundsToPence, longDate, countdown, setMeta, toast,
  tickIcon, celebrate, pluralise,
} from '../ui.js';
import { api, ApiError } from '../api.js';
import { store } from '../store.js';
import {
  openAuthDialog, loadingBlock, errorBlock, sectionHeader, traditionsPicker, upgradePanel,
} from '../components.js';
import { navigate } from '../router.js';

const DRAFT_KEY = 'aeterna.plan.draft';

// Mirrors the server side split so the preview and the saved plan agree.
const SPLIT = [
  ['Venue and catering', 0.4],
  ['Photography and video', 0.12],
  ['Decor and florals', 0.12],
  ['Outfits and jewellery', 0.11],
  ['Planning and coordination', 0.07],
  ['Music and entertainment', 0.07],
  ['Hair and makeup', 0.05],
  ['Stationery and favours', 0.03],
  ['Contingency', 0.03],
];

export function renderPlanner() {
  setMeta(
    'Your Wedding Reality Plan, AETERNA',
    'A free wedding plan with a real budget split, a countdown, a checklist, guests, seating and a day timeline.'
  );

  const page = el('div');
  if (!store.user) page.append(renderIntake());
  else if (store.user.role !== 'couple') page.append(vendorNotice());
  else page.append(renderFullPlanner());
  return page;
}

/* ================================================================== */
/* intake, for anyone who has not signed in yet                        */
/* ================================================================== */

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; }
}
function writeDraft(draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* private mode, carry on */ }
}
export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
}

function renderIntake() {
  const meta = store.meta || {};
  const regions = meta.regions || ['South London'];
  const traditions = meta.traditions || [];
  const draft = readDraft();

  const wrapper = el('div');
  const preview = el('div', { id: 'plan-preview', 'aria-live': 'polite' });

  const form = el('form', { class: 'panel', novalidate: '' });

  const dateInput = el('input', { type: 'date', name: 'weddingDate', value: draft.weddingDate || '' });
  const budgetInput = el('input', {
    type: 'text', name: 'budget', inputmode: 'numeric', placeholder: '24,000',
    value: draft.budgetPence ? String(Math.round(draft.budgetPence / 100)) : '',
  });
  const guestsInput = el('input', {
    type: 'number', name: 'guestCount', min: '0', max: '2000', placeholder: '140',
    value: draft.guestCount || '',
  });
  const regionSelect = el('select', { name: 'region' },
    (meta.regionGroups || [{ label: 'Regions', items: regions }]).map((group) =>
      el('optgroup', { label: group.label }, group.items.map((region) =>
        el('option', { value: region, selected: region === (draft.region || 'South London') }, region)))));

  const picker = traditionsPicker({ selected: draft.traditions || [], custom: draft.customTraditions || [] });

  form.append(
    el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:18px' }, [
      el('label', { class: 'field', style: 'margin:0' }, [el('span', {}, 'Your date, or your best guess'), dateInput]),
      el('label', { class: 'field', style: 'margin:0' }, [
        el('span', {}, 'Total budget in pounds'), budgetInput,
        el('span', { class: 'hint' }, 'A working figure. You can change it later.'),
      ]),
      el('label', { class: 'field', style: 'margin:0' }, [el('span', {}, 'Guest count'), guestsInput]),
      el('label', { class: 'field', style: 'margin:0' }, [el('span', {}, 'Where'), regionSelect]),
    ]),
    el('fieldset', { style: 'margin-top:26px' }, [
      el('legend', {}, 'Traditions you are bringing together'),
      el('p', { class: 'small muted', style: 'margin:-2px 0 14px' },
        'Pick as many as apply. If yours is not here, type it in and we will treat it exactly the same.'),
      picker.node,
    ]),
    el('div', { class: 'row', style: 'margin-top:22px;gap:12px' }, [
      el('button', { class: 'btn btn--primary', type: 'submit' }, 'Build my plan'),
      el('span', { class: 'small muted' }, 'Nothing is sent to a vendor. This is just for you.'),
    ])
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = {
      weddingDate: dateInput.value || null,
      budgetPence: poundsToPence(budgetInput.value),
      guestCount: Number(guestsInput.value) || 0,
      region: regionSelect.value,
      traditions: picker.getSelected(),
      customTraditions: picker.getCustom(),
    };
    writeDraft(next);
    clear(preview).append(buildPreview(next));
    preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  wrapper.append(
    el('section', { class: 'section section--tight section--blush' }, [
      el('div', { class: 'wrap' }, [
        sectionHeader({
          eyebrow: 'Free for everyone',
          title: 'The Wedding Reality Plan',
          lede: 'Answer four questions and get a real budget split, a countdown and a first set of actions. About ten minutes. Saving it and coming back to it needs a free account.',
        }),
      ]),
    ]),
    el('section', { class: 'section' }, [
      el('div', { class: 'wrap-narrow' }, [form, preview]),
    ])
  );

  if (draft.budgetPence || draft.weddingDate || draft.guestCount) {
    preview.append(buildPreview(draft));
  }

  return wrapper;
}

function buildPreview(draft) {
  const block = el('div', { style: 'margin-top:36px' });
  const count = countdown(draft.weddingDate);
  const perHead = draft.budgetPence && draft.guestCount
    ? Math.round((draft.budgetPence * 0.4) / draft.guestCount)
    : 0;

  block.append(el('div', { class: 'grid grid--3', style: 'margin-bottom:28px' }, [
    stat(count ? count.label : 'Date not set', draft.weddingDate ? longDate(draft.weddingDate) : 'Add a date for a countdown'),
    stat(draft.budgetPence ? money(draft.budgetPence) : 'No budget yet', 'Total budget'),
    stat(draft.guestCount ? String(draft.guestCount) : 'No count yet', perHead ? `About ${money(perHead)} a head for catering` : 'Guests'),
  ]));

  if (draft.budgetPence) {
    block.append(el('div', { class: 'panel', style: 'margin-bottom:24px' }, [
      el('h3', {}, 'Where the money goes'),
      el('div', { class: 'table-scroll' }, [
        el('table', { class: 'table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', {}, 'Category'), el('th', { class: 'num' }, 'Planned'),
          ])]),
          el('tbody', {}, SPLIT.map(([category, share]) => el('tr', {}, [
            el('td', {}, category),
            el('td', { class: 'num' }, money(Math.round(draft.budgetPence * share))),
          ]))),
        ]),
      ]),
      el('p', { class: 'tiny muted', style: 'margin-top:12px' },
        'A starting split you can move around once the plan is saved. The contingency line is there because something always moves.'),
    ]));
  }

  const allTraditions = (draft.traditions || []).concat(draft.customTraditions || []);
  if (allTraditions.length) {
    block.append(el('div', { class: 'panel panel--sage', style: 'margin-bottom:24px' }, [
      el('h3', { style: 'font-size:1.2rem' }, 'What your traditions need from a venue'),
      el('p', { class: 'small', style: 'margin-bottom:10px' },
        `You are combining ${allTraditions.join(' and ')}. The planner builds every answer around that, and the checklist adds the specific questions to ask.`),
      el('div', { class: 'row', style: 'gap:8px' },
        allTraditions.map((tradition) => el('span', { class: 'tag' }, tradition))),
    ]));
  }

  block.append(el('div', { class: 'panel panel--blush' }, [
    el('h3', { style: 'font-size:1.35rem' }, 'Save this and keep going'),
    el('p', { style: 'margin-bottom:18px' },
      'A free account saves this plan, unlocks the checklist, guest list, seating and day timeline, and lets the AI planner answer using these numbers.'),
    el('div', { class: 'row', style: 'gap:12px' }, [
      el('button', {
        class: 'btn btn--primary', type: 'button',
        onclick: () => openAuthDialog({
          reason: 'Your answers are held in this browser. Create a free account and we will save them to your plan.',
          mode: 'register', role: 'couple',
          onDone: async () => {
            try {
              await api.updateWedding(draft);
              clearDraft();
              await store.refresh();
              celebrate();
              navigate('#/planner');
            } catch {
              toast('Your account is ready. We could not copy the draft across, so please re-enter it in the planner.', 'bad');
              navigate('#/planner');
            }
          },
        }),
      }, 'Create a free account'),
      el('button', {
        class: 'btn btn--quiet', type: 'button',
        onclick: () => openAuthDialog({ mode: 'login' }),
      }, 'I already have one'),
    ]),
    el('p', { class: 'tiny muted', style: 'margin:16px 0 0' },
      'Planning stays free. The optional £49 upgrade is paid once per wedding and is not a subscription.'),
  ]));

  return block;

  function stat(value, label) {
    return el('div', { class: 'panel', style: 'text-align:center' }, [
      el('p', { class: 'stat', style: 'margin:0' }, value),
      el('p', { class: 'stat-label' }, label),
    ]);
  }
}

/* ================================================================== */
/* the saved planner                                                   */
/* ================================================================== */

function vendorNotice() {
  return el('section', { class: 'section' }, [
    el('div', { class: 'wrap-narrow' }, [
      el('div', { class: 'empty' }, [
        el('h3', {}, 'The planner is for couple accounts'),
        el('p', { class: 'muted' }, 'You are signed in as a vendor. Your enquiries live in your vendor dashboard.'),
        el('a', { class: 'btn btn--primary', href: '#/account', 'data-link': '' }, 'Go to your dashboard'),
      ]),
    ]),
  ]);
}

function renderFullPlanner() {
  const host = el('div', {}, [loadingBlock('Loading your plan')]);
  let plan = null;
  let activeTab = (location.hash.split('tab=')[1] || 'checklist').split('&')[0];

  const reload = async () => {
    try {
      plan = await api.planner();
      store.setWedding(plan.wedding);
      draw();
    } catch (error) {
      host.replaceChildren(errorBlock(error.message, reload));
    }
  };

  function draw() {
    const wedding = plan.wedding;
    const count = countdown(wedding.weddingDate);

    const header = el('section', { class: 'section section--tight section--blush' }, [
      el('div', { class: 'wrap' }, [
        el('p', { class: 'eyebrow' }, 'Your Wedding Reality Plan'),
        el('h1', { style: 'font-size:clamp(2rem,4.5vw,3rem);margin-bottom:10px' },
          [wedding.partnerOne, wedding.partnerTwo].filter(Boolean).join(' and ') || 'Your wedding'),
        el('p', { class: 'lede', style: 'margin-bottom:22px' },
          `${longDate(wedding.weddingDate)}${count ? `, ${count.label.toLowerCase()}` : ''}. ${wedding.region}.`),
        el('div', { class: 'grid grid--4' }, [
          stat(count ? count.label : 'Set a date', 'Countdown'),
          stat(wedding.budgetPence ? money(wedding.budgetPence) : 'Not set', 'Total budget'),
          stat(String(wedding.guestCount || 0), 'Guests planned'),
          stat(`${plan.checklistProgress.done} of ${plan.checklistProgress.total}`, 'Tasks done'),
        ]),
        plan.entitlements ? planBanner(plan.entitlements) : null,
        (wedding.allTraditions || wedding.traditions).length
          ? el('div', { class: 'row', style: 'gap:8px;margin-top:20px' },
            (wedding.allTraditions || wedding.traditions).map((t) => el('span', { class: 'tag' }, t)))
          : null,
      ]),
    ]);

    const ent = plan.entitlements || { plan: 'upgraded', features: {} };
    const locked = (feature) => ent.plan === 'free' && !ent.features[feature];

    // Locked tabs stay visible and clickable. Hiding them would be dishonest
    // about what the product does, and a padlock the user can open is kinder
    // than a feature they never knew existed.
    const tabNames = [
      ['checklist', 'Checklist', false],
      ['budget', 'Budget', false],
      ['guests', 'Guests', locked('guests')],
      ['seating', 'Seating', locked('seating')],
      ['timeline', 'Timeline', locked('timeline')],
      ['workspace', 'Shared page', locked('sharedWorkspace')],
      ['details', 'Wedding details', false],
      ['enquiries', 'Enquiries', false],
    ];

    const panel = el('div', {
      id: 'planner-panel', role: 'tabpanel', tabindex: '0',
      'aria-labelledby': `tab-${activeTab}`,
    });
    const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Plan sections' },
      tabNames.map(([key, label, isLocked]) => el('button', {
        type: 'button', role: 'tab', id: `tab-${key}`,
        'aria-selected': String(activeTab === key),
        'aria-controls': 'planner-panel',
        tabindex: activeTab === key ? '0' : '-1',
        onclick: () => { activeTab = key; history.replaceState(null, '', `#/planner?tab=${key}`); paint(); },
      }, isLocked ? [label, el('span', { class: 'lock', title: 'Part of the £49 upgrade' }, '·')] : label)));

    // Left and right arrows move between tabs, which is what a keyboard user expects.
    tabs.addEventListener('keydown', (event) => {
      const index = tabNames.findIndex(([key]) => key === activeTab);
      let next = null;
      if (event.key === 'ArrowRight') next = (index + 1) % tabNames.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabNames.length) % tabNames.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabNames.length - 1;
      if (next === null) return;
      event.preventDefault();
      activeTab = tabNames[next][0];
      history.replaceState(null, '', `#/planner?tab=${activeTab}`);
      paint();
      tabs.children[next].focus();
    });

    function paint() {
      [...tabs.children].forEach((button, index) => {
        const selected = tabNames[index][0] === activeTab;
        button.setAttribute('aria-selected', String(selected));
        button.setAttribute('tabindex', selected ? '0' : '-1');
      });
      panel.setAttribute('aria-labelledby', `tab-${activeTab}`);
      clear(panel);
      const entry = tabNames.find(([key]) => key === activeTab);
      if (entry && entry[2]) {
        panel.append(lockedTab(activeTab, reload));
        return;
      }
      const painters = {
        checklist: checklistTab, budget: budgetTab, guests: guestsTab,
        seating: seatingTab, timeline: timelineTab, details: detailsTab,
        enquiries: enquiriesTab, workspace: workspaceTab,
      };
      panel.append((painters[activeTab] || checklistTab)(plan, reload));
    }
    paint();

    host.replaceChildren(header, el('section', { class: 'section' }, [
      el('div', { class: 'wrap' }, [tabs, panel]),
    ]));
  }

  reload();
  return host;

  function stat(value, label) {
    return el('div', { class: 'panel', style: 'text-align:center;background:var(--paper)' }, [
      el('p', { class: 'stat', style: 'margin:0;font-size:clamp(1.3rem,2.4vw,1.8rem)' }, value),
      el('p', { class: 'stat-label' }, label),
    ]);
  }
}

/**
 * A plain statement of which plan this wedding is on and what is left.
 * No countdowns and no pressure, just the numbers.
 */
function planBanner(ent) {
  if (ent.plan === 'upgraded') {
    return el('p', { class: 'small', style: 'margin-top:18px;color:var(--sage-ink);font-weight:600' },
      `Upgraded. ${ent.ai.remaining} of ${ent.ai.quota} planner messages left this month, and everything is unlocked.`);
  }
  return el('div', { class: 'row', style: 'gap:12px;margin-top:18px;align-items:center' }, [
    el('span', { class: 'badge badge--plain' }, 'Free plan'),
    el('span', { class: 'small muted' },
      `${ent.ai.remaining} of ${ent.ai.quota} planner messages left, and ${ent.enquiries.remaining} of ${ent.enquiries.quota} enquiries.`),
    el('a', { class: 'linkish small', href: '#/pricing', 'data-link': '' }, 'What the £49 upgrade adds'),
  ]);
}

/* ---------------- locked tabs ---------------- */

const LOCKED_COPY = {
  guests: {
    title: 'The guest list is part of the upgrade',
    body: 'Build your list with sides, groups, dietary notes and RSVP tracking, and get the headcount the caterer will ask for. Your checklist and budget stay free and stay exactly as they are.',
  },
  seating: {
    title: 'The seating designer is part of the upgrade',
    body: 'Lay out the room with round, square, banquet, oval and top tables. Drag them into place, set seats per table and seat every guest.',
  },
  timeline: {
    title: 'The day timeline is part of the upgrade',
    body: 'Build the hour by hour running order and share one version with every supplier, so nobody is working from a different plan.',
  },
  sharedWorkspace: {
    title: 'The shared page is part of the upgrade',
    body: 'Bring your planner and your booked vendors onto one page, with a shared timeline, tasks and a comment thread each. Booked vendors see only their own slice, never your full guest list or your total budget.',
  },
};

function lockedTab(tab, reload) {
  const key = tab === 'workspace' ? 'sharedWorkspace' : tab;
  const copy = LOCKED_COPY[key] || { title: 'Part of the upgrade', body: '' };
  return el('div', {}, [
    upgradePanel({ title: copy.title, body: copy.body, onUpgrade: reload }),
    el('p', { class: 'small muted', style: 'margin-top:18px' }, [
      'The free plan covers the checklist, the budget, 20 planner messages and one enquiry. ',
      el('a', { href: '#/pricing', 'data-link': '' }, 'See exactly what each plan includes'),
      '.',
    ]),
  ]);
}

/* ---------------- shared workspace tab ---------------- */

function workspaceTab(plan) {
  return el('div', {}, [
    el('div', { class: 'notice notice--good', style: 'margin-bottom:20px' }, [
      el('div', {}, [
        el('strong', {}, 'Everyone on one page. '),
        'Your planner and every vendor you have booked work from the same date, the same timeline and the same task list.',
      ]),
    ]),
    el('p', { class: 'lede' }, 'Open the shared page to invite your planner, see your booked vendors and keep one version of the day.'),
    el('a', { class: 'btn btn--primary', href: `#/workspace/${plan.wedding.id}`, 'data-link': '' }, 'Open the shared page'),
  ]);
}

/* ---------------- checklist ---------------- */

function checklistTab(plan, reload) {
  const wrapper = el('div');
  const phases = [];
  for (const item of plan.checklist) {
    let phase = phases.find((p) => p.name === item.phase);
    if (!phase) { phase = { name: item.phase, items: [] }; phases.push(phase); }
    phase.items.push(item);
  }

  const progress = plan.checklistProgress;
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  wrapper.append(el('div', { class: 'panel', style: 'margin-bottom:24px' }, [
    el('div', { class: 'row row--between', style: 'margin-bottom:12px' }, [
      el('strong', {}, `${progress.done} of ${progress.total} done`),
      el('span', { class: 'small muted' }, `${percent}%`),
    ]),
    el('div', { class: 'meter meter--sage' }, [el('span', { style: `width:${percent}%` })]),
  ]));

  const addForm = el('form', { class: 'panel', style: 'margin-bottom:24px' }, [
    el('div', { class: 'row', style: 'gap:12px;align-items:flex-end' }, [
      el('label', { class: 'field', style: 'margin:0;flex:1 1 260px' }, [
        el('span', {}, 'Add your own task'),
        el('input', { type: 'text', name: 'title', placeholder: 'Book the dhol players', required: '' }),
      ]),
      el('label', { class: 'field', style: 'margin:0;flex:0 1 200px' }, [
        el('span', {}, 'Phase'),
        el('select', { name: 'phase' }, phases.map((p) => el('option', { value: p.name }, p.name))),
      ]),
      el('button', { class: 'btn btn--quiet', type: 'submit' }, 'Add task'),
    ]),
  ]);
  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(addForm).entries());
    if (!String(data.title || '').trim()) return;
    await api.addTask(data);
    reload();
  });
  wrapper.append(addForm);

  for (const phase of phases) {
    const done = phase.items.filter((i) => i.done).length;
    wrapper.append(el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
      el('div', { class: 'row row--between', style: 'margin-bottom:8px' }, [
        el('h3', { style: 'margin:0;font-size:1.2rem' }, phase.name),
        el('span', { class: 'small muted' }, `${done} of ${phase.items.length}`),
      ]),
      el('div', {}, phase.items.map((item) => {
        const box = el('input', { type: 'checkbox', checked: item.done, id: `chk-${item.id}` });
        box.addEventListener('change', async () => {
          row.classList.toggle('is-done', box.checked);
          try { await api.updateTask(item.id, { done: box.checked }); reload(); }
          catch (error) { toast(error.message, 'bad'); box.checked = !box.checked; }
        });
        const row = el('div', { class: `checkitem${item.done ? ' is-done' : ''}` }, [
          box,
          el('div', { style: 'flex:1' }, [
            el('label', { for: `chk-${item.id}`, style: 'cursor:pointer' }, [el('strong', {}, item.title)]),
            item.detail ? el('p', { class: 'small muted', style: 'margin:4px 0 0' }, item.detail) : null,
          ]),
          item.custom ? el('button', {
            class: 'linkish tiny', type: 'button',
            onclick: async () => { await api.removeTask(item.id); reload(); },
          }, 'Remove') : null,
        ]);
        return row;
      })),
    ]));
  }

  return wrapper;
}

/* ---------------- budget ---------------- */

function budgetTab(plan, reload) {
  const wrapper = el('div');
  const totals = plan.budgetTotals;
  const spentPercent = totals.budgetPence ? Math.min(100, Math.round((totals.actualPence / totals.budgetPence) * 100)) : 0;
  const over = totals.actualPence > totals.budgetPence && totals.budgetPence > 0;

  wrapper.append(el('div', { class: 'grid grid--4', style: 'margin-bottom:24px' }, [
    figure(money(totals.budgetPence), 'Total budget'),
    figure(money(totals.plannedPence), 'Planned'),
    figure(money(totals.actualPence), 'Committed so far'),
    figure(money(totals.remainingPence), over ? 'Over budget' : 'Left to commit'),
  ]));

  wrapper.append(el('div', { class: 'panel', style: 'margin-bottom:24px' }, [
    el('div', { class: 'row row--between', style: 'margin-bottom:10px' }, [
      el('strong', {}, 'Committed against budget'),
      el('span', { class: 'small muted' }, `${spentPercent}%`),
    ]),
    el('div', { class: `meter${over ? ' meter--over' : ''}` }, [el('span', { style: `width:${spentPercent}%` })]),
    totals.unallocatedPence !== 0 ? el('p', { class: 'small muted', style: 'margin:12px 0 0' },
      totals.unallocatedPence > 0
        ? `${money(totals.unallocatedPence)} of your budget is not allocated to a line yet.`
        : `Your planned lines add up to ${money(Math.abs(totals.unallocatedPence))} more than your total budget.`) : null,
    el('button', {
      class: 'btn btn--quiet btn--sm', type: 'button', style: 'margin-top:14px',
      onclick: async () => {
        try { await api.rebalanceBudget(); toast('Rebalanced to the standard split.', 'good'); reload(); }
        catch (error) { toast(error.message, 'bad'); }
      },
    }, 'Reset to the standard split'),
  ]));

  const rows = plan.budget.map((line) => {
    const planned = el('input', { type: 'text', inputmode: 'numeric', value: String(Math.round(line.plannedPence / 100)), 'aria-label': `Planned for ${line.category}`, style: 'max-width:130px' });
    const actual = el('input', { type: 'text', inputmode: 'numeric', value: String(Math.round(line.actualPence / 100)), 'aria-label': `Committed for ${line.category}`, style: 'max-width:130px' });
    const paid = el('input', { type: 'checkbox', checked: line.paid, 'aria-label': `Paid for ${line.category}` });

    const save = async (payload) => {
      try { await api.updateBudgetLine(line.id, payload); reload(); }
      catch (error) { toast(error.message, 'bad'); }
    };
    planned.addEventListener('change', () => save({ plannedPence: poundsToPence(planned.value) }));
    actual.addEventListener('change', () => save({ actualPence: poundsToPence(actual.value) }));
    paid.addEventListener('change', () => save({ paid: paid.checked }));

    return el('tr', {}, [
      el('td', {}, line.category),
      el('td', { class: 'num' }, planned),
      el('td', { class: 'num' }, actual),
      el('td', { class: 'num' }, paid),
      el('td', { class: 'num' }, el('button', {
        class: 'linkish tiny', type: 'button',
        onclick: async () => { await api.removeBudgetLine(line.id); reload(); },
      }, 'Remove')),
    ]);
  });

  wrapper.append(el('div', { class: 'panel' }, [
    el('div', { class: 'table-scroll' }, [
      el('table', { class: 'table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', {}, 'Category'),
          el('th', { class: 'num' }, 'Planned, £'),
          el('th', { class: 'num' }, 'Committed, £'),
          el('th', { class: 'num' }, 'Paid'),
          el('th', { class: 'num' }, ''),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]),
  ]));

  const addForm = el('form', { class: 'panel', style: 'margin-top:20px' }, [
    el('div', { class: 'row', style: 'gap:12px;align-items:flex-end' }, [
      el('label', { class: 'field', style: 'margin:0;flex:1 1 220px' }, [
        el('span', {}, 'Add a line'), el('input', { type: 'text', name: 'category', required: '', placeholder: 'Dhol players' }),
      ]),
      el('label', { class: 'field', style: 'margin:0;flex:0 1 160px' }, [
        el('span', {}, 'Planned, £'), el('input', { type: 'text', name: 'planned', inputmode: 'numeric', placeholder: '600' }),
      ]),
      el('button', { class: 'btn btn--quiet', type: 'submit' }, 'Add'),
    ]),
  ]);
  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(addForm).entries());
    if (!String(data.category || '').trim()) return;
    await api.addBudgetLine({ category: data.category, plannedPence: poundsToPence(data.planned) });
    reload();
  });
  wrapper.append(addForm);

  return wrapper;

  function figure(value, label) {
    return el('div', { class: 'panel', style: 'text-align:center' }, [
      el('p', { class: 'stat', style: 'margin:0;font-size:clamp(1.3rem,2.4vw,1.8rem)' }, value),
      el('p', { class: 'stat-label' }, label),
    ]);
  }
}

/* ---------------- guests ---------------- */

function guestsTab(plan, reload) {
  const wrapper = el('div');
  const totals = plan.guestTotals;

  wrapper.append(el('div', { class: 'grid grid--4', style: 'margin-bottom:24px' }, [
    fig(String(totals.total), 'On the list'),
    fig(String(totals.yes), 'Coming'),
    fig(String(totals.no), 'Cannot come'),
    fig(String(totals.pending), 'Waiting to hear'),
  ]));

  const addForm = el('form', { class: 'panel', style: 'margin-bottom:24px' }, [
    el('div', { class: 'row', style: 'gap:12px;align-items:flex-end' }, [
      el('label', { class: 'field', style: 'margin:0;flex:1 1 220px' }, [
        el('span', {}, 'Add a guest'), el('input', { type: 'text', name: 'name', required: '', placeholder: 'Ada Obi' }),
      ]),
      el('label', { class: 'field', style: 'margin:0;flex:0 1 180px' }, [
        el('span', {}, 'Group'), el('input', { type: 'text', name: 'party', placeholder: 'University friends' }),
      ]),
      el('label', { class: 'field', style: 'margin:0;flex:0 1 170px' }, [
        el('span', {}, 'Side'),
        el('select', { name: 'side' }, ['Both', 'Partner one', 'Partner two'].map((s) => el('option', { value: s }, s))),
      ]),
      el('button', { class: 'btn btn--quiet', type: 'submit' }, 'Add guest'),
    ]),
  ]);
  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(addForm).entries());
    if (!String(data.name || '').trim()) return;
    await api.addGuest(data);
    addForm.reset();
    reload();
  });
  wrapper.append(addForm);

  if (!plan.guests.length) {
    wrapper.append(el('div', { class: 'empty' }, [
      el('h3', {}, 'No guests on the list yet'),
      el('p', { class: 'muted' }, 'Build it in three tiers. The people who must be there, the people you would love there, and the people you would invite if the numbers allow.'),
    ]));
    return wrapper;
  }

  const rows = plan.guests.map((guest) => {
    const rsvp = el('select', { 'aria-label': `RSVP for ${guest.name}`, style: 'max-width:140px' },
      ['pending', 'yes', 'no'].map((value) => el('option', {
        value, selected: guest.rsvp === value,
      }, value === 'pending' ? 'Waiting' : value === 'yes' ? 'Coming' : 'Cannot come')));
    rsvp.addEventListener('change', async () => {
      try { await api.updateGuest(guest.id, { rsvp: rsvp.value }); reload(); }
      catch (error) { toast(error.message, 'bad'); }
    });

    const table = el('select', { 'aria-label': `Table for ${guest.name}`, style: 'max-width:150px' }, [
      el('option', { value: '' }, 'Not seated'),
      ...plan.seating.tables.map((t) => el('option', { value: t.id, selected: guest.tableId === t.id }, t.name)),
    ]);
    table.addEventListener('change', async () => {
      try { await api.updateGuest(guest.id, { tableId: table.value || null }); reload(); }
      catch (error) { toast(error.message, 'bad'); table.value = guest.tableId || ''; }
    });

    return el('tr', {}, [
      el('td', {}, el('strong', {}, guest.name)),
      el('td', { class: 'small muted' }, guest.party || 'No group'),
      el('td', { class: 'small muted' }, guest.side),
      el('td', {}, rsvp),
      el('td', {}, table),
      el('td', { class: 'num' }, el('button', {
        class: 'linkish tiny', type: 'button',
        onclick: async () => { await api.removeGuest(guest.id); reload(); },
      }, 'Remove')),
    ]);
  });

  wrapper.append(el('div', { class: 'panel' }, [
    el('div', { class: 'table-scroll' }, [
      el('table', { class: 'table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', {}, 'Name'), el('th', {}, 'Group'), el('th', {}, 'Side'),
          el('th', {}, 'RSVP'), el('th', {}, 'Table'), el('th', {}, ''),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]),
  ]));

  wrapper.append(guestMessaging(plan));

  return wrapper;

  function fig(value, label) {
    return el('div', { class: 'panel', style: 'text-align:center' }, [
      el('p', { class: 'stat', style: 'margin:0' }, value),
      el('p', { class: 'stat-label' }, label),
    ]);
  }
}

/* ---------------- guest messaging and RSVP links ---------------- */

/**
 * Messages go out through channels the couple already has. Email delivery is
 * not connected, so composing a message produces a WhatsApp link and a mail
 * link per guest, each carrying that guest's personal RSVP page. Guests reply
 * from the link with no account, and the RSVP lands straight in the list.
 */
function guestMessaging(plan) {
  const wrapper = el('div', { class: 'panel', style: 'margin-top:24px' }, [
    el('h3', { style: 'font-size:1.3rem;margin-bottom:4px' }, 'Message your guests'),
    el('p', { class: 'small muted', style: 'margin-bottom:16px' },
      'Write once. Every guest gets a WhatsApp and an email link with your message and their own reply page, so RSVPs land straight back in this list.'),
  ]);

  const form = el('form', { novalidate: '' }, [
    el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:14px' }, [
      el('label', { class: 'field', style: 'margin:0' }, [
        el('span', {}, 'Subject'),
        el('input', { type: 'text', name: 'subject', required: '', maxlength: '160', placeholder: 'Save the date' }),
      ]),
      el('label', { class: 'field', style: 'margin:0' }, [
        el('span', {}, 'Send to'),
        el('select', { name: 'audience' }, [
          el('option', { value: 'all' }, 'Everyone'),
          el('option', { value: 'pending' }, 'Only guests yet to reply'),
          el('option', { value: 'yes' }, 'Only guests who said yes'),
        ]),
      ]),
    ]),
    el('label', { class: 'field' }, [
      el('span', {}, 'Message'),
      el('textarea', {
        name: 'body', rows: '3', required: '', maxlength: '2000',
        placeholder: 'We are getting married on 12 June and would love you there. Details and your reply link below.',
      }),
    ]),
    el('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, 'Create the send list'),
  ]);

  const results = el('div', { style: 'margin-top:16px' }, []);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api.sendGuestMessage(data);
      clear(results);
      results.append(el('div', { class: 'notice notice--info', style: 'margin-bottom:14px' }, [
        el('div', { class: 'small' }, result.note),
      ]));
      if (!result.recipients.length) {
        results.append(el('p', { class: 'small muted' }, 'Nobody matches that audience yet.'));
        return;
      }
      results.append(el('div', { class: 'table-scroll' }, [
        el('table', { class: 'table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', {}, 'Guest'), el('th', {}, 'Send with'), el('th', {}, 'Reply link'),
          ])]),
          el('tbody', {}, result.recipients.map((recipient) => el('tr', {}, [
            el('td', { class: 'small' }, recipient.name),
            el('td', {}, el('div', { class: 'row', style: 'gap:8px' }, [
              el('a', {
                class: 'btn btn--quiet btn--sm', href: recipient.whatsapp,
                target: '_blank', rel: 'noopener noreferrer',
              }, 'WhatsApp'),
              el('a', { class: 'btn btn--quiet btn--sm', href: recipient.mailto }, 'Email'),
            ])),
            el('td', {}, el('button', {
              class: 'linkish tiny', type: 'button',
              onclick: async () => {
                try {
                  await navigator.clipboard.writeText(recipient.rsvpUrl);
                  toast('Reply link copied.', 'good');
                } catch {
                  window.prompt('Copy this reply link', recipient.rsvpUrl);
                }
              },
            }, 'Copy link')),
          ]))),
        ]),
      ]));
    } catch (error) { toast(error.message, 'bad'); }
  });

  wrapper.append(form, results);
  return wrapper;
}

/* ---------------- seating, demo only ---------------- */

function seatingTab(plan, reload) {
  const wrapper = el('div');
  const shapes = (plan.seating && plan.seating.shapes) || [];
  const tables = (plan.seating.tables || []).map((t) => ({ ...t }));
  let selectedId = tables.length ? tables[0].id : null;

  /* ---- add a table ---- */

  const shapeSelect = el('select', { 'aria-label': 'Table shape' },
    shapes.map((shape) => el('option', { value: shape.key }, shape.label)));
  const seatsInput = el('input', { type: 'number', value: '8', min: '2', max: '24', 'aria-label': 'Seats' });
  shapeSelect.addEventListener('change', () => {
    const spec = shapes.find((sh) => sh.key === shapeSelect.value);
    if (spec) { seatsInput.value = String(spec.defaultSeats); seatsInput.min = String(spec.minSeats); seatsInput.max = String(spec.maxSeats); }
  });

  const addForm = el('form', { class: 'panel', style: 'margin-bottom:20px' }, [
    el('div', { class: 'row', style: 'gap:12px;align-items:flex-end' }, [
      el('label', { class: 'field', style: 'margin:0;flex:1 1 180px' }, [
        el('span', {}, 'Table name'),
        el('input', { type: 'text', name: 'name', required: '', placeholder: `Table ${tables.length + 1}` }),
      ]),
      el('label', { class: 'field', style: 'margin:0;flex:0 1 150px' }, [el('span', {}, 'Shape'), shapeSelect]),
      el('label', { class: 'field', style: 'margin:0;flex:0 1 110px' }, [el('span', {}, 'Seats'), seatsInput]),
      el('button', { class: 'btn btn--quiet', type: 'submit' }, 'Add table'),
    ]),
  ]);
  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(addForm).entries());
    if (!String(data.name || '').trim()) return;
    try {
      await api.addTable({ name: data.name, shape: shapeSelect.value, capacity: Number(seatsInput.value) || 8 });
      reload();
    } catch (error) { toast(error.message, 'bad'); }
  });
  wrapper.append(addForm);

  /* ---- the room ---- */

  const room = el('div', {
    class: 'seating-room', role: 'application',
    'aria-label': 'Seating plan. Drag tables to arrange the room, or use the arrow keys on a selected table.',
  });

  const editor = el('div', { style: 'margin-top:20px' });

  function savePosition(table) {
    api.updateTable(table.id, { x: table.x, y: table.y }).catch((error) => toast(error.message, 'bad'));
  }

  function paintRoom() {
    clear(room);
    for (const table of tables) {
      const spec = shapes.find((sh) => sh.key === table.shape) || shapes[0] || { width: 12, height: 12 };
      const full = table.seated >= table.capacity;
      const node = el('div', {
        class: `stable stable--${table.shape || 'round'}${table.id === selectedId ? ' stable--selected' : ''}${full ? ' stable--full' : ''}`,
        tabindex: '0',
        role: 'button',
        'aria-label': `${table.name}, ${spec.label || table.shape}, ${table.seated} of ${table.capacity} seated. Arrow keys move it.`,
        style: `left:${table.x}%;top:${table.y}%;width:${spec.width}%;height:${spec.height * 1.6}%`,
      }, [
        el('strong', {}, table.name),
        el('span', { class: 'stable__count' }, `${table.seated}/${table.capacity}`),
      ]);

      /* drag with pointer events */
      node.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        selectedId = table.id;
        paintRoom();
        paintEditor();
        const roomRect = room.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const origX = table.x;
        const origY = table.y;
        let moved = false;

        const onMove = (move) => {
          moved = true;
          table.x = Math.min(92, Math.max(0, origX + ((move.clientX - startX) / roomRect.width) * 100));
          table.y = Math.min(92, Math.max(0, origY + ((move.clientY - startY) / roomRect.height) * 100));
          node.style.left = `${table.x}%`;
          node.style.top = `${table.y}%`;
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (moved) savePosition(table);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      /* keyboard: arrows move, enter selects */
      node.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 5 : 2;
        let handled = true;
        if (event.key === 'ArrowLeft') table.x = Math.max(0, table.x - step);
        else if (event.key === 'ArrowRight') table.x = Math.min(92, table.x + step);
        else if (event.key === 'ArrowUp') table.y = Math.max(0, table.y - step);
        else if (event.key === 'ArrowDown') table.y = Math.min(92, table.y + step);
        else if (event.key === 'Enter' || event.key === ' ') { selectedId = table.id; paintEditor(); paintRoom(); }
        else handled = false;
        if (handled && event.key.startsWith('Arrow')) {
          event.preventDefault();
          node.style.left = `${table.x}%`;
          node.style.top = `${table.y}%`;
          clearTimeout(node._saveTimer);
          node._saveTimer = setTimeout(() => savePosition(table), 400);
        }
      });

      room.append(node);
    }

    if (!tables.length) {
      room.append(el('p', { class: 'muted small', style: 'position:absolute;inset:0;display:grid;place-items:center;margin:0;padding:20px;text-align:center' },
        'An empty room. Add your first table above, then drag it wherever it should stand.'));
    }
  }

  /* ---- the editor for the selected table ---- */

  function paintEditor() {
    clear(editor);
    const table = tables.find((t) => t.id === selectedId);
    if (!table) {
      editor.append(el('p', { class: 'small muted' }, 'Select a table to edit it, seat guests or change its shape.'));
      return;
    }
    const spec = shapes.find((sh) => sh.key === table.shape) || { minSeats: 2, maxSeats: 24 };

    const nameInput = el('input', { type: 'text', value: table.name, 'aria-label': 'Table name' });
    const shapeEdit = el('select', { 'aria-label': 'Table shape' },
      shapes.map((sh) => el('option', { value: sh.key, selected: sh.key === table.shape }, sh.label)));
    const seatsEdit = el('input', {
      type: 'number', value: String(table.capacity),
      min: String(spec.minSeats), max: String(spec.maxSeats), 'aria-label': 'Seats',
    });

    const save = async (payload) => {
      try {
        await api.updateTable(table.id, payload);
        reload();
      } catch (error) { toast(error.message, 'bad'); }
    };
    nameInput.addEventListener('change', () => save({ name: nameInput.value }));
    shapeEdit.addEventListener('change', () => save({ shape: shapeEdit.value }));
    seatsEdit.addEventListener('change', () => save({ capacity: Number(seatsEdit.value) }));

    const unseated = plan.guests.filter((g) => !g.tableId);
    const seatedHere = plan.guests.filter((g) => g.tableId === table.id);

    editor.append(el('div', { class: 'panel' }, [
      el('div', { class: 'row row--between', style: 'margin-bottom:14px' }, [
        el('h3', { style: 'margin:0;font-size:1.2rem' }, `Editing ${table.name}`),
        el('button', {
          class: 'linkish tiny', type: 'button',
          onclick: async () => {
            try { await api.removeTable(table.id); reload(); }
            catch (error) { toast(error.message, 'bad'); }
          },
        }, 'Remove this table'),
      ]),
      el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr));gap:14px;margin-bottom:18px' }, [
        el('label', { class: 'field', style: 'margin:0' }, [el('span', {}, 'Name'), nameInput]),
        el('label', { class: 'field', style: 'margin:0' }, [el('span', {}, 'Shape'), shapeEdit]),
        el('label', { class: 'field', style: 'margin:0' }, [
          el('span', {}, 'Seats'), seatsEdit,
          el('span', { class: 'hint' }, `${spec.minSeats} to ${spec.maxSeats} for this shape`),
        ]),
      ]),
      el('div', { class: 'grid grid--2', style: 'gap:18px' }, [
        el('div', {}, [
          el('h4', { style: 'margin-bottom:8px' }, `Seated here, ${seatedHere.length} of ${table.capacity}`),
          seatedHere.length
            ? el('div', {}, seatedHere.map((guest) => el('div', {
              class: 'row row--between', style: 'padding:6px 0;border-top:1px solid var(--line)',
            }, [
              el('span', { class: 'small' }, guest.name),
              el('button', {
                class: 'linkish tiny', type: 'button',
                onclick: async () => {
                  try { await api.updateGuest(guest.id, { tableId: null }); reload(); }
                  catch (error) { toast(error.message, 'bad'); }
                },
              }, 'Unseat'),
            ])))
            : el('p', { class: 'small muted' }, 'Nobody yet.'),
        ]),
        el('div', {}, [
          el('h4', { style: 'margin-bottom:8px' }, `Still to seat, ${unseated.length}`),
          unseated.length
            ? el('div', { style: 'max-height:220px;overflow-y:auto' }, unseated.map((guest) => el('div', {
              class: 'row row--between', style: 'padding:6px 0;border-top:1px solid var(--line)',
            }, [
              el('span', { class: 'small' }, guest.name),
              el('button', {
                class: 'btn btn--quiet btn--sm', type: 'button',
                onclick: async () => {
                  try { await api.updateGuest(guest.id, { tableId: table.id }); reload(); }
                  catch (error) { toast(error.message, 'bad'); }
                },
              }, 'Seat here'),
            ])))
            : el('p', { class: 'small muted' }, 'Everyone with an RSVP is seated.'),
        ]),
      ]),
    ]));
  }

  const seatedTotal = plan.guests.filter((g) => g.tableId).length;
  wrapper.append(
    el('div', { class: 'row row--between', style: 'margin-bottom:12px' }, [
      el('p', { class: 'small muted', style: 'margin:0' },
        `${tables.length} ${tables.length === 1 ? 'table' : 'tables'}, ${seatedTotal} of ${plan.guests.length} guests seated. Drag tables to arrange the room. Arrow keys work too.`),
    ]),
    room,
    editor
  );

  paintRoom();
  paintEditor();
  return wrapper;
}

/* ---------------- timeline ---------------- */

function timelineTab(plan, reload) {
  const wrapper = el('div');

  const addForm = el('form', { class: 'panel', style: 'margin-bottom:24px' }, [
    el('div', { class: 'row', style: 'gap:12px;align-items:flex-end' }, [
      el('label', { class: 'field', style: 'margin:0;flex:0 1 140px' }, [
        el('span', {}, 'Time'), el('input', { type: 'time', name: 'time', required: '', value: '12:00' }),
      ]),
      el('label', { class: 'field', style: 'margin:0;flex:1 1 220px' }, [
        el('span', {}, 'What happens'), el('input', { type: 'text', name: 'title', required: '', placeholder: 'Baraat arrives' }),
      ]),
      el('label', { class: 'field', style: 'margin:0;flex:0 1 190px' }, [
        el('span', {}, 'Who owns it'), el('input', { type: 'text', name: 'owner', placeholder: 'Venue' }),
      ]),
      el('button', { class: 'btn btn--quiet', type: 'submit' }, 'Add'),
    ]),
  ]);
  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(addForm).entries());
    if (!String(data.title || '').trim()) return;
    await api.addTimelineEvent(data);
    addForm.reset();
    reload();
  });
  wrapper.append(addForm);

  wrapper.append(el('div', { class: 'panel' }, plan.timeline.map((event, index) => el('div', {
    style: `display:grid;grid-template-columns:88px 1fr auto;gap:16px;padding:14px 0;${index ? 'border-top:1px solid var(--line)' : ''}`,
  }, [
    el('strong', { style: 'font-variant-numeric:tabular-nums;color:var(--coral-ink)' }, event.time),
    el('div', {}, [
      el('strong', {}, event.title),
      event.detail ? el('p', { class: 'small muted', style: 'margin:3px 0 0' }, event.detail) : null,
      event.owner ? el('p', { class: 'tiny muted', style: 'margin:3px 0 0' }, `Owned by ${event.owner}`) : null,
    ]),
    el('button', {
      class: 'linkish tiny', type: 'button',
      onclick: async () => { await api.removeTimelineEvent(event.id); reload(); },
    }, 'Remove'),
  ]))));

  wrapper.append(el('div', { class: 'row', style: 'gap:14px;margin-top:16px;align-items:center' }, [
    el('button', {
      class: 'btn btn--quiet btn--sm', type: 'button',
      onclick: async () => {
        const { downloadIcs } = await import('./crm.js');
        if (!plan.wedding.weddingDate) { toast('Set your wedding date first, a calendar needs one.'); return; }
        downloadIcs('aeterna-wedding-day.ics', plan.timeline.map((event) => ({
          uid: event.id,
          date: plan.wedding.weddingDate,
          time: event.time,
          title: event.title,
          detail: [event.detail, event.owner ? `Owner: ${event.owner}` : ''].filter(Boolean).join('. '),
        })));
        toast('Calendar file downloaded. Open it in Google Calendar, Apple Calendar or Outlook.', 'good');
      },
    }, 'Download as a calendar file'),
    el('span', { class: 'small muted' },
      'Once this is right, send it to every supplier so nobody is working from a different version.'),
  ]));

  return wrapper;
}

/* ---------------- details ---------------- */

function detailsTab(plan, reload) {
  const wedding = plan.wedding;
  const meta = store.meta || {};
  const form = el('form', { class: 'panel' });

  const picker = traditionsPicker({
    selected: wedding.traditions || [],
    custom: wedding.customTraditions || [],
  });

  form.append(
    el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:18px' }, [
      field('Partner one', el('input', { type: 'text', name: 'partnerOne', value: wedding.partnerOne || '' })),
      field('Partner two', el('input', { type: 'text', name: 'partnerTwo', value: wedding.partnerTwo || '' })),
      field('Wedding date', el('input', { type: 'date', name: 'weddingDate', value: wedding.weddingDate || '' })),
      field('Total budget, £', el('input', {
        type: 'text', name: 'budget', inputmode: 'numeric',
        value: wedding.budgetPence ? String(Math.round(wedding.budgetPence / 100)) : '',
      })),
      field('Guest count', el('input', { type: 'number', name: 'guestCount', min: '0', max: '2000', value: wedding.guestCount || 0 })),
      field('Region', el('select', { name: 'region' },
        (meta.regionGroups || [{ label: 'Regions', items: meta.regions || [] }]).map((group) =>
          el('optgroup', { label: group.label }, group.items.map((r) =>
            el('option', { value: r, selected: r === wedding.region }, r)))))),
    ]),
    el('fieldset', { style: 'margin-top:26px' }, [
      el('legend', {}, 'Traditions'),
      el('p', { class: 'small muted', style: 'margin:-2px 0 14px' },
        'If yours is not listed, type it in. Custom entries are matched against vendor experience exactly like the presets.'),
      picker.node,
    ]),
    el('label', { class: 'field', style: 'margin-top:18px' }, [
      el('span', {}, 'Anything else the planner should know'),
      el('textarea', { name: 'notes', rows: '3', maxlength: '2000' }, wedding.notes || ''),
    ]),
    el('button', { class: 'btn btn--primary', type: 'submit' }, 'Save details')
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await api.updateWedding({
        partnerOne: data.partnerOne,
        partnerTwo: data.partnerTwo,
        weddingDate: data.weddingDate || null,
        budgetPence: poundsToPence(data.budget),
        guestCount: Number(data.guestCount) || 0,
        region: data.region,
        notes: data.notes,
        traditions: picker.getSelected(),
        customTraditions: picker.getCustom(),
      });
      toast('Saved. The planner will use these numbers from now on.', 'good');
      reload();
    } catch (error) {
      toast(error.message, 'bad');
    }
  });

  const upgrade = el('div', { class: 'panel panel--blush', style: 'margin-top:24px' }, [
    el('h3', { style: 'font-size:1.25rem' }, wedding.upgraded ? 'This wedding is upgraded' : 'The optional upgrade'),
    el('p', { style: 'margin-bottom:16px' }, wedding.upgraded
      ? 'You have the upgraded planner allowance and the full export. Paid once, and it will not renew.'
      : 'A one off £49 per wedding. It raises the AI planner allowance under the published fair use policy and unlocks the full plan export. It is not a subscription.'),
    wedding.upgraded ? null : el('button', {
      class: 'btn btn--primary', type: 'button',
      onclick: async () => {
        try {
          const result = await api.upgrade();
          celebrate();
          toast(`Upgrade recorded. ${result.note}`, 'good');
          await store.refresh();
          reload();
        } catch (error) { toast(error.message, 'bad'); }
      },
    }, 'Upgrade this wedding, £49 once'),
    el('p', { class: 'tiny muted', style: 'margin:14px 0 0' },
      'Card processing is not connected in this build, so no payment is taken.'),
  ]);

  return el('div', {}, [form, upgrade]);

  function field(label, input) {
    return el('label', { class: 'field', style: 'margin:0' }, [el('span', {}, label), input]);
  }
}

/* ---------------- enquiries ---------------- */

function enquiriesTab() {
  const wrapper = el('div', {}, [loadingBlock('Loading your enquiries')]);
  (async () => {
    try {
      const data = await api.enquiries();
      if (!data.enquiries.length) {
        wrapper.replaceChildren(el('div', { class: 'empty' }, [
          el('h3', {}, 'No enquiries yet'),
          el('p', { class: 'muted' }, 'When you are ready, one enquiry goes to one verified vendor. Nobody else sees it.'),
          el('a', { class: 'btn btn--primary', href: '#/browse', 'data-link': '' }, 'Browse vendors'),
        ]));
        return;
      }
      wrapper.replaceChildren(el('div', { class: 'grid grid--2' }, data.enquiries.map((enquiry) => el('div', { class: 'panel' }, [
        el('div', { class: 'row row--between', style: 'margin-bottom:10px' }, [
          el('span', { class: 'badge badge--coral' }, enquiry.categoryLabel),
          el('span', { class: 'tiny muted' }, enquiry.reference),
        ]),
        el('h3', { style: 'font-size:1.2rem;margin-bottom:6px' }, enquiry.vendor ? enquiry.vendor.businessName : 'Finding a match'),
        el('p', { class: 'small muted', style: 'margin-bottom:12px' }, statusLine(enquiry)),
        el('p', { class: 'small', style: 'margin-bottom:12px' }, enquiry.routedReason),
        el('div', { class: 'notice notice--good', style: 'padding:10px 14px' }, [
          el('span', { class: 'tiny' }, 'Sent to one vendor. Not shared with anyone else.'),
        ]),
        enquiry.status === 'accepted' && enquiry.vendor ? el('button', {
          class: 'btn btn--primary btn--sm', type: 'button', style: 'margin-top:14px',
          onclick: async () => {
            try {
              const result = await api.bookVendor({ vendorId: enquiry.vendor.id, enquiryId: enquiry.id });
              celebrate();
              toast(result.note, 'good');
            } catch (error) { toast(error.message, 'bad'); }
          },
        }, `Book ${enquiry.vendor.businessName}`) : null,
        enquiry.status === 'accepted' ? el('p', { class: 'tiny muted', style: 'margin:10px 0 0' },
          'Booking them adds them to your shared page, scoped to their own work.') : null,
      ]))));
    } catch (error) {
      wrapper.replaceChildren(errorBlock(error.message));
    }
  })();
  return wrapper;

  function statusLine(enquiry) {
    const map = {
      awaiting_vendor: 'Waiting for their reply',
      accepted: 'They have accepted and will be in touch',
      declined: 'They could not take it on',
      no_match: 'No other matching vendor is available right now',
    };
    const base = map[enquiry.status] || enquiry.status;
    return enquiry.attempt > 1 ? `${base}. This is vendor ${enquiry.attempt}, one at a time.` : base;
  }
}
