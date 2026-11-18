// Analitik writing rubriği: 4 ölçüt × 0–5 bant, beklentiler CEFR seviyesine göre kalibre.
// Bant tanımı seviyeden bağımsızdır ("hedefi ne ölçüde karşılıyor"); hedefin kendisi seviyeye göre değişir.
// Böylece A2 bir öğrenci A2 beklentisine göre 5 alabilir; B2 ölçütüyle cezalandırılmaz.

import { CRITERION_LIST } from './codes.js';

/** Seviye başına, ölçüt başına "tam karşılama" (bant 5) beklentisi. */
export const LEVEL_TARGETS = {
  A1: {
    TA: 'Covers the basic points of the task with simple, isolated phrases and sentences about personal/concrete topics.',
    CC: 'Links words or groups of words with very basic connectors (and, but, then).',
    LR: 'Uses a basic repertoire of words and simple phrases about personal details and concrete situations.',
    GRA: 'Shows limited control of a few simple memorised structures (present simple, to be, have got, can).'
  },
  A2: {
    TA: 'Addresses all parts of the task in simple terms; the message is clear to the reader.',
    CC: 'Links simple sentences with connectors like and, but, because, so, then, first, after that.',
    LR: 'Uses everyday vocabulary sufficient for routine topics; may repeat words; spelling of common words mostly correct.',
    GRA: 'Uses simple structures correctly (present/past simple, present continuous, going to, comparatives) though basic mistakes still occur systematically.'
  },
  B1: {
    TA: 'Addresses all parts of the task with relevant detail; produces a straightforward connected text of the required length.',
    CC: 'Writes a linear sequence of connected points; uses a range of linkers and some paragraphing.',
    LR: 'Has enough vocabulary to express themselves with some circumlocution on familiar topics; occasional wrong word choice.',
    GRA: 'Uses a repertoire of frequently used routines and patterns (past continuous, present perfect, modals, first conditional, relative clauses) reasonably accurately.'
  },
  B2: {
    TA: 'Fully develops all parts of the task with supporting reasons and examples; register appropriate to the reader.',
    CC: 'Clear, logically organised text with effective paragraphing and a variety of cohesive devices.',
    LR: 'Good range of vocabulary including some less common items and collocations; word choice errors do not cause confusion.',
    GRA: 'Good grammatical control with a range of complex structures (passives, conditionals, reported speech); errors are rare and do not lead to misunderstanding.'
  }
};

/** Seviyeden bağımsız bant ölçeği. */
export const BANDS = [
  { band: 5, tr: 'Hedef seviye beklentisini tamamen karşılıyor', en: 'Fully meets the target-level expectation' },
  { band: 4, tr: 'Büyük ölçüde karşılıyor, küçük eksikler var', en: 'Largely meets it, minor lapses' },
  { band: 3, tr: 'Kısmen karşılıyor, belirgin eksikler var', en: 'Partly meets it, noticeable gaps' },
  { band: 2, tr: 'Sınırlı karşılıyor, iletişim zaman zaman zorlaşıyor', en: 'Limited; communication sometimes strained' },
  { band: 1, tr: 'Çok sınırlı, yalnızca parçalar', en: 'Very limited; fragments only' },
  { band: 0, tr: 'Yanıt yok, konu dışı ya da değerlendirilemez', en: 'No response, off-topic or not assessable' }
];

/** İstemde kullanılacak rubrik metni (İngilizce; model için en tutarlı dil). */
export function rubricPromptText(cefr) {
  const t = LEVEL_TARGETS[cefr] || LEVEL_TARGETS.A2;
  const lines = [`Target level: CEFR ${cefr}. A band 5 means the student fully meets the ${cefr} expectation below — never judge against a higher level.`];
  for (const c of CRITERION_LIST) lines.push(`- ${c} (band 5 at ${cefr}): ${t[c]}`);
  lines.push('Band scale (all criteria):');
  for (const b of BANDS) lines.push(`  ${b.band} = ${b.en}`);
  return lines.join('\n');
}

/**
 * Bantlardan puan: soru puanı × Σ(ağırlık × bant/5) / Σ ağırlık, 0,5'e yuvarlanır.
 * @param {{criterion:string, band:number}[]} bands
 * @param {Record<string, number>} weights
 * @param {number} maxPoints
 */
export function rubricPoints(bands, weights, maxPoints) {
  let wsum = 0, acc = 0;
  for (const c of CRITERION_LIST) {
    const w = Number(weights?.[c] ?? 1);
    if (!(w > 0)) continue;
    const b = bands.find(x => x.criterion === c);
    const band = clampBand(b?.band);
    wsum += w; acc += w * band / 5;
  }
  if (!wsum) return 0;
  return Math.round((maxPoints * acc / wsum) * 2) / 2;
}

export function clampBand(b) {
  const n = Math.round(Number(b));
  return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
}
