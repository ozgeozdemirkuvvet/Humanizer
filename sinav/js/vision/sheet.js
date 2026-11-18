// Kırmızı Kalem cevap kağıdı: yerleşim (geometri) ve yazdırılabilir SVG.
// Aynı yerleşim fonksiyonu hem kağıdı çizer hem de taranan kağıdı okur. Bu yüzden basılan
// kağıt ile okuyucu arasında konum uyuşmazlığı oluşamaz.
//
// Kanonik koordinatlar: A4 @150 dpi = 1240 × 1754 px.

import { optionLetters } from '../core/codes.js';
import { examFingerprint } from '../core/exam.js';

export const PAGE_W = 1240, PAGE_H = 1754;
export const FID = 44; // köşe işaretçisi kenarı
export const FIDUCIALS = [ // merkezler: sol üst, sağ üst, sağ alt, sol alt
  { x: 36 + FID / 2, y: 36 + FID / 2 },
  { x: PAGE_W - 36 - FID / 2, y: 36 + FID / 2 },
  { x: PAGE_W - 36 - FID / 2, y: PAGE_H - 36 - FID / 2 },
  { x: 36 + FID / 2, y: PAGE_H - 36 - FID / 2 }
];
export const ORIENT_BAR = { x: 520, y: 40, w: 200, h: 20 }; // yalnızca üstte: yön tespiti
export const CODE_BITS = Array.from({ length: 8 }, (_, i) => ({ x: 140 + i * 46, y: 1690, w: 18, h: 18 }));
export const NUMBER_GRID = { cols: 4, x0: 930, dx: 58, y0: 176, dy: 27, r: 10 };
export const BUBBLE_R = 11;
const MARGIN_X = 90, CONTENT_TOP = 470, CONTENT_BOTTOM = 1650;
const LINE_H = 50, MC_ROW = 34, MC_DX = 36, GAP_H = 64;

/**
 * Sınavın cevap kağıdı yerleşimi.
 * @returns {{pages: {index:number, bubbles:object[], boxes:object[], writing:object[], labels:object[]}[], fingerprint:number}}
 */
export function layoutSheet(exam) {
  const pages = [];
  let page = newPage(1);
  pages.push(page);
  let y = CONTENT_TOP;
  const next = () => { page = newPage(pages.length + 1); pages.push(page); y = CONTENT_TOP; };

  // 1) Baloncuklu sorular: sütun sütun (yukarıdan aşağı), 4 sütun
  const closed = exam.questions.filter(q => ['mc', 'tf', 'match'].includes(q.type));
  if (closed.length) {
    const cols = 4, colW = (PAGE_W - 2 * MARGIN_X) / cols;
    let remaining = [...closed];
    while (remaining.length) {
      const rowsFit = Math.max(1, Math.floor((CONTENT_BOTTOM - y - 40) / MC_ROW));
      if (rowsFit < 3 && y > CONTENT_TOP) { next(); continue; }
      const perPage = rowsFit * cols;
      const chunk = remaining.slice(0, perPage);
      remaining = remaining.slice(perPage);
      const rows = Math.ceil(chunk.length / cols);
      page.labels.push({ kind: 'section', x: MARGIN_X, y: y + 22, text: 'Çoktan seçmeli · Doğru/Yanlış · Eşleştirme' });
      y += 40;
      chunk.forEach((q, i) => {
        const c = Math.floor(i / rows), r = i % rows;
        const x0 = MARGIN_X + c * colW, cy = y + r * MC_ROW + MC_ROW / 2;
        page.labels.push({ kind: 'qno', x: x0 + 40, y: cy + 6, text: `${q.no}.`, anchor: 'end' });
        optionLetters(q).forEach((opt, k) => {
          page.bubbles.push({ questionId: q.id, option: opt, cx: x0 + 62 + k * MC_DX, cy, r: BUBBLE_R });
        });
      });
      y += rows * MC_ROW + 24;
      if (remaining.length) next();
    }
  }

  // 2) Kısa cevap kutuları: iki sütun
  const gaps = exam.questions.filter(q => q.type === 'gap');
  if (gaps.length) {
    if (y + 40 + GAP_H > CONTENT_BOTTOM) next();
    page.labels.push({ kind: 'section', x: MARGIN_X, y: y + 22, text: 'Boşluk doldurma / kısa cevap' });
    y += 40;
    const w = (PAGE_W - 2 * MARGIN_X - 20) / 2;
    for (let i = 0; i < gaps.length; i += 2) {
      if (y + GAP_H > CONTENT_BOTTOM) { next(); }
      for (let k = 0; k < 2 && i + k < gaps.length; k++) {
        const q = gaps[i + k];
        const x = MARGIN_X + k * (w + 20);
        page.boxes.push({ questionId: q.id, x, y, w, h: GAP_H });
        page.labels.push({ kind: 'boxno', x: x + 8, y: y + 18, text: `${q.no}.` });
      }
      y += GAP_H + 16;
    }
    y += 8;
  }

  // 3) Writing: numaralı satırlar; sığmazsa sonraki sayfada devam eder (numaralar sürer)
  for (const q of exam.questions.filter(x => x.type === 'writing')) {
    let left = Math.max(1, Number(q.lines) || 16);
    let n = 1;
    if (CONTENT_BOTTOM - y < 40 + LINE_H * 4) next();
    page.labels.push({ kind: 'section', x: MARGIN_X, y: y + 22, text: `${q.no}. Writing` + (q.minWords ? ` (${q.minWords}–${q.maxWords || '…'} kelime)` : '') });
    y += 40;
    while (left > 0) {
      let fit = Math.floor((CONTENT_BOTTOM - y) / LINE_H);
      if (fit < 2) { next(); page.labels.push({ kind: 'section', x: MARGIN_X, y: y + 22, text: `${q.no}. Writing (devam)` }); y += 40; fit = Math.floor((CONTENT_BOTTOM - y) / LINE_H); }
      const count = Math.min(left, fit);
      const rect = { x: MARGIN_X, y, w: PAGE_W - 2 * MARGIN_X, h: count * LINE_H };
      const lines = Array.from({ length: count }, (_, i) => ({ n: n + i, y0: y + i * LINE_H, y1: y + (i + 1) * LINE_H }));
      page.writing.push({ questionId: q.id, rect, firstLine: n, lines });
      n += count; left -= count; y += count * LINE_H + 20;
    }
  }
  return { pages, fingerprint: examFingerprint(exam) };
}

function newPage(index) { return { index, bubbles: [], boxes: [], writing: [], labels: [] }; }

/** Alt şerit bitleri: 0–1 = sayfa (1–4), 2–7 = sınav parmak izi. */
export function codeBits(pageIndex, fingerprint) {
  const v = ((pageIndex - 1) & 3) | ((fingerprint & 63) << 2);
  return Array.from({ length: 8 }, (_, i) => (v >> i) & 1);
}
export function decodeBits(bits) {
  const v = bits.reduce((a, b, i) => a | ((b ? 1 : 0) << i), 0);
  return { page: (v & 3) + 1, fingerprint: v >> 2 };
}

/** Sorunun sayfadaki konumları (hata işaretleri için). */
export function answerBoxFinder(layout) {
  return (qid, option) => {
    for (const p of layout.pages) {
      if (option) {
        const b = p.bubbles.find(x => x.questionId === qid && x.option === option);
        if (b) return { page: p.index, x: b.cx - b.r - 4, y: b.cy - b.r - 4, w: 2 * b.r + 8, h: 2 * b.r + 8, shape: 'circle' };
      } else {
        const bs = p.bubbles.filter(x => x.questionId === qid);
        if (bs.length) {
          const x0 = Math.min(...bs.map(b => b.cx - b.r)), x1 = Math.max(...bs.map(b => b.cx + b.r));
          return { page: p.index, x: x0 - 6, y: bs[0].cy - bs[0].r - 6, w: x1 - x0 + 12, h: 2 * bs[0].r + 12 };
        }
        const box = p.boxes.find(x => x.questionId === qid);
        if (box) return { page: p.index, x: box.x, y: box.y, w: box.w, h: box.h };
      }
    }
    return null;
  };
}

/** Writing satır bantları (bir soru birden fazla sayfaya yayılabilir). */
export function lineBandsFinder(layout) {
  return qid => layout.pages.flatMap(p => p.writing.filter(w => w.questionId === qid).flatMap(w => w.lines.map(l => ({ ...l, page: p.index }))));
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Yazdırılabilir SVG (A4). `fill` testler için: {questionId: 'B'} ya da {number:'1234'} baloncukları doldurur.
 * @param {object} exam
 * @param {object} layout
 * @param {number} pageIndex 1 tabanlı
 * @param {{fill?:Record<string,string|string[]>, number?:string, className?:string}} [opts]
 */
export function renderSheetSVG(exam, layout, pageIndex, opts = {}) {
  const p = layout.pages[pageIndex - 1];
  const ink = '#111', faint = '#9a9a9a', line = '#b9b9b9';
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" width="210mm" height="297mm" font-family="Helvetica, Arial, sans-serif" class="sheet-page">`);
  o.push(`<rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>`);
  for (const f of FIDUCIALS) o.push(`<rect x="${f.x - FID / 2}" y="${f.y - FID / 2}" width="${FID}" height="${FID}" fill="${ink}"/>`);
  o.push(`<rect x="${ORIENT_BAR.x}" y="${ORIENT_BAR.y}" width="${ORIENT_BAR.w}" height="${ORIENT_BAR.h}" fill="${ink}"/>`);
  codeBits(pageIndex, layout.fingerprint).forEach((b, i) => {
    const c = CODE_BITS[i];
    o.push(b ? `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${ink}"/>` : `<rect x="${c.x + 0.5}" y="${c.y + 0.5}" width="${c.w - 1}" height="${c.h - 1}" fill="none" stroke="${line}" stroke-width="1"/>`);
  });
  // Başlık
  o.push(`<text x="${MARGIN_X}" y="100" font-size="15" fill="${faint}">Kırmızı Kalem · Sayfa ${pageIndex}/${layout.pages.length} · Kağıdı katlamayın, köşe karelerinin üstüne yazmayın.</text>`);
  o.push(`<text x="${MARGIN_X}" y="132" font-size="17" fill="${ink}">Adı Soyadı</text><rect x="${MARGIN_X}" y="140" width="740" height="56" fill="none" stroke="${ink}" stroke-width="1.5" rx="6"/>`);
  o.push(`<text x="${MARGIN_X}" y="230" font-size="17" fill="${ink}">Sınıfı</text><rect x="${MARGIN_X}" y="238" width="240" height="48" fill="none" stroke="${ink}" stroke-width="1.5" rx="6"/>`);
  if (opts.className) o.push(`<text x="${MARGIN_X + 14}" y="272" font-size="22" fill="${ink}">${esc(opts.className)}</text>`);
  o.push(`<text x="${MARGIN_X}" y="330" font-size="24" font-weight="700" fill="${ink}">${esc(exam.name)}</text>`);
  o.push(`<text x="${MARGIN_X}" y="362" font-size="16" fill="#444">${esc([exam.className, exam.cefr && `Hedef seviye ${exam.cefr}`].filter(Boolean).join(' · '))}</text>`);
  o.push(`<text x="${MARGIN_X}" y="398" font-size="15" fill="#444">Baloncukları koyu kalemle tamamen doldurun; değiştirmek için iyice silin.</text>`);
  o.push(`<text x="${MARGIN_X}" y="420" font-size="15" fill="#444">Okul numaranızı sağdaki tabloya soldan başlayarak işaretleyin.</text>`);
  // Numara tablosu
  const g = NUMBER_GRID;
  o.push(`<text x="${g.x0 - 20}" y="132" font-size="17" fill="${ink}">Okul No</text>`);
  o.push(`<rect x="${g.x0 - 30}" y="112" width="${g.cols * g.dx + 30}" height="${g.y0 + 9 * g.dy + 22 - 112}" fill="none" stroke="${ink}" stroke-width="1.5" rx="6"/>`);
  const num = String(opts.number ?? '');
  for (let c = 0; c < g.cols; c++) {
    const cx = g.x0 + c * g.dx;
    o.push(`<rect x="${cx - 18}" y="140" width="36" height="24" fill="none" stroke="${line}"/>`);
    if (num[c]) o.push(`<text x="${cx}" y="159" font-size="18" text-anchor="middle" fill="${ink}">${num[c]}</text>`);
    for (let v = 0; v < 10; v++) {
      const cy = g.y0 + v * g.dy;
      const filled = num[c] === String(v);
      o.push(bubble(cx, cy, g.r, String(v), filled));
    }
  }
  // İçerik
  for (const l of p.labels) {
    if (l.kind === 'section') o.push(`<text x="${l.x}" y="${l.y}" font-size="18" font-weight="700" fill="${ink}">${esc(l.text)}</text>`);
    else if (l.kind === 'qno') o.push(`<text x="${l.x}" y="${l.y}" font-size="17" text-anchor="end" fill="${ink}">${esc(l.text)}</text>`);
    else if (l.kind === 'boxno') o.push(`<text x="${l.x}" y="${l.y}" font-size="15" fill="#555">${esc(l.text)}</text>`);
  }
  const fill = opts.fill || {};
  for (const b of p.bubbles) {
    const f = fill[b.questionId];
    const filled = Array.isArray(f) ? f.includes(b.option) : f === b.option;
    o.push(bubble(b.cx, b.cy, b.r, b.option, filled));
  }
  for (const b of p.boxes) o.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${ink}" stroke-width="1.2" rx="6"/>`);
  for (const w of p.writing) {
    o.push(`<rect x="${w.rect.x}" y="${w.rect.y}" width="${w.rect.w}" height="${w.rect.h}" fill="none" stroke="${line}" stroke-width="1"/>`);
    for (const l of w.lines) {
      o.push(`<line x1="${w.rect.x + 50}" y1="${l.y1 - 6}" x2="${w.rect.x + w.rect.w - 10}" y2="${l.y1 - 6}" stroke="${line}" stroke-width="1"/>`);
      o.push(`<text x="${w.rect.x + 36}" y="${l.y1 - 10}" font-size="14" text-anchor="end" fill="${faint}">${l.n}</text>`);
    }
  }
  o.push('</svg>');
  return o.join('');
}

function bubble(cx, cy, r, label, filled) {
  return filled
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#1a1a1a"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#333" stroke-width="1.3"/><text x="${cx}" y="${cy + 4}" font-size="11" text-anchor="middle" fill="#c4c4c4">${label}</text>`;
}
