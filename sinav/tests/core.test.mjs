// Çekirdek mantık birim testleri: puanlama, yazım toleransı, hata konumu, tekrar birleştirme,
// hata tablosu, e-Okul CSV, sınıf listesi, sınav doğrulama ve uçtan uca birleştirme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnswer, editDistance, scoreClosed, scoreGap, scoreWriting, totals, countWords } from '../js/core/scoring.js';
import { rubricPoints, rubricPromptText } from '../js/core/rubric.js';
import { locateQuote, lineLayout, spanBox, anchorError, groupRecurring, recurrenceText, errorTable, errorTableMarkdown, numberErrors, missingFields, impactText } from '../js/core/errors.js';
import { eOkulCSV, parseRoster, parseCSV, pseudonym } from '../js/core/csv.js';
import { validateExam, newExam, examFingerprint } from '../js/core/exam.js';
import { assemble, enforceIllegible } from '../js/core/assemble.js';
import { codeLabel, markTone } from '../js/core/codes.js';

const W = (t, c = 0.95, x = 0) => ({ text: t, confidence: c, box: [x, 100, x + 80, 300] });
const line = (n, s) => ({ n, words: s.split(' ').map((t, i) => W(t, 0.95, i * 100)) });

test('normalleştirme: büyük/küçük harf, akıllı tırnak, boşluk, sondaki nokta', () => {
  assert.equal(normalizeAnswer('  Don’t   go. '), "don't go");
  assert.equal(normalizeAnswer('"WENT"'), 'went');
});

test('Damerau-Levenshtein: harf yer değiştirmesi tek işlem', () => {
  assert.equal(editDistance('recieve', 'receive'), 1);
  assert.equal(editDistance('went', 'want'), 1);
  assert.equal(editDistance('', 'abc'), 3);
});

test('kapalı uçlu: doğru, yanlış, boş, çoklu, belirsiz', () => {
  const q = { id: 'q1', no: 1, type: 'mc', points: 4, options: 4, key: ['B'] };
  assert.equal(scoreClosed(q, { state: 'isaretli', value: 'B', confidence: 0.99 }).earned, 4);
  const wrong = scoreClosed(q, { state: 'isaretli', value: 'c', confidence: 0.99 });
  assert.equal(wrong.earned, 0);
  assert.match(wrong.reason, /İşaretlenen: C · Anahtar: B/);
  assert.equal(scoreClosed(q, { state: 'bos' }).earned, 0);
  const multi = scoreClosed(q, { state: 'coklu', marked: ['A', 'B'] });
  assert.equal(multi.earned, 0);
  assert.equal(multi.needsReview, true);
  assert.equal(scoreClosed(q, { state: 'belirsiz', value: 'B', confidence: 0.6 }).needsReview, true);
});

test('boşluk doldurma: alternatif cevap, katı ve esnek yazım', () => {
  const q = { id: 'q4', no: 4, type: 'gap', points: 4, key: ['went'], alternatives: ['had gone'] };
  assert.equal(scoreGap(q, { text: 'Went.', confidence: 0.9 }, 'katı').score.earned, 4);
  assert.equal(scoreGap(q, { text: 'had  gone', confidence: 0.9 }, 'katı').score.earned, 4);
  // "wnet" → went: katı modda yanlış, esnek modda kabul + Sp kaydı
  assert.equal(scoreGap(q, { text: 'wnet', confidence: 0.9 }, 'katı').score.earned, 0);
  const flex = scoreGap(q, { text: 'wnet', confidence: 0.9 }, 'esnek');
  assert.equal(flex.score.earned, 4);
  assert.equal(flex.match.kind, 'yazim');
  // 3 harflik kelimede tolerans yok: "goes"/"go" gibi anlam farkları puan alamaz
  const q2 = { id: 'q', no: 2, type: 'gap', points: 2, key: ['sit'] };
  assert.equal(scoreGap(q2, { text: 'set', confidence: 0.9 }, 'esnek').score.earned, 0);
  // okunamayan cevap tahmin edilmez ve öğretmen kontrolüne düşer
  const ill = scoreGap(q, { text: '[okunamadı]', confidence: 0.2, illegible: true }, 'esnek');
  assert.equal(ill.score.earned, 0);
  assert.equal(ill.score.needsReview, true);
});

test('writing: rubrik puanı ağırlıklı ve 0,5’e yuvarlanır; gerekçesiz bant öğretmen kontrolü ister', () => {
  const bands = [{ criterion: 'TA', band: 4 }, { criterion: 'CC', band: 3 }, { criterion: 'LR', band: 3 }, { criterion: 'GRA', band: 2 }];
  assert.equal(rubricPoints(bands, { TA: 1, CC: 1, LR: 1, GRA: 1 }, 30), 18);
  assert.equal(rubricPoints(bands, { TA: 2, CC: 1, LR: 1, GRA: 1 }, 30), 19); // 30 × (8+3+3+2)/25 = 19,2 → 19
  const q = { id: 'w', type: 'writing', points: 30, rubric: { TA: 1, CC: 1, LR: 1, GRA: 1 }, minWords: 80 };
  const s = scoreWriting(q, bands.map(b => ({ ...b, justification: 'ok' })), { words: 60 });
  assert.equal(s.earned, 18);
  assert.match(s.reason, /60 kelime \(en az 80 istendi\)/);
  assert.equal(s.needsReview, false);
  assert.equal(scoreWriting(q, bands, { words: 90 }).needsReview, true);
  assert.match(rubricPromptText('A2'), /CEFR A2/);
});

test('toplam: 100’e ölçekleme ve yarım yukarı yuvarlama', () => {
  const exam = { questions: [{ id: 'a', points: 30 }, { id: 'b', points: 10 }] };
  assert.deepEqual(totals(exam, [{ questionId: 'a', earned: 27 }, { questionId: 'b', earned: 0 }]), { earned: 27, max: 40, grade100: 68 }); // 67,5 → 68
  assert.equal(countWords("I don't like it [okunamadı] much."), 6);
});

test('alıntı konumu: birebir, harf duyarsız, kenar noktalaması, kaçıncı geçiş', () => {
  const t = 'She go to school and she go home.';
  assert.deepEqual(locateQuote(t, 'go'), { start: 4, end: 6 });
  assert.deepEqual(locateQuote(t, 'go', 2), { start: 25, end: 27 });
  assert.deepEqual(locateQuote(t, 'SHE GO'), { start: 0, end: 6 });
  assert.deepEqual(locateQuote(t, 'home.'), { start: 28, end: 33 });
  assert.equal(locateQuote(t, 'went'), null);
});

test('hata kağıda bağlanır: kelime kutusu sayfa koordinatına çevrilir; bulunamayan alıntı gri olur', () => {
  const region = { rect: { x: 100, y: 1000, w: 1000, h: 500 }, lines: [line(1, 'Yesterday she go to school')] };
  const { text } = lineLayout(region.lines[0].words);
  assert.equal(text, 'Yesterday she go to school');
  assert.deepEqual(spanBox(region.lines[0].words, locateQuote(text, 'go')), [200, 100, 280, 300]);
  const e = anchorError({ line: 1, quote: 'go', code: 'T' }, region);
  assert.deepEqual(e.box, { x: 300, y: 1050, w: 80, h: 100 });
  const bad = anchorError({ line: 1, quote: 'went', code: 'T' }, region);
  assert.equal(bad.certain, false);
  assert.match(bad.uncertainReason, /bulunamadı/);
  assert.equal(markTone(bad), 'gray');
});

test('tekrarlayan hatalar: hepsi işaretlenir, açıklama bir kez yapılır ve özetlenir', () => {
  const exam = { questions: [{ id: 'w', no: 5 }] };
  const errs = numberErrors([9, 2, 7, 5].map(l => ({ questionId: 'w', line: l, quote: 'go', correction: 'went', code: 'T', ruleId: 'past', severity: 'bozmuyor', impact: { kind: 'rubric', criterion: 'GRA' } })), exam);
  assert.deepEqual(errs.map(e => e.line), [2, 5, 7, 9]);
  const g = groupRecurring(errs).get('past');
  assert.equal(recurrenceText(g), 'Bu hata kağıtta 4 kez geçiyor (Satır 2, 5, 7, 9)');
  const rows = errorTable({ errors: errs, rules: [{ ruleId: 'past', explanation: "'yesterday' geçmiş zamanı gösterir." }] }, exam);
  assert.match(rows[0].explanation, /geçmiş zamanı gösterir.*4 kez geçiyor/);
  assert.equal(rows[1].explanation, 'Bkz. hata 1');
  assert.equal(rows[0].where, 'S5 / Satır 2');
  assert.equal(rows[0].type, 'T = Zaman (Tense) hatası');
  assert.equal(rows[0].impact, 'GRA (Dilbilgisi çeşitliliği ve doğruluğu) ölçütünü etkiliyor');
  const md = errorTableMarkdown(rows);
  assert.match(md, /^\| No \| Soru\/Satır \| Yazılan \| Doğrusu \| Tür \| Açıklama \| Puan etkisi \|/);
  assert.equal(md.split('\n').length, 6);
});

test('eksiksizlik denetimi: açıklaması ya da doğru biçimi olmayan hata yakalanır', () => {
  const e = { questionId: 'w', line: 1, quote: 'go', code: 'T', severity: 'bozuyor', ruleId: 'x' };
  assert.deepEqual(missingFields(e, []), ['doğru biçim', 'açıklama']);
  assert.deepEqual(missingFields({ ...e, correction: 'went' }, [{ ruleId: 'x', explanation: 'kural' }]), []);
  assert.equal(impactText({ impact: { kind: 'points', points: -2.5 } }), '−2,5 puan');
  assert.equal(codeLabel('^', 'en'), '^ = Missing word error');
});

test('okunamayan kelime tahmin edilmez: güven < 0,5 → [okunamadı], tahmin ayrı saklanır', () => {
  const r = enforceIllegible({ lines: [{ n: 1, words: [{ text: 'beach', confidence: 0.3 }, { text: 'sea', confidence: 0.9 }] }] });
  assert.equal(r.lines[0].words[0].text, '[okunamadı]');
  assert.equal(r.lines[0].words[0].guess, 'beach');
  assert.equal(r.lines[0].words[1].text, 'sea');
});

test('e-Okul CSV: BOM, ";" ayraç, numara sırası, yalnızca onaylılar, formül enjeksiyonu koruması', () => {
  const papers = [
    { status: 'onaylandi', student: { no: '12', name: 'Şule Öz' }, total: { grade100: 85 } },
    { status: 'onaylandi', student: { no: '3', name: '=HACK()' }, total: { grade100: 40 } },
    { status: 'degerlendirildi', student: { no: '5', name: 'Ali' }, total: { grade100: 70 } }
  ];
  const { csv, skipped } = eOkulCSV({}, papers);
  assert.ok(csv.startsWith('﻿Okul No;Adı Soyadı;Not\r\n'));
  assert.equal(csv, "﻿Okul No;Adı Soyadı;Not\r\n3;'=HACK();40\r\n12;Şule Öz;85\r\n");
  assert.equal(skipped.length, 1);
});

test('sınıf listesi: başlıklı/başlıksız, ";" ya da ",", baştaki sıfır, tekrar', () => {
  assert.deepEqual(parseRoster('Okul No;Adı Soyadı\n0012;Şule Öz\n7;"Kaya, Emre"\n7;Tekrar'), [{ no: '12', name: 'Şule Öz' }, { no: '7', name: 'Kaya, Emre' }]);
  assert.deepEqual(parseRoster('Ayşe Yılmaz,101\nCan Demir,102'), [{ no: '101', name: 'Ayşe Yılmaz' }, { no: '102', name: 'Can Demir' }]);
  assert.equal(parseCSV('a;"b""c"\r\n').at(0)[1], 'b"c');
  assert.equal(pseudonym('102', [{ no: '101' }, { no: '102' }]), 'Öğrenci 02');
});

test('sınav doğrulama: anahtar, seçenek, puan, rubrik, toplam uyarısı', () => {
  const ex = newExam({ name: 'Deneme', questions: [
    { id: 'a', no: 1, type: 'mc', points: 50, options: 4, key: ['E'] },
    { id: 'b', no: 1, type: 'writing', points: 40, rubric: { TA: 0, CC: 0, LR: 0, GRA: 0 } }
  ] });
  const v = validateExam(ex);
  assert.ok(v.errors.some(e => /geçerli bir seçenek değil/.test(e)));
  assert.ok(v.errors.some(e => /tekrar ediyor/.test(e)));
  assert.ok(v.errors.some(e => /rubrik/.test(e)));
  assert.ok(v.warnings.some(w => /100'e ölçeklenecek/.test(w)));
  const fp = examFingerprint(ex);
  assert.ok(fp >= 0 && fp < 64);
  assert.equal(fp, examFingerprint(ex));
});

test('birleştirme: OMR + boşluk + writing → numaralı hatalar, kurallar, öneriler, toplam', () => {
  const exam = newExam({ name: 'X', cefr: 'A2', spelling: 'esnek', questions: [
    { id: 'q1', no: 1, type: 'mc', points: 10, options: 4, key: ['B'], text: 'She ___ to school yesterday.' },
    { id: 'q2', no: 2, type: 'gap', points: 10, key: ['beautiful'] },
    { id: 'q3', no: 3, type: 'writing', points: 80, rubric: { TA: 1, CC: 1, LR: 1, GRA: 1 }, text: 'Holiday' }
  ] });
  const regions = [
    enforceIllegible({ questionId: 'q2', rect: { x: 100, y: 600, w: 500, h: 70 }, lines: [{ n: 1, words: [{ text: 'beatiful', confidence: 0.9, box: [10, 10, 500, 900] }] }] }),
    enforceIllegible({ questionId: 'q3', rect: { x: 90, y: 900, w: 1060, h: 700 }, lines: [line(1, 'Last summer I go to Antalya'), line(2, 'I go swimming every day'), line(3, 'It was very good')] })
  ];
  const evaluation = {
    writing: [{ questionId: 'q3',
      rubric: [{ criterion: 'TA', band: 4, justification: 'a' }, { criterion: 'CC', band: 3, justification: 'b' }, { criterion: 'LR', band: 3, justification: 'c' }, { criterion: 'GRA', band: 2, justification: 'd' }],
      errors: [
        { line: 2, quote: 'go', occurrence: 1, code: 'T', ruleId: 'past', correction: 'went', original: 'I go swimming every day', corrected: 'I went swimming every day', severity: 'bozmuyor' },
        { line: 1, quote: 'go', occurrence: 1, code: 'T', ruleId: 'past', correction: 'went', original: 'Last summer I go to Antalya', corrected: 'Last summer I went to Antalya', severity: 'bozmuyor' }
      ],
      suggestions: [{ line: 3, quote: 'very good', suggestion: 'amazing', reason: 'Daha zengin sıfat' }] }],
    rules: [{ ruleId: 'past', code: 'T', explanation: 'Geçmişte olan bir olay: fiil V2 olur.', example: 'We visited Izmir last year.' }],
    answerNotes: [{ questionId: 'q1', code: 'T', ruleId: 'past', explanation: "'yesterday' geçmiş zaman ister." }],
    feedback: { strength: 's', improvements: ['a', 'b', 'c', 'd'], studyTip: 't' }
  };
  const boxes = (qid, opt) => (qid === 'q1' && opt ? { x: opt.charCodeAt(0) * 10, y: 500, w: 24, h: 24 } : null);
  const r = assemble({ exam, omr: [{ questionId: 'q1', state: 'isaretli', value: 'C', confidence: 0.98 }], regions, evaluation, answerBox: boxes });
  assert.deepEqual(r.scores.map(s => s.earned), [0, 10, 48]);
  assert.deepEqual(r.total, { earned: 58, max: 100, grade100: 58 });
  // sıra: S1 (Key/T) → S2 (Sp, esnek kabul) → S3 satır 1 → S3 satır 2
  assert.deepEqual(r.errors.map(e => [e.no, e.questionId, e.code, e.line]), [[1, 'q1', 'T', null], [2, 'q2', 'Sp', null], [3, 'q3', 'T', 1], [4, 'q3', 'T', 2]]);
  assert.deepEqual(r.errors[0].impact, { kind: 'points', points: -10 });
  assert.deepEqual(r.errors[0].box, { x: 670, y: 500, w: 24, h: 24 });
  assert.deepEqual(r.errors[1].impact, { kind: 'points', points: 0 });
  assert.ok(r.errors.every(e => e.certain), JSON.stringify(r.errors.filter(e => !e.certain)));
  assert.equal(r.suggestions.length, 1);
  assert.ok(r.suggestions[0].box);
  assert.equal(r.feedback.improvements.length, 3);
});
