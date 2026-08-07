import { el, clear, money, setMeta, toast, shortDate, longDate } from '../ui.js';
import { api, ApiError } from '../api.js';
import { store } from '../store.js';
import { loadingBlock, errorBlock } from '../components.js';

/**
 * The vendor CRM: pipeline, quotes, invoices and availability.
 *
 * The pipeline is the vendor's private working view. Quotes are the one
 * proposal channel, decided by the couple on the shared page, so the CRM never
 * becomes a place where agreements happen out of sight.
 */

/* ------------------------------------------------------------------ */
/* calendar export, client side                                        */
/*                                                                     */
/* ICS is plain text, so it is generated here from data the page       */
/* already has. No server endpoint, works identically in the demo.     */
/* ------------------------------------------------------------------ */

export function downloadIcs(filename, events) {
  const stamp = (date) => date.replace(/[-:]/g, '').replace('.000', '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AETERNA//Wedding planner//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const event of events) {
    if (!event.date) continue;
    const uid = `${event.uid || Math.random().toString(36).slice(2)}@aeterna`;
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp(new Date().toISOString().slice(0, 19))}Z`);
    if (event.time) {
      const start = `${event.date.replace(/-/g, '')}T${event.time.replace(':', '')}00`;
      lines.push(`DTSTART:${start}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`);
    }
    lines.push(`SUMMARY:${String(event.title || '').replace(/[\n,;]/g, ' ')}`);
    if (event.detail) lines.push(`DESCRIPTION:${String(event.detail).replace(/[\n,;]/g, ' ')}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

/* ------------------------------------------------------------------ */
/* the CRM panel on the vendor dashboard                               */
/* ------------------------------------------------------------------ */

export function crmPanel() {
  const host = el('div', {}, [loadingBlock('Loading your pipeline')]);
  let tab = 'pipeline';

  const load = async () => {
    let pipeline;
    let invoices;
    let availability;
    try {
      [pipeline, invoices, availability] = await Promise.all([
        api.crmPipeline(),
        api.crmInvoices(),
        api.crmAvailability(),
      ]);
    } catch (error) {
      host.replaceChildren(errorBlock(error.message, load));
      return;
    }

    const panel = el('div');
    const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'CRM sections' },
      [['pipeline', `Pipeline ${pipeline.total}`], ['invoices', 'Invoices'], ['availability', 'Availability']]
        .map(([key, label]) => el('button', {
          type: 'button', role: 'tab', 'aria-selected': String(tab === key),
          onclick: () => { tab = key; paint(); },
        }, label)));

    function paint() {
      [...tabs.children].forEach((button, index) => {
        button.setAttribute('aria-selected', String(['pipeline', 'invoices', 'availability'][index] === tab));
      });
      clear(panel);
      if (tab === 'pipeline') panel.append(pipelineBoard(pipeline, load));
      else if (tab === 'invoices') panel.append(invoicesPanel(invoices, load));
      else panel.append(availabilityPanel(availability, pipeline, load));
    }

    host.replaceChildren(
      el('h2', { style: 'font-size:1.5rem;margin-bottom:6px' }, 'Your business'),
      el('p', { class: 'small muted', style: 'margin-bottom:18px' },
        'Every enquiry, quote and invoice in one place. Quotes are decided by the couple on their shared page, so what was agreed is always on the record.'),
      tabs, panel
    );
    paint();
  };

  load();
  return host;
}

/* ---------------- pipeline ---------------- */

function pipelineBoard(pipeline, reload) {
  const board = el('div', { class: 'crm-board' });

  for (const stage of pipeline.stages) {
    const column = el('div', { class: 'crm-column' }, [
      el('div', { class: 'row row--between', style: 'margin-bottom:10px' }, [
        el('h4', { style: 'margin:0' }, stage.label),
        el('span', { class: 'tiny muted' }, String(stage.cards.length)),
      ]),
    ]);

    if (!stage.cards.length) {
      column.append(el('p', { class: 'tiny muted' }, 'Nothing here.'));
    }

    for (const card of stage.cards) {
      column.append(pipelineCard(card, stage.key, reload));
    }
    board.append(column);
  }

  return el('div', {}, [
    board,
    el('p', { class: 'tiny muted', style: 'margin-top:12px' },
      'Cards move on their own when the facts change: accepting an enquiry, sending a quote, or the couple approving one. You can also move them by hand.'),
  ]);
}

function pipelineCard(card, stageKey, reload) {
  const node = el('div', { class: 'crm-card' }, [
    el('div', { class: 'row row--between', style: 'margin-bottom:6px' }, [
      el('strong', { class: 'small' }, card.reference),
      el('span', { class: 'tiny muted' }, card.weddingDate ? shortDate(card.weddingDate) : 'No date'),
    ]),
    el('p', { class: 'tiny muted', style: 'margin:0 0 8px' },
      `${card.guestCount || '?'} guests, ${card.region}`),
    card.message ? el('p', { class: 'tiny', style: 'margin:0 0 8px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical' }, card.message) : null,
    card.quotes.length ? el('p', { class: 'tiny', style: 'margin:0 0 8px' },
      card.quotes.map((q) => `${money(q.amountPence)} ${q.status}`).join(', ')) : null,
    card.booked ? el('span', { class: 'badge badge--verified' }, `Booked, ${money(card.agreedPence)}`) : null,
  ]);

  const actions = el('div', { class: 'row', style: 'gap:6px;margin-top:8px' });

  if (!card.booked && ['new', 'in_conversation', 'quoted'].includes(stageKey)) {
    actions.append(el('button', {
      class: 'btn btn--quiet btn--sm', type: 'button',
      onclick: () => quoteForm(card, reload),
    }, card.quotes.some((q) => q.status === 'sent') ? 'Quote again' : 'Send a quote'));
  }
  if (stageKey === 'new') {
    actions.append(el('button', {
      class: 'linkish tiny', type: 'button',
      onclick: async () => {
        try { await api.crmUpdateEnquiry(card.enquiryId, { stage: 'in_conversation' }); reload(); }
        catch (error) { toast(error.message, 'bad'); }
      },
    }, 'Mark in conversation'));
  }
  if (['new', 'in_conversation', 'quoted'].includes(stageKey) && !card.booked) {
    actions.append(el('button', {
      class: 'linkish tiny', type: 'button',
      onclick: async () => {
        try { await api.crmUpdateEnquiry(card.enquiryId, { stage: 'closed_lost' }); reload(); }
        catch (error) { toast(error.message, 'bad'); }
      },
    }, 'Close'));
  }
  node.append(actions);

  /* private notes */
  const notes = el('textarea', {
    rows: '2', placeholder: 'Private notes, never shown to the couple',
    'aria-label': `Notes for ${card.reference}`, style: 'margin-top:8px;font-size:.78rem',
  }, card.notes || '');
  notes.addEventListener('change', async () => {
    try { await api.crmUpdateEnquiry(card.enquiryId, { notes: notes.value }); toast('Notes saved.', 'good'); }
    catch (error) { toast(error.message, 'bad'); }
  });
  node.append(notes);

  return node;
}

function quoteForm(card, reload) {
  import('../ui.js').then(({ modal, closeModal }) => {
    const form = el('form', { novalidate: '' }, [
      el('label', { class: 'field' }, [
        el('span', {}, 'What the quote covers'),
        el('input', { type: 'text', name: 'title', required: '', maxlength: '160', placeholder: 'Full day photography with a second shooter' }),
      ]),
      el('label', { class: 'field' }, [
        el('span', {}, 'Details'),
        el('textarea', { name: 'description', rows: '4', maxlength: '4000', placeholder: 'What is included, what is not, and any conditions.' }),
      ]),
      el('label', { class: 'field' }, [
        el('span', {}, 'Amount, £'),
        el('input', { type: 'text', name: 'amount', inputmode: 'numeric', required: '', placeholder: '1950' }),
      ]),
      el('div', { class: 'notice notice--info', style: 'margin-bottom:16px' }, [
        el('div', { class: 'small' },
          'The couple decides on their shared page. If they approve, you are booked at this amount automatically and it joins your calendar.'),
      ]),
      el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Send the quote'),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const amountPence = Math.round(Number(String(data.amount).replace(/[^0-9.]/g, '')) * 100);
      try {
        const result = await api.crmSendQuote({
          weddingId: card.weddingId,
          enquiryId: card.enquiryId,
          title: data.title,
          description: data.description,
          amountPence,
        });
        closeModal();
        toast(result.note, 'good');
        reload();
      } catch (error) { toast(error.message, 'bad'); }
    });
    modal(`Quote for ${card.reference}`, form);
  });
}

/* ---------------- invoices ---------------- */

function invoicesPanel(data, reload) {
  const wrapper = el('div');

  wrapper.append(el('div', { class: 'grid grid--2', style: 'margin-bottom:18px' }, [
    el('div', { class: 'panel', style: 'text-align:center' }, [
      el('p', { class: 'stat', style: 'margin:0;font-size:1.6rem' }, money(data.owedPence)),
      el('p', { class: 'stat-label' }, 'Outstanding'),
    ]),
    el('div', { class: 'panel', style: 'text-align:center' }, [
      el('p', { class: 'stat', style: 'margin:0;font-size:1.6rem' }, money(data.collectedPence)),
      el('p', { class: 'stat-label' }, 'Collected'),
    ]),
  ]));

  wrapper.append(el('p', { class: 'tiny muted', style: 'margin-bottom:14px' },
    'This tracks what is owed and what has arrived. It does not take payment, and it only works against weddings that have booked you.'));

  if (!data.invoices.length) {
    wrapper.append(el('div', { class: 'empty' }, [
      el('h4', {}, 'No invoices yet'),
      el('p', { class: 'muted small' }, 'Raise one from a booked card in the pipeline, or from the shared page of a wedding that has booked you.'),
    ]));
    return wrapper;
  }

  wrapper.append(el('div', { class: 'panel', style: 'padding:0;overflow:hidden' }, [
    el('div', { class: 'table-scroll' }, [
      el('table', { class: 'table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', {}, 'Reference'), el('th', {}, 'Couple'), el('th', { class: 'num' }, 'Amount'),
          el('th', {}, 'Due'), el('th', {}, 'Status'), el('th', {}, ''),
        ])]),
        el('tbody', {}, data.invoices.map((invoice) => el('tr', {}, [
          el('td', {}, [
            el('strong', { class: 'small' }, invoice.reference),
            invoice.description ? el('p', { class: 'tiny muted', style: 'margin:2px 0 0' }, invoice.description) : null,
          ]),
          el('td', { class: 'small' }, invoice.couple),
          el('td', { class: 'num small' }, money(invoice.amountPence)),
          el('td', { class: 'tiny muted' }, invoice.dueOn || 'No date'),
          el('td', {}, el('span', {
            class: `badge ${invoice.status === 'paid' ? 'badge--verified' : 'badge--sample'}`,
          }, invoice.status === 'paid' ? 'Paid' : 'Unpaid')),
          el('td', { class: 'num' }, invoice.status === 'unpaid' ? el('button', {
            class: 'btn btn--quiet btn--sm', type: 'button',
            onclick: async () => {
              try { await api.crmSettleInvoice(invoice.id, 'paid'); toast('Marked as paid.', 'good'); reload(); }
              catch (error) { toast(error.message, 'bad'); }
            },
          }, 'Mark paid') : null),
        ]))),
      ]),
    ]),
  ]));

  return wrapper;
}

/* ---------------- availability ---------------- */

function availabilityPanel(data, pipeline, reload) {
  const wrapper = el('div');

  wrapper.append(el('div', { class: 'notice notice--good', style: 'margin-bottom:18px' }, [
    el('div', { class: 'small' }, data.note),
  ]));

  const form = el('form', { class: 'panel', style: 'margin-bottom:18px' }, [
    el('div', { class: 'row', style: 'gap:12px;align-items:flex-end' }, [
      el('label', { class: 'field', style: 'margin:0;flex:0 1 190px' }, [
        el('span', {}, 'Block out a date'),
        el('input', { type: 'date', name: 'date', required: '' }),
      ]),
      el('label', { class: 'field', style: 'margin:0;flex:1 1 200px' }, [
        el('span', {}, 'Why, optional'),
        el('input', { type: 'text', name: 'note', maxlength: '200', placeholder: 'Booked elsewhere, holiday, family' }),
      ]),
      el('button', { class: 'btn btn--quiet btn--sm', type: 'submit' }, 'Block it out'),
    ]),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data2 = Object.fromEntries(new FormData(form).entries());
    try {
      await api.crmAddBlackout({ date: data2.date, note: data2.note });
      form.reset();
      toast('Blocked. That date will never receive an enquiry.', 'good');
      reload();
    } catch (error) { toast(error.message, 'bad'); }
  });
  wrapper.append(form);

  if (data.blackouts.length) {
    wrapper.append(el('div', { class: 'panel', style: 'margin-bottom:18px' },
      data.blackouts.map((blackout) => el('div', {
        class: 'row row--between', style: 'padding:8px 0;border-top:1px solid var(--line)',
      }, [
        el('div', {}, [
          el('strong', { class: 'small' }, longDate(blackout.date)),
          blackout.note ? el('span', { class: 'tiny muted', style: 'margin-left:10px' }, blackout.note) : null,
        ]),
        el('button', {
          class: 'linkish tiny', type: 'button',
          onclick: async () => {
            try { await api.crmRemoveBlackout(blackout.id); reload(); }
            catch (error) { toast(error.message, 'bad'); }
          },
        }, 'Unblock'),
      ]))));
  }

  /* calendar export from bookings the pipeline already knows about */
  const booked = pipeline.stages.find((s) => s.key === 'booked');
  const bookedCards = booked ? booked.cards : [];
  wrapper.append(el('div', { class: 'panel' }, [
    el('h4', { style: 'margin-bottom:6px' }, 'Your calendar'),
    el('p', { class: 'small muted', style: 'margin-bottom:12px' },
      `${bookedCards.length} booked ${bookedCards.length === 1 ? 'wedding' : 'weddings'}. Download them as a calendar file and open it in Google Calendar, Apple Calendar or Outlook. It is a one off export rather than a live feed, so re-download after new bookings.`),
    el('button', {
      class: 'btn btn--quiet btn--sm', type: 'button',
      onclick: () => {
        if (!bookedCards.length) { toast('Nothing booked yet, so nothing to export.'); return; }
        downloadIcs('aeterna-bookings.ics', bookedCards.map((card) => ({
          uid: card.enquiryId,
          date: card.weddingDate,
          title: `Wedding, ${card.region} (${card.reference})`,
          detail: `${card.guestCount || '?'} guests. Agreed ${money(card.agreedPence || 0)}.`,
        })));
        toast('Calendar file downloaded.', 'good');
      },
    }, 'Download bookings as a calendar file'),
  ]));

  return wrapper;
}
