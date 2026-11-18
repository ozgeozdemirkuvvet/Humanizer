// Gerçek kağıtlarla kalibrasyon: öğretmenin kırmızı kalemle puanladığı 5 kağıt (A–E).
// 1) Task 4 (ilk harfi verilen boşluklar) tamamen yerelde puanlanır → öğretmenle madde madde karşılaştırma.
// 2) Task 5–6 (açık uçlu) için öğretmenin her kararı uygulamanın puan modeliyle (içerik kararı, dil payı %0)
//    birebir ifade edilebiliyor mu ve kağıttaki toplamlar tutuyor mu?
// 3) Onaylanan kağıtlar sonraki kağıtların istemine puanlama örneği olarak giriyor mu?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exam, papers } from './fixtures/okuma-sinavi.mjs';
import { scoreGap, scoreOpen } from '../js/core/scoring.js';
import { calibrationExamples, evalUserText, evalSystem } from '../js/ai/prompts.js';

const gaps = exam.questions.filter(q => q.type === 'gap');
const opens = exam.questions.filter(q => q.type === 'open');

test('Task 4: ilk harf ipucuyla yerel puanlama öğretmenle madde madde uyuşuyor', () => {
  let agree = 0, total = 0;
  const diffs = [];
  for (const p of papers) {
    for (const q of gaps) {
      total++;
      const ours = scoreGap(q, { text: p.answers[q.id], confidence: 0.95 }, exam.spelling).score.earned;
      if (ours === p.teacher[q.id]) agree++; else diffs.push(`${p.label} S${q.no}: “${p.answers[q.id]}” uygulama ${ours}, öğretmen ${p.teacher[q.id]}`);
    }
  }
  console.log(`# Task 4: ${agree}/${total} madde öğretmenle aynı (%${(agree / total * 100).toFixed(1)})`);
  assert.deepEqual(diffs, []);
  // Öğretmenin kağıda yazdığı Task 4 toplamlarıyla karşılaştırma (E kağıdında toplam ile maddeler çelişiyor)
  const totals = papers.map(p => [p.label, gaps.reduce((s, q) => s + scoreGap(q, { text: p.answers[q.id], confidence: 0.95 }, exam.spelling).score.earned, 0), p.teacherTotals.task4]);
  console.log('# Task 4 toplamları (kağıt, uygulama, öğretmen): ' + totals.map(t => t.join('/')).join(' · '));
  assert.deepEqual(totals.filter(([l, a, b]) => a !== b && l !== 'E'), []);
  assert.deepEqual(totals.find(t => t[0] === 'E'), ['E', 3, 4]);
});

test('ilk harf ipucu: “urriculum”, “chool schedule”, “nxiyty” kabul; “hallenges”, “truggle” ret', () => {
  const g = id => gaps.find(q => q.id === id);
  assert.match(scoreGap(g('t4-1'), { text: 'urriculum', confidence: 1 }, 'esnek').score.reason, /verilen “c” ile: curriculum/);
  assert.equal(scoreGap(g('t4-6'), { text: 'chool schedule', confidence: 1 }, 'esnek').score.earned, 1);
  assert.equal(scoreGap(g('t4-3'), { text: 'nxiyty', confidence: 1 }, 'esnek').score.earned, 1);
  assert.equal(scoreGap(g('t4-3'), { text: 'nxiyty', confidence: 1 }, 'katı').score.earned, 0);
  assert.equal(scoreGap(g('t4-1'), { text: 'curriculum', confidence: 1 }, 'katı').score.earned, 1, 'ilk harfi tekrar yazan da kabul');
  assert.equal(scoreGap(g('t4-1'), { text: 'hallenges', confidence: 1 }, 'esnek').score.earned, 0);
  assert.equal(scoreGap(g('t4-6'), { text: 'truggle', confidence: 1 }, 'esnek').score.earned, 0);
});

test('Task 5–6: öğretmenin her puanı içerik kararlarıyla (dil payı %0) birebir ifade ediliyor; toplamlar tutuyor', () => {
  const verdictFor = (q, pts) => (pts === q.points ? 'karsilandi' : pts === q.points / 2 ? 'kismen' : pts === 0 ? 'eksik' : null);
  for (const p of papers) {
    let t5 = 0, t6 = 0;
    for (const q of opens) {
      const want = p.teacher[q.id];
      const verdict = verdictFor(q, want);
      assert.ok(verdict, `${p.label} S${q.no}: ${want} puan modelde ifade edilemiyor`);
      const s = scoreOpen(q, { points: [{ index: 0, verdict, justification: 'öğretmen kararı' }], language: { band: 0, justification: '' } }, exam.langWeight);
      assert.equal(s.earned, want, `${p.label} S${q.no}`);
      if (q.id === 't5') t5 += s.earned; else t6 += s.earned;
    }
    assert.equal(t5, p.teacherTotals.task5, `${p.label} Task 5`);
    assert.equal(t6, p.teacherTotals.task6, `${p.label} Task 6`);
  }
});

test('kalibrasyon: onaylanan kağıtlar puanları farklı örnekler olarak sonraki kağıdın istemine girer', () => {
  // Onaylanmış kağıtları uygulamanın saklama biçimine çevir
  const approved = papers.filter(p => p.label !== 'E').map(p => ({
    status: 'onaylandi',
    scores: opens.map(q => ({ questionId: q.id, earned: p.teacher[q.id], max: q.points, open: { points: [{ index: 0, verdict: p.teacher[q.id] === q.points ? 'karsilandi' : p.teacher[q.id] ? 'kismen' : 'eksik' }] } })),
    reading: { regions: opens.map(q => ({ questionId: q.id, lines: [{ n: 1, words: String(p.answers[q.id]).split(/\s+/).filter(Boolean).map(t => ({ text: t })) }] })) }
  }));
  const ex = calibrationExamples(exam, approved);
  const q3 = ex.filter(x => x.questionId === 't6-3');
  // S3 için 0, 0,5 ve 1 puanlık örneklerin hepsi seçilmeli (öğretmenin sınırı nereye çektiği görünsün)
  assert.deepEqual([...new Set(q3.map(x => x.earned))], [1, 0.5, 0]);
  assert.ok(q3.length <= 4);
  assert.ok(q3.some(x => x.answer === 'Melatonin.' && x.earned === 0.5));
  assert.ok(q3.some(x => x.answer === 'because of their body clock' && x.earned === 0));
  const text = evalUserText(exam, [], [], [], ex);
  assert.match(text, /<teacher_graded_examples>[\s\S]*Q10 \(question_id "t6-3"\): "Melatonin\." → 0\.5\/1/);
  const sys = evalSystem({ ...exam, readingText: 'Teenagers are often criticised…' });
  assert.match(sys, /<reading_text>\nTeenagers are often criticised…/);
  assert.match(sys, /THE TEACHER'S MARKING NOTES[\s\S]*Yalnızca anahtar kelime/);
  assert.match(sys, /naming only the key term[\s\S]*"kismen"/);
});
