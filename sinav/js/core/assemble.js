// Okuma (OMR + Aşama A) ve değerlendirme (Aşama B) sonuçlarını tek bir kağıt kaydında birleştirir:
// puanlar, numaralı hatalar, kurallar, öneriler, okuma uyarıları, geri bildirim ve toplam.
// Saf fonksiyon: aynı girdiye her zaman aynı çıktı (tutarlılık + test edilebilirlik).

import { scoreClosed, scoreGap, scoreWriting, scoreOpen, totals, countWords } from './scoring.js';
import { anchorError, numberErrors, missingFields, markUncertain, lineLayout, toPageBox } from './errors.js';
import { CODES, QUESTION_TYPES } from './codes.js';

const ILLEGIBLE = '[okunamadı]';
export const ILLEGIBLE_BELOW = 0.5; // bu güvenin altındaki kelime tahmin edilmez
export const REVIEW_BELOW = 0.75;   // bu güvenin altındaki kelime gri işaretlenir

/**
 * Aşama A kelimelerine kuralı yerelde uygular: düşük güvenli kelime "[okunamadı]" olur.
 * Model "tahmin ettim" dese bile tahmin edilmiş metin puanlamaya girmez.
 */
export function enforceIllegible(region) {
  return {
    ...region,
    lines: (region.lines || []).map(l => ({
      ...l,
      words: (l.words || []).map(w => {
        const c = Number(w.confidence);
        const conf = Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0;
        if (w.illegible || conf < ILLEGIBLE_BELOW || /\[okunamad[ıi]\]/i.test(w.text)) {
          return { ...w, text: ILLEGIBLE, illegible: true, confidence: conf, guess: w.text && !/\[okunamad/i.test(w.text) ? w.text : undefined };
        }
        return { ...w, confidence: conf };
      })
    }))
  };
}

export function regionText(region) {
  return (region?.lines || []).map(l => lineLayout(l.words).text).join('\n');
}

/**
 * @param {object} o
 * @param {object} o.exam
 * @param {object[]} o.omr               [{questionId, value, state, confidence, marked}]
 * @param {object[]} o.regions           Aşama A bölgeleri (enforceIllegible uygulanmış)
 * @param {object[]} [o.answers]         serbest kağıtta modelin okuduğu kapalı uçlu / kısa cevaplar
 * @param {object} [o.evaluation]        Aşama B sonucu (yoksa yalnızca yerel puanlama)
 * @param {(qid:string, option:string|null)=>object|null} [o.answerBox] cevabın sayfadaki kutusu
 * @param {(qid:string)=>object[]} [o.lineBands] writing satır bantları
 * @param {string} [o.lang]
 */
export function assemble({ exam, omr = [], regions = [], answers = [], evaluation = null, answerBox = () => null, lineBands = () => [], lang = 'tr' }) {
  const scores = [];
  const raw = [];
  const suggestions = [];
  const readingFlags = [];
  const rules = [...(evaluation?.rules || [])];
  const note = qid => evaluation?.answerNotes?.find(n => n.questionId === qid);
  const langWeight = Number(exam.langWeight ?? 0);
  const merged = mergeRegions(regions);
  const regionOf = qid => merged.find(r => r.questionId === qid);

  for (const q of exam.questions) {
    if (QUESTION_TYPES[q.type]?.closed) {
      const r = omr.find(x => x.questionId === q.id) || toOmrLike(answers.find(a => a.questionId === q.id));
      const s = scoreClosed(q, r);
      scores.push(s);
      if (s.earned < s.max) raw.push(closedError(q, r, s, note(q.id), answerBox, lang));
      continue;
    }
    if (q.type === 'gap') {
      const reg = regionOf(q.id);
      const read = reg ? gapReading(reg) : toGapReading(answers.find(a => a.questionId === q.id));
      const { score, match } = scoreGap(q, read, exam.spelling);
      scores.push(score);
      const box = reg ? { x: reg.rect.x + 8, y: reg.rect.y + 8, w: reg.rect.w - 16, h: reg.rect.h - 16, page: reg.page ?? 1 } : answerBox(q.id, null);
      if (match.kind === 'yanlis' || match.kind === 'bos') raw.push(gapError(q, read, score, note(q.id), box, match, lang));
      else if (match.kind === 'yazim') raw.push(spellingError(q, read, match, box, lang));
      else if (match.kind === 'okunamadi') readingFlags.push({ questionId: q.id, line: null, text: ILLEGIBLE, confidence: read.confidence, box });
      if (reg && read.confidence < REVIEW_BELOW && match.kind !== 'okunamadi') readingFlags.push({ questionId: q.id, line: null, text: read.text, confidence: read.confidence, box });
      continue;
    }
    if (q.type === 'writing' || q.type === 'open') {
      const isOpen = q.type === 'open';
      const reg = regionOf(q.id);
      const ev = (isOpen ? evaluation?.open : evaluation?.writing)?.find(w => w.questionId === q.id);
      const text = regionText(reg);
      const words = countWords(text);
      const label = isOpen ? 'Cevap' : 'Writing alanı';
      if (!reg || !words) {
        scores.push({ questionId: q.id, max: Number(q.points) || 0, earned: 0, auto: true, needsReview: !reg,
          reason: reg ? `${label} boş` : `${label} okunamadı`, rubric: [] });
        continue;
      }
      if (!ev) scores.push({ questionId: q.id, max: Number(q.points) || 0, earned: 0, auto: false, needsReview: true, reason: 'Değerlendirme bekleniyor', rubric: [] });
      else scores.push(isOpen ? scoreOpen(q, ev, langWeight) : scoreWriting(q, ev.rubric, { words }));
      const bands = lineBands(q.id);
      for (const e of ev?.errors || []) {
        const impact = !isOpen ? { kind: 'rubric', criterion: e.criterion || CODES[e.code]?.criterion || 'GRA' }
          : e.code === 'Key' ? { kind: 'content' } : { kind: 'language', weight: langWeight };
        raw.push(anchorError({ ...e, questionId: q.id, source: 'ai', certain: e.certain !== false, impact }, reg, bands));
      }
      for (const sg of ev?.suggestions || []) {
        const a = anchorError({ ...sg, questionId: q.id, kind: 'suggestion' }, reg, bands);
        suggestions.push({ ...a, kind: 'suggestion' });
      }
      for (const l of reg.lines) l.words.forEach((w, wi) => {
        if (w.confidence < REVIEW_BELOW) {
          const b = Array.isArray(w.box) ? w.box : null;
          readingFlags.push({ questionId: q.id, line: l.n, text: w.text, confidence: w.confidence, wordIndex: wi, guess: w.guess,
            box: b ? { ...toPageBox(l.rect || reg.rect, b), page: l.page ?? reg.page ?? 1 } : null });
        }
      });
    }
  }

  // Şartnamedeki her alan dolu mu? Eksikse hata gri ("Öğretmen kontrolü gerekli").
  for (const e of raw) {
    const miss = missingFields(e, rules);
    if (miss.length) markUncertain(e, `Eksik bilgi: ${miss.join(', ')}`);
    if (e.certain === undefined) e.certain = true;
  }
  const errors = numberErrors(raw, exam);
  suggestions.forEach((s, i) => { s.id = `s${i + 1}`; s.no = i + 1; });
  const total = totals(exam, scores);
  return {
    scores, errors, rules, suggestions, readingFlags,
    feedback: evaluation?.feedback ? { lang, ...evaluation.feedback, improvements: (evaluation.feedback.improvements || []).slice(0, 3) } : null,
    total,
    needsReview: scores.some(s => s.needsReview) || errors.some(e => e.certain === false) || readingFlags.length > 0
  };
}

/**
 * Aynı sorunun birden fazla sayfaya yayılan bölgelerini tek mantıksal bölgede birleştirir.
 * Her satır kendi sayfa ve dikdörtgen bilgisini taşır (kutu dönüşümü için).
 */
export function mergeRegions(regions) {
  const out = [];
  for (const r of regions) {
    const lines = (r.lines || []).map(l => ({ ...l, rect: l.rect || r.rect, page: l.page ?? r.page ?? 1 }));
    const prev = out.find(x => x.questionId === r.questionId);
    if (prev) prev.lines.push(...lines);
    else out.push({ ...r, lines });
  }
  for (const r of out) r.lines.sort((a, b) => a.n - b.n);
  return out;
}

function toOmrLike(a) {
  if (!a) return null;
  const v = String(a.value ?? '').trim().toUpperCase();
  if (!v) return { state: 'bos', value: null, confidence: a.confidence ?? 1 };
  if (/[,/ ]/.test(v)) return { state: 'coklu', value: null, marked: v.split(/[,/ ]+/), confidence: a.confidence ?? 1 };
  return { state: (a.confidence ?? 1) < REVIEW_BELOW ? 'belirsiz' : 'isaretli', value: v, confidence: a.confidence ?? 1 };
}

function gapReading(reg) {
  const words = reg.lines.flatMap(l => l.words);
  const text = words.map(w => w.text).join(' ');
  const confidence = words.length ? Math.min(...words.map(w => w.confidence)) : 1;
  return { text, confidence, illegible: words.some(w => w.illegible) };
}
function toGapReading(a) {
  if (!a) return { text: '', confidence: 1 };
  const c = Number(a.confidence ?? 1);
  return c < ILLEGIBLE_BELOW ? { text: ILLEGIBLE, confidence: c, illegible: true } : { text: String(a.value ?? ''), confidence: c };
}

function closedError(q, r, s, n, answerBox, lang) {
  const chosen = r?.state === 'isaretli' || r?.state === 'belirsiz' ? r.value : null;
  const blank = !r || r.state === 'bos';
  const multi = r?.state === 'coklu';
  const key = (q.key || [])[0] || '';
  return {
    questionId: q.id, line: null,
    quote: blank ? (lang === 'en' ? '(blank)' : '(boş)') : multi ? (r.marked || []).join(', ') : chosen,
    correction: key,
    code: n?.code && CODES[n.code] ? n.code : 'Key',
    ruleId: n?.ruleId || `q-${q.id}`,
    explanation: n?.explanation || defaultClosedExplanation(q, blank, multi, key, lang),
    example: n?.example || '',
    severity: 'bozuyor',
    certain: !multi && r?.state !== 'belirsiz',
    uncertainReason: multi ? 'Birden fazla seçenek işaretlenmiş' : r?.state === 'belirsiz' ? 'İşaret net değil' : '',
    impact: { kind: 'points', points: -s.max },
    box: answerBox(q.id, chosen) || answerBox(q.id, null),
    keyBox: answerBox(q.id, key),
    source: n ? 'ai' : 'yerel'
  };
}

function defaultClosedExplanation(q, blank, multi, key, lang) {
  if (lang === 'en') return blank ? `No answer was given. The correct answer is ${key}.` : multi ? `More than one option was marked. The correct answer is ${key}.` : `The correct answer is ${key}.`;
  return blank ? `Cevap verilmemiş. Doğru cevap: ${key}.` : multi ? `Birden fazla seçenek işaretlenmiş. Doğru cevap: ${key}.` : `Doğru cevap: ${key}.`;
}

function gapError(q, read, s, n, box, match, lang) {
  const key = (q.key || [])[0] || '';
  const blank = match.kind === 'bos';
  return {
    questionId: q.id, line: null,
    quote: blank ? (lang === 'en' ? '(blank)' : '(boş)') : read.text.trim(),
    correction: key,
    code: n?.code && CODES[n.code] ? n.code : 'Key',
    ruleId: n?.ruleId || `q-${q.id}`,
    explanation: n?.explanation || defaultClosedExplanation(q, blank, false, key, lang),
    example: n?.example || '',
    severity: n?.severity || 'bozuyor',
    certain: read.confidence >= REVIEW_BELOW,
    uncertainReason: read.confidence < REVIEW_BELOW ? 'Okuma güveni düşük' : '',
    impact: { kind: 'points', points: -s.max },
    box, source: n ? 'ai' : 'yerel'
  };
}

function spellingError(q, read, match, box, lang) {
  return {
    questionId: q.id, line: null,
    quote: read.text.trim(), correction: match.target,
    code: 'Sp', ruleId: `sp-${q.id}`,
    explanation: lang === 'en'
      ? `Spelling: the correct form is “${match.target}”. Accepted in flexible mode, no points deducted.`
      : `Yazım hatası: doğrusu “${match.target}”. Esnek modda kabul edildi, puan kırılmadı.`,
    example: '',
    severity: 'bozmuyor', certain: read.confidence >= REVIEW_BELOW,
    uncertainReason: read.confidence < REVIEW_BELOW ? 'Okuma güveni düşük' : '',
    impact: { kind: 'points', points: 0 }, box, source: 'yerel'
  };
}
