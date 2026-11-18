// Yapılandırılmış çıktı şemaları (output_config.format). API, yanıtın bu şemaya uymasını garanti eder.
// Not: Şemalarda sayısal/uzunluk sınırları desteklenmez; sınırlar normalize* fonksiyonlarında uygulanır.

import { CODE_LIST, CRITERION_LIST } from '../core/codes.js';

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: 'string' }, int = { type: 'integer' }, num = { type: 'number' }, bool = { type: 'boolean' };
const arr = items => ({ type: 'array', items });

export const READ_SCHEMA = obj({
  regions: arr(obj({
    region_id: str,
    lines: arr(obj({
      n: int,
      words: arr(obj({ text: str, confidence: num, box: arr(num) }))
    }))
  })),
  answers: arr(obj({ question_id: str, value: str, confidence: num }))
});

export const EVAL_SCHEMA = obj({
  writing: arr(obj({
    question_id: str,
    rubric: arr(obj({ criterion: { type: 'string', enum: CRITERION_LIST }, band: int, justification: str })),
    errors: arr(obj({
      line: int, quote: str, occurrence: int,
      code: { type: 'string', enum: CODE_LIST.filter(c => c !== 'Key') },
      rule_id: str, correction: str, original: str, corrected: str,
      severity: { type: 'string', enum: ['bozuyor', 'bozmuyor'] },
      criterion: { type: 'string', enum: CRITERION_LIST },
      certain: bool, uncertain_reason: str
    })),
    suggestions: arr(obj({ line: int, quote: str, suggestion: str, reason: str }))
  })),
  rules: arr(obj({ rule_id: str, code: { type: 'string', enum: CODE_LIST }, explanation: str, example: str })),
  answer_notes: arr(obj({
    question_id: str, code: { type: 'string', enum: CODE_LIST }, rule_id: str, explanation: str, example: str,
    severity: { type: 'string', enum: ['bozuyor', 'bozmuyor'] }
  })),
  feedback: obj({ strength: str, improvements: arr(str), study_tip: str })
});

const clamp01 = x => Math.max(0, Math.min(1, Number(x) || 0));
const box4 = b => (Array.isArray(b) && b.length === 4 && b.every(v => Number.isFinite(Number(v)))
  ? (() => { const [x0, y0, x1, y1] = b.map(v => Math.max(0, Math.min(1000, Number(v)))); return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]; })()
  : null);

/** Aşama A çıktısını iç biçime çevirir; bilinmeyen bölgeler atılır. */
export function normalizeRead(raw, knownRegionIds) {
  const regions = [];
  for (const r of raw?.regions || []) {
    if (knownRegionIds && !knownRegionIds.includes(r.region_id)) continue;
    const lines = (r.lines || [])
      .filter(l => Number.isInteger(l.n) && l.n > 0)
      .map(l => ({ n: l.n, words: (l.words || []).filter(w => String(w.text ?? '').trim()).map(w => ({ text: String(w.text).trim(), confidence: clamp01(w.confidence), box: box4(w.box) })) }))
      .filter(l => l.words.length)
      .sort((a, b) => a.n - b.n);
    regions.push({ regionId: r.region_id, lines });
  }
  const answers = (raw?.answers || []).map(a => ({ questionId: a.question_id, value: String(a.value ?? '').trim(), confidence: clamp01(a.confidence) }));
  return { regions, answers };
}

/** Aşama B çıktısını iç biçime çevirir; geri bildirimde en fazla 3 gelişim alanı. */
export function normalizeEval(raw) {
  return {
    writing: (raw?.writing || []).map(w => ({
      questionId: w.question_id,
      rubric: (w.rubric || []).map(r => ({ criterion: r.criterion, band: Math.max(0, Math.min(5, Math.round(r.band))), justification: String(r.justification || '').trim() })),
      errors: (w.errors || []).map(e => ({
        line: e.line, quote: e.quote, occurrence: Math.max(1, e.occurrence || 1), code: e.code, ruleId: e.rule_id,
        correction: e.correction, original: e.original, corrected: e.corrected, severity: e.severity,
        criterion: e.criterion, certain: e.certain !== false, uncertainReason: e.uncertain_reason || ''
      })),
      suggestions: (w.suggestions || []).map(s => ({ line: s.line, quote: s.quote, occurrence: 1, suggestion: s.suggestion, reason: s.reason }))
    })),
    rules: dedupe((raw?.rules || []).map(r => ({ ruleId: r.rule_id, code: r.code, explanation: String(r.explanation || '').trim(), example: String(r.example || '').trim() })), 'ruleId'),
    answerNotes: (raw?.answer_notes || []).map(n => ({ questionId: n.question_id, code: n.code, ruleId: n.rule_id, explanation: n.explanation, example: n.example, severity: n.severity })),
    feedback: raw?.feedback ? {
      strength: String(raw.feedback.strength || '').trim(),
      improvements: (raw.feedback.improvements || []).map(s => String(s).trim()).filter(Boolean).slice(0, 3),
      studyTip: String(raw.feedback.study_tip || '').trim()
    } : null
  };
}

function dedupe(list, key) {
  const seen = new Set();
  return list.filter(x => (seen.has(x[key]) ? false : (seen.add(x[key]), true)));
}
