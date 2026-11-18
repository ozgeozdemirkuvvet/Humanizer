// Saf görüntü işlemleri (DOM yok): gri ton, küçültme, Otsu, uyarlanır eşik, bağlı bileşenler,
// homografi, perspektif düzeltme, döndürme. Hem tarayıcıda hem Node testlerinde çalışır.
//
// Gri görüntü: { w, h, d: Uint8ClampedArray }  (0 = siyah, 255 = beyaz)
// Renkli görüntü: { w, h, d: Uint8ClampedArray(w*h*4) }  (RGBA, ImageData ile aynı düzen)

export function gray(w, h, fill = 255) {
  const d = new Uint8ClampedArray(w * h);
  if (fill) d.fill(fill);
  return { w, h, d };
}

export function rgbaToGray(img) {
  const { w, h, d } = img;
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return { w, h, d: out };
}

/** Kutu ortalamasıyla küçültme (en uzun kenar ≤ max). */
export function downscale(g, max) {
  const s = Math.max(g.w, g.h) / max;
  if (s <= 1) return { img: g, scale: 1 };
  const w = Math.max(1, Math.round(g.w / s)), h = Math.max(1, Math.round(g.h / s));
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * s), y1 = Math.min(g.h, Math.max(y0 + 1, Math.floor((y + 1) * s)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * s), x1 = Math.min(g.w, Math.max(x0 + 1, Math.floor((x + 1) * s)));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) { const row = yy * g.w; for (let xx = x0; xx < x1; xx++) sum += g.d[row + xx]; }
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return { img: { w, h, d: out }, scale: g.w / w };
}

export function otsu(g) {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.d.length; i++) hist[g.d[i]]++;
  const total = g.d.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; th = t; }
  }
  return th;
}

export function integral(g) {
  const W = g.w + 1;
  const I = new Float64Array(W * (g.h + 1));
  for (let y = 0; y < g.h; y++) {
    let row = 0;
    for (let x = 0; x < g.w; x++) { row += g.d[y * g.w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
  }
  return { I, W };
}
function boxMean(it, x0, y0, x1, y1) {
  const { I, W } = it;
  return (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
}

/** Uyarlanır eşik: piksel, çevresinin ortalamasının `k` katından koyuysa 1 (gölgeye dayanıklı). */
export function adaptiveBinary(g, win, k = 0.7) {
  const it = integral(g);
  const r = Math.max(2, win >> 1);
  const out = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(g.h, y + r + 1);
    for (let x = 0; x < g.w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(g.w, x + r + 1);
      if (g.d[y * g.w + x] < boxMean(it, x0, y0, x1, y1) * k) out[y * g.w + x] = 1;
    }
  }
  return out;
}

/** 4-komşuluklu bağlı bileşenler; her bileşen için kutu, alan ve ağırlık merkezi. */
export function components(bin, w, h, minArea = 4) {
  const label = new Int32Array(w * h);
  const out = [];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || label[i]) continue;
    let sp = 0; stack[sp++] = i; label[i] = next;
    let area = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && bin[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && bin[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && bin[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && bin[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
    }
    if (area >= minArea) out.push({ area, cx: sx / area + 0.5, cy: sy / area + 0.5, x0, y0, x1, y1, bw: x1 - x0 + 1, bh: y1 - y0 + 1 });
    next++;
  }
  return out;
}

/** 4 nokta çiftinden homografi (src → dst). 8×8 doğrusal sistem, kısmi pivotlu Gauss eleme. */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export function applyH(H, x, y) {
  const z = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / z, y: (H[3] * x + H[4] * y + H[5]) / z };
}

export function multiplyH(A, B) {
  const C = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c];
  return C.map(v => v / C[8]);
}

/**
 * Perspektif düzeltme: hedef (sayfa) pikselinden kaynağa H ile gidilir, çift doğrusal örnekleme yapılır.
 * @param {{w,h,d}} src gri ya da RGBA (channels ile)
 * @param {number[]} H sayfa → kaynak
 * @param {{x,y,w,h}} rect sayfa koordinatında çıkış bölgesi
 * @param {number} scale çıkış çözünürlüğü çarpanı
 */
export function warp(src, H, rect, scale = 1, channels = 1) {
  const ow = Math.round(rect.w * scale), oh = Math.round(rect.h * scale);
  const out = new Uint8ClampedArray(ow * oh * channels);
  const sw = src.w, sh = src.h, sd = src.d;
  for (let y = 0; y < oh; y++) {
    const py = rect.y + (y + 0.5) / scale;
    for (let x = 0; x < ow; x++) {
      const px = rect.x + (x + 0.5) / scale;
      const z = H[6] * px + H[7] * py + H[8];
      const fx = (H[0] * px + H[1] * py + H[2]) / z - 0.5;
      const fy = (H[3] * px + H[4] * py + H[5]) / z - 0.5;
      const o = (y * ow + x) * channels;
      if (fx < 0 || fy < 0 || fx > sw - 1 || fy > sh - 1) {
        for (let c = 0; c < channels; c++) out[o + c] = c === 3 ? 255 : 255;
        continue;
      }
      const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      for (let c = 0; c < channels; c++) {
        const a = sd[(y0 * sw + x0) * channels + c], b = sd[(y0 * sw + x1) * channels + c];
        const cc = sd[(y1 * sw + x0) * channels + c], d = sd[(y1 * sw + x1) * channels + c];
        out[o + c] = (a * (1 - ax) + b * ax) * (1 - ay) + (cc * (1 - ax) + d * ax) * ay;
      }
    }
  }
  return { w: ow, h: oh, d: out };
}

/** Merkez etrafında döndürme (derece, saat yönünde pozitif), boyut korunur. */
export function rotate(src, deg, channels = 1) {
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const cx = src.w / 2, cy = src.h / 2;
  // sayfa → kaynak: ters dönme
  const H = [c, s, cx - c * cx - s * cy, -s, c, cy + s * cx - c * cy, 0, 0, 1];
  return warp(src, H, { x: 0, y: 0, w: src.w, h: src.h }, 1, channels);
}

export function crop(src, rect, channels = 1) {
  return warp(src, [1, 0, 0, 0, 1, 0, 0, 0, 1], rect, 1, channels);
}

/** Dairesel bölgenin ortalama gri değeri. */
export function meanDisk(g, cx, cy, r) {
  let s = 0, n = 0;
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    if (y < 0 || y >= g.h) continue;
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || x >= g.w) continue;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) { s += g.d[y * g.w + x]; n++; }
    }
  }
  return n ? s / n : 255;
}

export function meanRect(g, x0, y0, w, h) {
  let s = 0, n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(g.h, Math.ceil(y0 + h)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(g.w, Math.ceil(x0 + w)); x++) { s += g.d[y * g.w + x]; n++; }
  return n ? s / n : 255;
}

/** Kağıt beyazı: parlak piksellerin yüksek yüzdeliği (gölge ve soluk baskıya karşı normalizasyon). */
export function paperWhite(g, pct = 0.9) {
  const hist = new Uint32Array(256);
  const step = Math.max(1, Math.floor(g.d.length / 200000));
  let n = 0;
  for (let i = 0; i < g.d.length; i += step) { hist[g.d[i]]++; n++; }
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * pct) return Math.max(80, v); }
  return 255;
}
