// Sentetik "fotoğraf" üretici: cevap kağıdı yerleşimini rasterleştirir, öğrenci işaretlerini
// (koyu, soluk, küçük, çarpı, yarım silinmiş, çift) çizer, ardından perspektif, dönme, gölge,
// gürültü ve bulanıklık uygular. Optik okumanın doğruluk testleri bunu kullanır.

import { PAGE_W, PAGE_H, FIDUCIALS, FID, ORIENT_BAR, CODE_BITS, NUMBER_GRID, codeBits } from '../js/vision/sheet.js';
import { homography } from '../js/vision/imgops.js';

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function canvas(w, h, v = 250) { const d = new Float32Array(w * h).fill(v); return { w, h, d }; }
function fillRect(c, x, y, w, h, v, k) {
  for (let yy = Math.round(y * k); yy < Math.round((y + h) * k); yy++) for (let xx = Math.round(x * k); xx < Math.round((x + w) * k); xx++)
    if (xx >= 0 && yy >= 0 && xx < c.w && yy < c.h) c.d[yy * c.w + xx] = v;
}
function disk(c, cx, cy, r, v, k, alpha = 1) {
  const R = r * k, X = cx * k, Y = cy * k;
  for (let yy = Math.floor(Y - R); yy <= Math.ceil(Y + R); yy++) for (let xx = Math.floor(X - R); xx <= Math.ceil(X + R); xx++) {
    if (xx < 0 || yy < 0 || xx >= c.w || yy >= c.h) continue;
    if ((xx + 0.5 - X) ** 2 + (yy + 0.5 - Y) ** 2 <= R * R) { const i = yy * c.w + xx; c.d[i] = c.d[i] * (1 - alpha) + v * alpha; }
  }
}
function ring(c, cx, cy, r, v, k, t = 1.3) {
  const R = r * k, T = t * k, X = cx * k, Y = cy * k;
  for (let yy = Math.floor(Y - R - T); yy <= Math.ceil(Y + R + T); yy++) for (let xx = Math.floor(X - R - T); xx <= Math.ceil(X + R + T); xx++) {
    if (xx < 0 || yy < 0 || xx >= c.w || yy >= c.h) continue;
    const dd = Math.hypot(xx + 0.5 - X, yy + 0.5 - Y);
    if (Math.abs(dd - R) <= T / 2) c.d[yy * c.w + xx] = v;
  }
}
function stroke(c, x0, y0, x1, y1, v, k, t = 2.5) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * k);
  for (let i = 0; i <= n; i++) disk(c, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, t / 2, v, k);
}

/**
 * İşaret türleri: full (koyu dolu), light (soluk dolu), small (küçük dolu), x (çarpı),
 * erased (silinmiş iz; yeni işaret de olabilir).
 */
export function drawMark(c, b, kind, k, r) {
  if (kind === 'full') disk(c, b.cx, b.cy, b.r * (0.9 + r() * 0.15), 40 + r() * 30, k);
  else if (kind === 'light') disk(c, b.cx, b.cy, b.r * 0.95, 140 + r() * 20, k);
  else if (kind === 'small') disk(c, b.cx + (r() - 0.5) * 3, b.cy + (r() - 0.5) * 3, b.r * 0.72, 50, k);
  else if (kind === 'x') { stroke(c, b.cx - 8, b.cy - 8, b.cx + 8, b.cy + 8, 40, k, 3.2); stroke(c, b.cx - 8, b.cy + 8, b.cx + 8, b.cy - 8, 40, k, 3.2); }
  else if (kind === 'erased') disk(c, b.cx, b.cy, b.r, 222, k, 0.9);
}

/** Kanonik sayfayı `k` ölçeğinde rasterleştirir. marks: [{questionId, option, kind}] */
export function rasterSheet(layout, pageIndex, { marks = [], number = '', k = 1.5, seed = 1, handwriting = true } = {}) {
  const r = rng(seed);
  const c = canvas(Math.round(PAGE_W * k), Math.round(PAGE_H * k));
  const p = layout.pages[pageIndex - 1];
  for (const f of FIDUCIALS) fillRect(c, f.x - FID / 2, f.y - FID / 2, FID, FID, 20, k);
  fillRect(c, ORIENT_BAR.x, ORIENT_BAR.y, ORIENT_BAR.w, ORIENT_BAR.h, 20, k);
  codeBits(pageIndex, layout.fingerprint).forEach((b, i) => { const q = CODE_BITS[i]; if (b) fillRect(c, q.x, q.y, q.w, q.h, 20, k); });
  // başlık metnini taklit eden yatay çizgiler + el yazısı ad (karartılacak bölge)
  for (let y = 120; y < 420; y += 32) fillRect(c, 90, y, 300 + r() * 400, 3, 90, k);
  const G = NUMBER_GRID;
  for (let col = 0; col < G.cols; col++) for (let v = 0; v < 10; v++) ring(c, G.x0 + col * G.dx, G.y0 + v * G.dy, G.r, 60, k);
  for (const b of p.bubbles) ring(c, b.cx, b.cy, b.r, 60, k);
  for (const b of p.boxes) { fillRect(c, b.x, b.y, b.w, 1.5, 40, k); fillRect(c, b.x, b.y + b.h, b.w, 1.5, 40, k); }
  for (const w of p.writing) for (const l of w.lines) {
    fillRect(c, w.rect.x + 50, l.y1 - 6, w.rect.w - 60, 1, 180, k);
    if (handwriting) { let x = w.rect.x + 60; while (x < w.rect.x + w.rect.w - 120 && r() < 0.95) { const len = 20 + r() * 70; stroke(c, x, l.y1 - 14, x + len, l.y1 - 18 - r() * 10, 50, k, 2); x += len + 14; } }
  }
  String(number).split('').forEach((dg, col) => { if (/\d/.test(dg)) drawMark(c, { cx: G.x0 + col * G.dx, cy: G.y0 + Number(dg) * G.dy, r: G.r }, 'full', k, r); });
  for (const m of marks) {
    const b = p.bubbles.find(x => x.questionId === m.questionId && x.option === m.option);
    if (b) drawMark(c, b, m.kind, k, r);
  }
  return c;
}

/**
 * Sayfayı bir "fotoğraf"a yerleştirir: perspektif, dönme (rot90 × 90° + açı), gölge, gürültü, bulanıklık.
 * @returns {{w,h,d:Uint8ClampedArray}}
 */
export function photograph(sheet, { seed = 1, angle = 0, rot90 = 0, persp = 0.04, size = [2000, 2700], shadow = 0.3, noise = 10, blur = true, offset = [0, 0] } = {}) {
  const r = rng(seed * 7919);
  const [W, H] = size;
  // sayfa köşelerinin fotoğraftaki yeri
  const aspect = sheet.w / sheet.h;
  const ph = H * 0.82, pw = ph * aspect;
  const cx = W / 2 + (r() - 0.5) * W * 0.05 + offset[0], cy = H / 2 + (r() - 0.5) * H * 0.05 + offset[1];
  const t = (angle + rot90 * 90) * Math.PI / 180;
  const base = [[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]];
  let scaleFit = 1;
  if (rot90 % 2) scaleFit = Math.min(W / ph, H / pw) * 0.85;
  const quad = base.map(([x, y]) => {
    const jx = x * scaleFit + (r() - 0.5) * pw * persp * 2, jy = y * scaleFit + (r() - 0.5) * ph * persp * 2;
    return { x: cx + jx * Math.cos(t) - jy * Math.sin(t), y: cy + jx * Math.sin(t) + jy * Math.cos(t) };
  });
  const Hm = homography(quad, [{ x: 0, y: 0 }, { x: sheet.w, y: 0 }, { x: sheet.w, y: sheet.h }, { x: 0, y: sheet.h }]); // fotoğraf → sayfa
  const out = new Float32Array(W * H);
  const sx = r(), sy = r();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const z = Hm[6] * x + Hm[7] * y + 1;
    const u = (Hm[0] * x + Hm[1] * y + Hm[2]) / z, v = (Hm[3] * x + Hm[4] * y + Hm[5]) / z;
    let val;
    if (u < 0 || v < 0 || u >= sheet.w - 1 || v >= sheet.h - 1) val = 70 + ((x * 13 + y * 7) % 23);
    else {
      const x0 = u | 0, y0 = v | 0, ax = u - x0, ay = v - y0, sw = sheet.w, d = sheet.d;
      val = (d[y0 * sw + x0] * (1 - ax) + d[y0 * sw + x0 + 1] * ax) * (1 - ay) + (d[(y0 + 1) * sw + x0] * (1 - ax) + d[(y0 + 1) * sw + x0 + 1] * ax) * ay;
    }
    const light = 1 - shadow * Math.max(0, 1 - Math.hypot(x / W - sx, y / H - sy) * 1.4);
    out[y * W + x] = val * light + (r() - 0.5) * 2 * noise;
  }
  const d = new Uint8ClampedArray(W * H);
  if (blur) {
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      d[i] = (out[i] * 4 + out[i - 1] + out[i + 1] + out[i - W] + out[i + W]) / 8;
    }
  } else for (let i = 0; i < d.length; i++) d[i] = out[i];
  return { w: W, h: H, d };
}
