// Sınav çalışma alanı: kağıt yükleme, işleme ilerlemesi, kağıt listesi ve sonuçlar (e-Okul CSV).

import { h, toast, download, fmt, confirmDialog } from './dom.js';
import { db } from '../store/db.js';
import { ingest, bus, stats, configure, regrade, isBusy } from '../engine.js';
import { eOkulCSV } from '../core/csv.js';
import { QUESTION_TYPES } from '../core/codes.js';
import { layoutSheet } from '../vision/sheet.js';

export const STATUS = {
  yuklendi: ['Sayfa bekleniyor', ''], degerlendiriliyor: ['Değerlendiriliyor…', 'brand'],
  degerlendirildi: ['İncelemeye hazır', 'warn'], onaylandi: ['Onaylandı', 'ok'], hata: ['Hata', 'c-red']
};

export function studentLabel(p, app) {
  const s = p.student || {};
  if (app.settings.anonymous) return s.pseudonym || (s.no ? `Öğrenci (${s.no})` : 'Öğrenci ?');
  return [s.no || '—', s.name || (s.no ? '' : 'numara okunamadı')].filter(Boolean).join(' · ');
}

let unsub = null;

export async function renderWorkspace(exam, { mount, app, tab }) {
  configure(app.settings);
  if (unsub) unsub();
  const results = tab === 'sonuclar';
  const layout = layoutSheet(exam);
  const listBox = h('div');
  const progress = h('div.grid', { hidden: true });

  const fileInput = h('input', { type: 'file', multiple: true, accept: 'image/*,application/pdf,.pdf,.heic', hidden: true, onchange: () => { start([...fileInput.files]); fileInput.value = ''; } });
  const drop = h('div.drop', { role: 'button', tabindex: 0, 'aria-label': 'Kağıt yükle: dosya seçin ya da buraya bırakın',
    onclick: () => fileInput.click(), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
    ondragover: e => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: e => { e.preventDefault(); drop.classList.remove('over'); start([...e.dataTransfer.files]); } },
  h('div', { style: { fontSize: '2rem' }, 'aria-hidden': 'true' }, '📄'),
  h('h2', 'Kağıtları yükleyin'),
  h('p.muted', 'Fotoğraf (JPG, PNG) ya da taranmış PDF; birden fazla dosya seçebilirsiniz. Sayfalar otomatik düzeltilir, kırpılır ve öğrenciye eşlenir.'),
  h('span.btn.primary', 'Dosya seç'), fileInput);

  async function start(files) {
    if (!files.length) return;
    if (!app.settings.apiKey) toast('API anahtarı yok: kapalı uçlu sorular puanlanır; el yazısı ve writing için Ayarlar’dan anahtar ekleyin.', 6000);
    await ingest(exam, files);
  }

  const onProgress = () => drawProgress();
  const onPaper = () => drawList();
  const onError = e => toast(e.detail.message, 6000);
  const onIdle = e => { drawProgress(); const d = e.detail; if (d.startedAt && d.finishedAt) toast(`${d.done} kağıt ${duration(d.finishedAt - d.startedAt)} içinde işlendi.${d.failed ? ` ${d.failed} hata.` : ''}`, 6000); };
  bus.addEventListener('progress', onProgress); bus.addEventListener('paper', onPaper); bus.addEventListener('error', onError); bus.addEventListener('idle', onIdle);
  unsub = () => { bus.removeEventListener('progress', onProgress); bus.removeEventListener('paper', onPaper); bus.removeEventListener('error', onError); bus.removeEventListener('idle', onIdle); };
  window.addEventListener('hashchange', () => { unsub?.(); unsub = null; }, { once: true });

  function drawProgress() {
    const total = stats.done + stats.failed + stats.pending;
    progress.hidden = !total || (!isBusy() && !stats.pending);
    const pct = total ? Math.round((stats.done + stats.failed) / total * 100) : 0;
    progress.replaceChildren(
      h('div.row.small', h('b', 'İşleniyor'), h('span.muted', `${stats.done + stats.failed}/${total} kağıt`), h('span.spacer'), stats.startedAt ? h('span.muted', duration(Date.now() - stats.startedAt)) : null),
      h('div.progress', { role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: pct + '%' } })));
  }

  async function drawList() {
    const papers = sortPapers(await db.byExam('papers', exam.id));
    if (results) return drawResults(papers);
    if (!papers.length) { listBox.replaceChildren(h('p.muted', { style: { marginTop: '12px' } }, 'Henüz kağıt yüklenmedi.')); return; }
    const needs = papers.filter(p => p.status === 'degerlendirildi').length;
    listBox.replaceChildren(
      h('div.row', { style: { margin: '18px 0 8px' } }, h('h2', { style: { margin: 0 } }, `Kağıtlar (${papers.length})`), h('span.spacer'),
        needs ? h('a.btn.primary', { href: `#/sinav/${exam.id}/kagit/${papers.find(p => p.status === 'degerlendirildi').id}` }, `İncelemeye başla (${needs})`) : null),
      h('div.table-wrap', h('table', h('thead', h('tr', h('th', 'Öğrenci'), h('th', 'Durum'), h('th', 'Not'), h('th', 'Kontrol'), h('th', h('span.sr-only', 'İşlem')))),
        h('tbody', papers.map(p => {
          const [label, cls] = STATUS[p.status] || [p.status, ''];
          const flags = (p.needsReview ? 1 : 0);
          const go = () => { location.hash = `#/sinav/${exam.id}/kagit/${p.id}`; };
          return h('tr.click', { 'data-paper': p.id, onclick: e => { if (!e.target.closest('button')) go(); } },
            h('td', h('b', studentLabel(p, app)), p.student && !p.student.confirmed ? h('div.small', h('span.chip.warn', 'kimlik onayı')) : null, p.pages.some(x => x.detect?.examMatch === false) ? h('div.small', h('span.chip.c-red', 'başka sınav?')) : null),
            h('td', h(`span.chip${cls ? '.' + cls : ''}`, label), p.status === 'yuklendi' ? h('div.small.muted', `${p.pages.length}/${layout.pages.length} sayfa`) : null, p.error ? h('div.small', { style: { color: 'var(--ink-red)', maxWidth: '360px' } }, p.error) : null),
            h('td', p.total ? h('b', String(p.total.grade100)) : '—'),
            h('td', flags && p.status !== 'onaylandi' ? h('span.chip.c-gray', 'öğretmen kontrolü') : ''),
            h('td', { style: { whiteSpace: 'nowrap' } },
              (p.status === 'hata' || p.status === 'yuklendi') ? h('button.btn.sm', { onclick: () => regrade(exam, p.id) }, p.status === 'yuklendi' ? 'Eksik sayfayla değerlendir' : 'Yeniden dene') : null,
              h('button.btn.sm.ghost.danger', { 'aria-label': 'Kağıdı sil', title: 'Kağıdı sil', onclick: async () => {
                if (!(await confirmDialog('Kağıdı sil', `${studentLabel(p, app)} kağıdı ve görüntüleri silinecek.`, { ok: 'Sil', danger: true }))) return;
                for (const pg of p.pages) { if (pg.imageId) await db.del('images', pg.imageId); await db.del('images', pg.sourceId); }
                await db.del('papers', p.id); drawList();
              } }, '✕')));
        })))));
  }

  function drawResults(papers) {
    const graded = papers.filter(p => p.total);
    const approved = papers.filter(p => p.status === 'onaylandi');
    const grades = approved.map(p => p.total.grade100);
    const avg = grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : 0;
    const qStats = exam.questions.map(q => {
      const sc = graded.map(p => p.scores?.find(s => s.questionId === q.id)).filter(Boolean);
      const pct = sc.length ? sc.reduce((a, s) => a + (s.max ? s.earned / s.max : 0), 0) / sc.length * 100 : null;
      return { q, pct };
    });
    listBox.replaceChildren(
      h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', margin: '16px 0' } },
        statCard('Onaylı kağıt', `${approved.length}/${papers.length}`), statCard('Sınıf ortalaması', grades.length ? fmt(Math.round(avg * 10) / 10) : '—'),
        statCard('En yüksek', grades.length ? String(Math.max(...grades)) : '—'), statCard('En düşük', grades.length ? String(Math.min(...grades)) : '—')),
      h('div.row', { style: { marginBottom: '10px' } }, h('h2', { style: { margin: 0 } }, 'Not listesi'), h('span.spacer'),
        h('button.btn.primary', { onclick: () => {
          const { csv, skipped } = eOkulCSV(exam, papers);
          if (!approved.length) return toast('Henüz onaylanmış kağıt yok. Notlar öğretmen onayı olmadan dışa aktarılmaz.');
          download(`${slug(exam.name)}-eokul.csv`, csv, 'text/csv;charset=utf-8');
          toast(skipped.length ? `${approved.length} onaylı not indirildi; ${skipped.length} kağıt onay bekliyor ve listeye alınmadı.` : `${approved.length} not indirildi.`, 6000);
        } }, 'e-Okul CSV indir')),
      approved.length < papers.length ? h('div.notice.small', { style: { marginBottom: '10px' } }, `${papers.length - approved.length} kağıt henüz onaylanmadı; bunlar e-Okul listesine alınmaz.`) : null,
      h('div.table-wrap', h('table', h('thead', h('tr', h('th', 'Okul No'), h('th', 'Öğrenci'), h('th', 'Ham puan'), h('th', 'Not (100)'), h('th', 'Durum'))),
        h('tbody', papers.map(p => h('tr.click', { onclick: () => { location.hash = `#/sinav/${exam.id}/kagit/${p.id}`; } },
          h('td', p.student?.no || '—'), h('td', app.settings.anonymous ? (p.student?.pseudonym || '—') : (p.student?.name || '—')),
          h('td', p.total ? `${fmt(p.total.earned)} / ${fmt(p.total.max)}` : '—'), h('td', h('b', p.total ? String(p.total.grade100) : '—')),
          h('td', h(`span.chip.${STATUS[p.status]?.[1] || ''}`, STATUS[p.status]?.[0] || p.status))))))),
      h('h2', { style: { marginTop: '22px' } }, 'Soru bazında başarı'),
      h('div.table-wrap', h('table', h('thead', h('tr', h('th', 'Soru'), h('th', 'Tip'), h('th', 'Başarı'), h('th', 'Kazanım'))),
        h('tbody', qStats.map(({ q, pct }) => h('tr', h('td', `${q.no}.`), h('td', QUESTION_TYPES[q.type].tr),
          h('td', pct == null ? '—' : h('div.row', h('div.progress', { style: { width: '120px' } }, h('i', { style: { width: pct + '%', background: pct < 50 ? 'var(--m-red)' : pct < 70 ? 'var(--m-orange)' : 'var(--ok)' } })), `%${Math.round(pct)}`)),
          h('td.muted', q.outcome || '')))))));
  }

  mount(
    h('div.row', { style: { marginBottom: '6px' } }, h('h1', { style: { margin: 0 } }, exam.name), h('span.spacer'),
      h('a.btn', { href: `#/sinav/${exam.id}/duzenle` }, 'Düzenle'), exam.sheetMode !== 'serbest' ? h('a.btn', { href: `#/sinav/${exam.id}/yazdir` }, 'Cevap kağıdı') : null),
    h('p.muted.small', [exam.className, `CEFR ${exam.cefr}`, `${exam.questions.length} soru`, exam.sheetMode === 'serbest' ? 'serbest kağıt' : 'Kırmızı Kalem kağıdı'].filter(Boolean).join(' · ')),
    h('div.tabs', { role: 'tablist', style: { marginBottom: '16px' } },
      h('button', { role: 'tab', 'aria-selected': String(!results), onclick: () => { location.hash = `#/sinav/${exam.id}`; } }, 'Kağıtlar'),
      h('button', { role: 'tab', 'aria-selected': String(results), onclick: () => { location.hash = `#/sinav/${exam.id}/sonuclar`; } }, 'Sonuçlar')),
    results ? null : drop, results ? null : h('div', { style: { marginTop: '12px' } }, progress),
    listBox);
  drawProgress();
  await drawList();
}

function statCard(label, value) { return h('div.card', h('div.small.muted', label), h('div.score-big', { style: { fontSize: '1.7rem' } }, value)); }
export function sortPapers(ps) { return [...ps].sort((a, b) => (parseInt(a.student?.no, 10) || 1e9) - (parseInt(b.student?.no, 10) || 1e9) || (a.createdAt || '').localeCompare(b.createdAt || '')); }
function duration(ms) { const s = Math.round(ms / 1000); return s < 60 ? `${s} sn` : `${Math.floor(s / 60)} dk ${s % 60} sn`; }
function slug(s) { return String(s || 'sinav').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'sinav'; }
