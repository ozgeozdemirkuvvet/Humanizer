// Optik okuma doğruluk testi: 30 kağıtlık sentetik sınıf (1200 kapalı uçlu cevap).
// Kabul kriteri: öğretmen puanıyla ≥ %98 uyum. Ayrıca numara, sayfa kodu, yön ve süre ölçülür.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSheet, decodeBits, codeBits } from '../js/vision/sheet.js';
import { detectSheet, rectify } from '../js/vision/detect.js';
import { readBubbles, readNumber, readCode, decide } from '../js/vision/omr.js';
import { paperWhite, rotate } from '../js/vision/imgops.js';
import { estimateSkew } from '../js/vision/freeform.js';
import { scoreClosed } from '../js/core/scoring.js';
import { optionLetters } from '../js/core/codes.js';
import { newExam } from '../js/core/exam.js';
import { rasterSheet, photograph, rng } from './synth.mjs';

const exam = newExam({ id: 'omr-test-exam', name: 'OMR Test', questions: [] });
for (let i = 1; i <= 40; i++) {
  const type = i <= 28 ? 'mc' : i <= 34 ? 'tf' : 'match';
  exam.questions.push({ id: `q${i}`, no: i, type, points: 2.5, options: type === 'mc' ? (i % 2 ? 4 : 5) : 5, key: [] });
}
exam.questions.push({ id: 'g1', no: 41, type: 'gap', points: 5, key: ['went'] });
exam.questions.push({ id: 'w1', no: 42, type: 'writing', points: 20, lines: 6, rubric: { TA: 1, CC: 1, LR: 1, GRA: 1 } });
const layout = layoutSheet(exam);
const KINDS = [['full', 0.70], ['light', 0.08], ['small', 0.07], ['x', 0.05], ['erased', 0.05], ['blank', 0.03], ['double', 0.02]];
function pickKind(r) { const u = r(); let acc = 0; for (const [k, p] of KINDS) { acc += p; if (u < acc) return k; } return 'full'; }

test('kağıt yerleşimi: tek sayfa, 40 soru baloncuğu, kod şeridi çift yönlü', () => {
  assert.equal(layout.pages.length, 1);
  assert.equal(new Set(layout.pages[0].bubbles.map(b => b.questionId)).size, 40);
  assert.equal(layout.pages[0].writing[0].lines.length, 6);
  const bits = codeBits(1, 37);
  assert.deepEqual(decodeBits(bits), { page: 1, fingerprint: 37 });
});

test('karar kuralı: dolu, boş, çoklu, soluk', () => {
  assert.equal(decide([{ option: 'A', d: 0.05 }, { option: 'B', d: 0.8 }]).value, 'B');
  assert.equal(decide([{ option: 'A', d: 0.05 }, { option: 'B', d: 0.06 }]).state, 'bos');
  assert.equal(decide([{ option: 'A', d: 0.7 }, { option: 'B', d: 0.75 }]).state, 'coklu');
  assert.equal(decide([{ option: 'A', d: 0.2 }, { option: 'B', d: 0.04 }]).state, 'belirsiz');
});

test('30 kağıtlık sentetik sınıf: kapalı uçlu sorularda öğretmen puanıyla ≥ %98 uyum', () => {
  const N = Number(process.env.OMR_PAPERS || 30);
  let agree = 0, total = 0, review = 0, numberOk = 0, codeOk = 0, detected = 0, ms = 0;
  const mistakes = [];
  for (let p = 0; p < N; p++) {
    const r = rng(1000 + p);
    const marks = [], truth = new Map();
    for (const q of exam.questions.filter(x => x.type !== 'gap' && x.type !== 'writing')) {
      const letters = optionLetters(q);
      q.key = [letters[Math.floor(r() * letters.length)]];
      const kind = pickKind(r);
      const a = letters[Math.floor(r() * letters.length)];
      if (kind === 'blank') { truth.set(q.id, { state: 'bos' }); continue; }
      if (kind === 'double') {
        const b = letters[(letters.indexOf(a) + 1) % letters.length];
        marks.push({ questionId: q.id, option: a, kind: 'full' }, { questionId: q.id, option: b, kind: 'full' });
        truth.set(q.id, { state: 'coklu', marked: [a, b] }); continue;
      }
      if (kind === 'erased') {
        const b = letters[(letters.indexOf(a) + 1) % letters.length];
        marks.push({ questionId: q.id, option: b, kind: 'erased' }, { questionId: q.id, option: a, kind: 'full' });
      } else marks.push({ questionId: q.id, option: a, kind });
      truth.set(q.id, { state: 'isaretli', value: a });
    }
    const number = String(100 + Math.floor(r() * 900));
    const sheet = rasterSheet(layout, 1, { marks, number, k: 1.4, seed: p + 1 });
    const photo = photograph(sheet, {
      seed: p + 1, angle: (r() - 0.5) * 16, rot90: p % 7 === 3 ? 2 : p % 11 === 5 ? 1 : 0,
      persp: 0.035, shadow: 0.25 + r() * 0.25, noise: 8 + r() * 6
    });
    const t0 = performance.now();
    const det = detectSheet(photo);
    if (!det.ok) { mistakes.push(`kağıt ${p}: ${det.reason}`); total += truth.size; continue; }
    detected++;
    const g = rectify(photo, det.H);
    const white = paperWhite(g);
    const omr = readBubbles(g, layout.pages[0], white);
    const num = readNumber(g, white);
    const code = readCode(g, white);
    ms += performance.now() - t0;
    if (num.no === number) numberOk++; else mistakes.push(`kağıt ${p}: numara ${num.no} ≠ ${number}`);
    if (code.page === 1 && code.fingerprint === layout.fingerprint) codeOk++;
    for (const q of exam.questions.filter(x => truth.has(x.id))) {
      total++;
      const t = truth.get(q.id), o = omr.find(x => x.questionId === q.id);
      const teacher = scoreClosed(q, t).earned, auto = scoreClosed(q, o);
      if (auto.needsReview) review++;
      if (teacher === auto.earned) agree++;
      else mistakes.push(`kağıt ${p} S${q.no}: gerçek ${JSON.stringify(t)} okunan ${o.state}/${o.value} [${o.levels}]`);
    }
  }
  const rate = agree / total;
  console.log(`# OMR: ${N} kağıt, ${total} cevap · uyum %${(rate * 100).toFixed(2)} · öğretmen kontrolüne düşen %${(review / total * 100).toFixed(1)} · tespit ${detected}/${N} · numara ${numberOk}/${N} · kod ${codeOk}/${N} · kağıt başına ${(ms / Math.max(1, detected)).toFixed(0)} ms`);
  if (mistakes.length) console.log('# ' + mistakes.slice(0, 12).join('\n# '));
  assert.equal(detected, N, 'her kağıt bulunmalı');
  assert.ok(rate >= 0.98, `uyum %${(rate * 100).toFixed(2)} < %98`);
  assert.ok(numberOk / N >= 0.95);
  assert.equal(codeOk, detected);
});

test('köşe işaretçisi olmayan fotoğraf reddedilir (serbest kağıt akışına düşer)', () => {
  const blank = { w: 800, h: 1100, d: new Uint8ClampedArray(800 * 1100).fill(235) };
  assert.equal(detectSheet(blank).ok, false);
});

test('köşesi kadraj dışında kalan kağıt yanlış okunmaz, yeniden çekim istenir', () => {
  const sheet = rasterSheet(layout, 1, { number: '512', k: 1.2, seed: 9 });
  const photo = photograph(sheet, { seed: 9, offset: [-560, 0], noise: 6 });
  const det = detectSheet(photo);
  if (det.ok) { // tespit edildiyse okunan numara ve kod doğru olmalı
    const g = rectify(photo, det.H);
    assert.equal(readCode(g).fingerprint, layout.fingerprint);
    assert.equal(readNumber(g).no, '512');
  } else assert.match(det.reason, /bulunamadı|doğrulanamadı|belirlenemedi/);
});

test('serbest kağıt: eğiklik ±0,5° içinde bulunur', () => {
  const sheet = rasterSheet(layout, 1, { k: 0.6, seed: 3 });
  const g = { w: sheet.w, h: sheet.h, d: Uint8ClampedArray.from(sheet.d) };
  for (const deg of [-5, 3.5]) {
    const est = estimateSkew(rotate(g, deg));
    assert.ok(Math.abs(est - deg) <= 0.5, `beklenen ${deg}, bulunan ${est}`);
  }
});

test('işleme hattı: kırpıntılar yalnızca cevap bölgeleri (ad/numara başlığı yapay zekâya gitmez)', async () => {
  const { processPage } = await import('../js/vision/pipeline.js');
  const sheet = rasterSheet(layout, 1, { number: '207', k: 1.2, seed: 4, marks: [{ questionId: 'q1', option: 'C', kind: 'full' }] });
  const photo = photograph(sheet, { seed: 4, angle: 4, size: [1600, 2200] });
  const rgba = { w: photo.w, h: photo.h, d: new Uint8ClampedArray(photo.w * photo.h * 4) };
  for (let i = 0; i < photo.d.length; i++) { rgba.d[i * 4] = rgba.d[i * 4 + 1] = rgba.d[i * 4 + 2] = photo.d[i]; rgba.d[i * 4 + 3] = 255; }
  const t0 = performance.now();
  const res = processPage(rgba, { exam: { ...exam, sheetMode: 'kirmizikalem' }, layout });
  const ms = performance.now() - t0;
  assert.equal(res.ok, true);
  assert.equal(res.number.no, '207');
  assert.equal(res.examMatch, true);
  assert.equal(res.omr.find(o => o.questionId === 'q1').value, 'C');
  assert.deepEqual(res.crops.map(c => c.kind), ['gap', 'writing']);
  assert.ok(res.crops.every(c => c.rect.y >= 460), 'başlık bölgesi kırpıntıya girmemeli');
  assert.equal(res.crops[1].img.w, Math.round(res.crops[1].rect.w * 2));
  console.log(`# işleme hattı (düzeltme + OMR + 300 dpi kırpıntılar): ${ms.toFixed(0)} ms`);
  assert.ok(ms < 3000);
});

test('serbest kağıt kırpma: açık renkli masada sayfanın altı kesilmez (gerçek fotoğraflarda bulunan hata)', async () => {
  const { paperBounds } = await import('../js/vision/freeform.js');
  // 1000×1300 fotoğraf: masa 215 (açık bej), kağıt 240, kağıdın alt %25'i gölgede (200), üzerinde yazı
  const W = 1000, H = 1300, d = new Uint8ClampedArray(W * H).fill(215);
  for (let y = 60; y < 1290; y++) for (let x = 80; x < 960; x++) d[y * W + x] = y > 1000 ? 200 : 240;
  for (let y = 1100; y < 1250; y += 30) for (let x = 120; x < 900; x++) d[y * W + x] = 60; // gölgedeki son cevaplar
  const b = paperBounds({ w: W, h: H, d });
  assert.ok(b.y + b.h >= 1250, `alt sınır ${b.y + b.h}: son cevap satırları kesilmemeli`);
  // Koyu masada ise kenarlar kırpılır
  const d2 = new Uint8ClampedArray(W * H).fill(60);
  for (let y = 100; y < 1200; y++) for (let x = 100; x < 900; x++) d2[y * W + x] = 235;
  const b2 = paperBounds({ w: W, h: H, d: d2 });
  assert.ok(b2.x > 60 && b2.y > 60 && b2.x + b2.w < 940 && b2.y + b2.h < 1240, JSON.stringify(b2));
});
