// Bir öğrencinin kağıdını uçtan uca değerlendirir:
//   sayfa sonuçları (yerel OMR + kırpıntılar) → Aşama A (okuma) → yerel puanlama →
//   Aşama B (değerlendirme) → birleştirme.
// Görüntü kodlama (JPEG) dışarıdan verilir; böylece modül hem tarayıcıda hem Node'da çalışır.

import { assemble, enforceIllegible, mergeRegions } from './core/assemble.js';
import { readCrops, evaluate } from './ai/claude.js';
import { answerBoxFinder, lineBandsFinder } from './vision/sheet.js';
import { QUESTION_TYPES } from './core/codes.js';

/**
 * @param {object} o
 * @param {object} o.exam
 * @param {object} o.layout
 * @param {object[]} o.pages      processPage sonuçları (kağıdın sayfaları)
 * @param {object|null} o.ai      {client, model, cache, signal, readEffort, evalEffort} — yoksa yalnızca yerel puanlama
 * @param {string[]} [o.prefs]    öğretmen tercihleri
 * @param {(img)=>Promise<string>} o.encode RGBA → JPEG base64
 * @param {(stage:string)=>void} [o.onStage]
 */
export async function gradePaper({ exam, layout, pages, ai, prefs = [], encode, onStage = () => {} }) {
  const lang = exam.explainLang || 'tr';
  const omr = pages.flatMap(p => p.omr || []);
  const free = pages.some(p => p.mode === 'serbest');
  const regions = [];
  let answers = [], readModel = null;
  const needsReading = pages.some(p => p.crops?.length) && exam.questions.some(q => !QUESTION_TYPES[q.type].closed || free);

  if (ai && needsReading) {
    onStage('okuma');
    if (free) {
      for (const [i, p] of pages.entries()) {
        const crop = p.crops[0];
        const r = await readCrops(ai, exam, [{ ...crop, jpeg: await encode(crop.img) }]);
        readModel = r.model;
        for (const reg of r.regions) regions.push(enforceIllegible({ ...reg, questionId: reg.regionId, page: i + 1, rect: crop.rect }));
        for (const a of r.answers) if (!answers.some(x => x.questionId === a.questionId && x.value)) answers = answers.filter(x => x.questionId !== a.questionId).concat(a);
      }
    } else {
      const crops = [];
      for (const p of pages) for (const c of p.crops) crops.push({ ...c, jpeg: await encode(c.img) });
      const r = await readCrops(ai, exam, crops);
      readModel = r.model;
      for (const reg of r.regions) {
        const c = crops.find(x => x.regionId === reg.regionId);
        regions.push(enforceIllegible({ ...reg, questionId: c.questionId, page: c.page, rect: c.rect }));
      }
    }
  }

  const answerBox = free ? () => null : answerBoxFinder(layout);
  const lineBands = free ? () => [] : lineBandsFinder(layout);
  const local = assemble({ exam, omr, regions, answers, answerBox, lineBands, lang });

  let evaluation = null, evalModel = null;
  const hasWriting = exam.questions.some(q => q.type === 'writing') && regions.some(r => exam.questions.find(q => q.id === r.questionId)?.type === 'writing');
  const wrong = wrongAnswers(exam, local, omr, regions, answers);
  if (ai && (hasWriting || wrong.length)) {
    onStage('degerlendirme');
    evaluation = await evaluate(ai, exam, mergeRegions(regions), wrong, prefs);
    evalModel = evaluation.model;
  }
  const result = evaluation ? assemble({ exam, omr, regions, answers, evaluation, answerBox, lineBands, lang }) : local;
  if (!evaluation && !result.feedback) result.feedback = localFeedback(exam, result, lang);
  return {
    reading: { omr, regions, answers },
    ...result,
    model: evalModel || readModel || null,
    status: 'degerlendirildi'
  };
}

/** Değerlendirme istemine gidecek yanlış cevaplar (boşlar dahil). */
export function wrongAnswers(exam, local, omr, regions, answers) {
  const out = [];
  for (const q of exam.questions) {
    if (q.type === 'writing') continue;
    const s = local.scores.find(x => x.questionId === q.id);
    if (!s || s.earned >= s.max) continue;
    let given = '';
    if (QUESTION_TYPES[q.type].closed) {
      const o = omr.find(x => x.questionId === q.id);
      given = o ? (o.state === 'coklu' ? o.marked.join(',') : o.value || '') : answers.find(a => a.questionId === q.id)?.value || '';
    } else {
      const r = regions.find(x => x.questionId === q.id);
      given = r ? r.lines.flatMap(l => l.words.map(w => w.text)).join(' ') : answers.find(a => a.questionId === q.id)?.value || '';
    }
    if (!given || /\[okunamad/.test(given)) continue; // boş ya da okunamayan cevap için kural açıklaması üretilmez
    out.push({ q, given });
  }
  return out;
}

/** Yapay zekâ kullanılamadığında (anahtar yok) basit, dürüst geri bildirim. */
function localFeedback(exam, r, lang) {
  const correct = r.scores.filter(s => s.earned >= s.max && s.max > 0).length;
  const wrong = r.scores.filter(s => s.earned < s.max);
  const tr = lang !== 'en';
  return {
    lang,
    strength: tr ? `${r.scores.length} sorudan ${correct} tanesini tam doğru yaptın.` : `You answered ${correct} of ${r.scores.length} questions fully correctly.`,
    improvements: wrong.slice(0, 3).map(s => {
      const q = exam.questions.find(x => x.id === s.questionId);
      return tr ? `${q.no}. soru${q.outcome ? ` (${q.outcome})` : ''}` : `Question ${q.no}${q.outcome ? ` (${q.outcome})` : ''}`;
    }),
    studyTip: tr ? 'Yanlış yaptığın soruları doğru cevaplarıyla birlikte tekrar çöz ve nedenini not al.' : 'Redo the questions you missed with the correct answers and write down why.',
    local: true
  };
}
