// Yapay zekâ katmanı testleri (taklit istemciyle; ağ ve anahtar gerekmez):
// istek biçimi, kişisel veri sızıntısı, yapılandırılmış çıktı şeması, önbellek/tutarlılık,
// [okunamadı] kuralı, ret (refusal) ve uçtan uca kağıt değerlendirme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READ_SCHEMA, EVAL_SCHEMA, normalizeEval } from '../js/ai/schemas.js';
import { evalSystem, evalUserText, teacherPreferences } from '../js/ai/prompts.js';
import { callStructured, AIError } from '../js/ai/claude.js';
import { gradePaper } from '../js/grade.js';
import { layoutSheet } from '../js/vision/sheet.js';
import { processPage } from '../js/vision/pipeline.js';
import { newExam } from '../js/core/exam.js';
import { errorTable } from '../js/core/errors.js';
import { rasterSheet, photograph } from './synth.mjs';

function mockClient(handler) {
  const calls = [];
  return {
    calls,
    beta: { messages: { stream: (params) => { calls.push(params); return { finalMessage: async () => handler(params, calls.length) }; } } }
  };
}
const msg = (obj, extra = {}) => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: {}, ...extra });
function memCache() { const m = new Map(); return { m, get: async k => m.get(k), set: async (k, v) => { m.set(k, v); } }; }

function walk(s, path = '$') {
  if (s.type === 'object') {
    assert.equal(s.additionalProperties, false, `${path}: additionalProperties:false olmalı`);
    assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${path}: tüm alanlar zorunlu`);
    for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
  } else if (s.type === 'array') walk(s.items, `${path}[]`);
  for (const bad of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) assert.ok(!(bad in s), `${path}: ${bad} desteklenmez`);
}

test('şemalar yapılandırılmış çıktı kurallarına uyar', () => { walk(READ_SCHEMA); walk(EVAL_SCHEMA); });

test('istek: Opus 5.5, yedek model, şema, önbellek kontrolü; ret ve uzunluk sınırı anlaşılır hata verir', async () => {
  const client = mockClient(() => msg({ ok: 1 }));
  const r = await callStructured({ client, model: 'claude-opus-5-5', system: 'S', content: [{ type: 'text', text: 'x' }], schema: { type: 'object' } });
  assert.deepEqual(r.data, { ok: 1 });
  const p = client.calls[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.system[0].cache_control.type, 'ephemeral');
  assert.ok(!('thinking' in p) && !('temperature' in p), 'Opus 5.5’te düşünme kapatılamaz, örnekleme parametresi gönderilmez');
  const haiku = mockClient(() => msg({}));
  await callStructured({ client: haiku, model: 'claude-haiku-5-5', system: 'S', content: [], schema: {} });
  assert.ok(!('fallbacks' in haiku.calls[0]));
  const refuse = mockClient(() => msg({}, { stop_reason: 'refusal', stop_details: { category: 'cyber' } }));
  await assert.rejects(callStructured({ client: refuse, model: 'claude-opus-5-5', system: 'S', content: [], schema: {} }), e => e instanceof AIError && e.code === 'refusal');
  const long = mockClient(() => msg({}, { stop_reason: 'max_tokens' }));
  await assert.rejects(callStructured({ client: long, model: 'claude-opus-5-5', system: 'S', content: [], schema: {} }), e => e.code === 'max_tokens');
});

test('tutarlılık: aynı girdi ikinci kez API’ye gitmez, aynı sonucu döndürür', async () => {
  let n = 0;
  const client = mockClient(() => msg({ n: ++n }));
  const cache = memCache();
  const a = await callStructured({ client, model: 'm', system: 'S', content: [], schema: {}, cache, cacheKeyParts: ['x', 1] });
  const b = await callStructured({ client, model: 'm', system: 'S', content: [], schema: {}, cache, cacheKeyParts: ['x', 1] });
  assert.equal(client.calls.length, 1);
  assert.deepEqual(a.data, b.data);
  assert.equal(b.cached, true);
});

test('değerlendirme istemi: seviye kalibrasyonu, açıklama dili, öğretmen tercihleri', () => {
  const exam = newExam({ name: 'X', cefr: 'B1', grade: '11', explainLang: 'tr', questions: [{ id: 'w', no: 3, type: 'writing', points: 20, text: 'Describe your town.', minWords: 80, maxWords: 120 }] });
  const sys = evalSystem(exam);
  assert.match(sys, /CEFR B1/);
  assert.match(sys, /in Turkish/);
  assert.match(sys, /rules\[\]/);
  assert.match(evalSystem({ ...exam, explainLang: 'en' }), /in English/);
  const prefs = teacherPreferences([{ kind: 'error.delete', before: { quote: 'gonna', code: 'WW', ruleId: 'informal' }, note: 'mektupta kabul' }]);
  const user = evalUserText(exam, [{ questionId: 'w', lines: [{ n: 1, words: [{ text: 'My' }, { text: 'town' }] }] }], [], prefs);
  assert.match(user, /1: My town/);
  assert.match(user, /teacher_preferences[\s\S]*gonna[\s\S]*mektupta kabul/);
  assert.match(user, /min_words="80"/);
});

test('normalizeEval: en fazla 3 gelişim alanı, bant 0–5, tekrarsız kurallar', () => {
  const e = normalizeEval({ writing: [{ question_id: 'w', rubric: [{ criterion: 'TA', band: 9, justification: 'x' }], errors: [], suggestions: [] }],
    rules: [{ rule_id: 'a', code: 'T', explanation: '1', example: 'e' }, { rule_id: 'a', code: 'T', explanation: '2', example: 'e' }],
    answer_notes: [], feedback: { strength: 's', improvements: ['1', '2', '3', '4'], study_tip: 't' } });
  assert.equal(e.writing[0].rubric[0].band, 5);
  assert.equal(e.rules.length, 1);
  assert.equal(e.feedback.improvements.length, 3);
});

test('uçtan uca kağıt: OMR + okuma + değerlendirme; ad/numara istekte yok; hata tablosu eksiksiz', async () => {
  const exam = newExam({ id: 'ai-e2e', name: 'Uçtan uca', cefr: 'A2', grade: '9', spelling: 'esnek', questions: [
    { id: 'q1', no: 1, type: 'mc', points: 10, options: 4, key: ['B'], text: 'She ___ to school yesterday. A) go B) went C) goes D) going' },
    { id: 'q2', no: 2, type: 'tf', points: 10, key: ['D'] },
    { id: 'q3', no: 3, type: 'gap', points: 10, key: ['visited'], text: 'We ___ (visit) Izmir last summer.' },
    { id: 'q4', no: 4, type: 'writing', points: 70, lines: 8, text: 'Write about your last holiday.', minWords: 20, rubric: { TA: 1, CC: 1, LR: 1, GRA: 1 } }
  ] });
  const layout = layoutSheet(exam);
  const sheet = rasterSheet(layout, 1, { number: '1907', k: 1.2, seed: 2, marks: [{ questionId: 'q1', option: 'C', kind: 'full' }, { questionId: 'q2', option: 'D', kind: 'full' }] });
  const photo = photograph(sheet, { seed: 2, angle: -3, size: [1600, 2200] });
  const rgba = { w: photo.w, h: photo.h, d: new Uint8ClampedArray(photo.w * photo.h * 4) };
  for (let i = 0; i < photo.d.length; i++) { rgba.d[i * 4] = rgba.d[i * 4 + 1] = rgba.d[i * 4 + 2] = photo.d[i]; rgba.d[i * 4 + 3] = 255; }
  const page = processPage(rgba, { exam, layout });
  assert.equal(page.number.no, '1907');

  const W = (t, c, x) => ({ text: t, confidence: c, box: [x, 120, x + 70, 230] });
  const client = mockClient((params) => {
    if (params.output_config.format.schema === READ_SCHEMA) {
      return msg({ answers: [], regions: [
        { region_id: 'q3-p1', lines: [{ n: 1, words: [W('visitted', 0.92, 40)] }] },
        { region_id: 'q4-p1', lines: [
          { n: 1, words: ['Last', 'summer', 'I', 'go', 'to', 'Antalya'].map((t, i) => W(t, 0.95, 60 + i * 90)) },
          { n: 2, words: ['I', 'swim', 'in', 'the', 'see'].map((t, i) => W(t, i === 4 ? 0.4 : 0.95, 60 + i * 90)) },
          { n: 3, words: ['It', 'was', 'very', 'good'].map((t, i) => W(t, 0.95, 60 + i * 90)) }
        ] }
      ] });
    }
    return msg({
      writing: [{ question_id: 'q4',
        rubric: [{ criterion: 'TA', band: 3, justification: 'Tatil anlatılmış ama kısa.' }, { criterion: 'CC', band: 3, justification: 'Basit bağlaçlar.' }, { criterion: 'LR', band: 3, justification: 'Temel kelimeler.' }, { criterion: 'GRA', band: 2, justification: 'Geçmiş zaman hataları.' }],
        errors: [
          { line: 1, quote: 'go', occurrence: 1, code: 'T', rule_id: 'past-simple', correction: 'went', original: 'Last summer I go to Antalya', corrected: 'Last summer I went to Antalya', severity: 'bozmuyor', criterion: 'GRA', certain: true, uncertain_reason: '' },
          { line: 2, quote: 'swim', occurrence: 1, code: 'T', rule_id: 'past-simple', correction: 'swam', original: 'I swim in the see', corrected: 'I swam in the see', severity: 'bozmuyor', criterion: 'GRA', certain: true, uncertain_reason: '' },
          { line: 2, quote: 'see', occurrence: 1, code: 'Sp', rule_id: 'sea-see', correction: 'sea', original: 'I swim in the see', corrected: 'I swim in the sea', severity: 'bozuyor', criterion: 'LR', certain: true, uncertain_reason: '' }
        ],
        suggestions: [{ line: 3, quote: 'very good', suggestion: 'amazing', reason: 'Daha zengin bir sıfat.' }] }],
      rules: [
        { rule_id: 'past-simple', code: 'T', explanation: 'Geçmişte bitmiş olaylarda fiilin 2. hâli kullanılır.', example: 'We visited Izmir last year.' },
        { rule_id: 'sea-see', code: 'Sp', explanation: '"see" görmek demektir; deniz "sea" diye yazılır.', example: 'The sea was warm.' }
      ],
      answer_notes: [{ question_id: 'q1', code: 'T', rule_id: 'past-simple', explanation: "'yesterday' geçmiş zaman ister; doğru cevap 'went'.", example: 'I went home early yesterday.', severity: 'bozuyor' }],
      feedback: { strength: 'Tatilini sırayla anlatmışsın.', improvements: ['Geçmiş zaman (V2)', 'Yazım'], study_tip: 'Her gün 5 düzensiz fiil yaz.' }
    });
  });
  const encode = async img => `JPEG${img.w}x${img.h}`;
  const result = await gradePaper({ exam, layout, pages: [page], ai: { client, model: 'claude-opus-5-5', cache: memCache() }, encode });
  // kişisel veri: istekte ad/numara yok, yalnızca bölge kırpıntıları
  const sent = JSON.stringify(client.calls);
  assert.ok(!sent.includes('1907'), 'okul numarası istekte olmamalı');
  const imgs = client.calls[0].messages[0].content.filter(c => c.type === 'image');
  assert.equal(imgs.length, 2);
  // puanlar
  assert.deepEqual(result.scores.map(s => [s.questionId, s.earned]), [['q1', 0], ['q2', 10], ['q3', 10], ['q4', 38.5]]);
  assert.equal(result.total.grade100, 59);
  // "see" kelimesi 0,4 güvenle okundu → [okunamadı]; ona dayanan hata kesin değil (gri)
  const see = result.errors.find(e => e.quote === 'see');
  assert.equal(see.certain, false);
  assert.match(see.uncertainReason, /bulunamadı/);
  assert.ok(result.readingFlags.some(f => f.text === '[okunamadı]' && f.line === 2));
  // hata sırası ve konumları
  assert.deepEqual(result.errors.map(e => [e.no, e.questionId, e.code, e.line]), [[1, 'q1', 'T', null], [2, 'q3', 'Sp', null], [3, 'q4', 'T', 1], [4, 'q4', 'T', 2], [5, 'q4', 'Sp', 2]]);
  const go = result.errors.find(e => e.quote === 'go');
  const wr = layout.pages[0].writing[0].rect;
  assert.ok(go.box && go.box.page === 1 && go.box.y >= wr.y && go.box.y + go.box.h <= wr.y + wr.h && go.box.x > wr.x, JSON.stringify(go.box));
  // tablo: tekrar özeti, açıklama bir kez
  const rows = errorTable(result, exam);
  assert.match(rows[0].explanation, /yesterday/);
  assert.match(rows[2].explanation, /2\. hâli.*2 kez geçiyor \(Satır 1, 2\)/);
  assert.equal(rows[3].explanation, 'Bkz. hata 3');
  assert.ok(rows.every(r => r.where && r.written && r.correct && r.type && r.explanation && r.impact));
  assert.equal(result.feedback.improvements.length, 2);
  assert.equal(result.needsReview, true);
});
