/**
 * Hash router. Hash routing keeps the whole app deep linkable without needing
 * server rewrites, and it works identically when the built single file version
 * is opened from disk.
 */

const routes = [];
let renderTarget = null;
let notFound = null;

export function defineRoute(pattern, handler) {
  // '/vendor/:slug' becomes a matcher with named parameters.
  const segments = pattern.split('/').filter(Boolean);
  routes.push({ pattern, segments, handler });
}

export function setNotFound(handler) { notFound = handler; }

export function currentPath() {
  const hash = location.hash.replace(/^#/, '') || '/';
  return hash.split('?')[0];
}

export function currentQuery() {
  const hash = location.hash.replace(/^#/, '');
  const index = hash.indexOf('?');
  if (index === -1) return {};
  return Object.fromEntries(new URLSearchParams(hash.slice(index + 1)).entries());
}

export function navigate(hash) {
  if (location.hash === hash) { resolve(); return; }
  location.hash = hash;
}

export function start(target) {
  renderTarget = target;
  window.addEventListener('hashchange', resolve);
  resolve();
}

export function resolve() {
  if (!renderTarget) return;
  const path = currentPath();
  const parts = path.split('/').filter(Boolean);

  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < parts.length; i += 1) {
      const segment = route.segments[i];
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[i]);
      else if (segment !== parts[i]) { matched = false; break; }
    }
    if (!matched) continue;

    paint(route.handler(params));
    return;
  }

  if (notFound) paint(notFound());
}

function paint(node) {
  renderTarget.replaceChildren(node instanceof Node ? node : document.createTextNode(''));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  syncNav();
  // Move focus to the main region so keyboard and screen reader users land in
  // the new view rather than at the top of an unchanged document.
  const main = document.getElementById('main');
  if (main) main.focus({ preventScroll: true });
}

export function syncNav() {
  const path = currentPath();
  document.querySelectorAll('.nav a[href^="#/"]').forEach((link) => {
    const target = link.getAttribute('href').replace(/^#/, '').split('?')[0];
    const active = target === path || (target !== '/' && path.startsWith(`${target}/`));
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
