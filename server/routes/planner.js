'use strict';

const { all, get, run, id, now } = require('../db');
const { HttpError, str, int, bool, oneOf, isoDate } = require('../lib/http');
const { requireRole } = require('../lib/auth');
const {
  REGIONS, TRADITIONS, FAIR_USE, MAX_TRADITIONS_PER_WEDDING, MAX_CUSTOM_TRADITION_LENGTH,
  TABLE_SHAPES, TABLE_SHAPE_KEYS,
} = require('../lib/config');

function shapeSpec(key) {
  return TABLE_SHAPES.find((s) => s.key === key) || TABLE_SHAPES[0];
}
const { shapeWedding } = require('./auth');
const ai = require('../lib/planner-ai');
const entitlements = require('../lib/entitlements');

/**
 * Traditions a couple typed themselves.
 *
 * The preset list is a starting point, never a closed one. Anything not on it
 * arrives here as free text, so it gets trimmed, length limited, stripped of
 * control characters and de-duplicated against the presets and against itself.
 * It is stored as data and rendered as text, never as markup.
 */
function cleanCustomTraditions(input, presets) {
  if (!Array.isArray(input)) return [];
  const presetLower = new Set(presets.map((t) => t.toLowerCase()));
  const seen = new Set();
  const out = [];

  for (const raw of input.slice(0, MAX_TRADITIONS_PER_WEDDING * 2)) {
    if (typeof raw !== 'string') continue;
    const value = raw
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      // Angle brackets are stripped rather than escaped. This text is rendered
      // as text and also reaches the AI prompt, so it should never look like
      // markup or like an instruction in either place.
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CUSTOM_TRADITION_LENGTH);
    if (value.length < 2) continue;
    const key = value.toLowerCase();
    if (presetLower.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_TRADITIONS_PER_WEDDING) break;
  }
  return out;
}

function myWedding(req) {
  const user = requireRole(req, 'couple');
  const wedding = get('SELECT * FROM weddings WHERE user_id = ? LIMIT 1', user.id);
  if (!wedding) throw new HttpError(404, 'We could not find your plan.');
  return { user, wedding };
}

function clampPercent(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.round((fallback || 0) * 10) / 10;
  return Math.round(Math.min(92, Math.max(0, n)) * 10) / 10;
}

function touch(weddingId) {
  run('UPDATE weddings SET updated_at = ? WHERE id = ?', now(), weddingId);
}

function fullPlan(wedding) {
  const checklist = all('SELECT * FROM checklist_items WHERE wedding_id = ? ORDER BY sort, rowid', wedding.id);
  const budget = all('SELECT * FROM budget_lines WHERE wedding_id = ? ORDER BY sort, rowid', wedding.id);
  const guests = all('SELECT * FROM guests WHERE wedding_id = ? ORDER BY created_at', wedding.id);
  const tables = all('SELECT * FROM seating_tables WHERE wedding_id = ? ORDER BY sort', wedding.id);
  const timeline = all('SELECT * FROM timeline_events WHERE wedding_id = ? ORDER BY at_time', wedding.id);

  const plannedTotal = budget.reduce((sum, b) => sum + b.planned_pence, 0);
  const actualTotal = budget.reduce((sum, b) => sum + b.actual_pence, 0);

  return {
    wedding: shapeWedding(wedding),
    entitlements: entitlements.summarise(wedding),
    checklist: checklist.map((c) => ({
      id: c.id, title: c.title, phase: c.phase, detail: c.detail,
      done: Boolean(c.done), custom: Boolean(c.custom),
    })),
    checklistProgress: {
      total: checklist.length,
      done: checklist.filter((c) => c.done).length,
    },
    budget: budget.map((b) => ({
      id: b.id, category: b.category, plannedPence: b.planned_pence,
      actualPence: b.actual_pence, paid: Boolean(b.paid),
    })),
    budgetTotals: {
      budgetPence: wedding.budget_pence,
      plannedPence: plannedTotal,
      actualPence: actualTotal,
      remainingPence: wedding.budget_pence - actualTotal,
      unallocatedPence: wedding.budget_pence - plannedTotal,
    },
    guests: guests.map((g) => ({
      id: g.id, name: g.name, side: g.side, party: g.party,
      rsvp: g.rsvp, dietary: g.dietary, tableId: g.table_id,
    })),
    guestTotals: {
      total: guests.length,
      yes: guests.filter((g) => g.rsvp === 'yes').length,
      no: guests.filter((g) => g.rsvp === 'no').length,
      pending: guests.filter((g) => g.rsvp === 'pending').length,
    },
    seating: {
      shapes: TABLE_SHAPES,
      tables: tables.map((t) => ({
        id: t.id, name: t.name, capacity: t.capacity,
        shape: t.shape || 'round',
        x: t.pos_x || 0, y: t.pos_y || 0,
        seated: guests.filter((g) => g.table_id === t.id).length,
        guests: guests.filter((g) => g.table_id === t.id).map((g) => ({ id: g.id, name: g.name })),
      })),
    },
    timeline: timeline.map((t) => ({
      id: t.id, time: t.at_time, title: t.title, detail: t.detail, owner: t.owner,
    })),
  };
}

module.exports = {
  'GET /api/planner': async ({ req }) => {
    const { wedding } = myWedding(req);
    return { body: fullPlan(wedding) };
  },

  'PATCH /api/planner/wedding': async ({ req, body }) => {
    const { wedding } = myWedding(req);
    const fields = [];
    const params = [];

    if (body.partnerOne !== undefined) { fields.push('partner_one = ?'); params.push(str(body.partnerOne, 'Partner name', { max: 120 })); }
    if (body.partnerTwo !== undefined) { fields.push('partner_two = ?'); params.push(str(body.partnerTwo, 'Partner name', { max: 120 })); }
    if (body.weddingDate !== undefined) { fields.push('wedding_date = ?'); params.push(isoDate(body.weddingDate, 'Wedding date')); }
    if (body.budgetPence !== undefined) { fields.push('budget_pence = ?'); params.push(int(body.budgetPence, 'Budget', { min: 0, max: 100_000_000 })); }
    if (body.guestCount !== undefined) { fields.push('guest_count = ?'); params.push(int(body.guestCount, 'Guest count', { min: 0, max: 2000 })); }
    if (body.region !== undefined) { fields.push('region = ?'); params.push(oneOf(body.region, 'Region', REGIONS)); }
    if (body.notes !== undefined) { fields.push('notes = ?'); params.push(str(body.notes, 'Notes', { max: 2000 })); }
    if (body.traditions !== undefined) {
      if (!Array.isArray(body.traditions)) throw new HttpError(400, 'Traditions must be a list.');
      const cleaned = body.traditions
        .filter((t) => TRADITIONS.includes(t))
        .slice(0, MAX_TRADITIONS_PER_WEDDING);
      fields.push('traditions = ?');
      params.push(JSON.stringify(cleaned));
    }
    if (body.customTraditions !== undefined) {
      fields.push('custom_traditions = ?');
      params.push(JSON.stringify(cleanCustomTraditions(body.customTraditions, TRADITIONS)));
    }

    if (!fields.length) throw new HttpError(400, 'There was nothing to update.');
    fields.push('updated_at = ?');
    params.push(now(), wedding.id);
    run(`UPDATE weddings SET ${fields.join(', ')} WHERE id = ?`, ...params);

    return { body: fullPlan(get('SELECT * FROM weddings WHERE id = ?', wedding.id)) };
  },

  'POST /api/planner/budget/rebalance': async ({ req }) => {
    const { wedding } = myWedding(req);
    if (!wedding.budget_pence) throw new HttpError(400, 'Set a total budget first and we will split it for you.');
    const { BUDGET_TEMPLATE } = require('../lib/templates');
    const lines = all('SELECT * FROM budget_lines WHERE wedding_id = ? ORDER BY sort', wedding.id);
    for (const line of lines) {
      const template = BUDGET_TEMPLATE.find((t) => t.category === line.category);
      if (!template) continue;
      run('UPDATE budget_lines SET planned_pence = ? WHERE id = ?',
        Math.round(wedding.budget_pence * template.share), line.id);
    }
    touch(wedding.id);
    return { body: fullPlan(get('SELECT * FROM weddings WHERE id = ?', wedding.id)) };
  },

  /* ---------------- checklist ---------------- */

  'POST /api/planner/checklist': async ({ req, body }) => {
    const { wedding } = myWedding(req);
    const title = str(body.title, 'Task', { required: true, max: 200 });
    const phase = str(body.phase, 'Phase', { max: 60, fallback: 'First decisions' });
    const detail = str(body.detail, 'Detail', { max: 500 });
    const itemId = id('chk');
    run('INSERT INTO checklist_items (id, wedding_id, title, phase, detail, done, sort, custom) VALUES (?,?,?,?,?,?,?,?)',
      itemId, wedding.id, title, phase, detail, 0, 9999, 1);
    touch(wedding.id);
    return { status: 201, body: { id: itemId } };
  },

  'PATCH /api/planner/checklist/:id': async ({ req, params, body }) => {
    const { wedding } = myWedding(req);
    const item = get('SELECT * FROM checklist_items WHERE id = ? AND wedding_id = ?', params.id, wedding.id);
    if (!item) throw new HttpError(404, 'We could not find that task.');
    if (body.done !== undefined) run('UPDATE checklist_items SET done = ? WHERE id = ?', bool(body.done) ? 1 : 0, item.id);
    if (body.title !== undefined) run('UPDATE checklist_items SET title = ? WHERE id = ?', str(body.title, 'Task', { required: true, max: 200 }), item.id);
    touch(wedding.id);
    return { body: { ok: true } };
  },

  'DELETE /api/planner/checklist/:id': async ({ req, params }) => {
    const { wedding } = myWedding(req);
    run('DELETE FROM checklist_items WHERE id = ? AND wedding_id = ?', params.id, wedding.id);
    touch(wedding.id);
    return { body: { ok: true } };
  },

  /* ---------------- budget ---------------- */

  'POST /api/planner/budget': async ({ req, body }) => {
    const { wedding } = myWedding(req);
    const category = str(body.category, 'Category', { required: true, max: 120 });
    const lineId = id('bud');
    run('INSERT INTO budget_lines (id, wedding_id, category, planned_pence, actual_pence, paid, sort) VALUES (?,?,?,?,?,?,?)',
      lineId, wedding.id, category,
      int(body.plannedPence, 'Planned', { min: 0, max: 100_000_000 }),
      int(body.actualPence, 'Actual', { min: 0, max: 100_000_000 }), 0, 9999);
    touch(wedding.id);
    return { status: 201, body: { id: lineId } };
  },

  'PATCH /api/planner/budget/:id': async ({ req, params, body }) => {
    const { wedding } = myWedding(req);
    const line = get('SELECT * FROM budget_lines WHERE id = ? AND wedding_id = ?', params.id, wedding.id);
    if (!line) throw new HttpError(404, 'We could not find that budget line.');
    if (body.plannedPence !== undefined) run('UPDATE budget_lines SET planned_pence = ? WHERE id = ?', int(body.plannedPence, 'Planned', { min: 0, max: 100_000_000 }), line.id);
    if (body.actualPence !== undefined) run('UPDATE budget_lines SET actual_pence = ? WHERE id = ?', int(body.actualPence, 'Actual', { min: 0, max: 100_000_000 }), line.id);
    if (body.paid !== undefined) run('UPDATE budget_lines SET paid = ? WHERE id = ?', bool(body.paid) ? 1 : 0, line.id);
    touch(wedding.id);
    return { body: { ok: true } };
  },

  'DELETE /api/planner/budget/:id': async ({ req, params }) => {
    const { wedding } = myWedding(req);
    run('DELETE FROM budget_lines WHERE id = ? AND wedding_id = ?', params.id, wedding.id);
    touch(wedding.id);
    return { body: { ok: true } };
  },

  /* ---------------- guests ---------------- */

  'POST /api/planner/guests': async ({ req, body }) => {
    const { wedding } = myWedding(req);
    entitlements.assertGuestsAllowed(wedding);
    const name = str(body.name, 'Name', { required: true, max: 160 });
    const guestId = id('gst');
    const rsvpToken = require('node:crypto').randomBytes(12).toString('base64url');
    run('INSERT INTO guests (id, wedding_id, name, side, party, rsvp, dietary, table_id, rsvp_token, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      guestId, wedding.id, name,
      oneOf(body.side, 'Side', ['Partner one', 'Partner two', 'Both'], 'Both'),
      str(body.party, 'Group', { max: 120 }),
      oneOf(body.rsvp, 'RSVP', ['pending', 'yes', 'no'], 'pending'),
      str(body.dietary, 'Dietary', { max: 200 }),
      null, rsvpToken, now());
    touch(wedding.id);
    return { status: 201, body: { id: guestId } };
  },

  'PATCH /api/planner/guests/:id': async ({ req, params, body }) => {
    const { wedding } = myWedding(req);
    const guest = get('SELECT * FROM guests WHERE id = ? AND wedding_id = ?', params.id, wedding.id);
    if (!guest) throw new HttpError(404, 'We could not find that guest.');
    if (body.name !== undefined) run('UPDATE guests SET name = ? WHERE id = ?', str(body.name, 'Name', { required: true, max: 160 }), guest.id);
    if (body.rsvp !== undefined) run('UPDATE guests SET rsvp = ? WHERE id = ?', oneOf(body.rsvp, 'RSVP', ['pending', 'yes', 'no']), guest.id);
    if (body.side !== undefined) run('UPDATE guests SET side = ? WHERE id = ?', oneOf(body.side, 'Side', ['Partner one', 'Partner two', 'Both']), guest.id);
    if (body.party !== undefined) run('UPDATE guests SET party = ? WHERE id = ?', str(body.party, 'Group', { max: 120 }), guest.id);
    if (body.dietary !== undefined) run('UPDATE guests SET dietary = ? WHERE id = ?', str(body.dietary, 'Dietary', { max: 200 }), guest.id);
    if (body.tableId !== undefined) {
      const tableId = body.tableId ? str(body.tableId, 'Table', { max: 60 }) : null;
      if (tableId) {
        const table = get('SELECT * FROM seating_tables WHERE id = ? AND wedding_id = ?', tableId, wedding.id);
        if (!table) throw new HttpError(404, 'We could not find that table.');
        const seated = get('SELECT COUNT(*) AS n FROM guests WHERE table_id = ? AND id != ?', tableId, guest.id).n;
        if (seated >= table.capacity) throw new HttpError(409, `${table.name} is full. Raise its capacity or pick another table.`);
      }
      run('UPDATE guests SET table_id = ? WHERE id = ?', tableId, guest.id);
    }
    touch(wedding.id);
    return { body: { ok: true } };
  },

  'DELETE /api/planner/guests/:id': async ({ req, params }) => {
    const { wedding } = myWedding(req);
    run('DELETE FROM guests WHERE id = ? AND wedding_id = ?', params.id, wedding.id);
    touch(wedding.id);
    return { body: { ok: true } };
  },

  /* ---------------- seating, demo only ---------------- */

  'POST /api/planner/tables': async ({ req, body }) => {
    const { wedding } = myWedding(req);
    entitlements.assertSeatingAllowed(wedding);

    const shape = oneOf(body.shape, 'Table shape', TABLE_SHAPE_KEYS, 'round');
    const spec = shapeSpec(shape);
    const capacity = int(body.capacity, 'Seats', {
      min: spec.minSeats, max: spec.maxSeats, fallback: spec.defaultSeats,
    });

    const tableId = id('tbl');
    run(
      `INSERT INTO seating_tables (id, wedding_id, name, capacity, shape, pos_x, pos_y, sort)
       VALUES (?,?,?,?,?,?,?,?)`,
      tableId, wedding.id,
      str(body.name, 'Table name', { required: true, max: 80 }),
      capacity, shape,
      clampPercent(body.x, 8 + Math.random() * 30),
      clampPercent(body.y, 8 + Math.random() * 30),
      9999
    );
    touch(wedding.id);
    return { status: 201, body: { id: tableId } };
  },

  /**
   * The seating designer edits everything about a table: name, shape, seat
   * count and where it sits in the room. Positions are percentages so the
   * same plan draws correctly at any screen size.
   */
  'PATCH /api/planner/tables/:id': async ({ req, params, body }) => {
    const { wedding } = myWedding(req);
    entitlements.assertSeatingAllowed(wedding);
    const table = get('SELECT * FROM seating_tables WHERE id = ? AND wedding_id = ?', params.id, wedding.id);
    if (!table) throw new HttpError(404, 'We could not find that table.');

    if (body.name !== undefined) {
      run('UPDATE seating_tables SET name = ? WHERE id = ?',
        str(body.name, 'Table name', { required: true, max: 80 }), table.id);
    }
    if (body.shape !== undefined) {
      const shape = oneOf(body.shape, 'Table shape', TABLE_SHAPE_KEYS);
      const spec = shapeSpec(shape);
      // Changing shape keeps the seat count where the new shape allows it.
      const capacity = Math.min(Math.max(table.capacity, spec.minSeats), spec.maxSeats);
      run('UPDATE seating_tables SET shape = ?, capacity = ? WHERE id = ?', shape, capacity, table.id);
    }
    if (body.capacity !== undefined) {
      const spec = shapeSpec(body.shape !== undefined ? body.shape : (table.shape || 'round'));
      const capacity = int(body.capacity, 'Seats', { min: spec.minSeats, max: spec.maxSeats });
      const seated = get('SELECT COUNT(*) AS n FROM guests WHERE table_id = ?', table.id).n;
      if (capacity < seated) {
        throw new HttpError(409, `${seated} guests are already seated here. Move ${seated - capacity} of them before shrinking the table.`);
      }
      run('UPDATE seating_tables SET capacity = ? WHERE id = ?', capacity, table.id);
    }
    if (body.x !== undefined || body.y !== undefined) {
      run('UPDATE seating_tables SET pos_x = ?, pos_y = ? WHERE id = ?',
        clampPercent(body.x, table.pos_x || 0), clampPercent(body.y, table.pos_y || 0), table.id);
    }
    touch(wedding.id);
    const updated = get('SELECT * FROM seating_tables WHERE id = ?', table.id);
    return {
      body: {
        table: {
          id: updated.id, name: updated.name, capacity: updated.capacity,
          shape: updated.shape, x: updated.pos_x, y: updated.pos_y,
        },
      },
    };
  },

  'DELETE /api/planner/tables/:id': async ({ req, params }) => {
    const { wedding } = myWedding(req);
    run('UPDATE guests SET table_id = NULL WHERE table_id = ? AND wedding_id = ?', params.id, wedding.id);
    run('DELETE FROM seating_tables WHERE id = ? AND wedding_id = ?', params.id, wedding.id);
    touch(wedding.id);
    return { body: { ok: true } };
  },

  /* ---------------- timeline ---------------- */

  'POST /api/planner/timeline': async ({ req, body }) => {
    const { wedding } = myWedding(req);
    entitlements.assertTimelineAllowed(wedding);
    const eventId = id('tml');
    const time = str(body.time, 'Time', { required: true, max: 5 });
    if (!/^\d{2}:\d{2}$/.test(time)) throw new HttpError(400, 'Time must be in 24 hour HH:MM form.');
    run('INSERT INTO timeline_events (id, wedding_id, at_time, title, detail, owner) VALUES (?,?,?,?,?,?)',
      eventId, wedding.id, time, str(body.title, 'Title', { required: true, max: 160 }),
      str(body.detail, 'Detail', { max: 500 }), str(body.owner, 'Owner', { max: 120 }));
    touch(wedding.id);
    return { status: 201, body: { id: eventId } };
  },

  'PATCH /api/planner/timeline/:id': async ({ req, params, body }) => {
    const { wedding } = myWedding(req);
    const event = get('SELECT * FROM timeline_events WHERE id = ? AND wedding_id = ?', params.id, wedding.id);
    if (!event) throw new HttpError(404, 'We could not find that timeline entry.');
    if (body.time !== undefined) {
      const time = str(body.time, 'Time', { required: true, max: 5 });
      if (!/^\d{2}:\d{2}$/.test(time)) throw new HttpError(400, 'Time must be in 24 hour HH:MM form.');
      run('UPDATE timeline_events SET at_time = ? WHERE id = ?', time, event.id);
    }
    if (body.title !== undefined) run('UPDATE timeline_events SET title = ? WHERE id = ?', str(body.title, 'Title', { required: true, max: 160 }), event.id);
    if (body.detail !== undefined) run('UPDATE timeline_events SET detail = ? WHERE id = ?', str(body.detail, 'Detail', { max: 500 }), event.id);
    if (body.owner !== undefined) run('UPDATE timeline_events SET owner = ? WHERE id = ?', str(body.owner, 'Owner', { max: 120 }), event.id);
    touch(wedding.id);
    return { body: { ok: true } };
  },

  'DELETE /api/planner/timeline/:id': async ({ req, params }) => {
    const { wedding } = myWedding(req);
    run('DELETE FROM timeline_events WHERE id = ? AND wedding_id = ?', params.id, wedding.id);
    touch(wedding.id);
    return { body: { ok: true } };
  },

  /* ---------------- AI planner ---------------- */

  'GET /api/ai/status': async ({ req }) => {
    const user = requireRole(req, 'couple');
    const wedding = get('SELECT * FROM weddings WHERE user_id = ? LIMIT 1', user.id);
    const summary = entitlements.summarise(wedding);
    const live = ai.status();
    return {
      body: {
        mode: live.mode,
        modeReason: live.reason,
        modeCheckedAt: live.checkedAt,
        model: live.model,
        fairUse: FAIR_USE,
        basis: summary.ai.basis,
        quota: summary.ai.quota,
        used: summary.ai.used,
        remaining: summary.ai.remaining,
        plan: summary.plan,
      },
    };
  },

  'GET /api/ai/messages': async ({ req }) => {
    const { wedding } = myWedding(req);
    const rows = all('SELECT * FROM chat_messages WHERE wedding_id = ? ORDER BY created_at LIMIT 200', wedding.id);
    return { body: { messages: rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at })) } };
  },

  'POST /api/ai/chat': async ({ req, body }) => {
    const { wedding } = myWedding(req);
    const message = str(body.message, 'Message', { required: true, max: 4000 });

    // Published allowances, enforced. The free plan gets a one off total, the
    // upgraded plan a monthly allowance. Neither ever locks the rest of the plan.
    const allowance = entitlements.assertAiAllowed(wedding);

    const { rateLimit } = require('../lib/http');
    const burst = rateLimit(`ai:${wedding.id}`, 20, 10 * 60 * 1000);
    if (!burst.ok) {
      throw new HttpError(429, {
        message: 'That is more than 20 messages in ten minutes, which is the published rate limit. Give it a moment and carry on.',
        retryAfter: burst.retryAfter,
      });
    }

    const history = all(
      'SELECT role, content FROM chat_messages WHERE wedding_id = ? ORDER BY created_at DESC LIMIT 16',
      wedding.id
    ).reverse();

    run('INSERT INTO chat_messages (id, wedding_id, role, content, created_at) VALUES (?,?,?,?,?)',
      id('msg'), wedding.id, 'user', message, now());

    const reply = await ai.answer({ wedding, history, message });

    run('INSERT INTO chat_messages (id, wedding_id, role, content, created_at) VALUES (?,?,?,?,?)',
      id('msg'), wedding.id, 'assistant', reply.text, now());

    const period = new Date().toISOString().slice(0, 7);
    run(
      `INSERT INTO ai_usage (wedding_id, period, used) VALUES (?,?,1)
       ON CONFLICT(wedding_id, period) DO UPDATE SET used = used + 1`,
      wedding.id, period
    );

    const after = entitlements.summarise(get('SELECT * FROM weddings WHERE id = ?', wedding.id));
    return {
      body: {
        reply: reply.text,
        mode: reply.mode,
        model: reply.model,
        degraded: Boolean(reply.degraded),
        degradedReason: reply.degradedReason || null,
        usage: {
          basis: after.ai.basis,
          used: after.ai.used,
          quota: after.ai.quota,
          remaining: after.ai.remaining,
        },
      },
    };
  },

  'DELETE /api/ai/messages': async ({ req }) => {
    const { wedding } = myWedding(req);
    run('DELETE FROM chat_messages WHERE wedding_id = ?', wedding.id);
    return { body: { ok: true } };
  },
};
