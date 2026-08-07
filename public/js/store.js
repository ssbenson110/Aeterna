/**
 * Tiny observable store for session and reference data.
 */

import { api } from './api.js';

const listeners = new Set();

export const store = {
  user: null,
  wedding: null,
  vendor: null,
  meta: null,
  pricing: null,
  ready: false,

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  emit() {
    for (const fn of listeners) {
      try { fn(store); } catch { /* a broken listener should not break the app */ }
    }
  },

  async boot() {
    const [meta, pricing, me] = await Promise.allSettled([
      api.meta(), api.pricing(), api.me(),
    ]);
    if (meta.status === 'fulfilled') store.meta = meta.value;
    if (pricing.status === 'fulfilled') store.pricing = pricing.value;
    if (me.status === 'fulfilled') {
      store.user = me.value.user;
      store.wedding = me.value.wedding;
      store.vendor = me.value.vendor;
    }
    store.ready = true;
    store.emit();
  },

  async refresh() {
    try {
      const me = await api.me();
      store.user = me.user;
      store.wedding = me.wedding;
      store.vendor = me.vendor;
    } catch {
      store.user = null;
      store.wedding = null;
      store.vendor = null;
    }
    try { store.pricing = await api.pricing(); } catch { /* keep the cached copy */ }
    store.emit();
  },

  setWedding(wedding) {
    store.wedding = wedding;
    store.emit();
  },

  async signOut() {
    try { await api.logout(); } catch { /* clearing locally is enough */ }
    store.user = null;
    store.wedding = null;
    store.vendor = null;
    store.emit();
  },
};
