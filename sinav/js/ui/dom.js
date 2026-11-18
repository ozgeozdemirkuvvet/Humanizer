// Küçük DOM yardımcıları. Kullanıcı ve model metni her zaman textContent ile yazılır (XSS yok).

/**
 * h('div.card#x', {onclick, 'aria-label': ..}, child1, 'metin', [çocuklar])
 */
export function h(tag, attrs, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m?.[1] || 'div');
  for (const part of (m?.[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected' || k === 'multiple') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/** Basit modal. İçerik fonksiyonu kapatma fonksiyonunu alır. Sonuç Promise ile döner. */
export function modal(build) {
  return new Promise(resolve => {
    const d = h('dialog');
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    d.append(build(close));
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
    document.body.append(d);
    d.showModal();
    d.querySelector('input, select, textarea, button.primary')?.focus();
  });
}

export function confirmDialog(title, text, { ok = 'Tamam', danger = false } = {}) {
  return modal(close => h('div',
    h('h2', title), h('p.muted', text),
    h('div.row', h('span.spacer'), h('button.btn', { onclick: () => close(false) }, 'Vazgeç'),
      h(`button.btn.${danger ? 'danger' : 'primary'}`, { onclick: () => close(true) }, ok))));
}

export function download(name, blobOrText, type = 'text/plain') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const fmt = n => (Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString().replace('.', ','));
export const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
