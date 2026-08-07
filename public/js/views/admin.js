import {
  el, clear, money, setMeta, toast, shortDate, longDate, debounce, tickIcon, crossIcon,
} from '../ui.js';
import { api, ApiError } from '../api.js';
import { store } from '../store.js';
import { loadingBlock, errorBlock, verifiedBadge, openAuthDialog } from '../components.js';
import { navigate, currentQuery } from '../router.js';

/**
 * The verification console.
 *
 * The console records the outcome of the six published checks. It has no button
 * that awards a badge, because the badge is derived on the server from those
 * checks plus a valid insurance certificate. Anything in this file that looks
 * like it grants a badge is really just recording evidence.
 */

const STATE_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  ready: 'Ready',
  verified: 'Verified',
  all: 'Everyone',
  attention: 'Needs attention',
};

const CHECK_STATUS_LABELS = {
  outstanding: 'Outstanding',
  passed: 'Passed',
  failed: 'Failed',
  not_applicable: 'Not applicable',
};

export function renderAdmin() {
  setMeta('Verification console, AETERNA', 'Staff console for the AETERNA Verified checks.');

  if (!store.user) {
    openAuthDialog({ mode: 'login', reason: 'The verification console is for AETERNA staff.' });
    return gate('Sign in to open the console');
  }
  if (store.user.role !== 'admin') {
    return gate('The verification console is for AETERNA staff', 'This account is not a staff account.');
  }

  const host = el('div', {}, [loadingBlock('Loading the console')]);
  const query = currentQuery();
  const state = { filter: query.filter || 'attention', q: query.q || '', tab: query.tab || 'queue' };

  const load = async () => {
    let meta;
    try { meta = await api.adminMeta(); }
    catch (error) { host.replaceChildren(errorBlock(error.message, load)); return; }
    paint(meta);
  };

  async function paint(meta) {
    const panel = el('div', { id: 'admin-panel' });

    const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Console sections' },
      [['queue', 'Verification queue'], ['renewals', 'Renewals'], ['audit', 'Audit trail']]
        .map(([key, label]) => el('button', {
          type: 'button', role: 'tab', id: `atab-${key}`,
          'aria-selected': String(state.tab === key),
          'aria-controls': 'admin-panel',
          onclick: () => { state.tab = key; sync(); render(); },
        }, label)));

    function render() {
      [...tabs.children].forEach((button) => {
        button.setAttribute('aria-selected', String(button.id === `atab-${state.tab}`));
      });
      clear(panel);
      if (state.tab === 'queue') panel.append(queueSection(meta, state, sync));
      else if (state.tab === 'renewals') panel.append(renewalsSection());
      else panel.append(auditSection());
    }

    host.replaceChildren(
      el('section', { class: 'section section--tight', style: 'background:var(--ivory-deep)' }, [
        el('div', { class: 'wrap' }, [
          el('p', { class: 'eyebrow' }, 'Staff console'),
          el('h1', { style: 'font-size:clamp(1.8rem,3.6vw,2.6rem);margin-bottom:12px' }, 'AETERNA Verified'),
          el('div', { class: 'notice notice--info', style: 'max-width:820px' }, [
            el('div', {}, [
              el('strong', {}, 'The badge is derived, not switched on. '),
              meta.rule,
            ]),
          ]),
        ]),
      ]),
      el('section', { class: 'section', style: 'padding-top:clamp(24px,3vw,36px)' }, [
        el('div', { class: 'wrap' }, [tabs, panel]),
      ])
    );
    render();
  }

  function sync() {
    const params = new URLSearchParams();
    if (state.tab !== 'queue') params.set('tab', state.tab);
    if (state.filter !== 'attention') params.set('filter', state.filter);
    if (state.q) params.set('q', state.q);
    history.replaceState(null, '', `#/admin${params.toString() ? `?${params}` : ''}`);
  }

  load();
  return host;
}

function gate(title, detail) {
  return el('section', { class: 'section' }, [
    el('div', { class: 'wrap-narrow' }, [
      el('div', { class: 'empty' }, [
        el('h3', {}, title),
        detail ? el('p', { class: 'muted' }, detail) : null,
        el('a', { class: 'btn btn--quiet', href: '#/', 'data-link': '' }, 'Back to the site'),
      ]),
    ]),
  ]);
}

/* ================================================================== */
/* queue                                                               */
/* ================================================================== */

function queueSection(meta, state, sync) {
  const wrapper = el('div');
  const results = el('div', { 'aria-live': 'polite' });
  const chips = el('div', { class: 'row', style: 'gap:8px;margin-bottom:18px' });

  const search = el('input', {
    type: 'search', value: state.q, placeholder: 'Search by business name, town or slug',
    'aria-label': 'Search vendors',
  });
  search.addEventListener('input', debounce(() => { state.q = search.value; sync(); load(); }, 300));

  wrapper.append(
    el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
      el('label', { class: 'field', style: 'margin:0' }, [el('span', {}, 'Find a vendor'), search]),
    ]),
    chips,
    results
  );

  async function load() {
    clear(results).append(loadingBlock('Loading the queue'));
    let data;
    try { data = await api.adminQueue({ filter: state.filter, q: state.q }); }
    catch (error) { clear(results).append(errorBlock(error.message, load)); return; }

    clear(chips);
    for (const filter of data.filters) {
      const count = data.counts[filter] ?? 0;
      chips.append(el('button', {
        type: 'button', class: 'pill', 'aria-pressed': String(state.filter === filter),
        onclick: () => { state.filter = filter; sync(); load(); },
      }, `${STATE_LABELS[filter] || filter} ${count}`));
    }

    clear(results);
    if (!data.vendors.length) {
      results.append(el('div', { class: 'empty' }, [
        el('h3', {}, 'Nothing here'),
        el('p', { class: 'muted' }, 'No vendors match that filter, which in this case is good news.'),
      ]));
      return;
    }

    results.append(el('div', { class: 'panel', style: 'padding:0;overflow:hidden' }, [
      el('div', { class: 'table-scroll' }, [
        el('table', { class: 'table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', {}, 'Vendor'),
            el('th', {}, 'State'),
            el('th', { class: 'num' }, 'Checks'),
            el('th', {}, 'Insurance'),
            el('th', {}, 'Re-check'),
            el('th', {}, ''),
          ])]),
          el('tbody', {}, data.vendors.map((row) => el('tr', {}, [
            el('td', {}, [
              el('strong', { style: 'display:block' }, row.businessName),
              el('span', { class: 'tiny muted' },
                `${row.category}, ${row.town || row.region}${row.isSample ? ', sample listing' : ''}`),
              row.badgeRemovedReason
                ? el('p', { class: 'tiny', style: 'margin:4px 0 0;color:var(--coral-deep)' }, row.badgeRemovedReason)
                : null,
            ]),
            el('td', {}, [
              row.verified ? verifiedBadge() : el('span', {
                class: `badge ${row.state === 'ready' ? 'badge--verified' : row.state === 'in_progress' ? 'badge--sample' : 'badge--plain'}`,
              }, STATE_LABELS[row.state]),
              row.needsAttention ? el('span', {
                class: 'badge badge--coral', style: 'margin-left:6px',
              }, 'Attention') : null,
            ]),
            el('td', { class: 'num' }, `${row.completed} of ${row.total}`),
            el('td', {}, insuranceChip(row.insuranceStatus, row.insuranceExpiresOn)),
            el('td', { class: 'tiny muted' }, row.recheckDueOn || 'Not set'),
            el('td', { class: 'num' }, el('button', {
              class: 'btn btn--quiet btn--sm', type: 'button',
              onclick: () => openDossier(row.vendorId, meta, load),
            }, 'Open')),
          ]))),
        ]),
      ]),
    ]));
  }

  load();
  return wrapper;
}

function insuranceChip(status, expiresOn) {
  const map = {
    valid: ['badge--verified', expiresOn ? `In date to ${expiresOn}` : 'In date'],
    expiring: ['badge--sample', `Expires ${expiresOn}`],
    expired: ['badge--coral', `Expired ${expiresOn}`],
    incomplete: ['badge--sample', 'Cover incomplete'],
    missing: ['badge--plain', 'None recorded'],
  };
  const [cls, label] = map[status] || map.missing;
  return el('span', { class: `badge ${cls}` }, label);
}

/* ================================================================== */
/* dossier                                                             */
/* ================================================================== */

function openDossier(vendorId, meta, onChange) {
  import('../ui.js').then(({ modal, closeModal }) => {
    const body = el('div', {}, [loadingBlock('Loading the dossier')]);
    modal('Verification dossier', body);

    const load = async () => {
      let data;
      try { data = await api.adminVendor(vendorId); }
      catch (error) { body.replaceChildren(errorBlock(error.message, load)); return; }
      body.replaceChildren(dossierBody(data, meta, async () => { await load(); onChange(); }));
    };
    load();
  });
}

function dossierBody(data, meta, reload) {
  const { vendor, assessment } = data;
  const wrapper = el('div');

  /* ---- header ---- */
  wrapper.append(
    el('div', { style: 'margin-bottom:18px' }, [
      el('h3', { style: 'font-size:1.4rem;margin-bottom:6px' }, vendor.businessName),
      el('p', { class: 'small muted', style: 'margin-bottom:10px' },
        `${vendor.category}, ${vendor.town || vendor.region}${vendor.isSample ? '. Sample listing.' : ''}`),
      el('div', { class: 'row', style: 'gap:8px' }, [
        vendor.verified ? verifiedBadge() : el('span', { class: 'badge badge--plain' }, 'Not verified'),
        el('span', { class: 'badge badge--plain' }, `${assessment.completed} of ${assessment.total} checks`),
        vendor.hasAccount ? null : el('span', { class: 'badge badge--sample' }, 'No account claimed'),
      ]),
    ])
  );

  if (vendor.badgeRemovedReason) {
    wrapper.append(el('div', { class: 'notice notice--warn', style: 'margin-bottom:16px' }, [
      el('div', {}, [el('strong', {}, 'Badge removed. '), vendor.badgeRemovedReason]),
    ]));
  }

  if (assessment.blockers.length) {
    wrapper.append(el('div', { class: 'notice notice--info', style: 'margin-bottom:18px' }, [
      el('div', {}, [
        el('strong', {}, 'Outstanding before the badge is awarded'),
        el('ul', { style: 'margin:8px 0 0;padding-left:1.1em' },
          assessment.blockers.map((b) => el('li', { class: 'small' }, b))),
      ]),
    ]));
  } else {
    wrapper.append(el('div', { class: 'notice notice--good', style: 'margin-bottom:18px' }, [
      el('div', {}, 'Every published check is satisfied, so the badge is awarded automatically.'),
    ]));
  }

  /* ---- the six checks ---- */
  wrapper.append(el('h4', { style: 'margin-bottom:10px' }, 'The six published checks'));

  for (const check of assessment.checks) {
    const definition = (meta.checks || []).find((c) => c.key === check.key) || {};
    const driven = Boolean(definition.drivenBy);

    const evidence = el('textarea', {
      rows: '2', maxlength: '2000', placeholder: definition.evidencePrompt || '',
      'aria-label': `Evidence for ${check.label}`,
    }, check.evidence || '');

    const row = el('div', {
      style: 'padding:14px 0;border-top:1px solid var(--line)',
    }, [
      el('div', { class: 'row row--between', style: 'margin-bottom:8px' }, [
        el('div', {}, [
          el('strong', {}, check.label),
          check.completedAt
            ? el('p', { class: 'tiny muted', style: 'margin:2px 0 0' },
              `${CHECK_STATUS_LABELS[check.status]} ${shortDate(check.completedAt)}${check.completedBy ? ` by ${check.completedBy}` : ''}`)
            : el('p', { class: 'tiny muted', style: 'margin:2px 0 0' }, CHECK_STATUS_LABELS[check.status]),
        ]),
        el('span', {
          class: `badge ${check.status === 'passed' ? 'badge--verified' : check.status === 'failed' ? 'badge--coral' : 'badge--plain'}`,
        }, CHECK_STATUS_LABELS[check.status]),
      ]),
    ]);

    if (driven) {
      row.append(el('p', { class: 'tiny muted', style: 'margin:0' }, definition.evidencePrompt));
      if (check.evidence) row.append(el('p', { class: 'small', style: 'margin:6px 0 0' }, check.evidence));
    } else {
      row.append(evidence);
      row.append(el('div', { class: 'row', style: 'gap:8px;margin-top:8px' }, [
        el('button', {
          class: 'btn btn--primary btn--sm', type: 'button',
          onclick: () => setCheck(check.key, 'passed', evidence.value),
        }, 'Pass'),
        el('button', {
          class: 'btn btn--quiet btn--sm', type: 'button',
          onclick: () => setCheck(check.key, 'failed', evidence.value),
        }, 'Fail'),
        check.status !== 'outstanding' ? el('button', {
          class: 'linkish tiny', type: 'button',
          onclick: () => setCheck(check.key, 'outstanding', evidence.value),
        }, 'Reset to outstanding') : null,
      ]));
    }

    wrapper.append(row);
  }

  async function setCheck(key, status, evidenceText) {
    try {
      const result = await api.adminSetCheck(vendor.id, key, { status, evidence: evidenceText });
      toast(result.note, result.assessment.shouldBeVerified ? 'good' : '');
      reload();
    } catch (error) { toast(error.message, 'bad'); }
  }

  /* ---- insurance ---- */
  const ins = assessment.insurance;
  const insuranceForm = el('form', { class: 'panel', style: 'margin-top:20px' }, [
    el('h4', { style: 'margin-bottom:4px' }, 'Insurance certificate'),
    el('p', { class: 'tiny muted', style: 'margin-bottom:14px' },
      `${ins.label}. Recording a certificate is what passes the insurance check, because a tick with no expiry date would be worthless.`),
    el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:14px' }, [
      el('label', { class: 'field', style: 'margin:0' }, [
        el('span', {}, 'Insurer'),
        el('input', { type: 'text', name: 'insurer', required: '', value: ins.insurer || '' }),
      ]),
      el('label', { class: 'field', style: 'margin:0' }, [
        el('span', {}, 'Policy number'),
        el('input', { type: 'text', name: 'policyNumber', value: ins.policyNumber || '' }),
      ]),
      el('label', { class: 'field', style: 'margin:0' }, [
        el('span', {}, 'Cover, £'),
        el('input', {
          type: 'text', name: 'cover', inputmode: 'numeric',
          value: ins.coverPence ? String(Math.round(ins.coverPence / 100)) : '',
        }),
      ]),
      el('label', { class: 'field', style: 'margin:0' }, [
        el('span', {}, 'Expires on'),
        el('input', { type: 'date', name: 'expiresOn', required: '', value: ins.expiresOn || '' }),
      ]),
    ]),
    ins.indemnityRequired ? el('label', { class: 'checkline', style: 'margin-top:12px' }, [
      el('input', { type: 'checkbox', name: 'indemnitySeen', checked: ins.indemnitySeen }),
      el('span', {}, 'Professional indemnity sighted. This category needs it as well as public liability.'),
    ]) : null,
    el('button', { class: 'btn btn--primary btn--sm', type: 'submit', style: 'margin-top:12px' },
      'Record this certificate'),
  ]);
  insuranceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(insuranceForm).entries());
    try {
      const result = await api.adminRecordInsurance(vendor.id, {
        insurer: form.insurer,
        policyNumber: form.policyNumber,
        coverPence: Math.round(Number(String(form.cover).replace(/[^0-9.]/g, '')) * 100) || 0,
        expiresOn: form.expiresOn,
        indemnitySeen: Boolean(form.indemnitySeen),
      });
      toast(result.note, 'good');
      reload();
    } catch (error) { toast(error.message, 'bad'); }
  });
  wrapper.append(insuranceForm);

  /* ---- chase, notes, images ---- */
  const chaseForm = el('form', { class: 'panel', style: 'margin-top:16px' }, [
    el('h4', { style: 'margin-bottom:10px' }, 'Log a renewal chase'),
    el('div', { class: 'row', style: 'gap:10px;align-items:flex-end' }, [
      el('label', { class: 'field', style: 'margin:0;flex:0 1 190px' }, [
        el('span', {}, 'About'),
        el('select', { name: 'kind' }, [
          el('option', { value: 'insurance' }, 'Insurance'),
          el('option', { value: 'annual_recheck' }, 'Annual re-check'),
        ]),
      ]),
      el('label', { class: 'field', style: 'margin:0;flex:1 1 220px' }, [
        el('span', {}, 'What you said'),
        el('input', { type: 'text', name: 'note', placeholder: 'Emailed asking for the renewed certificate' }),
      ]),
      el('button', { class: 'btn btn--quiet btn--sm', type: 'submit' }, 'Log it'),
    ]),
    data.chases.length ? el('div', { style: 'margin-top:14px' }, data.chases.slice(0, 5).map((chase) => el('p', {
      class: 'tiny muted', style: 'margin:0 0 4px',
    }, `${shortDate(chase.at)}, ${chase.kind.replace('_', ' ')}, ${chase.by}${chase.note ? `: ${chase.note}` : ''}`))) : null,
  ]);
  chaseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(chaseForm).entries());
    try {
      const result = await api.adminChase(vendor.id, form);
      toast(result.note, 'good');
      reload();
    } catch (error) { toast(error.message, 'bad'); }
  });
  wrapper.append(chaseForm);

  if (data.images && data.images.length) {
    wrapper.append(el('div', { class: 'panel', style: 'margin-top:16px' }, [
      el('h4', { style: 'margin-bottom:10px' }, 'Images the vendor uploaded'),
      el('p', { class: 'tiny muted', style: 'margin-bottom:12px' },
        'Remove anything they clearly do not hold the rights to. Removing an image is recorded against them.'),
      el('div', { class: 'grid grid--4' }, data.images.map((image) => el('figure', { style: 'margin:0' }, [
        el('div', { class: 'media media--1x1', style: 'border-radius:var(--r-sm)' }, [
          el('img', { src: image.url, alt: image.alt, loading: 'lazy' }),
        ]),
        el('figcaption', { class: 'tiny muted', style: 'margin-top:6px' }, image.alt),
        el('button', {
          class: 'linkish tiny', type: 'button',
          onclick: async () => {
            try { await api.adminRemoveImage(vendor.id, image.id); toast('Removed.', 'good'); reload(); }
            catch (error) { toast(error.message, 'bad'); }
          },
        }, 'Remove'),
      ]))),
    ]));
  }

  const notes = el('textarea', { rows: '3', maxlength: '4000', 'aria-label': 'Internal notes' }, vendor.adminNotes || '');
  wrapper.append(el('div', { class: 'panel', style: 'margin-top:16px' }, [
    el('h4', { style: 'margin-bottom:6px' }, 'Internal notes'),
    el('p', { class: 'tiny muted', style: 'margin-bottom:10px' },
      'Not shown to the vendor or to couples. Do not paste reference comments here, they are not reviews.'),
    notes,
    el('div', { class: 'row', style: 'gap:10px;margin-top:10px' }, [
      el('button', {
        class: 'btn btn--quiet btn--sm', type: 'button',
        onclick: async () => {
          try { await api.adminSetNotes(vendor.id, notes.value); toast('Saved.', 'good'); }
          catch (error) { toast(error.message, 'bad'); }
        },
      }, 'Save notes'),
      el('button', {
        class: 'linkish tiny', type: 'button',
        onclick: async () => {
          const reason = window.prompt('Why is the badge being suspended? This goes on the record.');
          if (!reason) return;
          try {
            const result = await api.adminSuspend(vendor.id, reason);
            toast(result.note, 'good');
            reload();
          } catch (error) { toast(error.message, 'bad'); }
        },
      }, 'Suspend the badge pending review'),
    ]),
  ]));

  /* ---- audit ---- */
  wrapper.append(el('div', { class: 'panel', style: 'margin-top:16px' }, [
    el('h4', { style: 'margin-bottom:10px' }, 'What happened, and who did it'),
    data.audit.length
      ? el('div', {}, data.audit.slice(0, 14).map((entry) => el('div', {
        style: 'padding:7px 0;border-top:1px solid var(--line)',
      }, [
        el('p', { class: 'small', style: 'margin:0' }, [
          el('strong', {}, entry.action.replace(/[._]/g, ' ')),
          entry.detail ? `, ${entry.detail}` : '',
        ]),
        el('p', { class: 'tiny muted', style: 'margin:0' }, `${entry.actor}, ${shortDate(entry.at)}`),
      ])))
      : el('p', { class: 'small muted' }, 'Nothing recorded yet.'),
  ]));

  return wrapper;
}

/* ================================================================== */
/* renewals                                                            */
/* ================================================================== */

function renewalsSection() {
  const host = el('div', {}, [loadingBlock('Loading renewals')]);

  const load = async () => {
    let data;
    try { data = await api.adminRenewals(); }
    catch (error) { host.replaceChildren(errorBlock(error.message, load)); return; }

    if (!data.renewals.length) {
      host.replaceChildren(el('div', { class: 'empty' }, [
        el('h3', {}, 'Nothing due'),
        el('p', { class: 'muted' }, `No insurance expiry or annual re-check falls inside the next ${data.chaseWindowDays} days.`),
      ]));
      return;
    }

    host.replaceChildren(
      el('div', { class: 'notice notice--info', style: 'margin-bottom:20px' }, [
        el('div', {}, data.note),
      ]),
      el('div', { class: 'panel', style: 'padding:0;overflow:hidden' }, [
        el('div', { class: 'table-scroll' }, [
          el('table', { class: 'table' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', {}, 'Vendor'), el('th', {}, 'What'), el('th', {}, 'Due'),
              el('th', {}, 'Last chased'), el('th', {}, ''),
            ])]),
            el('tbody', {}, data.renewals.map((item) => el('tr', {}, [
              el('td', {}, el('strong', {}, item.vendorName)),
              el('td', {}, [
                el('span', {
                  class: `badge ${item.urgency === 'lapsed' ? 'badge--coral' : item.urgency === 'urgent' ? 'badge--sample' : 'badge--plain'}`,
                }, item.kind === 'insurance' ? 'Insurance' : 'Annual re-check'),
                el('p', { class: 'tiny muted', style: 'margin:4px 0 0' }, item.detail),
              ]),
              el('td', { class: 'tiny' }, item.dueOn),
              el('td', { class: 'tiny muted' }, item.lastChasedAt ? shortDate(item.lastChasedAt) : 'Never'),
              el('td', { class: 'num' }, el('button', {
                class: 'btn btn--quiet btn--sm', type: 'button',
                onclick: async () => {
                  try {
                    await api.adminChase(item.vendorId, { kind: item.kind, note: 'Chased from the renewals list' });
                    toast('Chase logged. Send the message yourself, email is not connected in this build.', 'good');
                    load();
                  } catch (error) { toast(error.message, 'bad'); }
                },
              }, 'Log a chase')),
            ]))),
          ]),
        ]),
      ]),
      el('div', { class: 'panel', style: 'margin-top:20px' }, [
        el('h4', { style: 'margin-bottom:8px' }, 'Re-derive every badge now'),
        el('p', { class: 'small muted', style: 'margin-bottom:12px' },
          'This runs automatically every fifteen minutes. It reapplies the rules and cannot force a badge on.'),
        el('button', {
          class: 'btn btn--quiet btn--sm', type: 'button',
          onclick: async () => {
            try { const result = await api.adminSweep(); toast(result.note, 'good'); load(); }
            catch (error) { toast(error.message, 'bad'); }
          },
        }, 'Run the sweep'),
      ])
    );
  };

  load();
  return host;
}

/* ================================================================== */
/* audit                                                               */
/* ================================================================== */

function auditSection() {
  const host = el('div', {}, [loadingBlock('Loading the audit trail')]);

  (async () => {
    let data;
    try { data = await api.adminAudit(); }
    catch (error) { host.replaceChildren(errorBlock(error.message)); return; }

    host.replaceChildren(
      el('p', { class: 'small muted', style: 'margin-bottom:18px' },
        'Append only. This is the record we would produce if a couple ever asked what the badge meant on the day they booked.'),
      el('div', { class: 'panel', style: 'padding:0;overflow:hidden' }, [
        el('div', { class: 'table-scroll' }, [
          el('table', { class: 'table' }, [
            el('thead', {}, [el('tr', {}, [
              el('th', {}, 'When'), el('th', {}, 'Vendor'), el('th', {}, 'Action'), el('th', {}, 'Detail'), el('th', {}, 'Who'),
            ])]),
            el('tbody', {}, data.audit.map((entry) => el('tr', {}, [
              el('td', { class: 'tiny muted nowrap' }, shortDate(entry.at)),
              el('td', { class: 'small' }, entry.vendorName),
              el('td', {}, el('span', {
                class: `badge ${entry.action.startsWith('badge.awarded') ? 'badge--verified' : entry.action.startsWith('badge.') ? 'badge--coral' : 'badge--plain'}`,
              }, entry.action.replace(/[._]/g, ' '))),
              el('td', { class: 'small muted' }, entry.detail),
              el('td', { class: 'tiny muted' }, entry.actor),
            ]))),
          ]),
        ]),
      ])
    );
  })();

  return host;
}
