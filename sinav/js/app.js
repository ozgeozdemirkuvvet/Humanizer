// Kırmızı Kalem: uygulama kabuğu, yönlendirme, sınavlar, sınav düzenleyici, sınıflar, ayarlar, kağıt yazdırma.

import { h, $, $$, toast, modal, confirmDialog, download, fmt, fmtDate } from './ui/dom.js';
import { db, kv, deleteExam, wipeAll, exportBackup, importBackup } from './store/db.js';
import { newExam, newQuestion, validateExam } from './core/exam.js';
import { QUESTION_TYPES, optionLetters, CEFR_LEVELS, GRADES, CRITERIA } from './core/codes.js';
import { parseRoster } from './core/csv.js';
import { layoutSheet, renderSheetSVG } from './vision/sheet.js';
import { MODELS, DEFAULT_MODEL } from './ai/claude.js';
import { renderWorkspace } from './ui/workspace.js';
import { renderReview } from './ui/review.js';

export const app = {
  settings: {},
  async loadSettings() {
    this.settings = {
      apiKey: await kv.get('apiKey', ''), model: await kv.get('model', DEFAULT_MODEL),
      concurrency: await kv.get('concurrency', 6), anonymous: await kv.get('anonymous', false),
      theme: await kv.get('theme', ''), evalEffort: await kv.get('evalEffort', 'high')
    };
    applyTheme(this.settings.theme);
  }
};

function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

const view = () => $('#app');
function setNav(key) { $$('.nav a').forEach(a => (a.dataset.nav === key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'))); }
function mount(...nodes) { const v = view(); v.replaceChildren(...nodes); window.scrollTo(0, 0); }

// ---------------------------------------------------------------- Yönlendirme
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  try {
    if (!parts.length) { setNav('exams'); return await renderExams(); }
    if (parts[0] === 'siniflar') { setNav('rosters'); return await renderRosters(); }
    if (parts[0] === 'ayarlar') { setNav('settings'); return await renderSettings(); }
    if (parts[0] === 'sinav') {
      setNav('exams');
      if (parts[1] === 'yeni') return await renderEditor(newExam());
      const exam = await db.get('exams', parts[1]);
      if (!exam) { mount(h('div.empty', h('h2', 'Sınav bulunamadı'), h('a.btn', { href: '#/' }, 'Sınavlara dön'))); return; }
      if (parts[2] === 'duzenle') return await renderEditor(exam);
      if (parts[2] === 'yazdir') return renderPrint(exam);
      if (parts[2] === 'kagit' && parts[3]) return await renderReview(exam, parts[3], { mount, app });
      return await renderWorkspace(exam, { mount, app, tab: parts[2] });
    }
    location.hash = '#/';
  } catch (e) {
    console.error(e);
    mount(h('div.notice.err', 'Bir hata oluştu: ' + (e.message || e)));
  }
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- Sınavlar
async function renderExams() {
  const exams = (await db.all('exams')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const papers = await db.all('papers');
  const head = h('div.row', { style: { marginBottom: '14px' } }, h('h1', 'Sınavlar'), h('span.spacer'), h('a.btn.primary', { href: '#/sinav/yeni' }, '+ Yeni sınav'));
  if (!exams.length) {
    mount(head, h('div.empty.card',
      h('h2', 'İlk sınavınızı tanımlayın'),
      h('p.muted', 'Kırmızı Kalem kağıtları okur, puanlar, her hatayı kağıdın üzerinde gösterir ve nedenini açıklar. Hiçbir not siz onaylamadan kesinleşmez.'),
      h('div.steps',
        h('div', h('b', '1. Tanımla'), 'Açık uçlu sorular, örnek cevaplar, puanlar; istenirse writing ve test soruları.'),
        h('div', h('b', '2. Yazdır ve yükle'), 'Cevap kağıdını yazdırın; doldurulan kağıtları fotoğraf ya da PDF olarak toplu yükleyin.'),
        h('div', h('b', '3. İncele ve onayla'), 'Kağıt ve değerlendirme yan yana; düzenleyin, onaylayın, e-Okul listesini indirin.')),
      h('a.btn.primary', { href: '#/sinav/yeni' }, 'Yeni sınav oluştur')));
    return;
  }
  const cards = exams.map(ex => {
    const ps = papers.filter(p => p.examId === ex.id);
    const approved = ps.filter(p => p.status === 'onaylandi').length;
    const total = ex.questions.reduce((s, q) => s + (Number(q.points) || 0), 0);
    return h('div.card', { 'data-exam': ex.id },
      h('div.row', h('h2', { style: { margin: 0 } }, ex.name || 'Adsız sınav'), h('span.spacer'), h('span.chip.brand', ex.cefr)),
      h('p.muted.small', [GRADES[ex.grade] || ex.grade, ex.className, `${ex.questions.length} soru · ${fmt(total)} puan`, fmtDate(ex.updatedAt)].filter(Boolean).join(' · ')),
      h('div.row.small', h('span.chip', `${ps.length} kağıt`), h(`span.chip${approved === ps.length && ps.length ? '.ok' : ''}`, `${approved} onaylı`)),
      h('div.row', { style: { marginTop: '12px' } },
        h('a.btn.primary', { href: `#/sinav/${ex.id}` }, 'Kağıtlar'),
        h('a.btn', { href: `#/sinav/${ex.id}/duzenle` }, 'Düzenle'),
        ex.sheetMode !== 'serbest' && h('a.btn', { href: `#/sinav/${ex.id}/yazdir` }, 'Cevap kağıdı')));
  });
  mount(head, h('div.grid.cards', cards));
}

// ---------------------------------------------------------------- Sınav düzenleyici
async function renderEditor(exam) {
  const rosters = await db.all('rosters');
  const ex = structuredClone(exam);
  const isNew = !(await db.get('exams', ex.id));
  const status = h('div');
  const list = h('div.qlist');

  const field = (label, input, hint) => h('label.f', label, input, hint && h('span.h', hint));
  const bind = (obj, key, el, cast = v => v) => { el.addEventListener('input', () => { obj[key] = cast(el.type === 'checkbox' ? el.checked : el.value); refresh(); }); return el; };
  const sel = (obj, key, opts) => bind(obj, key, h('select', opts.map(([v, t]) => h('option', { value: v, selected: String(obj[key]) === String(v) }, t))));

  const general = h('div.card.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } },
    field('Sınav adı', bind(ex, 'name', h('input', { value: ex.name, placeholder: 'ör. 9. Sınıf 1. Dönem 1. Yazılı', required: true }))),
    field('Sınıf düzeyi', sel(ex, 'grade', Object.entries(GRADES))),
    field('Şube', bind(ex, 'className', h('input', { value: ex.className, list: 'roster-names', placeholder: 'ör. 9-A' })), 'Sınıf listesindeki adla eşleşirse öğrenci adları numaradan bulunur.'),
    field('Hedef CEFR seviyesi', sel(ex, 'cefr', CEFR_LEVELS.map(l => [l, l])), 'Dil doğruluğu ve writing beklentisi bu seviyeye göre ayarlanır.'),
    field('Açıklama ve geri bildirim dili', sel(ex, 'explainLang', [['tr', 'Türkçe'], ['en', 'İngilizce']])),
    field('Açık uçlu sorularda dil payı', bind(ex, 'langWeight', h('select', [[0, '%0 — yalnızca içerik (dil hataları işaretlenir, puan kırmaz)'], [20, '%20'], [30, '%30 (önerilen)'], [40, '%40'], [50, '%50']].map(([v, t]) => h('option', { value: v, selected: Number(ex.langWeight ?? 30) === v }, t))), Number), 'Sorunun puanının bu kadarı dil doğruluğuna, kalanı içeriğe ayrılır. İçerik tamamen yanlışsa dil puanı verilmez.'),
    field('Yazım hatası toleransı', sel(ex, 'spelling', [['esnek', 'Esnek (küçük yazım farkı kabul)'], ['katı', 'Katı (birebir)']]), 'Boşluk doldurma ve kısa cevaplar için.'),
    field('Kağıt türü', sel(ex, 'sheetMode', [['kirmizikalem', 'Kırmızı Kalem cevap kağıdı (önerilen)'], ['serbest', 'Kendi kağıdım (serbest)']]), 'Önerilen kağıtta sorular basılı gelir, okul numarası cihazda okunur ve ad hiçbir yere gönderilmez.'),
    h('datalist#roster-names', rosters.map(r => h('option', { value: r.id }))));
  const freeOpts = h('div.card.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' } },
    field('Karartılacak üst bant (%)', bind(ex, 'redactTop', h('input', { type: 'number', min: 0, max: 50, step: 1, value: Math.round((ex.redactTop ?? 0.15) * 100) }), v => Number(v) / 100), 'Ad ve numaranın yazdığı üst bölüm yapay zekâya gönderilmeden karartılır.'),
    field('Öğrenci başına sayfa', bind(ex, 'pagesPerStudent', h('input', { type: 'number', min: 1, max: 6, value: ex.pagesPerStudent || 1 }), Number), 'Yüklenen sayfalar bu sayıda gruplanarak bir öğrenciye atanır.'));

  function drawQuestions() {
    list.replaceChildren(...ex.questions.map((q, i) => questionRow(q, i)));
  }
  function questionRow(q, i) {
    const t = QUESTION_TYPES[q.type];
    const fields = h('div.fields');
    fields.append(field('Tip', h('select', { onchange: e => { const nq = newQuestion(e.target.value, q.no); ex.questions[i] = { ...nq, id: q.id, points: q.points, text: q.text, outcome: q.outcome }; drawQuestions(); refresh(); } },
      Object.entries(QUESTION_TYPES).map(([k, v]) => h('option', { value: k, selected: k === q.type }, v.tr)))));
    fields.append(field('Puan', bind(q, 'points', h('input', { type: 'number', min: 0, step: 0.5, value: q.points }), Number)));
    if (q.type === 'mc' || q.type === 'match') fields.append(field('Seçenek sayısı', h('select', { onchange: e => { q.options = Number(e.target.value); q.key = q.key.filter(k => optionLetters(q).includes(k)); drawQuestions(); refresh(); } }, [2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: n === q.options }, String(n))))));
    if (t.closed) {
      const pick = h('div.keypick', { role: 'group', 'aria-label': `Soru ${q.no} cevap anahtarı` }, optionLetters(q).map(l => h('button', { type: 'button', 'aria-pressed': String(q.key.includes(l)), onclick: e => {
        q.key = q.key.includes(l) ? q.key.filter(k => k !== l) : [...q.key, l];
        e.currentTarget.setAttribute('aria-pressed', String(q.key.includes(l))); refresh();
      } }, l)));
      fields.append(h('div.f', h('span', { style: { fontWeight: 600, fontSize: '.9rem' } }, 'Cevap anahtarı'), pick, h('span.h.small.muted', 'Birden fazla doğru seçenek seçilebilir.')));
    }
    if (q.type === 'gap') {
      fields.append(field('Doğru cevap', bind(q, 'key', h('input', { value: (q.key || []).join(' | ') }), v => v.split('|').map(x => x.trim()).filter(Boolean))));
      fields.append(field('Kabul edilen alternatifler', bind(q, 'alternatives', h('input', { value: (q.alternatives || []).join(' | '), placeholder: "ör. had gone | 'd gone" }), v => v.split('|').map(x => x.trim()).filter(Boolean)), '"|" ile ayırın.'));
    }
    if (q.type === 'writing') {
      fields.append(field('En az kelime', bind(q, 'minWords', h('input', { type: 'number', min: 0, value: q.minWords }), Number)));
      fields.append(field('En fazla kelime', bind(q, 'maxWords', h('input', { type: 'number', min: 0, value: q.maxWords }), Number)));
      fields.append(field('Satır sayısı (kağıtta)', bind(q, 'lines', h('input', { type: 'number', min: 4, max: 60, value: q.lines }), Number)));
      fields.append(h('div.f.wide', h('span', { style: { fontWeight: 600, fontSize: '.9rem' } }, 'Rubrik ağırlıkları'),
        h('div.row', Object.keys(CRITERIA).map(c => h('label.row.small', { title: CRITERIA[c].tr }, h('b', c), bind(q.rubric, c, h('input', { type: 'number', min: 0, max: 5, step: 0.5, value: q.rubric[c], style: { width: '70px' } }), Number)))),
        h('span.h.small.muted', 'TA görevi yerine getirme · CC tutarlılık · LR kelime · GRA dilbilgisi. 0 = ölçüt kullanılmaz.')));
    }
    if (q.type === 'open') {
      fields.append(field('Cevap satırı (kağıtta)', bind(q, 'lines', h('input', { type: 'number', min: 1, max: 30, value: q.lines }), Number)));
      fields.append(h('label.f.wide', 'Soru (kağıda basılır)', bind(q, 'text', h('textarea', { rows: 2, placeholder: 'ör. Why did Tom go to London? Answer according to the text.' }, q.text || ''))));
      fields.append(h('label.f.wide', 'Örnek doğru cevap', bind(q, 'modelAnswer', h('textarea', { rows: 2, placeholder: 'ör. He went to London to visit his grandmother.' }, q.modelAnswer || '')),
        h('span.h', 'Farklı ama doğru ifadeler de kabul edilir; örnek cevap yalnızca anlamı tarif eder.')));
      fields.append(h('label.f.wide', 'Olması gereken noktalar (isteğe bağlı, her satıra bir nokta)', bind(q, 'keyPoints', h('textarea', { rows: 2, placeholder: 'ör.\nLondra’ya gitti\nbüyükannesini ziyaret etmek için' }, (q.keyPoints || []).join('\n')), v => v.split('\n').map(x => x.trim()).filter(Boolean)),
        h('span.h', 'İçerik puanı noktalara eşit bölünür; kısmen karşılanan nokta yarım puan alır. Boş bırakırsanız örnek cevabın anlamı tek nokta sayılır.')));
      fields.append(field('Kazanım (isteğe bağlı)', bind(q, 'outcome', h('input', { value: q.outcome || '', placeholder: 'ör. E9.1.R1' }))));
      return h('div.q',
        h('div', h('div.no', `${q.no}.`), qMoveButtons(q, i)),
        fields);
    }
    fields.append(h('label.f.wide', q.type === 'writing' ? 'Görev (yönerge)' : 'Soru metni (isteğe bağlı)', bind(q, 'text', h('textarea', { rows: q.type === 'writing' ? 3 : 2, placeholder: q.type === 'writing' ? 'ör. Write an e-mail to a friend about your last holiday (80–100 words).' : 'Yanlış cevaplarda kuralın açıklanabilmesi için soru metnini yazın.' }, q.text || '')),
      h('span.h', q.type === 'writing' ? 'Görevi yerine getirme ölçütü bu yönergeye göre değerlendirilir.' : '')));
    fields.append(field('Kazanım (isteğe bağlı)', bind(q, 'outcome', h('input', { value: q.outcome || '', placeholder: 'ör. E9.1.R1' }))));
    return h('div.q', h('div', h('div.no', `${q.no}.`), qMoveButtons(q, i)), fields);
  }
  function qMoveButtons(q, i) {
    return h('div.row', { style: { justifyContent: 'center', marginTop: '6px' } },
      h('button.btn.ghost.sm', { title: 'Yukarı taşı', 'aria-label': `Soru ${q.no} yukarı`, disabled: i === 0, onclick: () => { [ex.questions[i - 1], ex.questions[i]] = [ex.questions[i], ex.questions[i - 1]]; renumber(); } }, '↑'),
      h('button.btn.ghost.sm.danger', { title: 'Sil', 'aria-label': `Soru ${q.no} sil`, onclick: () => { ex.questions.splice(i, 1); renumber(); } }, '✕'));
  }
  function renumber() { ex.questions.forEach((q, i) => { q.no = i + 1; }); drawQuestions(); refresh(); }
  function refresh() {
    const v = validateExam(ex);
    freeOpts.hidden = ex.sheetMode !== 'serbest';
    status.replaceChildren(
      h('div.row', h('b', `Toplam: ${fmt(v.total)} puan`), h('span.muted.small', `${ex.questions.length} soru`)),
      ...v.errors.map(e => h('div.notice.err.small', e)),
      ...v.warnings.map(w => h('div.notice.small', w)));
    return v;
  }
  async function save() {
    const v = refresh();
    if (v.errors.length) { toast('Kaydetmeden önce kırmızı uyarıları düzeltin.'); status.scrollIntoView({ behavior: 'smooth' }); return; }
    if (!isNew) {
      const ps = await db.byExam('papers', ex.id);
      const changedLayout = JSON.stringify(layoutSheet(exam)) !== JSON.stringify(layoutSheet(ex));
      if (ps.length && changedLayout && !(await confirmDialog('Kağıt yerleşimi değişti', 'Bu sınava yüklenmiş kağıtlar var. Soru sırası ya da tipi değiştiği için daha önce basılmış cevap kağıtları yeni yerleşimle uyuşmayabilir. Yine de kaydedilsin mi?', { ok: 'Kaydet' }))) return;
    }
    ex.updatedAt = new Date().toISOString();
    await db.put('exams', ex);
    toast('Sınav kaydedildi.');
    location.hash = `#/sinav/${ex.id}`;
  }
  const addBar = h('div.row', Object.entries(QUESTION_TYPES).map(([k, v]) => h('button.btn.sm', { onclick: () => { ex.questions.push(newQuestion(k, ex.questions.length + 1)); drawQuestions(); refresh(); list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, `+ ${v.tr}`)));
  const quick = h('button.btn.sm', { onclick: async () => {
    const r = await modal(close => {
      const t = h('select', [['open', 'Açık uçlu'], ['mc', 'Çoktan seçmeli']].map(([v, x]) => h('option', { value: v }, x)));
      const n = h('input', { type: 'number', min: 1, max: 60, value: 5 }), p = h('input', { type: 'number', min: 0.5, step: 0.5, value: 10 });
      const o = h('input', { type: 'number', min: 1, max: 30, value: 3 });
      const oLabel = h('span', 'Cevap satırı');
      t.addEventListener('change', () => { oLabel.textContent = t.value === 'mc' ? 'Seçenek sayısı' : 'Cevap satırı'; o.value = t.value === 'mc' ? 4 : 3; p.value = t.value === 'mc' ? 2 : 10; });
      return h('div', h('h2', 'Soruları hızlı ekle'), h('div.grid', field('Soru tipi', t), field('Soru sayısı', n), field('Her biri kaç puan', p), h('label.f', oLabel, o)),
        h('p.small.muted', 'Soru metinlerini ve cevapları sonra tek tek doldurursunuz.'),
        h('div.row', { style: { marginTop: '12px' } }, h('span.spacer'), h('button.btn', { onclick: () => close() }, 'Vazgeç'), h('button.btn.primary', { onclick: () => close({ t: t.value, n: Number(n.value), p: Number(p.value), o: Number(o.value) }) }, 'Ekle')));
    });
    if (!r) return;
    for (let i = 0; i < r.n; i++) {
      const q = newQuestion(r.t, ex.questions.length + 1); q.points = r.p;
      if (r.t === 'mc') q.options = Math.max(2, Math.min(6, r.o)); else q.lines = Math.max(1, r.o);
      ex.questions.push(q);
    }
    drawQuestions(); refresh();
  } }, '⚡ Hızlı ekle');

  drawQuestions();
  mount(
    h('div.row', { style: { marginBottom: '14px' } }, h('h1', isNew ? 'Yeni sınav' : 'Sınavı düzenle'), h('span.spacer'),
      !isNew && h('button.btn.danger', { onclick: async () => { if (await confirmDialog('Sınavı sil', 'Sınav, tüm kağıtları, görüntüleri ve düzenleme kayıtları kalıcı olarak silinecek.', { ok: 'Sil', danger: true })) { await deleteExam(ex.id); toast('Sınav silindi.'); location.hash = '#/'; } } }, 'Sil'),
      h('a.btn', { href: isNew ? '#/' : `#/sinav/${ex.id}` }, 'Vazgeç'), h('button.btn.primary', { onclick: save }, 'Kaydet')),
    h('div.grid', general, freeOpts,
      h('div.row', h('h2', { style: { margin: '8px 0 0' } }, 'Sorular'), h('span.spacer'), quick),
      list, h('div.card', addBar), h('div.card.grid', status)));
  refresh();
}

// ---------------------------------------------------------------- Cevap kağıdı yazdırma
function renderPrint(exam) {
  const layout = layoutSheet(exam);
  const pages = layout.pages.map((_, i) => {
    const wrap = h('div', { style: { background: '#fff', marginBottom: '16px', boxShadow: 'var(--shadow)', maxWidth: '820px' } });
    wrap.innerHTML = renderSheetSVG(exam, layout, i + 1, { className: exam.className }); // SVG metni esc() ile kaçırılmış olarak üretilir
    const svg = wrap.firstElementChild; svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; svg.style.height = 'auto';
    return wrap;
  });
  const printArea = h('div.sheet-print.print-only');
  printArea.innerHTML = layout.pages.map((_, i) => renderSheetSVG(exam, layout, i + 1, { className: exam.className })).join('');
  mount(
    h('div.row.no-print', { style: { marginBottom: '14px' } }, h('h1', 'Cevap kağıdı'), h('span.spacer'),
      h('a.btn', { href: `#/sinav/${exam.id}` }, 'Geri'), h('button.btn.primary', { onclick: () => window.print() }, 'Yazdır')),
    h('p.muted.no-print', `${layout.pages.length} sayfa · A4 · Sınıf sayısı kadar çoğaltın. Kağıt sayfa ölçeğiyle (%100) yazdırılmalı; köşe kareleri ve alt şerit okuma için gereklidir.`),
    h('div.no-print', pages), printArea);
}

// ---------------------------------------------------------------- Sınıflar
async function renderRosters() {
  const rosters = (await db.all('rosters')).sort((a, b) => a.id.localeCompare(b.id, 'tr'));
  const name = h('input', { placeholder: 'ör. 9-A' });
  const text = h('textarea', { rows: 8, placeholder: 'Okul No;Adı Soyadı\n101;Ayşe Yılmaz\n102;Can Demir' });
  const file = h('input', { type: 'file', accept: '.csv,.txt', onchange: async () => { if (file.files[0]) text.value = await file.files[0].text(); } });
  const save = async () => {
    const id = name.value.trim();
    const students = parseRoster(text.value);
    if (!id) return toast('Şube adını yazın.');
    if (!students.length) return toast('Listede geçerli öğrenci bulunamadı (No;Ad Soyad).');
    await db.put('rosters', { id, students, updatedAt: new Date().toISOString() });
    toast(`${id}: ${students.length} öğrenci kaydedildi.`);
    renderRosters();
  };
  mount(
    h('h1', 'Sınıf listeleri'),
    h('p.muted', 'Numara → ad eşlemesi için kullanılır. e-Okul’dan aldığınız listeyi yapıştırın ya da CSV yükleyin. Liste yalnızca bu cihazda saklanır.'),
    h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' } },
      h('div.card.grid', h('h2', 'Liste ekle / güncelle'), h('label.f', 'Şube', name), h('label.f', 'Öğrenciler', text, h('span.h', '"No;Ad Soyad" ya da "Ad Soyad,No". Başlık satırı olabilir.')), file,
        h('div.row', h('span.spacer'), h('button.btn.primary', { onclick: save }, 'Kaydet'))),
      h('div.grid', rosters.length ? rosters.map(r => h('div.card',
        h('div.row', h('h2', { style: { margin: 0 } }, r.id), h('span.chip', `${r.students.length} öğrenci`), h('span.spacer'),
          h('button.btn.sm', { onclick: () => { name.value = r.id; text.value = r.students.map(s => `${s.no};${s.name}`).join('\n'); name.focus(); } }, 'Düzenle'),
          h('button.btn.sm.danger', { onclick: async () => { if (await confirmDialog('Listeyi sil', `${r.id} listesi silinecek.`, { ok: 'Sil', danger: true })) { await db.del('rosters', r.id); renderRosters(); } } }, 'Sil')),
        h('p.small.muted', r.students.slice(0, 6).map(s => `${s.no} ${s.name}`).join(' · ') + (r.students.length > 6 ? ' …' : ''))))
        : h('div.card.muted', 'Henüz sınıf listesi yok.'))));
}

// ---------------------------------------------------------------- Ayarlar
async function renderSettings() {
  const s = app.settings;
  const key = h('input', { type: 'password', value: s.apiKey, autocomplete: 'off', placeholder: 'sk-ant-…' });
  const model = h('select', MODELS.map(m => h('option', { value: m.id, selected: m.id === s.model }, m.label)));
  const conc = h('input', { type: 'number', min: 1, max: 12, value: s.concurrency });
  const effort = h('select', [['high', 'Yüksek (önerilen)'], ['medium', 'Orta (daha hızlı)'], ['xhigh', 'Çok yüksek (daha yavaş)']].map(([v, t]) => h('option', { value: v, selected: v === s.evalEffort }, t)));
  const anon = h('input', { type: 'checkbox', checked: s.anonymous });
  const theme = h('select', [['', 'Sistem'], ['light', 'Açık'], ['dark', 'Koyu']].map(([v, t]) => h('option', { value: v, selected: v === s.theme }, t)));
  const save = async () => {
    Object.assign(s, { apiKey: key.value.trim(), model: model.value, concurrency: Math.max(1, Math.min(12, Number(conc.value) || 6)), evalEffort: effort.value, anonymous: anon.checked, theme: theme.value });
    for (const k of ['apiKey', 'model', 'concurrency', 'evalEffort', 'anonymous', 'theme']) await kv.set(k, s[k]);
    applyTheme(s.theme);
    toast('Ayarlar kaydedildi.');
  };
  const pw = () => modal(close => { const p = h('input', { type: 'password', autocomplete: 'new-password' });
    return h('div', h('h2', 'Yedek parolası'), h('p.muted', 'Yedek bu parolayla şifrelenir. Parolayı unutursanız yedek açılamaz.'), h('label.f', 'Parola (en az 8 karakter)', p),
      h('div.row', { style: { marginTop: '12px' } }, h('span.spacer'), h('button.btn', { onclick: () => close() }, 'Vazgeç'), h('button.btn.primary', { onclick: () => { if (p.value.length < 8) return toast('Parola en az 8 karakter olmalı.'); close(p.value); } }, 'Devam'))); });
  const backupFile = h('input', { type: 'file', accept: '.kkyedek', hidden: true, onchange: async () => {
    const f = backupFile.files[0]; if (!f) return; const p = await pw(); if (!p) return;
    try { const r = await importBackup(f, p); toast(`Yedek yüklendi: ${r.exams} sınav, ${r.papers} kağıt.`); } catch (e) { toast(e.message); }
  } });
  mount(
    h('h1', 'Ayarlar'),
    h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' } },
      h('div.card.grid',
        h('h2', 'Yapay zekâ (Claude)'),
        h('label.f', 'Anthropic API anahtarı', key, h('span.h', 'Yalnızca bu tarayıcıda saklanır ve yalnızca api.anthropic.com adresine gönderilir. Ortak bilgisayarda kullanmayın.')),
        h('label.f', 'Model', model),
        h('label.f', 'Değerlendirme derinliği', effort),
        h('label.f', 'Eşzamanlı kağıt sayısı', conc, h('span.h', '30 kağıt için 6 önerilir. Hız sınırı hatası alırsanız azaltın.')),
        h('div.notice.info.small', 'Gizlilik: Yapay zekâya yalnızca cevap bölgelerinin görüntüsü ve okunan metin gider. Öğrenci adı ve numarası hiçbir istekte yer almaz; kapalı uçlu sorular cihazınızda okunur.')),
      h('div.card.grid',
        h('h2', 'Görünüm ve gizlilik'),
        h('label.row', anon, h('span', 'Anonim mod: öğrenci adları yerine “Öğrenci 07” gibi takma adlar göster')),
        h('label.f', 'Tema', theme),
        h('div.row', h('span.spacer'), h('button.btn.primary', { onclick: save }, 'Kaydet'))),
      h('div.card.grid',
        h('h2', 'Yedek ve silme (KVKK)'),
        h('p.muted.small', 'Tüm veriler yalnızca bu tarayıcıda saklanır. Cihaz değiştirmeden önce şifreli yedek alın.'),
        h('div.row',
          h('button.btn', { onclick: async () => { const p = await pw(); if (!p) return; toast('Yedek hazırlanıyor…'); download(`kirmizi-kalem-${new Date().toISOString().slice(0, 10)}.kkyedek`, await exportBackup(p)); } }, 'Şifreli yedek al'),
          h('button.btn', { onclick: () => backupFile.click() }, 'Yedeği geri yükle'), backupFile),
        h('hr', { style: { border: 0, borderTop: '1px solid var(--line)', width: '100%' } }),
        h('p.small', h('b', 'Dönem sonu toplu silme: '), 'tüm sınavlar, kağıtlar, görüntüler, sınıf listeleri, düzenleme kayıtları ve yapay zekâ önbelleği kalıcı olarak silinir. Ayarlar korunur.'),
        h('button.btn.danger', { onclick: async () => {
          const ok = await modal(close => { const t = h('input', { placeholder: 'SİL' });
            return h('div', h('h2', 'Her şeyi sil'), h('p.muted', 'Bu işlem geri alınamaz. Onaylamak için SİL yazın.'), t,
              h('div.row', { style: { marginTop: '12px' } }, h('span.spacer'), h('button.btn', { onclick: () => close(false) }, 'Vazgeç'), h('button.btn.danger', { onclick: () => close(t.value.trim().toLocaleUpperCase('tr') === 'SİL') }, 'Kalıcı olarak sil'))); });
          if (ok) { await wipeAll(); toast('Tüm veriler silindi.'); location.hash = '#/'; }
        } }, 'Tüm verileri sil'))));
}

// ---------------------------------------------------------------- Başlat
await app.loadSettings();
route();
window.KK = { app, db }; // testler için
