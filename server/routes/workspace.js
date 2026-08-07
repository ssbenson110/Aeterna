'use strict';

/**
 * Shared workspace endpoints.
 *
 * Access is decided in lib/workspace.js. These handlers never widen it, they
 * only ask for it. A booked vendor gets a scoped payload built from scratch
 * rather than a filtered copy of the couple's view.
 */

const { all, get, run, id, now } = require('../db');
const { HttpError, str, int, isEmail, isoDate, oneOf, bool } = require('../lib/http');
const { requireUser, requireRole } = require('../lib/auth');
const entitlements = require('../lib/entitlements');
const workspace = require('../lib/workspace');
const { WORKSPACE_ROLES } = require('../lib/config');
const email = require('../lib/email');

function myWedding(req) {
  const user = requireRole(req, 'couple');
  const wedding = get('SELECT * FROM weddings WHERE user_id = ? LIMIT 1', user.id);
  if (!wedding) throw new HttpError(404, 'We could not find your plan.');
  return { user, wedding };
}

module.exports = {
  /**
   * Every wedding this user can reach, whichever role they hold.
   * Powers the planner dashboard and the vendor's list of booked weddings.
   */
  'GET /api/workspaces': async ({ req }) => {
    const user = requireUser(req);
    const owned = all('SELECT * FROM weddings WHERE user_id = ?', user.id).map((w) => ({
      weddingId: w.id,
      role: 'owner',
      roleLabel: WORKSPACE_ROLES.owner.label,
      couple: [w.partner_one, w.partner_two].filter(Boolean).join(' and ') || 'Your wedding',
      weddingDate: w.wedding_date,
      region: w.region,
    }));
    return { body: { workspaces: owned.concat(workspace.weddingsForUser(user)) } };
  },

  'GET /api/workspace/:weddingId': async ({ req, params }) => {
    const user = requireUser(req);
    const access = workspace.requireAccess(params.weddingId, user);

    // The couple needs the upgrade to open the shared page. A planner or vendor
    // the couple has already invited is never blocked by the couple's plan.
    if (access.role === 'owner') {
      entitlements.assertWorkspaceAllowed(access.wedding);
      // Older weddings predate the membership table, so backfill on first open.
      workspace.ensureOwner(access.wedding, user);
    }

    return { body: workspace.viewFor(access) };
  },

  /* ---------------- members ---------------- */

  'POST /api/workspace/:weddingId/invite': async ({ req, params, body }) => {
    const user = requireUser(req);
    const access = workspace.requireAccess(params.weddingId, user, 'invite');
    entitlements.assertCollaboratorAllowed(access.wedding);

    const email = str(body.email, 'Email', { required: true, max: 200 });
    if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
    const role = oneOf(body.role, 'Role', ['planner', 'helper']);
    const displayName = str(body.displayName, 'Name', { max: 120 });

    const result = workspace.inviteMember({
      weddingId: params.weddingId,
      invitedBy: user.id,
      role,
      displayName,
      email,
    });

    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`;
    const delivery = await require('../lib/email').send({
      to: email,
      subject: `${user.display_name} has invited you to help plan a wedding`,
      bodyText: `${user.display_name} has invited you onto their AETERNA wedding page as ${role === 'planner' ? 'their planner' : 'a helper'}.\n\nAccept the invitation and the wedding appears on your dashboard.`,
      ctaLabel: 'Accept the invitation',
      ctaUrl: `${origin}/#/join/${result.token}`,
    });

    return {
      status: 201,
      body: {
        ...result,
        note: result.status === 'invited'
          ? 'They do not have an AETERNA account yet. The invite link connects to this wedding when they sign up.'
          : 'They already have an account, so this wedding is on their dashboard now.',
        inviteUrl: `#/join/${result.token}`,
        emailSent: delivery.sent,
        emailNote: delivery.sent
          ? `An invitation email is on its way to ${email}.`
          : `${delivery.detail} Share the link yourself.`,
      },
    };
  },

  'POST /api/workspace/join/:token': async ({ req, params }) => {
    const user = requireUser(req);
    const member = workspace.acceptInvite(params.token, user);
    return { body: { weddingId: member.wedding_id, role: member.role } };
  },

  'DELETE /api/workspace/:weddingId/members/:memberId': async ({ req, params }) => {
    const user = requireUser(req);
    workspace.requireAccess(params.weddingId, user, 'revoke');
    workspace.revokeMember(params.weddingId, params.memberId);
    return { body: { ok: true } };
  },

  /* ---------------- bookings, the gate to the workspace ---------------- */

  'GET /api/workspace/:weddingId/bookings': async ({ req, params }) => {
    const user = requireUser(req);
    const access = workspace.requireAccess(params.weddingId, user, 'read_all');
    return {
      body: {
        bookings: workspace.bookingsFor(access.wedding.id).map((b) => ({
          id: b.id,
          vendorId: b.vendor_id,
          vendorName: b.business_name,
          vendorSlug: b.slug,
          category: b.category,
          agreedPence: b.agreed_pence,
          status: b.status,
          verified: Boolean(b.verified),
        })),
      },
    };
  },

  'POST /api/bookings': async ({ req, body }) => {
    const { user, wedding } = myWedding(req);
    entitlements.assertWorkspaceAllowed(wedding);

    const vendorId = str(body.vendorId, 'Vendor', { required: true, max: 60 });
    const booking = workspace.bookVendor({
      weddingId: wedding.id,
      vendorId,
      enquiryId: body.enquiryId ? str(body.enquiryId, 'Enquiry', { max: 60 }) : null,
      agreedPence: int(body.agreedPence, 'Agreed price', { min: 0, max: 100_000_000 }),
      notes: str(body.notes, 'Notes', { max: 2000 }),
    });
    workspace.ensureOwner(wedding, user);

    const vendor = get('SELECT business_name FROM vendors WHERE id = ?', vendorId);
    return {
      status: 201,
      body: {
        booking: { id: booking.id, vendorId: booking.vendor_id, category: booking.category, status: booking.status },
        note: `${vendor.business_name} is booked and now has scoped access to your shared page. They can see your date, venue, guest count, their own budget line and the day timeline. They cannot see your total budget, your guest list or any other supplier's prices.`,
      },
    };
  },

  'DELETE /api/bookings/:vendorId': async ({ req, params }) => {
    const { wedding } = myWedding(req);
    workspace.cancelBooking(wedding.id, params.vendorId);
    return { body: { ok: true, note: 'The booking is cancelled and their access to your shared page was removed immediately.' } };
  },

  /* ---------------- tasks ---------------- */

  'POST /api/workspace/:weddingId/tasks': async ({ req, params, body }) => {
    const user = requireUser(req);
    const access = workspace.requireAccess(params.weddingId, user);
    if (!access.can.includes('write_all') && !access.can.includes('write_plan')) {
      throw new HttpError(403, 'Only the couple and their planner can create tasks.');
    }

    const taskId = id('wtk');
    run(
      `INSERT INTO workspace_tasks (id, wedding_id, title, detail, assignee_id, due_date, done, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      taskId, params.weddingId,
      str(body.title, 'Task', { required: true, max: 200 }),
      str(body.detail, 'Detail', { max: 1000 }),
      body.assigneeId ? str(body.assigneeId, 'Assignee', { max: 60 }) : null,
      body.dueDate ? isoDate(body.dueDate, 'Due date') : null,
      0, user.id, now()
    );
    workspace.recordChange(params.weddingId, user.display_name, access.role, `added the task "${str(body.title, 'Task', { max: 200 })}"`);
    return { status: 201, body: { id: taskId } };
  },

  'PATCH /api/workspace/:weddingId/tasks/:taskId': async ({ req, params, body }) => {
    const user = requireUser(req);
    const access = workspace.requireAccess(params.weddingId, user);
    const task = get('SELECT * FROM workspace_tasks WHERE id = ? AND wedding_id = ?', params.taskId, params.weddingId);
    if (!task) throw new HttpError(404, 'We could not find that task.');

    // A vendor may only tick their own tasks.
    if (access.role === 'vendor') {
      if (task.assignee_id !== access.member.id) {
        throw new HttpError(403, 'You can only update tasks assigned to you.');
      }
      if (body.title !== undefined || body.assigneeId !== undefined) {
        throw new HttpError(403, 'Only the couple and their planner can change what a task says or who it belongs to.');
      }
    }

    if (body.done !== undefined) {
      run('UPDATE workspace_tasks SET done = ? WHERE id = ?', bool(body.done) ? 1 : 0, task.id);
      workspace.recordChange(params.weddingId, user.display_name, access.role,
        `${bool(body.done) ? 'completed' : 'reopened'} "${task.title}"`);
    }
    if (body.title !== undefined) run('UPDATE workspace_tasks SET title = ? WHERE id = ?', str(body.title, 'Task', { required: true, max: 200 }), task.id);
    if (body.assigneeId !== undefined) {
      run('UPDATE workspace_tasks SET assignee_id = ? WHERE id = ?', body.assigneeId || null, task.id);
    }
    if (body.dueDate !== undefined) run('UPDATE workspace_tasks SET due_date = ? WHERE id = ?', body.dueDate ? isoDate(body.dueDate, 'Due date') : null, task.id);

    return { body: { ok: true } };
  },

  'DELETE /api/workspace/:weddingId/tasks/:taskId': async ({ req, params }) => {
    const user = requireUser(req);
    const access = workspace.requireAccess(params.weddingId, user);
    if (!access.can.includes('write_all') && !access.can.includes('write_plan')) {
      throw new HttpError(403, 'Only the couple and their planner can remove tasks.');
    }
    run('DELETE FROM workspace_tasks WHERE id = ? AND wedding_id = ?', params.taskId, params.weddingId);
    return { body: { ok: true } };
  },

  /* ---------------- comments ---------------- */

  'GET /api/workspace/:weddingId/comments': async ({ req, params, query }) => {
    const user = requireUser(req);
    const access = workspace.requireAccess(params.weddingId, user);
    const threadKey = str(query.thread, 'Thread', { max: 80, fallback: 'general' });

    // A vendor may only read their own thread.
    if (access.role === 'vendor' && threadKey !== `vendor:${access.booking.vendor_id}`) {
      throw new HttpError(403, 'You can only read your own thread on this wedding.');
    }
    return { body: { comments: workspace.commentsFor(params.weddingId, threadKey), thread: threadKey } };
  },

  'POST /api/workspace/:weddingId/comments': async ({ req, params, body }) => {
    const user = requireUser(req);
    const access = workspace.requireAccess(params.weddingId, user, 'comment');
    const threadKey = str(body.thread, 'Thread', { max: 80, fallback: 'general' });

    if (access.role === 'vendor' && threadKey !== `vendor:${access.booking.vendor_id}`) {
      throw new HttpError(403, 'You can only post in your own thread on this wedding.');
    }

    const comment = workspace.addComment({
      weddingId: params.weddingId,
      threadKey,
      user,
      role: access.role,
      body: str(body.body, 'Comment', { required: true, max: 4000 }),
    });

    return {
      status: 201,
      body: {
        comment: {
          id: comment.id, body: comment.body, author: comment.author_name,
          role: comment.author_role, at: comment.created_at,
        },
      },
    };
  },
};

// `comment` is not in the owner or planner capability lists by name, so allow it
// for everyone who can already write. Vendors have it explicitly.
for (const role of ['owner', 'planner']) {
  if (!WORKSPACE_ROLES[role].can.includes('comment')) WORKSPACE_ROLES[role].can.push('comment');
}
