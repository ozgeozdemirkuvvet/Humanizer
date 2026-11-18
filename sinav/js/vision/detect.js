// Kırmızı Kalem kağıdının fotoğrafta bulunması: köşe işaretçileri → homografi → yön → ince ayar.

import { downscale, adaptiveBinary, components, homography, multiplyH, warp, applyH, otsu } from './imgops.js';
import { FIDUCIALS, FID, ORIENT_BAR, PAGE_W, PAGE_H } from './sheet.js';

/** Fotoğraftaki kare işaretçi adayları (küçültülmüş görüntüde). */
function candidates(small) {
  const { w, h } = small;
  const bin = adaptiveBinary(small, Math.max(15, Math.round(Math.min(w, h) / 9)) | 1, 0.62);
  const minDim = Math.min(w, h);
  const minSide = minDim * 0.012, maxSide = minDim * 0.09;
  return components(bin, w, h, 12).filter(c => {
    if (c.x0 <= 0 || c.y0 <= 0 || c.x1 >= w - 1 || c.y1 >= h - 1) return false;
    const ar = c.bw / c.bh;
    if (ar < 0.55 || ar > 1.8) return false;
    const side = Math.sqrt(c.area);
    if (side < minSide || side > maxSide) return false;
    return c.area / (c.bw * c.bh) >= 0.72; // dolu baloncuk ~0.785 ama döndürülmüş kare de ~0.5–1; ek elemeyi skor yapar
  });
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function quadArea(p) {
  let s = 0;
  for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s) / 2;
}

/** Dört köşe için en iyi aday dörtlüsünü seçer: dışbükey, büyük, benzer boyutlu. */
function pickQuad(cands, w, h) {
  const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const near = corners.map(k => [...cands].sort((a, b) => Math.hypot(a.cx - k.x, a.cy - k.y) - Math.hypot(b.cx - k.x, b.cy - k.y)).slice(0, 5));
  if (near.some(l => !l.length)) return null;
  let best = null;
  for (const a of near[0]) for (const b of near[1]) for (const c of near[2]) for (const d of near[3]) {
    const q = [a, b, c, d];
    if (new Set(q).size < 4) continue;
    const pts = q.map(t => ({ x: t.cx, y: t.cy }));
    const s = [0, 1, 2, 3].map(i => Math.sign(cross(pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4])));
    // Dışbükey ve saat yönünde (y aşağı): ters sıralı dörtlü aynalanmış bir sayfa verir
    if (!s.every(v => v === 1)) continue;
    const area = quadArea(pts);
    if (area < 0.15 * w * h) continue;
    const areas = q.map(t => t.area);
    const ratio = Math.max(...areas) / Math.min(...areas);
    if (ratio > 3.2) continue;
    const fill = q.reduce((m, t) => Math.min(m, t.area / (t.bw * t.bh)), 1);
    const score = area * (1 / ratio) * fill;
    if (!best || score > best.score) best = { score, q };
  }
  return best?.q || null;
}

/** Yön çubuğunun koyuluğu: sayfa → görüntü homografisiyle örneklenir. */
function barDarkness(g, H) {
  const sample = (rx, ry, rw, rh) => {
    let s = 0, n = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 12; i++) {
      const p = applyH(H, rx + (i + 0.5) * rw / 12, ry + (j + 0.5) * rh / 4);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) return null;
      s += g.d[y * g.w + x]; n++;
    }
    return s / n;
  };
  const b = ORIENT_BAR;
  const bar = sample(b.x + 10, b.y + 4, b.w - 20, b.h - 8);
  const white = sample(b.x, b.y + b.h + 12, b.w, 14);
  if (bar == null || white == null || white < 1) return -1;
  return 1 - bar / white;
}

/**
 * @param {{w,h,d}} g tam çözünürlüklü gri fotoğraf
 * @returns {{ok:boolean, H?:number[], rotation?:number, reason?:string, corners?:object[]}}
 *   H: sayfa (kanonik) → fotoğraf
 */
export function detectSheet(g) {
  const { img: small, scale } = downscale(g, 1000);
  const cands = candidates(small);
  const q = pickQuad(cands, small.w, small.h);
  if (!q) return { ok: false, reason: 'Köşe işaretçileri bulunamadı' };
  const pts = q.map(t => ({ x: t.cx * scale, y: t.cy * scale }));
  // Görüntüde saat yönünde sırala (sol üst, sağ üst, sağ alt, sol alt)
  let best = null;
  for (let r = 0; r < 4; r++) {
    const dst = [0, 1, 2, 3].map(k => pts[(k + r) % 4]);
    const H = homography(FIDUCIALS, dst);
    if (!H) continue;
    const dark = barDarkness(g, H);
    if (!best || dark > best.dark) best = { H, r, dark };
  }
  if (!best || best.dark < 0.35) return { ok: false, reason: 'Kağıdın yönü belirlenemedi (üst çubuk görünmüyor)' };
  const ref = refine(g, best.H);
  if (ref.confirmed < 4) return { ok: false, reason: 'Köşe işaretçilerinden biri doğrulanamadı; kağıdın tamamı kadrajda olacak şekilde yeniden çekin' };
  return { ok: true, H: ref.H, rotation: best.r * 90, corners: pts, residual: ref.shift };
}

/** İnce ayar: düzleştirilmiş görüntüde işaretçilerin gerçek merkezleri bulunur, düzeltme homografisi eklenir. */
function refine(g, H) {
  const found = [];
  for (const f of FIDUCIALS) {
    const R = 46;
    const rect = { x: f.x - R, y: f.y - R, w: 2 * R, h: 2 * R };
    const win = warp(g, H, rect, 1);
    const th = otsu(win);
    const bin = new Uint8Array(win.w * win.h);
    for (let i = 0; i < bin.length; i++) bin[i] = win.d[i] < th ? 1 : 0;
    const comps = components(bin, win.w, win.h, 50)
      .filter(c => c.area > FID * FID * 0.4 && c.area < FID * FID * 2.2)
      .sort((a, b) => Math.hypot(a.cx - R, a.cy - R) - Math.hypot(b.cx - R, b.cy - R));
    // Gerçek işaretçi: dolu, kareye yakın, beklenen boyutta
    const c = comps.find(k => k.area / (k.bw * k.bh) > 0.8 && k.bw / k.bh > 0.7 && k.bw / k.bh < 1.4);
    if (!c) return { H, confirmed: found.length };
    found.push({ x: rect.x + c.cx, y: rect.y + c.cy });
  }
  const Hc = homography(FIDUCIALS, found);
  const shift = found.reduce((m, p, i) => Math.max(m, Math.hypot(p.x - FIDUCIALS[i].x, p.y - FIDUCIALS[i].y)), 0);
  if (!Hc || shift > 30) return { H, confirmed: 0, shift }; // aşırı düzeltme şüpheli
  return { H: multiplyH(H, Hc), confirmed: 4, shift };
}

/** Kanonik sayfa boyutunda düzleştirilmiş görüntü. */
export function rectify(src, H, channels = 1, scale = 1) {
  return warp(src, H, { x: 0, y: 0, w: PAGE_W, h: PAGE_H }, scale, channels);
}

