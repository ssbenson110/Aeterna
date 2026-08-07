import {
  el, clear, money, setMeta, toast, longDate, shortDate, countdown, richText,
} from '../ui.js';
import { api, ApiError } from '../api.js';
import { store } from '../store.js';
import { loadingBlock, errorBlock, verifiedBadge, openAuthDialog } from '../components.js';
import { navigate } from '../router.js';

/**
 * The shared page: couple, planner, booked vendors and helpers.
 *
 * The server decides what each role may see, and it builds a booked vendor's
 * payload from scratch rather than filtering the couple's. This view simply
 * renders whichever shape it is handed, so a field the server withholds cannot
 * appear here by accident.
 */
export function renderWorkspace(weddingId) {
  setMeta('The shared wedding page, AETERNA', 'One page for the couple, their planner and every booked vendor.');

  if (!store.user) {
    openAuthDialog({ mode: 'login', reason: 'Sign in to open this wedding.' });
    return el('section', { class: 'section' }, [
      el('div', { class: 'wrap-narrow' }, [
        el('div', { class: 'empty' }, [
          el('h3', {}, 'Sign in to open this wedding'),
          el('button', { class: 'btn btn--primary', type: 'button', onclick: () => openAuthDialog({ mode: 'login' }) }, 'Sign in'),
        ]),
      ]),
    ]);
  }

  const host = el('div', {}, [loadingBlock('Opening the shared page')]);

  const load = async () => {
    let view;
    try {
      view = await api.workspace(weddingId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 402) {
        host.replaceChildren(upgradeWall(error, load));
        return;
      }
      host.replaceChildren(errorBlock(error.message, load));
      return;
    }
    host.replaceChildren(view.scope === 'vendor' ? vendorView(view, load) : coupleView(view, load, weddingId));
  };

  load();
  return host;
}

function upgradeWall(error, reload) {
  return el('section', { class: 'section' }, [
    el('div', { class: 'wrap-narrow' }, [
      el('div', { class: 'panel panel--blush' }, [
        el('h2', { style: 'font-size:1.6rem' }, 'The shared page is part of the upgrade'),
        el('p', {}, error.message),
        el('button', {
          class: 'btn btn--primary', type: 'button',
          onclick: async () => {
            try { await api.upgrade(); await store.refresh(); reload(); }
            catch (err) { toast(err.message, 'bad'); }
          },
        }, 'Upgrade this wedding, £49 once'),
        el('p', { class: 'tiny muted', style: 'margin:14px 0 0' }, error.body && error.body.note ? error.body.note : ''),
      ]),
    ]),
  ]);
}

/* ================================================================== */
/* couple and planner                                                  */
/* ================================================================== */

function coupleView(view, reload, weddingId) {
  const wedding = view.wedding;
  const count = countdown(wedding.weddingDate);
  const canInvite = view.role === 'owner' || view.role === 'planner';

  const header = el('section', { class: 'section section--tight section--blush' }, [
    el('div', { class: 'wrap' }, [
      el('p', { class: 'eyebrow' }, `Shared page, you are the ${view.roleLabel.toLowerCase()}`),
      el('h1', { style: 'font-size:clamp(1.9rem,4vw,2.8rem);margin-bottom:10px' },
        [wedding.partnerOne, wedding.partnerTwo].filter(Boolean).join(' and ') || 'This wedding'),
      el('p', { class: 'lede', style: 'margin-bottom:20px' },
        `${longDate(wedding.weddingDate)}${count ? `, ${count.label.toLowerCase()}` : ''}. ${wedding.region}.`),
      el('div', { class: 'grid grid--4' }, [
        figure(count ? count.label : 'Set a date', 'Countdown'),
        figure(String(view.members.filter((m) => m.status === 'active').length), 'People on this page'),
        figure(String(view.bookings.filter((b) => b.status === 'booked').length), 'Vendors booked'),
        view.budgetSummary
          ? figure(money(view.budgetSummary.committedPence), 'Committed so far')
          : figure(String(wedding.guestCount || 0), 'Guests'),
      ]),
    ]),
  ]);

  const body = el('section', { class: 'section' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'workspace-grid' }, [
        el('div', {}, [
          approvalsBlock(view, reload),
          timelineBlock(view),
          tasksBlock(view, reload, weddingId, true),
          commentsBlock(view, reload, weddingId, 'general', 'Everyone on this page'),
        ]),
        el('aside', {}, [
          bookingsBlock(view, reload),
          paymentsBlock(view),
          view.role === 'owner' ? sharingBlock(view, reload, weddingId) : null,
          membersBlock(view, reload, weddingId, canInvite),
          changesBlock(view),
        ]),
      ]),
    ]),
  ]);

  return el('div', {}, [header, body]);
}

/* ================================================================== */
/* booked vendor                                                       */
/* ================================================================== */

function vendorView(view, reload) {
  const wedding = view.wedding;
  const count = countdown(wedding.weddingDate);

  const header = el('section', { class: 'section section--tight section--sage' }, [
    el('div', { class: 'wrap' }, [
      el('p', { class: 'eyebrow eyebrow--sage' }, 'Shared page, you are a booked vendor'),
      el('h1', { style: 'font-size:clamp(1.8rem,3.6vw,2.5rem);margin-bottom:10px' },
        `${longDate(wedding.weddingDate)}${wedding.region ? `, ${wedding.region}` : ''}`),
      el('p', { class: 'lede' }, view.notice),
      el('div', { class: 'grid grid--4', style: 'margin-top:22px' }, [
        figure(count ? count.label : 'Date to confirm', 'Countdown'),
        figure(String(wedding.guestCount || 0), 'Guests expected'),
        figure(money(view.yourBooking.agreedPence), 'Your agreed fee'),
        figure(view.venue ? view.venue.name : 'To confirm', 'Venue'),
      ]),
    ]),
  ]);

  const body = el('section', { class: 'section' }, [
    el('div', { class: 'wrap' }, [
      el('div', { class: 'workspace-grid' }, [
        el('div', {}, [
          timelineBlock(view),
          tasksBlock(view, reload, null, false),
          commentsBlock(view, reload, null, view.commentThread, 'Your thread with the couple'),
        ]),
        el('aside', {}, [
          sharedByCoupleBlock(view),
          vendorMoneyBlock(view),
          el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
            el('h3', { style: 'font-size:1.15rem' }, 'Your booking'),
            el('dl', { style: 'margin:0' }, [
              pair('Category', view.yourBooking.category),
              pair('Agreed fee', money(view.yourBooking.agreedPence)),
              pair('Booked', shortDate(view.yourBooking.bookedAt)),
            ]),
          ]),
          wedding.traditions && wedding.traditions.length ? el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
            el('h3', { style: 'font-size:1.15rem' }, 'Traditions on the day'),
            el('div', { class: 'row', style: 'gap:8px' },
              wedding.traditions.map((t) => el('span', { class: 'tag' }, t))),
            el('p', { class: 'tiny muted', style: 'margin:12px 0 0' },
              'Worth reading before you plan your timings.'),
          ]) : null,
          wedding.notes ? el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
            el('h3', { style: 'font-size:1.15rem' }, 'Notes from the couple'),
            el('p', { class: 'small', style: 'margin:0' }, wedding.notes),
          ]) : null,
          el('div', { class: 'panel panel--gold', style: 'margin-bottom:20px' }, [
            el('h4', { style: 'margin-bottom:8px' }, 'What is not shared with you'),
            el('ul', { class: 'crosslist', style: 'margin:0' }, [
              'The couple\'s total budget',
              'What other suppliers are charging',
              'The full guest list',
            ].map((text) => el('li', {}, [
              el('span', { 'aria-hidden': 'true', style: 'color:var(--coral-ink);font-weight:700' }, '×'),
              el('span', {}, text),
            ]))),
          ]),
          teamBlock(view),
          changesBlock(view),
        ]),
      ]),
    ]),
  ]);

  return el('div', {}, [header, body]);
}

/* ================================================================== */
/* blocks                                                              */
/* ================================================================== */

function timelineBlock(view) {
  return el('div', { class: 'panel', style: 'margin-bottom:22px' }, [
    el('div', { class: 'row row--between', style: 'margin-bottom:14px' }, [
      el('h2', { style: 'margin:0;font-size:1.4rem' }, 'The day, hour by hour'),
      el('span', { class: 'tiny muted' }, 'One version, shared by everyone'),
    ]),
    view.timeline.length
      ? el('div', {}, view.timeline.map((event, index) => el('div', {
        style: `display:grid;grid-template-columns:84px 1fr;gap:16px;padding:12px 0;${index ? 'border-top:1px solid var(--line)' : ''}`,
      }, [
        el('strong', { style: 'font-variant-numeric:tabular-nums;color:var(--coral-ink)' }, event.time),
        el('div', {}, [
          el('strong', {}, event.title),
          event.detail ? el('p', { class: 'small muted', style: 'margin:3px 0 0' }, event.detail) : null,
          event.owner ? el('p', { class: 'tiny muted', style: 'margin:3px 0 0' }, `Owned by ${event.owner}`) : null,
        ]),
      ])))
      : el('p', { class: 'muted small' }, 'The timeline is empty. The couple builds it in the planner and it appears here for everyone.'),
  ]);
}

function tasksBlock(view, reload, weddingId, canCreate) {
  const wrapper = el('div', { class: 'panel', style: 'margin-bottom:22px' });
  wrapper.append(el('h2', { style: 'font-size:1.4rem;margin-bottom:14px' },
    canCreate ? 'Tasks' : 'Your tasks'));

  if (!view.tasks.length) {
    wrapper.append(el('p', { class: 'muted small' },
      canCreate ? 'No tasks yet. Add one and assign it to anyone on this page.' : 'Nothing assigned to you yet.'));
  } else {
    wrapper.append(el('div', {}, view.tasks.map((task) => {
      const box = el('input', { type: 'checkbox', checked: task.done, id: `wt-${task.id}` });
      box.addEventListener('change', async () => {
        try {
          await api.updateWorkspaceTask(view.wedding.id || weddingId, task.id, { done: box.checked });
          reload();
        } catch (error) { toast(error.message, 'bad'); box.checked = !box.checked; }
      });
      return el('div', { class: `checkitem${task.done ? ' is-done' : ''}` }, [
        box,
        el('div', { style: 'flex:1' }, [
          el('label', { for: `wt-${task.id}`, style: 'cursor:pointer' }, [el('strong', {}, task.title)]),
          task.detail ? el('p', { class: 'small muted', style: 'margin:3px 0 0' }, task.detail) : null,
          el('p', { class: 'tiny muted', style: 'margin:3px 0 0' }, [
            task.assigneeName ? `For ${task.assigneeName}` : 'Unassigned',
            task.dueDate ? `, due ${shortDate(task.dueDate)}` : '',
          ].join('')),
        ]),
      ]);
    })));
  }

  if (canCreate && weddingId) {
    const form = el('form', { style: 'margin-top:16px;padding-top:16px;border-top:1px solid var(--line)' }, [
      el('div', { class: 'row', style: 'gap:10px;align-items:flex-end' }, [
        el('label', { class: 'field', style: 'margin:0;flex:1 1 220px' }, [
          el('span', {}, 'Add a task'),
          el('input', { type: 'text', name: 'title', required: '', placeholder: 'Confirm the mandap build time' }),
        ]),
        el('label', { class: 'field', style: 'margin:0;flex:0 1 200px' }, [
          el('span', {}, 'Assign to'),
          el('select', { name: 'assigneeId' }, [
            el('option', { value: '' }, 'Nobody yet'),
            ...view.members.filter((m) => m.status === 'active')
              .map((m) => el('option', { value: m.id }, `${m.name} (${m.roleLabel})`)),
          ]),
        ]),
        el('button', { class: 'btn btn--quiet btn--sm', type: 'submit' }, 'Add'),
      ]),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      if (!String(data.title || '').trim()) return;
      try {
        await api.addWorkspaceTask(weddingId, { title: data.title, assigneeId: data.assigneeId || null });
        form.reset();
        reload();
      } catch (error) { toast(error.message, 'bad'); }
    });
    wrapper.append(form);
  }

  return wrapper;
}

function commentsBlock(view, reload, weddingId, thread, title) {
  const id = weddingId || view.wedding.id;
  const wrapper = el('div', { class: 'panel' }, [
    el('h2', { style: 'font-size:1.4rem;margin-bottom:6px' }, title),
    el('p', { class: 'tiny muted', style: 'margin-bottom:16px' },
      view.scope === 'vendor'
        ? 'Only you and the couple can read this thread.'
        : 'Everyone on this page can read this thread. Each booked vendor also has their own private thread with you.'),
  ]);

  if (!view.comments.length) {
    wrapper.append(el('p', { class: 'muted small' }, 'Nothing here yet.'));
  } else {
    wrapper.append(el('div', { style: 'display:flex;flex-direction:column;gap:14px;margin-bottom:18px' },
      view.comments.map((comment) => el('div', {
        style: 'background:var(--ivory-deep);border-radius:var(--r-md);padding:12px 16px',
      }, [
        el('div', { class: 'row row--between', style: 'margin-bottom:4px' }, [
          el('strong', { class: 'small' }, comment.author),
          el('span', { class: 'tiny muted' }, `${comment.roleLabel}, ${shortDate(comment.at)}`),
        ]),
        el('p', { class: 'small', style: 'margin:0' }, comment.body),
      ]))));
  }

  const input = el('textarea', { rows: '2', placeholder: 'Write a message', 'aria-label': 'Write a message', maxlength: '4000' });
  const form = el('form', { class: 'chat__composer', style: 'margin-top:8px' }, [
    input,
    el('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, 'Post'),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    try {
      await api.addWorkspaceComment(id, { thread, body });
      input.value = '';
      reload();
    } catch (error) { toast(error.message, 'bad'); }
  });
  wrapper.append(form);

  return wrapper;
}

function bookingsBlock(view, reload) {
  const booked = view.bookings.filter((b) => b.status === 'booked');
  return el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
    el('h3', { style: 'font-size:1.15rem' }, 'Booked vendors'),
    el('p', { class: 'tiny muted', style: 'margin-bottom:14px' },
      'A vendor joins this page when you book them, and not before. An enquiry on its own never gives anyone access.'),
    booked.length
      ? el('div', {}, booked.map((booking) => el('div', {
        style: 'padding:10px 0;border-top:1px solid var(--line)',
      }, [
        el('div', { class: 'row row--between' }, [
          el('a', { href: `#/vendor/${booking.vendorSlug}`, 'data-link': '', style: 'font-weight:700' }, booking.vendorName),
          booking.verified ? verifiedBadge() : null,
        ]),
        el('p', { class: 'tiny muted', style: 'margin:3px 0 0' },
          `${booking.category}, ${money(booking.agreedPence)} agreed`),
        view.role === 'owner' ? el('button', {
          class: 'linkish tiny', type: 'button',
          onclick: async () => {
            try {
              const result = await api.cancelBooking(booking.vendorId);
              toast(result.note, 'good');
              reload();
            } catch (error) { toast(error.message, 'bad'); }
          },
        }, 'Cancel booking and remove access') : null,
      ])))
      : el('p', { class: 'small muted' }, 'Nobody booked yet. Book a vendor from your enquiries and they appear here.'),
  ]);
}

function membersBlock(view, reload, weddingId, canInvite) {
  const wrapper = el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
    el('h3', { style: 'font-size:1.15rem' }, 'People on this page'),
    el('div', { style: 'margin-bottom:14px' }, view.members.map((member) => el('div', {
      class: 'row row--between', style: 'padding:8px 0;border-top:1px solid var(--line)',
    }, [
      el('div', {}, [
        el('strong', { class: 'small' }, member.name),
        el('p', { class: 'tiny muted', style: 'margin:0' },
          `${member.roleLabel}${member.status === 'invited' ? ', invitation sent' : ''}`),
      ]),
      (view.role === 'owner' && member.role !== 'owner') ? el('button', {
        class: 'linkish tiny', type: 'button',
        onclick: async () => {
          try { await api.removeWorkspaceMember(weddingId, member.id); toast('Removed.', 'good'); reload(); }
          catch (error) { toast(error.message, 'bad'); }
        },
      }, 'Remove') : null,
    ]))),
  ]);

  if (!canInvite) return wrapper;

  const form = el('form', { style: 'padding-top:14px;border-top:1px solid var(--line)' }, [
    el('label', { class: 'field' }, [
      el('span', {}, 'Invite someone'),
      el('input', { type: 'email', name: 'email', required: '', placeholder: 'their@email.co.uk' }),
    ]),
    el('div', { class: 'row', style: 'gap:10px;align-items:flex-end' }, [
      el('label', { class: 'field', style: 'margin:0;flex:1' }, [
        el('span', {}, 'As'),
        el('select', { name: 'role' }, [
          el('option', { value: 'planner' }, 'Planner'),
          el('option', { value: 'helper' }, 'Family or friend'),
        ]),
      ]),
      el('button', { class: 'btn btn--quiet btn--sm', type: 'submit' }, 'Invite'),
    ]),
    el('p', { class: 'tiny muted', style: 'margin-top:10px' },
      'Vendors are not invited here. They join automatically when you book them.'),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api.inviteToWorkspace(weddingId, data);
      form.reset();
      toast(result.note, 'good');
      if (result.inviteUrl) {
        toast(`Share this link with them: ${location.origin}${location.pathname}${result.inviteUrl}`);
      }
      reload();
    } catch (error) { toast(error.message, 'bad'); }
  });
  wrapper.append(form);
  return wrapper;
}

function teamBlock(view) {
  return el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
    el('h3', { style: 'font-size:1.15rem' }, 'Who else is working on this'),
    el('div', {}, view.team.map((member) => el('div', {
      style: 'padding:7px 0;border-top:1px solid var(--line)',
    }, [
      el('strong', { class: 'small' }, member.name),
      el('p', { class: 'tiny muted', style: 'margin:0' }, member.roleLabel),
    ]))),
  ]);
}

function changesBlock(view) {
  if (!view.changes || !view.changes.length) return null;
  return el('div', { class: 'panel' }, [
    el('h3', { style: 'font-size:1.15rem' }, 'What changed'),
    el('p', { class: 'tiny muted', style: 'margin-bottom:12px' }, 'So nobody works from a stale version.'),
    el('div', {}, view.changes.slice(0, 12).map((change) => el('div', {
      style: 'padding:7px 0;border-top:1px solid var(--line)',
    }, [
      el('p', { class: 'small', style: 'margin:0' }, `${change.actor} ${change.summary}`),
      el('p', { class: 'tiny muted', style: 'margin:0' }, shortDate(change.at)),
    ]))),
  ]);
}

/* ================================================================== */
/* the list of weddings a planner or vendor can reach                  */
/* ================================================================== */

export function renderWorkspaceList() {
  setMeta('Your weddings, AETERNA', 'Every wedding you are working on.');

  const host = el('div', {}, [loadingBlock('Loading your weddings')]);

  (async () => {
    let data;
    try { data = await api.workspaces(); }
    catch (error) { host.replaceChildren(errorBlock(error.message)); return; }

    if (!data.workspaces.length) {
      host.replaceChildren(el('section', { class: 'section' }, [
        el('div', { class: 'wrap-narrow' }, [
          el('div', { class: 'empty' }, [
            el('h3', {}, 'No weddings yet'),
            el('p', { class: 'muted' },
              'A couple adds you to their shared page by inviting you, or by booking you as a vendor.'),
          ]),
        ]),
      ]));
      return;
    }

    host.replaceChildren(el('section', { class: 'section' }, [
      el('div', { class: 'wrap' }, [
        el('h1', { style: 'font-size:clamp(1.8rem,4vw,2.6rem);margin-bottom:20px' }, 'Your weddings'),
        el('div', { class: 'grid grid--3' }, data.workspaces.map((w) => el('a', {
          class: 'card card--link card--pad', href: `#/workspace/${w.weddingId}`, 'data-link': '',
        }, [
          el('span', { class: 'badge badge--plain', style: 'margin-bottom:10px' }, w.roleLabel),
          el('h3', { style: 'font-size:1.25rem;margin-bottom:6px' }, w.couple),
          el('p', { class: 'small muted', style: 'margin:0' },
            `${longDate(w.weddingDate)}${w.region ? `, ${w.region}` : ''}`),
        ]))),
      ]),
    ]));
  })();

  return host;
}

/* ================================================================== */
/* accepting an invitation                                             */
/* ================================================================== */

export function renderJoin(token) {
  setMeta('Join a wedding, AETERNA', 'Accept your invitation to a shared wedding page.');

  if (!store.user) {
    return el('section', { class: 'section' }, [
      el('div', { class: 'wrap-narrow' }, [
        el('div', { class: 'panel panel--blush' }, [
          el('h2', {}, 'You have been invited to a wedding'),
          el('p', {}, 'Create an account or sign in, and this wedding will appear on your dashboard.'),
          el('div', { class: 'row', style: 'gap:12px' }, [
            el('button', {
              class: 'btn btn--primary', type: 'button',
              onclick: () => openAuthDialog({ mode: 'register', onDone: () => navigate(`#/join/${token}`) }),
            }, 'Create an account'),
            el('button', {
              class: 'btn btn--quiet', type: 'button',
              onclick: () => openAuthDialog({ mode: 'login', onDone: () => navigate(`#/join/${token}`) }),
            }, 'Sign in'),
          ]),
        ]),
      ]),
    ]);
  }

  const host = el('div', {}, [loadingBlock('Accepting your invitation')]);
  (async () => {
    try {
      const result = await api.joinWorkspace(token);
      toast('You are on the wedding now.', 'good');
      navigate(`#/workspace/${result.weddingId}`);
    } catch (error) {
      host.replaceChildren(errorBlock(error.message));
    }
  })();
  return host;
}

/* ================================================================== */
/* approvals: quotes decided on the page                               */
/* ================================================================== */

function approvalsBlock(view, reload) {
  const quotes = view.quotes || [];
  if (!quotes.length) return null;
  const pending = quotes.filter((q) => q.status === 'sent');
  const decided = quotes.filter((q) => q.status !== 'sent').slice(0, 5);

  const wrapper = el('div', { class: 'panel', style: 'margin-bottom:22px' }, [
    el('div', { class: 'row row--between', style: 'margin-bottom:12px' }, [
      el('h2', { style: 'margin:0;font-size:1.4rem' }, 'Approvals'),
      pending.length ? el('span', { class: 'badge badge--coral' }, `${pending.length} waiting`) : null,
    ]),
    el('p', { class: 'tiny muted', style: 'margin-bottom:14px' },
      'Quotes are decided here, in front of everyone they affect. Approving one books the vendor at that amount and adds them to this page.'),
  ]);

  for (const quote of pending) {
    wrapper.append(el('div', {
      style: 'border:1px solid var(--line);border-radius:var(--r-md);padding:14px 16px;margin-bottom:12px;background:var(--gold-wash)',
    }, [
      el('div', { class: 'row row--between', style: 'margin-bottom:6px' }, [
        el('strong', {}, quote.vendorName),
        el('strong', { style: 'color:var(--coral-deep)' }, money(quote.amountPence)),
      ]),
      el('p', { class: 'small', style: 'margin:0 0 6px;font-weight:600' }, quote.title),
      quote.description ? el('p', { class: 'small muted', style: 'margin:0 0 10px' }, quote.description) : null,
      view.role === 'owner' ? el('div', { class: 'row', style: 'gap:10px' }, [
        el('button', {
          class: 'btn btn--primary btn--sm', type: 'button',
          onclick: async () => {
            try {
              const result = await api.decideQuote(quote.id, 'approve');
              toast(result.note, 'good');
              reload();
            } catch (error) { toast(error.message, 'bad'); }
          },
        }, `Approve, ${money(quote.amountPence)}`),
        el('button', {
          class: 'btn btn--quiet btn--sm', type: 'button',
          onclick: async () => {
            try {
              const result = await api.decideQuote(quote.id, 'decline');
              toast(result.note, 'good');
              reload();
            } catch (error) { toast(error.message, 'bad'); }
          },
        }, 'Decline'),
      ]) : el('p', { class: 'tiny muted', style: 'margin:0' }, 'Waiting on the couple to decide.'),
    ]));
  }

  if (decided.length) {
    wrapper.append(el('div', {}, decided.map((quote) => el('p', {
      class: 'tiny muted', style: 'margin:0 0 4px',
    }, `${quote.vendorName}, "${quote.title}", ${money(quote.amountPence)}: ${quote.status}${quote.decidedAt ? ` on ${shortDate(quote.decidedAt)}` : ''}`))));
  }

  return wrapper;
}

/* ================================================================== */
/* payments                                                            */
/* ================================================================== */

function paymentsBlock(view) {
  const invoices = view.invoices || [];
  if (!invoices.length) return null;
  const owed = invoices.filter((i) => i.status === 'unpaid').reduce((s2, i) => s2 + i.amountPence, 0);

  return el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
    el('h3', { style: 'font-size:1.15rem' }, 'Payments'),
    el('p', { class: 'tiny muted', style: 'margin-bottom:12px' },
      owed ? `${money(owed)} currently outstanding across your vendors.` : 'Nothing outstanding.'),
    el('div', {}, invoices.map((invoice) => el('div', {
      class: 'row row--between', style: 'padding:7px 0;border-top:1px solid var(--line)',
    }, [
      el('div', {}, [
        el('strong', { class: 'small' }, `${invoice.vendorName}, ${invoice.reference}`),
        el('p', { class: 'tiny muted', style: 'margin:0' },
          `${money(invoice.amountPence)}${invoice.dueOn ? `, due ${invoice.dueOn}` : ''}`),
      ]),
      el('span', {
        class: `badge ${invoice.status === 'paid' ? 'badge--verified' : 'badge--sample'}`,
      }, invoice.status === 'paid' ? 'Paid' : 'Unpaid'),
    ]))),
    el('p', { class: 'tiny muted', style: 'margin:12px 0 0' },
      'Vendors record these. AETERNA tracks what is owed, it does not take payment.'),
  ]);
}

/* ================================================================== */
/* the sharing matrix, couple controlled                               */
/* ================================================================== */

function sharingBlock(view, reload, weddingId) {
  const host = el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
    el('h3', { style: 'font-size:1.15rem' }, 'Who sees what'),
    loadingBlock('Loading your sharing choices'),
  ]);

  (async () => {
    let data;
    try { data = await api.getSharing(weddingId); }
    catch (error) { host.replaceChildren(errorBlock(error.message)); return; }

    const vendors = (view.bookings || []).filter((b) => b.status === 'booked');

    const paint = () => {
      clear(host);
      host.append(
        el('h3', { style: 'font-size:1.15rem' }, 'Who sees what'),
        el('p', { class: 'tiny muted', style: 'margin-bottom:14px' },
          'Your call, per detail and per vendor. Defaults apply to every booked vendor unless you override them below.')
      );

      /* defaults */
      for (const item of data.keys) {
        const on = Boolean(data.defaults[item.key]);
        const toggle = el('button', {
          type: 'button', class: 'pill', 'aria-pressed': String(on),
          onclick: async () => {
            const next = !on;
            if (next && item.warning && !window.confirm(`${item.warning}\n\nShare it anyway?`)) return;
            try {
              await api.setSharing(weddingId, { defaults: { [item.key]: next } });
              data = await api.getSharing(weddingId);
              paint();
              toast(next ? `${item.label} is now shared with booked vendors.` : `${item.label} is now private.`, 'good');
            } catch (error) { toast(error.message, 'bad'); }
          },
        }, on ? 'Shared' : 'Private');
        host.append(el('div', { class: 'row row--between', style: 'padding:8px 0;border-top:1px solid var(--line)' }, [
          el('div', { style: 'flex:1 1 60%' }, [
            el('strong', { class: 'small' }, item.label),
            el('p', { class: 'tiny muted', style: 'margin:0' }, item.detail),
          ]),
          toggle,
        ]));
      }

      /* per vendor overrides */
      if (vendors.length) {
        const select = el('select', { 'aria-label': 'Vendor to override' },
          vendors.map((v) => el('option', { value: v.vendorId }, v.vendorName)));
        const overridesHost = el('div');

        const paintOverrides = () => {
          clear(overridesHost);
          const vendorId = select.value;
          const overrides = (data.perVendor || {})[vendorId] || {};
          for (const item of data.keys) {
            const effective = typeof overrides[item.key] === 'boolean' ? overrides[item.key] : Boolean(data.defaults[item.key]);
            const isOverride = typeof overrides[item.key] === 'boolean';
            overridesHost.append(el('div', {
              class: 'row row--between', style: 'padding:6px 0;border-top:1px solid var(--line)',
            }, [
              el('span', { class: 'tiny' }, [
                item.label,
                isOverride ? el('em', { class: 'tiny muted' }, ' (override)') : null,
              ]),
              el('button', {
                type: 'button', class: 'pill', 'aria-pressed': String(effective),
                onclick: async () => {
                  const next = !effective;
                  if (next && item.warning && !window.confirm(`${item.warning}\n\nShare it with this vendor anyway?`)) return;
                  try {
                    await api.setSharing(weddingId, { vendorId, overrides: { [item.key]: next } });
                    data = await api.getSharing(weddingId);
                    paintOverrides();
                  } catch (error) { toast(error.message, 'bad'); }
                },
              }, effective ? 'Shared' : 'Private'),
            ]));
          }
        };
        select.addEventListener('change', paintOverrides);

        host.append(
          el('h4', { style: 'margin:16px 0 8px' }, 'Overrides for one vendor'),
          select,
          overridesHost
        );
        paintOverrides();
      }

      host.append(el('div', { class: 'notice notice--info', style: 'margin-top:14px;padding:10px 14px' }, [
        el('span', { class: 'tiny' }, `Never shared, and not a setting: ${data.neverShared.join(' ')}`),
      ]));
    };
    paint();
  })();

  return host;
}

/* ================================================================== */
/* what the couple chose to share, vendor side                         */
/* ================================================================== */

function sharedByCoupleBlock(view) {
  const shared = view.sharedByCouple || {};
  const anything = shared.budgetTotalPence !== undefined || shared.guestSummary !== undefined
    || shared.dietaryCounts !== undefined || shared.guestList !== undefined;
  if (!anything) return null;

  const wrapper = el('div', { class: 'panel panel--sage', style: 'margin-bottom:20px' }, [
    el('h3', { style: 'font-size:1.15rem' }, 'Shared with you by the couple'),
    el('p', { class: 'tiny muted', style: 'margin-bottom:10px' },
      'The couple controls this list and can change it at any time.'),
  ]);

  if (shared.budgetTotalPence !== undefined) {
    wrapper.append(line('Total budget', money(shared.budgetTotalPence)));
  }
  if (shared.guestSummary) {
    wrapper.append(line('Guests', `${shared.guestSummary.total} invited, ${shared.guestSummary.coming} confirmed`));
  }
  if (shared.dietaryCounts) {
    wrapper.append(line('Dietary', shared.dietaryCounts.length
      ? shared.dietaryCounts.map((d) => `${d.count} ${d.need}`).join(', ')
      : 'None recorded yet'));
  }
  if (shared.guestList) {
    wrapper.append(el('details', { style: 'margin-top:8px' }, [
      el('summary', { class: 'small', style: 'cursor:pointer;font-weight:700' }, `Guest list, ${shared.guestList.length} names`),
      el('div', { style: 'max-height:200px;overflow-y:auto;margin-top:8px' },
        shared.guestList.map((g) => el('p', { class: 'tiny', style: 'margin:0 0 3px' },
          `${g.name}${g.party ? `, ${g.party}` : ''}`))),
    ]));
  }
  return wrapper;

  function line(label, value) {
    return el('div', { class: 'row row--between', style: 'padding:6px 0;border-top:1px solid rgba(74,107,78,.2)' }, [
      el('span', { class: 'tiny', style: 'font-weight:700' }, label),
      el('span', { class: 'tiny' }, value),
    ]);
  }
}

/* ================================================================== */
/* vendor money: quotes out, invoices raised                           */
/* ================================================================== */

function vendorMoneyBlock(view) {
  const quotes = view.yourQuotes || [];
  const invoices = view.yourInvoices || [];
  if (!quotes.length && !invoices.length) return null;

  return el('div', { class: 'panel', style: 'margin-bottom:20px' }, [
    el('h3', { style: 'font-size:1.15rem' }, 'Your quotes and invoices here'),
    quotes.length ? el('div', {}, quotes.map((q) => el('p', { class: 'tiny', style: 'margin:0 0 4px' },
      `Quote "${q.title}", ${money(q.amountPence)}: ${q.status}`))) : null,
    invoices.length ? el('div', { style: 'margin-top:6px' }, invoices.map((i) => el('p', { class: 'tiny', style: 'margin:0 0 4px' },
      `${i.reference}, ${money(i.amountPence)}: ${i.status}${i.dueOn ? `, due ${i.dueOn}` : ''}`))) : null,
    el('p', { class: 'tiny muted', style: 'margin:10px 0 0' },
      'Manage these from your dashboard.'),
  ]);
}

/* ================================================================== */
/* small shared bits                                                   */
/* ================================================================== */

function figure(value, label) {
  return el('div', { class: 'panel', style: 'text-align:center;background:var(--paper)' }, [
    el('p', { class: 'stat', style: 'margin:0;font-size:clamp(1.2rem,2.2vw,1.7rem)' }, value),
    el('p', { class: 'stat-label' }, label),
  ]);
}

function pair(term, value) {
  return el('div', { style: 'padding:8px 0;border-bottom:1px solid var(--line)' }, [
    el('dt', { class: 'tiny muted', style: 'text-transform:uppercase;letter-spacing:.07em;font-weight:700' }, term),
    el('dd', { class: 'small', style: 'margin:3px 0 0;font-weight:600' }, value),
  ]);
}
