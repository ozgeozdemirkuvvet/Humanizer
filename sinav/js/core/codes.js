// Düzeltme kodları, rubrik ölçütleri ve işaret renkleri.
// Tek kaynak: arayüz, istemler, doğrulayıcı ve testler bu tabloyu kullanır.

/** Öğretmenlerin kağıt üzerinde kullandığı standart düzeltme kodları. */
export const CODES = Object.freeze({
  Gr: { tr: 'Dilbilgisi', en: 'Grammar', criterion: 'GRA' },
  Sp: { tr: 'Yazım', en: 'Spelling', criterion: 'LR' },
  WW: { tr: 'Yanlış kelime', en: 'Wrong word', criterion: 'LR' },
  WO: { tr: 'Kelime sırası', en: 'Word order', criterion: 'GRA' },
  T: { tr: 'Zaman (Tense)', en: 'Tense', criterion: 'GRA' },
  Agr: { tr: 'Özne-yüklem uyumu', en: 'Agreement', criterion: 'GRA' },
  Art: { tr: 'Tanımlık (a/an/the)', en: 'Article', criterion: 'GRA' },
  Prep: { tr: 'Edat (Preposition)', en: 'Preposition', criterion: 'GRA' },
  P: { tr: 'Noktalama', en: 'Punctuation', criterion: 'CC' },
  '^': { tr: 'Eksik kelime', en: 'Missing word', criterion: 'GRA' },
  Key: { tr: 'Yanlış cevap / içerik', en: 'Wrong answer / content', criterion: null }
});
export const CODE_LIST = Object.keys(CODES);

/** "T = Zaman (Tense) hatası" biçiminde açık ad. */
export function codeLabel(code, lang = 'tr') {
  const c = CODES[code];
  if (!c) return code;
  return lang === 'en' ? `${code} = ${c.en} error` : `${code} = ${c.tr} hatası`;
}

export const CRITERIA = Object.freeze({
  TA: { tr: 'Görevi yerine getirme', en: 'Task Achievement' },
  CC: { tr: 'Tutarlılık ve bağlaşıklık', en: 'Coherence & Cohesion' },
  LR: { tr: 'Kelime dağarcığı', en: 'Lexical Resource' },
  GRA: { tr: 'Dilbilgisi çeşitliliği ve doğruluğu', en: 'Grammatical Range & Accuracy' }
});
export const CRITERION_LIST = Object.keys(CRITERIA);

export const SEVERITY = Object.freeze({
  bozuyor: { tr: 'Anlamı bozuyor', en: 'Affects meaning' },
  bozmuyor: { tr: 'Anlamı bozmuyor', en: 'Does not affect meaning' }
});

/**
 * İşaret türü → renk sınıfı. Kırmızı = anlamı bozan hata, turuncu = anlamı bozmayan,
 * mavi = öneri, gri = öğretmen kontrolü gerekli (belirsiz hata ya da düşük güvenli okuma).
 */
export function markTone(item) {
  if (item.kind === 'suggestion') return 'blue';
  if (item.kind === 'reading' || item.certain === false) return 'gray';
  return item.severity === 'bozuyor' ? 'red' : 'orange';
}

export const QUESTION_TYPES = Object.freeze({
  open: { tr: 'Açık uçlu', closed: false, text: true },
  writing: { tr: 'Writing (kompozisyon)', closed: false, text: true },
  gap: { tr: 'Boşluk doldurma (tek kelime)', closed: false },
  mc: { tr: 'Çoktan seçmeli', closed: true },
  tf: { tr: 'Doğru / Yanlış', closed: true },
  match: { tr: 'Eşleştirme', closed: true }
});

/** Cevabı satırlarla yazılan ve yapay zekâ ile değerlendirilen tipler (açık uçlu, writing). */
export const isTextType = t => !!QUESTION_TYPES[t]?.text;

/** Açık uçlu soruda içerik noktası kararı → puan oranı. */
export const VERDICTS = Object.freeze({
  karsilandi: { tr: 'Karşılandı', en: 'Met', ratio: 1 },
  kismen: { tr: 'Kısmen', en: 'Partly met', ratio: 0.5 },
  eksik: { tr: 'Eksik / yanlış', en: 'Missing / wrong', ratio: 0 }
});

/** Açık uçlu soruda dil doğruluğu bandı (0–4), seviyeye göre yorumlanır. */
export const LANG_BANDS = [
  { band: 4, short: 'Hatasız', tr: 'Hatasız ya da yalnızca çok küçük hatalar', en: 'Accurate; at most very minor slips' },
  { band: 3, short: 'Az hata', tr: 'Birkaç hata var, anlam açık', en: 'A few errors; meaning clear' },
  { band: 2, short: 'Belirgin hata', tr: 'Belirgin hatalar, anlam çoğunlukla anlaşılıyor', en: 'Noticeable errors; meaning mostly clear' },
  { band: 1, short: 'Çok hata', tr: 'Çok hata, anlam zorlanıyor', en: 'Many errors; meaning strained' },
  { band: 0, short: 'Anlaşılmıyor', tr: 'Anlaşılmıyor ya da cevap yok', en: 'Not understandable or no answer' }
];

/** Baloncuklu sorunun seçenek harfleri. D/Y Türkçe kağıtlarda alışılmış olandır. */
export function optionLetters(q) {
  if (q.type === 'tf') return ['D', 'Y'];
  const n = Math.max(2, Math.min(6, q.options || 4));
  return 'ABCDEF'.slice(0, n).split('');
}

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2'];
export const GRADES = { hazirlik: 'Hazırlık', 9: '9. sınıf', 10: '10. sınıf', 11: '11. sınıf', 12: '12. sınıf' };
