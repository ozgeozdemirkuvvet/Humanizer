// Hata konumlandırma, numaralandırma, tekrar birleştirme ve hata tablosu.
// Konum modelden "satır + birebir alıntı" olarak gelir; karakter aralığı ve kağıt üzerindeki kutu
// burada yerelde hesaplanır. Alıntı satırda bulunamazsa uydurma bir konum çizilmez; hata gri kalır.

import { CODES, codeLabel, CRITERIA, SEVERITY } from './codes.js';

/** Satırdaki kelimelerden satır metni (tek boşlukla) ve her kelimenin karakter aralığı. */
export function lineLayout(words) {
  let text = '';
  const spans = [];
  for (const w of words || []) {
    if (text) text += ' ';
    spans.push({ start: text.length, end: text.length + w.text.length });
    text += w.text;
  }
  return { text, spans };
}

const fold = s => s.toLowerCase().replace(/[‘’]/g, "'");

/**
 * Alıntının satırdaki konumu. Önce birebir, sonra büyük/küçük harf duyarsız, sonra
 * kenar noktalaması atılmış hâliyle aranır. `occurrence` 1 tabanlıdır.
 * @returns {{start:number,end:number}|null}
 */
export function locateQuote(lineText, quote, occurrence = 1) {
  if (!quote || !lineText) return null;
  const tries = [
    [lineText, quote],
    [fold(lineText), fold(quote)],
    [fold(lineText), fold(quote).replace(/^[\s.,;:!?"']+|[\s.,;:!?"']+$/g, '')]
  ];
  for (const [hay, needle] of tries) {
    if (!needle) continue;
    let from = 0, k = 0, idx;
    const hits = [];
    while ((idx = hay.indexOf(needle, from)) !== -1) { hits.push(idx); from = idx + 1; k++; if (k > 50) break; }
    if (hits.length) {
      const i = hits[Math.min(Math.max(1, occurrence), hits.length) - 1];
      return { start: i, end: i + needle.length };
    }
  }
  return null;
}

/** Karakter aralığına değen kelimelerin kutularının birleşimi (bölge içi 0–1000 koordinat). */
export function spanBox(words, span) {
  const { spans } = lineLayout(words);
  let box = null;
  spans.forEach((s, i) => {
    if (s.end <= span.start || s.start >= span.end) return;
    const b = words[i].box;
    if (!Array.isArray(b) || b.length !== 4) return;
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : [...b];
  });
  return box;
}

/** Bölge içi 0–1000 kutuyu sayfa pikseline çevirir. */
export function toPageBox(rect, b) {
  return {
    x: rect.x + b[0] / 1000 * rect.w,
    y: rect.y + b[1] / 1000 * rect.h,
    w: Math.max(6, (b[2] - b[0]) / 1000 * rect.w),
    h: Math.max(6, (b[3] - b[1]) / 1000 * rect.h)
  };
}

/**
 * Kelime kutusu yoksa yedek: satır bandı + metindeki orana göre yatay tahmin.
 * @param {{x:number,y:number,w:number,h:number}} rect bölge
 * @param {{n:number,y0:number,y1:number}} lineBand sayfa koordinatında satır bandı
 */
export function estimateBox(rect, lineBand, lineText, span) {
  const len = Math.max(1, lineText.length);
  const left = rect.x + 70; // satır numarası sütunu
  const width = rect.w - 90;
  return {
    x: left + width * span.start / len,
    y: lineBand.y0 + 4,
    w: Math.max(14, width * (span.end - span.start) / len),
    h: Math.max(10, lineBand.y1 - lineBand.y0 - 8),
    estimated: true
  };
}

/**
 * Modelin döndürdüğü hatayı okumaya bağlar: span ve kutu hesaplanır, eksik alanlar denetlenir.
 * @param {object} err ham hata (line, quote, occurrence ...)
 * @param {object} region okuma bölgesi {rect, lines:[{n, words}]}
 * @param {{n:number,y0:number,y1:number}[]} [lineBands] bizim kağıdımızdaki satır bantları
 */
export function anchorError(err, region, lineBands) {
  const out = { ...err };
  const line = region?.lines?.find(l => l.n === err.line);
  if (!line) {
    out.span = null; out.box = null;
    return markUncertain(out, `Satır ${err.line} okumada bulunamadı`);
  }
  const { text } = lineLayout(line.words);
  const span = locateQuote(text, err.quote, err.occurrence || 1);
  if (!span) {
    out.span = null; out.box = null;
    return markUncertain(out, `“${err.quote}” ifadesi ${err.line}. satırda bulunamadı`);
  }
  out.span = span;
  const rect = line.rect || region.rect; // çok sayfalı writing'de her satır kendi bölgesini taşır
  const b = spanBox(line.words, span);
  if (b) out.box = toPageBox(rect, b);
  else {
    const band = lineBands?.find(x => x.n === err.line);
    out.box = band ? estimateBox(rect, band, text, span) : null;
  }
  if (out.box) out.box.page = line.page ?? region.page ?? 1;
  // [okunamadı] kelimesine dayanan bir hata kesin olamaz
  if (/\[okunamad[ıi]\]/i.test(text.slice(span.start, span.end))) markUncertain(out, 'Hata okunamayan bir kelimeye dayanıyor');
  return out;
}

export function markUncertain(e, reason) {
  e.certain = false;
  e.uncertainReason = e.uncertainReason ? `${e.uncertainReason}; ${reason}` : reason;
  return e;
}

/** Bir hatada şartnamenin istediği alanların hepsi var mı? Eksikler listesi döner. */
export function missingFields(e, rules) {
  const miss = [];
  if (!e.questionId) miss.push('soru');
  if (e.line !== null && !(e.line > 0)) miss.push('satır'); // kapalı uçlu ve kısa cevapta satır yok (null)
  if (!String(e.quote ?? '').trim() && e.code !== '^') miss.push('yazılan');
  if (!String(e.correction ?? e.corrected ?? '').trim()) miss.push('doğru biçim');
  if (!CODES[e.code]) miss.push('hata türü');
  const rule = rules?.find(r => r.ruleId === e.ruleId);
  if (!String(rule?.explanation || e.explanation || '').trim()) miss.push('açıklama');
  if (!SEVERITY[e.severity]) miss.push('ciddiyet');
  return miss;
}

/** Hataları konum sırasına koyup 1'den numaralandırır: soru sırası → satır → karakter. */
export function numberErrors(errors, exam) {
  const qOrder = new Map(exam.questions.map((q, i) => [q.id, i]));
  const sorted = [...errors].sort((a, b) =>
    (qOrder.get(a.questionId) ?? 999) - (qOrder.get(b.questionId) ?? 999) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.span?.start ?? 0) - (b.span?.start ?? 0));
  return sorted.map((e, i) => ({ ...e, no: i + 1, id: e.id || `e${i + 1}` }));
}

/** Aynı kuraldan gelen tekrarlar: ruleId → { count, lines, nos }. */
export function groupRecurring(errors) {
  const g = new Map();
  for (const e of errors) {
    if (!e.ruleId) continue;
    const k = e.ruleId;
    if (!g.has(k)) g.set(k, { ruleId: k, code: e.code, count: 0, lines: [], nos: [] });
    const x = g.get(k);
    x.count++; x.nos.push(e.no);
    if (e.line != null && !x.lines.includes(e.line)) x.lines.push(e.line);
  }
  return g;
}

/** "Bu hata kağıtta 4 kez geçiyor (Satır 2, 5, 7, 9)" */
export function recurrenceText(group, lang = 'tr') {
  if (!group || group.count < 2) return '';
  const lines = [...group.lines].sort((a, b) => a - b).join(', ');
  if (lang === 'en') return `This error occurs ${group.count} times on the paper` + (lines ? ` (Line ${lines})` : '');
  return `Bu hata kağıtta ${group.count} kez geçiyor` + (lines ? ` (Satır ${lines})` : '');
}

/** "−4 puan" ya da "GRA ölçütünü etkiliyor". */
export function impactText(e, lang = 'tr') {
  const i = e.impact || {};
  if (i.kind === 'points') {
    const p = Math.abs(Number(i.points) || 0);
    if (!p) return lang === 'en' ? 'No deduction' : 'Puan kırılmadı';
    return lang === 'en' ? `−${fmt(p)} points` : `−${fmt(p)} puan`;
  }
  if (i.kind === 'rubric' && CRITERIA[i.criterion]) {
    return lang === 'en' ? `Affects ${i.criterion} (${CRITERIA[i.criterion].en})` : `${i.criterion} (${CRITERIA[i.criterion].tr}) ölçütünü etkiliyor`;
  }
  return '—';
}

const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

/**
 * Kağıt sonu hata tablosu: | No | Soru/Satır | Yazılan | Doğrusu | Tür | Açıklama | Puan etkisi |
 * Tekrarlayan hatalarda açıklama yalnızca ilk geçişte yazılır; diğerleri ona gönderme yapar.
 */
export function errorTable(paper, exam, lang = 'tr') {
  const qNo = new Map(exam.questions.map(q => [q.id, q.no]));
  const groups = groupRecurring(paper.errors || []);
  const seen = new Set();
  return (paper.errors || []).map(e => {
    const rule = paper.rules?.find(r => r.ruleId === e.ruleId);
    let explanation = rule?.explanation || e.explanation || '';
    const g = groups.get(e.ruleId);
    if (e.ruleId && seen.has(e.ruleId)) explanation = lang === 'en' ? `See error ${g.nos[0]}` : `Bkz. hata ${g.nos[0]}`;
    else if (g && g.count > 1) explanation += ` (${recurrenceText(g, lang)})`;
    if (e.ruleId) seen.add(e.ruleId);
    const where = `S${qNo.get(e.questionId) ?? '?'}` + (e.line ? (lang === 'en' ? ` / Line ${e.line}` : ` / Satır ${e.line}`) : '');
    return {
      no: e.no, where,
      written: e.quote || (lang === 'en' ? '(missing)' : '(eksik)'),
      correct: e.correction || e.corrected || '',
      type: codeLabel(e.code, lang),
      explanation,
      impact: impactText(e, lang),
      certain: e.certain !== false
    };
  });
}

/** Hata tablosunu Markdown olarak (PDF/yazdırma ve testler için). */
export function errorTableMarkdown(rows, lang = 'tr') {
  const h = lang === 'en'
    ? '| No | Question/Line | Written | Correct | Type | Explanation | Score impact |'
    : '| No | Soru/Satır | Yazılan | Doğrusu | Tür | Açıklama | Puan etkisi |';
  const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [h, '|---|---|---|---|---|---|---|', ...rows.map(r =>
    `| ${r.no} | ${cell(r.where)} | ${cell(r.written)} | ${cell(r.correct)} | ${cell(r.type)} | ${cell(r.explanation)} | ${cell(r.impact)} |`)].join('\n');
}
