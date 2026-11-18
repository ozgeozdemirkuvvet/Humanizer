// Bir sayfa fotoğrafının yerel işlenmesi (saf; DOM yok):
//   Kırmızı Kalem kağıdı → düzleştir → kod/numara/baloncuk oku → cevap bölgelerini kırp
//   Serbest kağıt        → kırp → eğikliği düzelt → üst bandı kartart → tüm sayfayı bölge yap
// Yapay zekâya giden kırpıntılarda ad, numara ve başlık bölgesi asla bulunmaz.

import { rgbaToGray, warp, crop, rotate, paperWhite } from './imgops.js';
import { detectSheet } from './detect.js';
import { readBubbles, readNumber, readCode } from './omr.js';
import { PAGE_W, PAGE_H } from './sheet.js';
import { paperBounds, estimateSkew } from './freeform.js';

export const AI_SCALE = 2; // yapay zekâ kırpıntıları 300 dpi (el yazısı için)

/**
 * @param {{w,h,d}} rgba fotoğraf (RGBA)
 * @param {object} o
 * @param {object} o.exam
 * @param {object} o.layout layoutSheet(exam)
 * @returns {object} sayfa sonucu
 */
export function processPage(rgba, { exam, layout, redact = true }) {
  const g0 = rgbaToGray(rgba);
  if (exam.sheetMode !== 'serbest') {
    const det = detectSheet(g0);
    if (det.ok) return sheetPage(rgba, det, exam, layout);
    if (exam.sheetMode === 'kirmizikalem') return { ok: false, mode: 'kirmizikalem', reason: det.reason };
  }
  return freePage(rgba, g0, exam, redact);
}

function sheetPage(rgba, det, exam, layout) {
  const display = warp(rgba, det.H, { x: 0, y: 0, w: PAGE_W, h: PAGE_H }, 1, 4);
  const g = rgbaToGray(display);
  const white = paperWhite(g);
  const code = readCode(g, white);
  const examMatch = code.fingerprint === layout.fingerprint;
  const pageIndex = Math.min(layout.pages.length, Math.max(1, code.page));
  const page = layout.pages[pageIndex - 1];
  const number = readNumber(g, white);
  const omr = readBubbles(g, page, white);
  const crops = [];
  for (const b of page.boxes) {
    const rect = { x: b.x, y: b.y, w: b.w, h: b.h };
    crops.push({ regionId: `${b.questionId}-p${pageIndex}`, questionId: b.questionId, kind: 'gap', page: pageIndex, rect, img: warp(rgba, det.H, rect, AI_SCALE, 4) });
  }
  for (const w of page.writing) {
    crops.push({ regionId: `${w.questionId}-p${pageIndex}`, questionId: w.questionId, kind: w.kind || 'writing', page: pageIndex, rect: w.rect, firstLine: w.firstLine, lastLine: w.firstLine + w.lines.length - 1, img: warp(rgba, det.H, w.rect, AI_SCALE, 4) });
  }
  return {
    ok: true, mode: 'kirmizikalem', page: pageIndex, examMatch, rotation: det.rotation,
    number, omr, crops, display, width: PAGE_W, height: PAGE_H,
    warnings: [
      ...(examMatch ? [] : ['Bu kağıt başka bir sınava ait görünüyor (alt şerit uyuşmuyor).']),
      ...(number.confident ? [] : ['Okul numarası net okunamadı; öğretmen onayı gerekli.'])
    ]
  };
}

function freePage(rgba, g0, exam, doRedact = true) {
  const b = paperBounds(g0);
  let img = crop(rgba, b, 4);
  let g = rgbaToGray(img);
  const skew = estimateSkew(g);
  if (Math.abs(skew) >= 0.3) { img = rotate(img, -skew, 4); g = rgbaToGray(img); }
  // Gösterim ve yapay zekâ için genişliği 1240'a ölçekle (yükseklik orantılı)
  const s = PAGE_W / img.w;
  const display = warp(img, [1 / s, 0, 0, 0, 1 / s, 0, 0, 0, 1], { x: 0, y: 0, w: PAGE_W, h: Math.round(img.h * s) }, 1, 4);
  // Ad yalnızca öğrencinin ilk sayfasında yazılır; sonraki sayfalarda karartma soruları silerdi
  const redact = doRedact ? Math.round(display.h * Math.max(0, Math.min(0.5, exam.redactTop ?? 0.15))) : 0;
  const ai = { w: display.w, h: display.h, d: new Uint8ClampedArray(display.d) };
  for (let i = 0; i < redact * ai.w * 4; i += 4) { ai.d[i] = 0; ai.d[i + 1] = 0; ai.d[i + 2] = 0; }
  const rect = { x: 0, y: 0, w: display.w, h: display.h };
  return {
    ok: true, mode: 'serbest', page: null, examMatch: null, skewDeg: skew,
    number: { no: '', confident: false }, omr: [], redactPx: redact,
    crops: [{ regionId: 'page', questionId: null, kind: 'page', page: null, rect, img: ai }],
    display, width: display.w, height: display.h,
    warnings: [redact ? 'Serbest kağıt: öğrenciyi listeden seçin. Ad bölgesi yapay zekâya gönderilmeden karartıldı.' : 'Serbest kağıt: öğrenciyi listeden seçin.']
  };
}
