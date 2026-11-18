// Serbest (öğretmenin kendi hazırladığı) kağıtlar: kağıdı arka plandan ayırıp kırpma ve
// izdüşüm profiliyle eğiklik düzeltme. Köşe işaretçisi olmadığı için perspektif düzeltilmez,
// yalnızca döndürme yapılır; öğretmene "kağıdı dik çekin" uyarısı gösterilir.

import { downscale, otsu, adaptiveBinary } from './imgops.js';

/** Kağıt bölgesi: parlak piksellerin çoğunlukta olduğu satır/sütun aralığı. */
export function paperBounds(g) {
  const { img: s, scale } = downscale(g, 600);
  const th = otsu(s);
  const rows = new Float32Array(s.h), cols = new Float32Array(s.w);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.d[y * s.w + x] > th) { rows[y]++; cols[x]++; }
  const first = (arr, n, lim) => { for (let i = 0; i < arr.length; i++) if (arr[i] / n > lim) return i; return 0; };
  const last = (arr, n, lim) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] / n > lim) return i; return arr.length - 1; };
  const y0 = first(rows, s.w, 0.5), y1 = last(rows, s.w, 0.5), x0 = first(cols, s.h, 0.5), x1 = last(cols, s.h, 0.5);
  const r = { x: x0 * scale, y: y0 * scale, w: (x1 - x0 + 1) * scale, h: (y1 - y0 + 1) * scale };
  // Kağıt görüntünün çok küçük bir kısmıysa kırpma yapma (yanlış tespit riski)
  if (r.w * r.h < 0.3 * g.w * g.h) return { x: 0, y: 0, w: g.w, h: g.h };
  return r;
}

/**
 * Eğiklik açısı (derece; görüntü saat yönünde bu kadar dönmüş). Düzeltmek için rotate(g, -açı). Metin satırları yatay olduğunda yatay izdüşümün "keskinliği"
 * (kare toplamı) en yüksektir; ±8° arasında 0,25° adımla aranır.
 */
export function estimateSkew(g, maxDeg = 8, step = 0.25) {
  const { img: s } = downscale(g, 700);
  const bin = adaptiveBinary(s, 31, 0.75);
  const pts = [];
  for (let y = 0; y < s.h; y += 1) for (let x = 0; x < s.w; x += 2) if (bin[y * s.w + x]) pts.push(x, y);
  if (pts.length < 200) return 0;
  let best = 0, bestScore = -1;
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += step) {
    const t = a * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t);
    const bins = new Float64Array(s.h * 2 + 10);
    for (let i = 0; i < pts.length; i += 2) {
      const yy = Math.round(-pts[i] * sn + pts[i + 1] * c + s.h / 2);
      if (yy >= 0 && yy < bins.length) bins[yy]++;
    }
    let score = 0;
    for (let i = 0; i < bins.length; i++) score += bins[i] * bins[i];
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return Math.round(best * 100) / 100;
}
