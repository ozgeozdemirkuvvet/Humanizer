// Optik okuma: düzleştirilmiş kanonik sayfada baloncukların koyuluğu ölçülür.
// Yerel ve deterministik çalışır; kapalı uçlu sorularda görüntü hiçbir yere gönderilmez.

import { meanDisk, meanRect, paperWhite } from './imgops.js';
import { NUMBER_GRID, CODE_BITS, decodeBits } from './sheet.js';

// Eşikler (0 = beyaz, 1 = tamamen siyah). Sentetik test kümesiyle ayarlandı; bkz. tests/omr.test.mjs
export const T_MARK = 0.30;  // bunun üstü "işaretli" sayılabilir
export const T_BLANK = 0.16; // bunun altı kesin boş
const INNER = 0.62;          // baskılı halkayı dışarıda bırakmak için iç yarıçap oranı

/**
 * Bir baloncuğun koyuluğu (0–1). Beyaz referansı baloncuğun hemen çevresindeki halkadan alınır
 * (80. yüzdelik): gölgeli bölgedeki boş baloncuk koyu sayılmaz, taşan karalama referansı bozmaz.
 */
export function darkness(g, cx, cy, r, white) {
  const local = annulusPercentile(g, cx, cy, r * 1.35, r * 1.7, 0.8);
  const ref = Math.max(40, Math.min(white, local ?? white));
  return Math.max(0, 1 - meanDisk(g, cx, cy, r * INNER) / ref);
}

function annulusPercentile(g, cx, cy, r0, r1, pct) {
  const vals = [];
  for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++) {
    if (y < 0 || y >= g.h) continue;
    for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++) {
      if (x < 0 || x >= g.w) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= r0 && d <= r1) vals.push(g.d[y * g.w + x]);
    }
  }
  if (vals.length < 8) return null;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * pct)];
}

/**
 * Bir sorunun seçenek koyuluklarından karar.
 * @param {{option:string, d:number}[]} opts
 * @returns {{value:string|null, state:'isaretli'|'bos'|'coklu'|'belirsiz', confidence:number, marked:string[], levels:number[]}}
 */
export function decide(opts) {
  const s = [...opts].sort((a, b) => b.d - a.d);
  const d1 = s[0]?.d ?? 0, d2 = s[1]?.d ?? 0;
  const levels = opts.map(o => round3(o.d));
  const marked = s.filter(o => o.d >= T_MARK && o.d >= d1 * 0.62).map(o => o.option);
  if (d1 < T_BLANK) return { value: null, state: 'bos', confidence: round3(1 - d1 / T_BLANK * 0.4), marked: [], levels };
  if (marked.length > 1) return { value: null, state: 'coklu', confidence: round3(Math.min(1, 0.5 + (d2 - T_MARK) * 2)), marked, levels };
  if (d1 >= T_MARK) {
    const margin = d1 - d2;
    const conf = Math.min(1, 0.55 + margin * 1.2);
    return { value: s[0].option, state: conf >= 0.75 ? 'isaretli' : 'belirsiz', confidence: round3(conf), marked: [s[0].option], levels };
  }
  // T_BLANK ≤ d1 < T_MARK: soluk işaret ya da yarım silinmiş → öğretmen kontrolü
  return { value: s[0].option, state: 'belirsiz', confidence: round3(0.35 + (d1 - T_BLANK)), marked: [], levels };
}

const round3 = x => Math.round(x * 1000) / 1000;

/** Sayfadaki tüm baloncuklu soruları okur. */
export function readBubbles(g, page, white = paperWhite(g)) {
  const byQ = new Map();
  for (const b of page.bubbles) {
    if (!byQ.has(b.questionId)) byQ.set(b.questionId, []);
    byQ.get(b.questionId).push({ option: b.option, d: darkness(g, b.cx, b.cy, b.r, white) });
  }
  return [...byQ].map(([questionId, opts]) => ({ questionId, ...decide(opts) }));
}

/** Okul numarası: her sütunda 0–9; boş sütunlar atlanır. Belirsiz sütun numarayı "onay gerekli" yapar. */
export function readNumber(g, white = paperWhite(g)) {
  const G = NUMBER_GRID;
  const digits = [];
  let sure = true;
  for (let c = 0; c < G.cols; c++) {
    const opts = Array.from({ length: 10 }, (_, v) => ({ option: String(v), d: darkness(g, G.x0 + c * G.dx, G.y0 + v * G.dy, G.r, white) }));
    const r = decide(opts);
    if (r.state === 'bos') continue;
    if (r.state !== 'isaretli') sure = false;
    digits.push(r.state === 'coklu' ? '?' : r.value);
  }
  const no = digits.join('').replace(/^0+(?=\d)/, '');
  return { no, confident: sure && !!no && !no.includes('?') };
}

/** Alt şerit: sayfa numarası ve sınav parmak izi. */
export function readCode(g, white = paperWhite(g)) {
  const bits = CODE_BITS.map(c => (1 - meanRect(g, c.x + 3, c.y + 3, c.w - 6, c.h - 6) / white) > 0.5 ? 1 : 0);
  return decodeBits(bits);
}
