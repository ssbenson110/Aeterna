/**
 * Application entry point. Boots reference data and the session, wires the
 * router, and keeps the header in step with who is signed in.
 */

import { el, clear, toast } from './ui.js';
import { store } from './store.js';
import { defineRoute, setNotFound, start, navigate, resolve, syncNav } from './router.js';
import { loadingBlock, openAuthDialog } from './components.js';

import { renderHome } from './views/home.js';
import { renderBrowse } from './views/browse.js';
import { renderVendor } from './views/vendor.js';
import { renderPlanner } from './views/planner.js';
import { renderChat } from './views/chat.js';
import { renderPricing } from './views/pricing.js';
import { renderForVendors } from './views/for-vendors.js';
import { renderVerification, renderFairUse } from './views/policies.js';
import { renderAccount } from './views/account.js';
import { renderWorkspace, renderWorkspaceList, renderJoin } from './views/workspace.js';
import { renderAdmin } from './views/admin.js';
import { renderRsvp } from './views/rsvp.js';

const main = document.getElementById('main');

/* ---------------- routes ---------------- */

defineRoute('/', renderHome);
defineRoute('/browse', renderBrowse);
defineRoute('/vendor/:slug', ({ slug }) => renderVendor(slug));
defineRoute('/planner', renderPlanner);
defineRoute('/chat', renderChat);
defineRoute('/pricing', renderPricing);
defineRoute('/for-vendors', renderForVendors);
defineRoute('/verification', renderVerification);
defineRoute('/fair-use', renderFairUse);
defineRoute('/account', renderAccount);
defineRoute('/weddings', renderWorkspaceList);
defineRoute('/workspace/:weddingId', ({ weddingId }) => renderWorkspace(weddingId));
defineRoute('/join/:token', ({ token }) => renderJoin(token));
defineRoute('/admin', renderAdmin);
defineRoute('/rsvp/:token', ({ token }) => renderRsvp(token));

setNotFound(() => el('section', { class: 'section' }, [
  el('div', { class: 'wrap-narrow' }, [
    el('div', { class: 'empty' }, [
      el('h2', {}, 'That page does not exist'),
      el('p', { class: 'muted' }, 'The link may be out of date. Everything is a click away from the home page.'),
      el('a', { class: 'btn btn--primary', href: '#/', 'data-link': '' }, 'Back to the home page'),
    ]),
  ]),
]));

/* ---------------- header account area ---------------- */

function paintAccountNav() {
  const host = document.getElementById('nav-account');
  if (!host) return;
  clear(host);

  if (!store.user) {
    host.append(
      el('button', {
        class: 'linkish', type: 'button', style: 'margin:0 12px;font-weight:600',
        onclick: () => openAuthDialog({ mode: 'login' }),
      }, 'Sign in'),
      el('button', {
        class: 'btn btn--primary btn--sm', type: 'button',
        onclick: () => navigate('#/planner'),
      }, 'Start free plan')
    );
    return;
  }

  // Staff see the console instead of the couple and vendor navigation.
  if (store.user.role === 'admin') {
    host.append(
      el('a', {
        class: 'btn btn--primary btn--sm', href: '#/admin', 'data-link': '', style: 'margin-left:8px',
      }, 'Verification console'),
      el('button', {
        class: 'linkish', type: 'button', style: 'margin-left:12px;font-weight:600',
        onclick: async () => { await store.signOut(); toast('Signed out.', 'good'); navigate('#/'); },
      }, 'Sign out')
    );
    return;
  }

  host.append(
    el('a', {
      class: 'btn btn--quiet btn--sm', href: '#/weddings', 'data-link': '', style: 'margin-left:8px',
    }, 'Shared pages'),
    el('a', {
      class: 'btn btn--quiet btn--sm', href: '#/account', 'data-link': '', style: 'margin-left:8px',
    }, store.user.role === 'vendor' ? 'Dashboard' : 'Account'),
    el('button', {
      class: 'linkish', type: 'button', style: 'margin-left:12px;font-weight:600',
      onclick: async () => {
        await store.signOut();
        toast('Signed out.', 'good');
        navigate('#/');
      },
    }, 'Sign out')
  );
}

store.subscribe(paintAccountNav);

/* ---------------- mobile nav ---------------- */

const navToggle = document.querySelector('.nav-toggle');
const nav = document.getElementById('primary-nav');
if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) {
      nav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ---------------- boot ---------------- */

main.replaceChildren(loadingBlock('Loading AETERNA'));

store.boot()
  .catch(() => { /* views handle their own failures */ })
  .finally(() => {
    paintAccountNav();
    start(main);
    syncNav();
    // Re-render the current view whenever the session changes, so signing in or
    // out never leaves a stale view behind.
    let lastUserId = store.user ? store.user.id : null;
    store.subscribe((next) => {
      const nextId = next.user ? next.user.id : null;
      if (nextId !== lastUserId) { lastUserId = nextId; resolve(); }
    });
  });
