// İşleme motoru: yüklenen dosyalar → sayfalar → (Worker) düzeltme + OMR → öğrenciye gruplama →
// eşzamanlı değerlendirme kuyruğu → IndexedDB. Arayüz `bus` olaylarını dinler.

import { db, aiCache } from './store/db.js';
import { fileToPages, toJpegBlob, toJpegBase64, blobToRGBA } from './browser/image.js';
import { layoutSheet } from './vision/sheet.js';
import { processPage } from './vision/pipeline.js';
import { gradePaper } from './grade.js';
import { makeClient, apiErrorMessage, loadSDK } from './ai/claude.js';
import { teacherPreferences } from './ai/prompts.js';
import { pseudonym } from './core/csv.js';
import { uid } from './core/exam.js';

export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

/** Bellekte tutulan sayfa sonuçları (kırpıntılar dahil): paperId → [sayfa sonucu] */
const pageCache = new Map();
export const stats = { pending: 0, done: 0, failed: 0, startedAt: 0, finishedAt: 0 };

// ---- Worker (yoksa ana iş parçacığında çalışır)
let worker = null, wseq = 0;
const wpending = new Map();
function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ev => { const p = wpending.get(ev.data.id); wpending.delete(ev.data.id); if (ev.data.error) p.reject(new Error(ev.data.error)); else p.resolve(ev.data.res); };
    worker.onerror = () => { worker = false; for (const p of wpending.values()) p.reject(new Error('worker')); wpending.clear(); };
  } catch { worker = false; }
  return worker;
}
async function runPipeline(rgba, exam, layout) {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise((resolve, reject) => { const id = ++wseq; wpending.set(id, { resolve, reject }); w.postMessage({ id, rgba, exam, layout }); });
    } catch (e) { if (e.message !== 'worker') throw e; }
  }
  await new Promise(r => setTimeout(r, 0));
  return processPage(rgba, { exam, layout });
}

// ---- Değerlendirme kuyruğu
const queue = [];
let running = 0;
let settingsRef = null;
export function configure(settings) { settingsRef = settings; }

function pump() {
  const limit = Math.max(1, settingsRef?.concurrency || 6);
  while (running < limit && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); if (!running && !queue.length) { stats.finishedAt = Date.now(); emit('idle', { ...stats }); } });
  }
}

/** Dosyaları işler: her sayfa düzeltilir, öğrenciye atanır; tamamlanan kağıt değerlendirme kuyruğuna girer. */
export async function ingest(exam, files) {
  const layout = layoutSheet(exam);
  const roster = exam.className ? await db.get('rosters', exam.className) : null;
  if (!stats.pending) { stats.done = 0; stats.failed = 0; stats.startedAt = Date.now(); stats.finishedAt = 0; }
  let openFree = null; // serbest kağıtta ardışık sayfa gruplama
  for (const file of files) {
    let pages;
    try { pages = await fileToPages(file); }
    catch (e) { emit('error', { message: e.message }); continue; }
    for (const pg of pages) {
      stats.pending++; emit('progress', { ...stats });
      try {
        const sourceBlob = await toJpegBlob(pg.rgba, 0.9);
        const res = await runPipeline(pg.rgba, exam, layout);
        if (!res.ok) {
          const p = await savePaper(exam, null, { sourceBlob, res, name: pg.name, roster });
          p.status = 'hata'; p.error = `${pg.name}: ${res.reason}. Kağıdın tamamı görünecek şekilde yeniden çekin ya da sınav ayarlarından “Kendi kağıdım” seçeneğini kullanın.`;
          await db.put('papers', p); stats.pending--; stats.failed++; emit('paper', p); emit('progress', { ...stats });
          continue;
        }
        let paper;
        if (res.mode === 'serbest') {
          const pps = Math.max(1, exam.pagesPerStudent || 1);
          if (openFree && openFree.pages.length < pps) paper = openFree;
          paper = await savePaper(exam, paper, { sourceBlob, res, name: pg.name, roster });
          openFree = paper.pages.length < pps ? paper : null;
          if (paper.pages.length >= pps) enqueue(exam, layout, paper.id); else { stats.pending--; emit('progress', { ...stats }); }
        } else {
          const existing = res.number.confident ? (await db.byExam('papers', exam.id)).find(p => p.student?.no === res.number.no && !p.pages.some(x => x.index === res.page) && p.status !== 'onaylandi') : null;
          paper = await savePaper(exam, existing, { sourceBlob, res, name: pg.name, roster });
          const have = new Set(paper.pages.map(x => x.index));
          if (layout.pages.every(lp => have.has(lp.index))) enqueue(exam, layout, paper.id);
          else { stats.pending--; emit('progress', { ...stats }); }
        }
      } catch (e) {
        console.error(e); stats.pending--; stats.failed++;
        emit('error', { message: `${pg.name}: ${e.message}` }); emit('progress', { ...stats });
      }
    }
  }
}

async function savePaper(exam, paper, { sourceBlob, res, name, roster }) {
  const now = new Date().toISOString();
  if (!paper) {
    const no = res.number?.no || '';
    const st = roster?.students.find(s => s.no === no);
    paper = {
      id: uid(), examId: exam.id, status: 'yuklendi', pages: [],
      student: { no, name: st?.name || '', confirmed: !!(res.number?.confident && st), pseudonym: roster && no ? pseudonym(no, roster.students) : '' },
      createdAt: now
    };
  }
  const sourceId = uid(), imageId = uid();
  await db.put('images', { id: sourceId, examId: exam.id, kind: 'source', blob: sourceBlob });
  if (res.display) await db.put('images', { id: imageId, examId: exam.id, kind: 'display', blob: await toJpegBlob(res.display, 0.88) });
  paper.pages.push({
    imageId: res.display ? imageId : null, sourceId, index: res.page ?? paper.pages.length + 1, name, mode: res.mode,
    width: res.width, height: res.height, warnings: res.warnings || [],
    detect: { examMatch: res.examMatch, rotation: res.rotation ?? 0, skewDeg: res.skewDeg ?? 0, redactPx: res.redactPx ?? 0 }
  });
  paper.pages.sort((a, b) => a.index - b.index);
  paper.updatedAt = now;
  if (res.ok) {
    const list = pageCache.get(paper.id) || [];
    list.push(res); list.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
    pageCache.set(paper.id, list);
  }
  await db.put('papers', paper);
  emit('paper', paper);
  return paper;
}

function enqueue(exam, layout, paperId) {
  queue.push(() => gradeJob(exam, layout, paperId));
  pump();
}

/** Bir kağıdı (yeniden) değerlendirir. Bellekte sayfa sonucu yoksa saklanan özgün görüntüden yeniden işler. */
async function gradeJob(exam, layout, paperId) {
  let paper = await db.get('papers', paperId);
  try {
    paper.status = 'degerlendiriliyor'; paper.error = null; await db.put('papers', paper); emit('paper', paper);
    let pages = pageCache.get(paperId);
    if (!pages || pages.length !== paper.pages.length) {
      pages = [];
      for (const pg of paper.pages) {
        const src = await db.get('images', pg.sourceId);
        pages.push(await runPipeline(await blobToRGBA(src.blob), exam, layout));
      }
      pageCache.set(paperId, pages);
    }
    let ai = null;
    if (settingsRef?.apiKey) {
      const { client } = await makeClient(settingsRef.apiKey);
      ai = { client, model: settingsRef.model, cache: aiCache, evalEffort: settingsRef.evalEffort };
    }
    const prefs = teacherPreferences(await db.byExam('edits', exam.id));
    const result = await gradePaper({ exam, layout, pages, ai, prefs, encode: img => toJpegBase64(img, 0.85), onStage: st => emit('stage', { paperId, stage: st }) });
    paper = await db.get('papers', paperId);
    Object.assign(paper, result, { status: 'degerlendirildi', aiUsed: !!ai, gradedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await db.put('papers', paper);
    pageCache.delete(paperId); // bellek: kırpıntılar artık gerekmiyor
    stats.done++;
  } catch (e) {
    console.error(e);
    const Anthropic = settingsRef?.apiKey ? await loadSDK().catch(() => null) : null;
    paper = await db.get('papers', paperId);
    paper.status = 'hata'; paper.error = apiErrorMessage(Anthropic, e);
    await db.put('papers', paper);
    stats.failed++;
  } finally {
    stats.pending = Math.max(0, stats.pending - 1);
    emit('paper', paper); emit('progress', { ...stats });
  }
}

/** Hatalı ya da eksik sayfalı kağıdı yeniden kuyruğa al. */
export function regrade(exam, paperId) {
  const layout = layoutSheet(exam);
  stats.pending++; emit('progress', { ...stats });
  queue.push(() => gradeJob(exam, layout, paperId));
  pump();
}

/** Öğretmen okumayı düzelttikten sonra yalnızca değerlendirmeyi yeniden çalıştırır. */
export async function reevaluate(exam, paper) {
  const { evaluate } = await import('./ai/claude.js');
  const { assemble, mergeRegions } = await import('./core/assemble.js');
  const { answerBoxFinder, lineBandsFinder } = await import('./vision/sheet.js');
  const { wrongAnswers } = await import('./grade.js');
  const layout = layoutSheet(exam);
  const free = paper.pages.some(p => p.mode === 'serbest');
  const { omr = [], regions = [], answers = [] } = paper.reading || {};
  const answerBox = free ? () => null : answerBoxFinder(layout);
  const lineBands = free ? () => [] : lineBandsFinder(layout);
  const local = assemble({ exam, omr, regions, answers, answerBox, lineBands, lang: exam.explainLang });
  let evaluation = null;
  if (settingsRef?.apiKey) {
    const { client } = await makeClient(settingsRef.apiKey);
    const prefs = teacherPreferences(await db.byExam('edits', exam.id));
    evaluation = await evaluate({ client, model: settingsRef.model, cache: aiCache, evalEffort: settingsRef.evalEffort }, exam, mergeRegions(regions), wrongAnswers(exam, local, omr, regions, answers), prefs);
  }
  const result = evaluation ? assemble({ exam, omr, regions, answers, evaluation, answerBox, lineBands, lang: exam.explainLang }) : local;
  return { ...result, evaluation: evaluation || paper.evaluation || null, feedback: result.feedback || paper.feedback };
}

/** Yalnızca yerel yeniden birleştirme (ör. öğretmen bir baloncuk okumasını düzeltti). Kayıtlı değerlendirme korunur. */
export async function reassemble(exam, paper) {
  const { assemble } = await import('./core/assemble.js');
  const { answerBoxFinder, lineBandsFinder } = await import('./vision/sheet.js');
  const layout = layoutSheet(exam);
  const free = paper.pages.some(p => p.mode === 'serbest');
  const { omr = [], regions = [], answers = [] } = paper.reading || {};
  const r = assemble({ exam, omr, regions, answers, evaluation: paper.evaluation || null, answerBox: free ? () => null : answerBoxFinder(layout), lineBands: free ? () => [] : lineBandsFinder(layout), lang: exam.explainLang });
  return { ...r, feedback: r.feedback || paper.feedback };
}

export function isBusy() { return running > 0 || queue.length > 0 || stats.pending > 0; }
