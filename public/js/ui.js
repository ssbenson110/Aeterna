/**
 * Small DOM and formatting helpers. No framework, no build step.
 */

/* ---------------- element building ---------------- */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function frag(children) {
  const f = document.createDocumentFragment();
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    f.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return f;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ---------------- formatting ---------------- */

export function money(pence, { decimals = false } = {}) {
  const value = (Number(pence) || 0) / 100;
  return value.toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}

export function poundsToPence(input) {
  const n = Number(String(input).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function longDate(iso) {
  if (!iso) return 'Not set';
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function shortDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function countdown(iso) {
  if (!iso) return null;
  const target = new Date(`${iso}T00:00:00`).getTime();
  if (Number.isNaN(target)) return null;
  const days = Math.ceil((target - Date.now()) / 864e5);
  if (days < 0) return { days, label: 'This date has passed' };
  if (days === 0) return { days, label: 'Today' };
  if (days === 1) return { days, label: 'Tomorrow' };
  if (days < 60) return { days, label: `${days} days to go` };
  const months = Math.round(days / 30.44);
  return { days, label: `${months} months to go` };
}

export function pluralise(n, one, many) {
  return `${n} ${n === 1 ? one : many || `${one}s`}`;
}

/* ---------------- icons, drawn not typed ---------------- */

export function tickIcon(colour = 'currentColor') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('tick');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M2.5 8.4l3.4 3.4L13.5 4.2');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', colour);
  path.setAttribute('stroke-width', '2.2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

export function crossIcon(colour = 'currentColor') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('tick');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 4l8 8M12 4l-8 8');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', colour);
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  return svg;
}

/* ---------------- toasts ---------------- */

export function toast(message, kind = '') {
  const tray = document.getElementById('toasts');
  if (!tray) return;
  const node = el('div', { class: `toast ${kind ? `toast--${kind}` : ''}`, role: 'status' }, message);
  tray.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 320);
  }, 5200);
}

/* ---------------- modal ---------------- */

let openModal = null;

export function modal(title, content, { onClose } = {}) {
  closeModal();
  const previousFocus = document.activeElement;

  const dialog = el('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
  });
  const close = el('button', {
    class: 'modal__close', type: 'button', 'aria-label': 'Close', onclick: () => closeModal(),
  }, '×');
  dialog.append(close, el('h2', {}, title), content);

  const backdrop = el('div', {
    class: 'modal-backdrop',
    onclick: (event) => { if (event.target === backdrop) closeModal(); },
  }, dialog);

  const onKey = (event) => { if (event.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', onKey);

  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  const focusable = dialog.querySelector('input, select, textarea, button:not(.modal__close), a[href]');
  (focusable || close).focus();

  openModal = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    document.body.style.overflow = '';
    if (previousFocus && previousFocus.focus) previousFocus.focus();
    if (onClose) onClose();
  };
  return { close: closeModal };
}

export function closeModal() {
  if (openModal) { const fn = openModal; openModal = null; fn(); }
}

/* ---------------- confetti ---------------- */

const CONFETTI_COLOURS = ['#E8646F', '#C9922F', '#F9D5D9', '#6E8F72', '#FFD8A8', '#D14A57'];

export function confetti(host, count = 46) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = el('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < count; i += 1) {
    const piece = el('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
    piece.style.animationDuration = `${5.5 + Math.random() * 5}s`;
    piece.style.animationDelay = `${Math.random() * 6}s`;
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 220}px`);
    piece.style.setProperty('--spin', `${360 + Math.random() * 900}deg`);
    if (i % 4 === 0) { piece.style.borderRadius = '50%'; piece.style.width = '8px'; piece.style.height = '8px'; }
    if (i % 5 === 0) { piece.style.width = '6px'; piece.style.height = '18px'; }
    layer.append(piece);
  }
  host.prepend(layer);
  return layer;
}

/**
 * A short burst used when something is worth celebrating, such as a plan
 * being created or an enquiry being sent.
 */
export function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = el('div', {
    style: 'position:fixed;inset:0;pointer-events:none;z-index:400;overflow:hidden',
    'aria-hidden': 'true',
  });
  document.body.append(host);
  confetti(host, 60);
  setTimeout(() => host.remove(), 9000);
}

/* ---------------- misc ---------------- */

export function debounce(fn, wait = 280) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Renders the small amount of markdown the planner produces: paragraphs and
 * simple dash lists. Text is escaped first, so nothing from a model or a user
 * can inject markup.
 */
export function richText(text) {
  const escape = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const blocks = String(text || '').split(/\n{2,}/);
  const wrapper = el('div');

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      const list = el('ul');
      for (const line of lines) {
        list.append(el('li', { html: inline(escape(line.replace(/^\s*[-*]\s+/, ''))) }));
      }
      wrapper.append(list);
    } else {
      wrapper.append(el('p', { html: inline(escape(lines.join(' '))) }));
    }
  }
  return wrapper;

  function inline(s) {
    return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }
}

export function setMeta(title, description) {
  document.title = title;
  const tag = document.querySelector('meta[name="description"]');
  if (tag && description) tag.setAttribute('content', description);
}
