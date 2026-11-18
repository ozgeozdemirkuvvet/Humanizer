// Serbest (öğretmenin kendi hazırladığı) kağıtlar: kağıdı arka plandan ayırıp kırpma ve
// izdüşüm profiliyle eğiklik düzeltme. Köşe işaretçisi olmadığı için perspektif düzeltilmez,
// yalnızca döndürme yapılır; öğretmene "kağıdı dik çekin" uyarısı gösterilir.

import { downscale, adaptiveBinary } from './imgops.js';

/**
 * Kağıt bölgesi: yalnızca kenarlardaki belirgin biçimde koyu bantlar (masa, gölge) kırpılır.
 * İlkesi: şüphede kırpma. Açık renkli masada kırpılmayan bir şerit zararsızdır; kesilen bir
 * cevap satırı ise geri gelmez. (Gerçek kağıt fotoğraflarıyla bulunan hata: Otsu tabanlı ilk
 * sürüm, açık renkli masada sayfanın altındaki soruları kesiyordu.)
 */
export function paperBounds(g) {
  const { img: s, scale } = downscale(g, 600);
  const rowMean = new Float32Array(s.h), colMean = new Float32Array(s.w);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const v = s.d[y * s.w + x]; rowMean[y] += v / s.w; colMean[x] += v / s.h; }
  const white = Math.max(percentile(rowMean, 0.9), percentile(colMean, 0.9));
  const dark = v => v < white * 0.62;
  let y0 = 0, y1 = s.h - 1, x0 = 0, x1 = s.w - 1;
  while (y0 < s.h / 3 && dark(rowMean[y0])) y0++;
  while (y1 > s.h * 2 / 3 && dark(rowMean[y1])) y1--;
  while (x0 < s.w / 3 && dark(colMean[x0])) x0++;
  while (x1 > s.w * 2 / 3 && dark(colMean[x1])) x1--;
  const m = Math.round(Math.min(s.w, s.h) * 0.015); // güvenlik payı
  y0 = Math.max(0, y0 - m); x0 = Math.max(0, x0 - m); y1 = Math.min(s.h - 1, y1 + m); x1 = Math.min(s.w - 1, x1 + m);
  return { x: x0 * scale, y: y0 * scale, w: Math.min(g.w - x0 * scale, (x1 - x0 + 1) * scale), h: Math.min(g.h - y0 * scale, (y1 - y0 + 1) * scale) };
}

function percentile(arr, p) { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; }

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
