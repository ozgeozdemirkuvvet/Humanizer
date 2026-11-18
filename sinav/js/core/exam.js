// Sınav tanımı: oluşturma, doğrulama, parmak izi.

import { QUESTION_TYPES, optionLetters, CEFR_LEVELS } from './codes.js';

export function newExam(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || uid(),
    name: '', grade: '9', className: '', cefr: 'A2', explainLang: 'tr', langWeight: 30,
    spelling: 'esnek', sheetMode: 'kirmizikalem', redactTop: 0.15,
    questions: [], createdAt: now, updatedAt: now,
    ...partial
  };
}

export function newQuestion(type, no) {
  const base = { id: uid().slice(0, 8), no, type, points: type === 'writing' ? 20 : type === 'open' ? 10 : 2, key: [], text: '', outcome: '' };
  if (type === 'open') return { ...base, modelAnswer: '', keyPoints: [], lines: 4 };
  if (type === 'mc') return { ...base, options: 4 };
  if (type === 'match') return { ...base, options: 5 };
  if (type === 'gap') return { ...base, alternatives: [] };
  if (type === 'writing') return { ...base, minWords: 60, maxWords: 100, lines: 16, rubric: { TA: 1, CC: 1, LR: 1, GRA: 1 } };
  return base;
}

/**
 * Sınav tanımını denetler. Hatalar (kaydı engeller) ve uyarılar (bilgi) ayrı döner.
 * @returns {{errors:string[], warnings:string[], total:number}}
 */
export function validateExam(exam) {
  const errors = [], warnings = [];
  if (!String(exam.name || '').trim()) errors.push('Sınav adı boş.');
  if (!CEFR_LEVELS.includes(exam.cefr)) errors.push('Hedef CEFR seviyesi seçilmedi.');
  if (!exam.questions?.length) errors.push('En az bir soru ekleyin.');
  const nos = new Set();
  let total = 0;
  for (const q of exam.questions || []) {
    const tag = `Soru ${q.no}`;
    if (!QUESTION_TYPES[q.type]) { errors.push(`${tag}: bilinmeyen soru tipi.`); continue; }
    if (nos.has(q.no)) errors.push(`${tag}: soru numarası tekrar ediyor.`);
    nos.add(q.no);
    const p = Number(q.points);
    if (!(p > 0)) errors.push(`${tag}: puan 0'dan büyük olmalı.`);
    else total += p;
    if (QUESTION_TYPES[q.type].closed) {
      const letters = optionLetters(q);
      if (!q.key?.length) errors.push(`${tag}: cevap anahtarı boş.`);
      for (const k of q.key || []) if (!letters.includes(String(k).toUpperCase())) errors.push(`${tag}: “${k}” geçerli bir seçenek değil (${letters.join(', ')}).`);
    }
    if (q.type === 'gap' && !q.key?.some(k => String(k).trim())) errors.push(`${tag}: doğru cevap boş.`);
    if (q.type === 'open') {
      if (!String(q.text || '').trim()) errors.push(`${tag}: soru metni boş; açık uçlu cevap sorusuz değerlendirilemez.`);
      if (!String(q.modelAnswer || '').trim() && !(q.keyPoints || []).some(k => String(k).trim())) errors.push(`${tag}: örnek cevap ya da olması gereken noktalardan en az biri girilmeli.`);
      if (!(Number(q.lines) >= 1)) errors.push(`${tag}: cevap satırı sayısı en az 1 olmalı.`);
    }
    if (q.type === 'writing') {
      const w = q.rubric || {};
      if (!Object.values(w).some(v => Number(v) > 0)) errors.push(`${tag}: en az bir rubrik ölçütünün ağırlığı 0'dan büyük olmalı.`);
      if (!String(q.text || '').trim()) warnings.push(`${tag}: writing görevi (yönerge) boş; görevi yerine getirme ölçütü yönergesiz değerlendirilemez.`);
      if (q.minWords && q.maxWords && Number(q.minWords) > Number(q.maxWords)) errors.push(`${tag}: en az kelime, en fazla kelimeden büyük.`);
    }
    if ((q.type === 'mc' || q.type === 'gap') && !String(q.text || '').trim()) warnings.push(`${tag}: soru metni boş; yanlış cevaplar için kural açıklaması üretilemez, yalnızca doğru cevap gösterilir.`);
  }
  const lw = Number(exam.langWeight ?? 30);
  if (exam.questions?.some(q => q.type === 'open') && !(lw >= 0 && lw <= 100)) errors.push('Açık uçlu sorularda dil payı 0 ile 100 arasında olmalı.');
  if (total && Math.abs(total - 100) > 1e-9) warnings.push(`Toplam puan ${total}; not 100'e ölçeklenecek.`);
  return { errors, warnings, total };
}

/** 6 bitlik sınav parmak izi: basılı kağıdın alt şeridine yazılır, yanlış sınav kağıdını yakalar. */
export function examFingerprint(exam) {
  let h = 2166136261;
  for (const ch of String(exam.id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 64;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
