// Deterministik puanlama. Aynı girdi her zaman aynı puanı verir (tutarlılık ilkesi).
// Kapalı uçlu ve boşluk doldurma soruları tamamen yerelde puanlanır; writing puanı rubrik bantlarından hesaplanır.

import { rubricPoints, clampBand } from './rubric.js';
import { CRITERION_LIST, CRITERIA, VERDICTS } from './codes.js';

/** Karşılaştırma için normalleştirme: küçük harf, akıllı tırnak, boşluk, sondaki noktalama. */
export function normalizeAnswer(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'(]+|[\s"'.,;:!?)]+$/g, '')
    .trim();
}

/** Damerau-Levenshtein (bitişik harf yer değiştirmesi = 1 işlem; "recieve" → "receive"). */
export function editDistance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, (_, i) => { const r = new Array(m + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[n][m];
}

/** Esnek modda kabul edilen yazım farkı: kısa kelimede tolerans yok (anlam değişir: "sit/set"). */
export function spellingTolerance(len) {
  if (len >= 8) return 2;
  if (len >= 4) return 1;
  return 0;
}

const READ_REVIEW = 0.75; // bunun altındaki okuma güveni öğretmen kontrolü ister

/**
 * Baloncuklu soru (mc / tf / match).
 * @param {object} q soru
 * @param {{value:string|null, state:string, confidence:number, marked?:string[]}} r optik okuma
 */
export function scoreClosed(q, r) {
  const key = (q.key || []).map(k => String(k).toUpperCase());
  const max = Number(q.points) || 0;
  const res = { questionId: q.id, max, earned: 0, auto: true, needsReview: false, reason: '' };
  const keyTxt = key.join(' / ') || '—';
  if (!r || r.state === 'bos') {
    res.reason = `Boş bırakılmış · Anahtar: ${keyTxt}`;
  } else if (r.state === 'coklu') {
    res.reason = `Birden fazla işaret (${(r.marked || []).join(', ')}) · Anahtar: ${keyTxt}`;
    res.needsReview = true;
  } else {
    const v = String(r.value).toUpperCase();
    const ok = key.includes(v);
    res.earned = ok ? max : 0;
    res.reason = `İşaretlenen: ${v} · Anahtar: ${keyTxt}${ok ? ' ✓' : ''}`;
    if (r.state === 'belirsiz' || (r.confidence ?? 1) < READ_REVIEW) {
      res.needsReview = true;
      res.reason += ' · İşaret net değil';
    }
  }
  return res;
}

/**
 * Boşluk doldurma / kısa cevap.
 * @param {object} q soru: key[], alternatives[]
 * @param {{text:string, confidence:number, illegible?:boolean}} r okunan cevap
 * @param {'katı'|'esnek'} spelling
 * @returns {{score:object, match:{kind:string, target?:string, distance?:number}}}
 */
export function scoreGap(q, r, spelling = 'esnek') {
  const max = Number(q.points) || 0;
  const accepted = [...(q.key || []), ...(q.alternatives || [])].map(normalizeAnswer).filter(Boolean);
  const score = { questionId: q.id, max, earned: 0, auto: true, needsReview: false, reason: '' };
  const raw = r?.text ?? '';
  const ans = normalizeAnswer(raw);
  const keyTxt = (q.key || []).join(' / ') || '—';
  if (r?.illegible || /\[okunamad[ıi]\]/i.test(raw)) {
    score.needsReview = true;
    score.reason = `Cevap okunamadı · Anahtar: ${keyTxt}`;
    return { score, match: { kind: 'okunamadi' } };
  }
  if (!ans) {
    score.reason = `Boş bırakılmış · Anahtar: ${keyTxt}`;
    return { score, match: { kind: 'bos' } };
  }
  if (accepted.includes(ans)) {
    score.earned = max;
    score.reason = `“${raw.trim()}” kabul edildi` + (normalizeAnswer(q.key?.[0]) === ans ? '' : ' (alternatif cevap)');
    if ((r.confidence ?? 1) < READ_REVIEW) { score.needsReview = true; score.reason += ' · Okuma güveni düşük'; }
    return { score, match: { kind: 'tam', target: ans } };
  }
  if (spelling === 'esnek') {
    let best = null;
    for (const a of accepted) {
      const d = editDistance(ans, a);
      if (d <= spellingTolerance(a.length) && (!best || d < best.distance)) best = { target: a, distance: d };
    }
    if (best) {
      score.earned = max;
      score.reason = `“${raw.trim()}” yazım farkıyla kabul edildi (doğrusu: ${best.target}; esnek mod)`;
      if ((r.confidence ?? 1) < READ_REVIEW) { score.needsReview = true; score.reason += ' · Okuma güveni düşük'; }
      return { score, match: { kind: 'yazim', ...best } };
    }
  }
  score.reason = `“${raw.trim()}” anahtarla uyuşmuyor · Anahtar: ${keyTxt}`;
  if ((r.confidence ?? 1) < READ_REVIEW) { score.needsReview = true; score.reason += ' · Okuma güveni düşük'; }
  return { score, match: { kind: 'yanlis' } };
}

/**
 * Writing puanı: modelin bantları + gerekçeleri. Gerekçesiz bant kabul edilmez → öğretmen kontrolü.
 * @param {object} q
 * @param {{criterion:string, band:number, justification:string}[]} rubric
 * @param {{words:number}} stats
 */
export function scoreWriting(q, rubric, stats = {}) {
  const max = Number(q.points) || 0;
  const bands = CRITERION_LIST.map(c => {
    const b = (rubric || []).find(x => x.criterion === c);
    return { criterion: c, band: clampBand(b?.band), justification: String(b?.justification || '').trim() };
  });
  const missing = bands.filter(b => !b.justification);
  const earned = rubricPoints(bands, q.rubric, max);
  const words = stats.words ?? null;
  let reason = 'Rubrik: ' + bands.map(b => `${b.criterion} ${b.band}`).join(' · ');
  if (words != null) {
    reason += ` · ${words} kelime`;
    if (q.minWords && words < q.minWords) reason += ` (en az ${q.minWords} istendi)`;
    if (q.maxWords && words > q.maxWords) reason += ` (en fazla ${q.maxWords} istendi)`;
  }
  return {
    questionId: q.id, max, earned, auto: true, rubric: bands, reason,
    needsReview: missing.length > 0,
    ...(missing.length ? { reviewReason: `Gerekçesi eksik ölçüt: ${missing.map(m => CRITERIA[m.criterion].tr).join(', ')}` } : {})
  };
}

/** Açık uçlu sorunun içerik noktaları: öğretmen girmediyse örnek cevabın anlamı tek nokta sayılır. */
export function contentPoints(q) {
  const kp = (q.keyPoints || []).map(k => String(k).trim()).filter(Boolean);
  return kp.length ? kp : ['Örnek cevaptaki anlamı veriyor'];
}

/**
 * Açık uçlu soru: içerik (nokta nokta, kısmi puanlı) + dil doğruluğu (0–4 bant).
 * puan = içerik payı × ortalama(nokta oranı) + dil payı × bant/4 ; 0,5'e yuvarlanır.
 * İçerik tamamen eksik/yanlışsa dil puanı verilmez (alakasız ama düzgün cümle puan almaz).
 * Gerekçesi eksik karar öğretmen kontrolüne düşer.
 * @param {object} q
 * @param {{points:{index:number, verdict:string, justification:string}[], language:{band:number, justification:string}}} ev
 * @param {number} langWeight 0–100 (sınav ayarı)
 */
export function scoreOpen(q, ev, langWeight = 30) {
  const max = Number(q.points) || 0;
  const cps = contentPoints(q);
  const w = Math.max(0, Math.min(100, Number(langWeight))) / 100;
  const points = cps.map((text, index) => {
    const v = (ev?.points || []).find(p => p.index === index);
    const verdict = VERDICTS[v?.verdict] ? v.verdict : 'eksik';
    return { index, text, verdict, justification: String(v?.justification || '').trim(), missing: !v };
  });
  const ratio = points.reduce((a, p) => a + VERDICTS[p.verdict].ratio, 0) / points.length;
  const rawBand = Math.round(Number(ev?.language?.band));
  let band = Number.isFinite(rawBand) ? Math.max(0, Math.min(4, rawBand)) : 0;
  const language = { band, justification: String(ev?.language?.justification || '').trim() };
  if (ratio === 0) band = 0;
  const earned = Math.round((max * (1 - w) * ratio + max * w * band / 4) * 2) / 2;
  const met = points.filter(p => p.verdict === 'karsilandi').length, part = points.filter(p => p.verdict === 'kismen').length;
  let reason = `İçerik: ${met}/${points.length} nokta` + (part ? ` (${part} kısmen)` : '');
  if (w > 0) reason += ratio === 0 ? ' · Dil: içerik yanlış olduğu için puanlanmadı' : ` · Dil: ${band}/4`;
  const gaps = points.filter(p => p.missing || !p.justification);
  const needsLang = w > 0 && ratio > 0 && !language.justification;
  return {
    questionId: q.id, max, earned, auto: true, reason,
    open: { points, language, langWeight: Math.round(w * 100) },
    needsReview: gaps.length > 0 || needsLang,
    ...(gaps.length || needsLang ? { reviewReason: gaps.length ? `Gerekçesi eksik içerik kararı: ${gaps.map(g => g.index + 1).join(', ')}. nokta` : 'Dil bandının gerekçesi eksik' } : {})
  };
}

/** Sınavın ham toplamı ve 100'lük e-Okul notu (yarım yukarı yuvarlanır). */
export function totals(exam, scores) {
  const max = exam.questions.reduce((s, q) => s + (Number(q.points) || 0), 0);
  const earned = exam.questions.reduce((s, q) => s + (Number(scores.find(x => x.questionId === q.id)?.earned) || 0), 0);
  const pct = max ? earned * 100 / max : 0;
  return { earned: round2(earned), max: round2(max), grade100: Math.min(100, Math.max(0, Math.floor(pct + 0.5 + 1e-9))) };
}

export function round2(x) { return Math.round(x * 100) / 100; }

/** Writing için kelime sayımı ([okunamadı] da bir kelime sayılır, çünkü öğrenci bir şey yazmıştır). */
export function countWords(text) {
  const m = String(text || '').match(/\[okunamad[ıi]\]|[A-Za-zÀ-ɏ0-9]+(?:['’-][A-Za-zÀ-ɏ0-9]+)*/g);
  return m ? m.length : 0;
}
