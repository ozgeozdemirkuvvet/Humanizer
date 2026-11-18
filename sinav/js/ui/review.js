// İnceleme ekranı: kağıt görüntüsü ve değerlendirme yan yana. Hatalar kağıdın üzerinde renkli,
// numaralı etiketlerle; etikete dokununca açıklama açılır. Öğretmen her puanı, bandı, hatayı,
// geri bildirimi ve okumayı düzenleyebilir; her düzenleme günlüğe yazılır. Onay olmadan not kesinleşmez.

import { h, s, $$, toast, modal, confirmDialog, fmt } from './dom.js';
import { db } from '../store/db.js';
import { uid } from '../core/exam.js';
import { CODES, CODE_LIST, CRITERIA, SEVERITY, VERDICTS, LANG_BANDS, isTextType, QUESTION_TYPES, codeLabel, markTone, optionLetters } from '../core/codes.js';
import { groupRecurring, groupKey, recurrenceText, explanationOf, impactText, errorTable, errorTableMarkdown, lineLayout } from '../core/errors.js';
import { rubricPoints, BANDS } from '../core/rubric.js';
import { scoreClosed, scoreOpen, totals } from '../core/scoring.js';
import { reevaluate, reassemble, configure } from '../engine.js';
import { STATUS, studentLabel, sortPapers } from './workspace.js';

const TONE_NAME = { red: 'Anlamı bozan hata', orange: 'Anlamı bozmayan hata', blue: 'Öneri', gray: 'Öğretmen kontrolü gerekli' };

export async function renderReview(exam, paperId, { mount, app }) {
  configure(app.settings);
  const paper = await db.get('papers', paperId);
  if (!paper) { mount(h('div.empty', h('h2', 'Kağıt bulunamadı'), h('a.btn', { href: `#/sinav/${exam.id}` }, 'Geri'))); return; }
  const all = sortPapers(await db.byExam('papers', exam.id));
  const idx = all.findIndex(p => p.id === paperId);
  const roster = exam.className ? await db.get('rosters', exam.className) : null;
  const lang = exam.explainLang || 'tr';
  const qById = new Map(exam.questions.map(q => [q.id, q]));
  let pageNo = 1, zoom = 1, active = null, tab = 'ozet';

  const back = h('a.btn.sm', { href: `#/sinav/${exam.id}` }, '← Kağıtlar');
  if (!paper.total) {
    const [label] = STATUS[paper.status] || [paper.status];
    mount(back, h('div.empty.card', { style: { marginTop: '14px' } }, h('h2', label), h('p.muted', paper.error || 'Bu kağıt henüz değerlendirilmedi. İşlem bitince burada görünecek.')));
    return;
  }

  // ------------------------------------------------------------ Kağıt paneli
  const urls = [];
  const imgEl = h('img', { alt: `${studentLabel(paper, app)} kağıdı, sayfa 1` });
  const svg = s('svg', { 'aria-label': 'Hata işaretleri', role: 'group' });
  const inner = h('div.paper-inner', imgEl, svg);
  const wrap = h('div.paper-wrap', inner);
  const pop = h('div.popover', { hidden: true });
  wrap.append(pop);
  const pageSel = paper.pages.length > 1 ? h('div.row', paper.pages.map((pg, i) => h('button.btn.sm', { 'aria-pressed': String(i === 0), onclick: e => { pageNo = i + 1; $$('button', e.currentTarget.parentElement).forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); drawPage(); } }, `Sayfa ${i + 1}`))) : null;
  const zoomBar = h('div.row', h('button.btn.sm', { 'aria-label': 'Uzaklaştır', onclick: () => setZoom(zoom / 1.25) }, '−'), h('button.btn.sm', { onclick: () => setZoom(1) }, 'Sığdır'), h('button.btn.sm', { 'aria-label': 'Yakınlaştır', onclick: () => setZoom(zoom * 1.25) }, '+'));
  const legend = h('div.legend', Object.entries({ red: 'Anlamı bozan', orange: 'Anlamı bozmayan', blue: 'Öneri', gray: 'Öğretmen kontrolü' }).map(([k, t]) => h('span', h('i', { style: { background: `var(--m-${k})` } }), t)));
  function setZoom(z) { zoom = Math.max(1, Math.min(4, z)); inner.style.width = `${zoom * 100}%`; }

  async function drawPage() {
    const pg = paper.pages[pageNo - 1];
    const im = pg.imageId ? await db.get('images', pg.imageId) : null;
    if (im) { const u = URL.createObjectURL(im.blob); urls.push(u); imgEl.src = u; }
    imgEl.alt = `${studentLabel(paper, app)} kağıdı, sayfa ${pageNo}`;
    svg.setAttribute('viewBox', `0 0 ${pg.width} ${pg.height}`);
    drawMarks();
  }

  function marksForPage() {
    const onPage = b => b && (b.page ?? 1) === (paper.pages[pageNo - 1].index ?? pageNo);
    const items = [];
    for (const e of paper.errors || []) if (onPage(e.box)) items.push({ kind: 'error', item: e, tone: markTone(e), label: String(e.no), box: e.box, keyBox: onPage(e.keyBox) ? e.keyBox : null });
    for (const sg of paper.suggestions || []) if (onPage(sg.box)) items.push({ kind: 'suggestion', item: sg, tone: 'blue', label: `Ö${sg.no}`, box: sg.box });
    for (const [i, f] of (paper.readingFlags || []).entries()) if (onPage(f.box)) items.push({ kind: 'reading', item: { ...f, id: `r${i}` }, tone: 'gray', label: '?', box: f.box });
    return items;
  }

  function drawMarks() {
    svg.replaceChildren();
    const placed = [];
    // Okunamadı işaretleri önce (altta), hatalar en üstte
    const items = marksForPage().sort((a, b) => (a.kind === 'reading') - (b.kind === 'reading')).reverse();
    for (const m of items) {
      const b = m.box;
      const g = s('g', { class: `mark t-${m.tone}${active && active !== m.item.id ? ' dim' : ''}${active === m.item.id ? ' active' : ''}`, tabindex: 0, role: 'button',
        'aria-label': `${m.kind === 'error' ? 'Hata' : m.kind === 'suggestion' ? 'Öneri' : 'Okuma'} ${m.label}: ${TONE_NAME[m.tone]}`,
        onclick: ev => { ev.stopPropagation(); select(m); }, onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(m); } } });
      if (b.shape === 'circle') g.append(s('circle', { class: 'u', cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: b.w / 2 }));
      else if (m.item.questionId && QUESTION_TYPES[qById.get(m.item.questionId)?.type]?.closed) g.append(s('rect', { class: 'area', x: b.x, y: b.y, width: b.w, height: b.h, rx: 6 }));
      else { g.append(s('rect', { class: 'area', x: b.x - 2, y: b.y, width: b.w + 4, height: b.h, rx: 4, style: 'fill-opacity:.08;stroke-opacity:0' })); g.append(s('path', { class: 'u', d: wavy(b.x, b.y + b.h + 2, b.w, m.kind === 'reading') })); }
      if (m.keyBox) g.append(s('circle', { class: 'keyring', cx: m.keyBox.x + m.keyBox.w / 2, cy: m.keyBox.y + m.keyBox.h / 2, r: m.keyBox.w / 2 + 2 }));
      // Etiket: üst üste binmesin diye sağa kaydır
      // Etiket ekranda ~12 px yarıçapta görünsün: sayfa birimine çevrilir (telefonda daha büyük)
      const R = labelRadius() * (m.label.length > 2 ? 1.2 : 1);
      let lx = b.x - R * 0.3;
      const ly = Math.max(R + 2, b.y - R * 0.9);
      while (placed.some(p => Math.hypot(p.x - lx, p.y - ly) < R * 2.1)) lx += R * 2.2;
      placed.push({ x: lx, y: ly });
      g.append(s('g', { class: 'tag' }, s('circle', { cx: lx, cy: ly, r: R }), s('text', { x: lx, y: ly, style: `font-size:${(R * 1.15).toFixed(1)}px` }, m.label)));
      svg.append(g);
    }
  }

  function labelRadius() {
    const pg = paper.pages[pageNo - 1];
    const shown = inner.clientWidth || 700;
    return Math.max(14, Math.min(42, 12 * pg.width / shown));
  }
  new ResizeObserver(() => drawMarks()).observe(wrap);

  function select(m) {
    active = m.item.id;
    drawMarks();
    const b = m.box, pg = paper.pages[pageNo - 1];
    pop.replaceChildren(card(m.kind, m.item, { compact: true }), h('div.row', { style: { marginTop: '6px' } }, h('span.spacer'), h('button.btn.sm', { onclick: () => { pop.hidden = true; active = null; drawMarks(); } }, 'Kapat'), m.kind === 'error' ? h('button.btn.sm', { onclick: () => { pop.hidden = true; showTab('hatalar'); focusCard(m.item.id); } }, 'Ayrıntı') : null));
    pop.hidden = false;
    const rect = inner.getBoundingClientRect(), sc = rect.width / pg.width;
    pop.style.left = `${Math.max(4, Math.min(rect.width - Math.min(360, rect.width * 0.9) - 4, b.x * sc))}px`;
    pop.style.top = `${(b.y + b.h + 14) * sc}px`;
    if (layoutEl.dataset.pane === 'paper' && window.matchMedia('(max-width: 980px)').matches) { /* telefonda kağıt üzerinde kal */ }
    else { showTab(m.kind === 'suggestion' ? 'oneriler' : m.kind === 'reading' ? 'okuma' : 'hatalar'); focusCard(m.item.id); }
  }
  svg.addEventListener('click', () => { active = null; pop.hidden = true; drawMarks(); });

  // ------------------------------------------------------------ Kartlar
  const groups = () => groupRecurring(paper.errors || []);
  function card(kind, e, { compact = false } = {}) {
    if (kind === 'reading') {
      return h('div.ecard.t-gray', h('div.head', h('span.num', '?'), h('b', `S${qById.get(e.questionId)?.no ?? '?'}${e.line ? ` · Satır ${e.line}` : ''}`), h('span.chip.c-gray', 'Öğretmen kontrolü gerekli')),
        h('div', e.text === '[okunamadı]' ? 'Bu kelime okunamadı; tahmin edilmedi.' : `Okuma güveni düşük (%${Math.round((e.confidence || 0) * 100)}): “${e.text}”`),
        e.guess && h('div.small.muted', `Olası okuma (puanlamaya alınmadı): “${e.guess}”`));
    }
    if (kind === 'suggestion') {
      return h('div.ecard.t-blue', { 'data-id': e.id }, h('div.head', h('span.num', `Ö${e.no}`), h('b', `S${qById.get(e.questionId)?.no} · Satır ${e.line}`), h('span.chip.c-blue', 'Öneri · puan kırılmaz')),
        h('div.fix', h('span', `“${e.quote}”`), ' → ', h('ins', e.suggestion)), e.reason && h('div.why', e.reason));
    }
    const tone = markTone(e);
    const q = qById.get(e.questionId);
    const g = groups().get(groupKey(e));
    const first = !g || g.nos[0] === e.no;
    const { explanation, example } = explanationOf(e, paper.rules);
    const where = `S${q?.no ?? '?'}` + (e.line ? ` · Satır ${e.line}` : '');
    return h(`div.ecard.t-${tone}`, { 'data-id': e.id, id: `err-${e.id}` },
      h('div.head', h('span.num', String(e.no)), h('b', where),
        h(`span.chip.c-${tone}`, { title: codeLabel(e.code, lang) }, e.code === 'Key' ? 'Yanlış cevap' : `${e.code} · ${CODES[e.code]?.tr || ''}`),
        h(`span.chip.c-${e.severity === 'bozuyor' ? 'red' : 'orange'}`, SEVERITY[e.severity]?.tr || ''),
        e.certain === false ? h('span.chip.c-gray', 'Öğretmen kontrolü gerekli') : null,
        e.teacherEdited ? h('span.chip', 'düzenlendi') : null),
      h('div.fix', h('del', e.quote || '(eksik)'), ' → ', h('ins', e.correction || e.corrected || '')),
      !compact && e.original && e.corrected && e.original !== e.corrected ? h('div.small', h('span.muted', 'Öğrenci: '), `“${e.original}”`, h('br'), h('span.muted', 'Doğrusu: '), `“${e.corrected}”`) : null,
      h('div.small.muted', codeLabel(e.code, lang)),
      first ? h('div.why', h('b', 'Neden? '), explanation || '—') : h('div.why.small', `Açıklama: bkz. hata ${g.nos[0]}`),
      first && example ? h('div.ex', 'Örnek: ', example) : null,
      first && g && g.count > 1 ? h('div.small', h('b', recurrenceText(g, lang))) : null,
      h('div.small', h('b', 'Puana etkisi: '), impactText(e, lang)),
      e.certain === false && e.uncertainReason ? h('div.small', { style: { color: 'var(--ink-gray)' } }, h('b', 'Kontrol nedeni: '), e.uncertainReason) : null,
      compact ? null : h('div.row', h('span.spacer'),
        h('button.btn.sm', { onclick: () => editError(e) }, 'Düzenle'),
        e.certain === false ? h('button.btn.sm', { onclick: () => confirmError(e) }, 'Hata olarak onayla') : null,
        h('button.btn.sm.danger', { onclick: () => deleteError(e) }, 'Sil')));
  }
  function focusCard(id) {
    setTimeout(() => { const el = side.querySelector(`[data-id="${CSS.escape(id)}"]`); if (el) { $$('.ecard.active', side).forEach(x => x.classList.remove('active')); el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 30);
  }

  // ------------------------------------------------------------ Düzenleme
  async function logEdit(kind, before, after, note = '') {
    await db.put('edits', { id: uid(), examId: exam.id, paperId: paper.id, at: new Date().toISOString(), kind, before, after, note });
  }
  async function persist(msg) {
    paper.total = totals(exam, paper.scores);
    paper.needsReview = paper.scores.some(x => x.needsReview) || paper.errors.some(e => e.certain === false);
    paper.updatedAt = new Date().toISOString();
    await db.put('papers', paper);
    drawMarks(); drawSide(); drawBar();
    if (msg) toast(msg);
  }
  const brief = e => ({ quote: e.quote, code: e.code, ruleId: e.ruleId, severity: e.severity, correction: e.correction, certain: e.certain, line: e.line, questionId: e.questionId });

  async function deleteError(e) {
    const note = await modal(close => { const t = h('input', { placeholder: 'ör. Bu seviyede kabul edilebilir' });
      return h('div', h('h2', `Hata ${e.no} silinsin mi?`), h('p.muted', 'Silme kaydedilir ve bu sınavın sonraki değerlendirmelerinde benzer işaretlemeler yapılmaz.'), h('label.f', 'Neden (isteğe bağlı)', t),
        h('div.row', { style: { marginTop: '12px' } }, h('span.spacer'), h('button.btn', { onclick: () => close(null) }, 'Vazgeç'), h('button.btn.danger', { onclick: () => close(t.value.trim()) }, 'Sil'))); });
    if (note === null || note === undefined) return;
    await logEdit('error.delete', brief(e), null, note);
    paper.errors = renumber(paper.errors.filter(x => x.id !== e.id));
    // Kapalı uçlu yanlış cevap hatası silindiyse puanı öğretmen ayrıca düzenler (Özet sekmesi)
    await persist('Hata silindi.');
  }
  async function confirmError(e) {
    const before = brief(e);
    e.certain = true; e.uncertainReason = ''; e.teacherEdited = true;
    await logEdit('error.edit', before, brief(e), 'öğretmen hatayı onayladı');
    await persist('Hata onaylandı.');
  }
  async function editError(e, isNew = false) {
    const f = {};
    const inp = (k, v, attrs = {}) => (f[k] = h('input', { value: v ?? '', ...attrs }));
    const ta = (k, v) => (f[k] = h('textarea', { rows: 2 }, v ?? ''));
    const { explanation, example } = explanationOf(e, paper.rules);
    const writingQs = exam.questions;
    const res = await modal(close => h('div', h('h2', isNew ? 'Hata ekle' : `Hata ${e.no}`),
      h('div.grid', { style: { gridTemplateColumns: '1fr 1fr' } },
        h('label.f', 'Soru', f.questionId = h('select', writingQs.map(q => h('option', { value: q.id, selected: q.id === e.questionId }, `${q.no}. ${QUESTION_TYPES[q.type].tr}`)))),
        h('label.f', 'Satır', inp('line', e.line ?? '', { type: 'number', min: 1 })),
        h('label.f', 'Öğrencinin yazdığı', inp('quote', e.quote)), h('label.f', 'Doğru biçim', inp('correction', e.correction)),
        h('label.f', 'Tür', f.code = h('select', CODE_LIST.map(c => h('option', { value: c, selected: c === e.code }, codeLabel(c))))),
        h('label.f', 'Ciddiyet', f.severity = h('select', Object.entries(SEVERITY).map(([k, v]) => h('option', { value: k, selected: k === e.severity }, v.tr))))),
      h('label.f', 'Doğru cümle', inp('corrected', e.corrected)),
      h('label.f', 'Neden yanlış (açıklama)', ta('explanation', explanation)),
      h('label.f', 'Benzer doğru örnek', inp('example', example)),
      h('label.row', f.certain = h('input', { type: 'checkbox', checked: e.certain !== false }), 'Kesin hata (işaretsizse gri: öğretmen kontrolü)'),
      h('label.f', 'Not (isteğe bağlı; sonraki değerlendirmelere yol gösterir)', inp('note', '')),
      h('div.row', { style: { marginTop: '12px' } }, h('span.spacer'), h('button.btn', { onclick: () => close(null) }, 'Vazgeç'), h('button.btn.primary', { onclick: () => close(true) }, 'Kaydet'))));
    if (!res) return;
    const before = isNew ? null : brief(e);
    const n = {
      ...e, questionId: f.questionId.value, line: f.line.value ? Number(f.line.value) : null, quote: f.quote.value.trim(), correction: f.correction.value.trim(),
      corrected: f.corrected.value.trim(), code: f.code.value, severity: f.severity.value, certain: f.certain.checked,
      uncertainReason: f.certain.checked ? '' : (e.uncertainReason || 'Öğretmen işaretledi'),
      explanation: f.explanation.value.trim(), example: f.example.value.trim(), teacherEdited: true, source: isNew ? 'ogretmen' : e.source
    };
    if (!n.quote || !n.correction || !n.explanation) return toast('Yazılan, doğru biçim ve açıklama zorunludur.');
    if (!n.impact) {
      const q = qById.get(n.questionId);
      n.impact = q?.type === 'writing' ? { kind: 'rubric', criterion: CODES[n.code]?.criterion || 'GRA' }
        : q?.type === 'open' ? (n.code === 'Key' ? { kind: 'content' } : { kind: 'language', weight: Number(exam.langWeight ?? 30) }) : { kind: 'points', points: 0 };
    }
    if (isNew) { n.id = `t${uid().slice(0, 6)}`; n.ruleId = n.ruleId || `ogretmen-${n.id}`; paper.errors.push(n); }
    else paper.errors = paper.errors.map(x => (x.id === e.id ? n : x));
    paper.errors = renumber(paper.errors);
    await logEdit(isNew ? 'error.add' : 'error.edit', before, brief(n), f.note.value.trim());
    await persist(isNew ? 'Hata eklendi.' : 'Hata güncellendi.');
  }
  function renumber(list) {
    const order = new Map(exam.questions.map((q, i) => [q.id, i]));
    return [...list].sort((a, b) => (order.get(a.questionId) ?? 99) - (order.get(b.questionId) ?? 99) || (a.line ?? 0) - (b.line ?? 0) || (a.span?.start ?? 1e9) - (b.span?.start ?? 1e9) || (a.no ?? 0) - (b.no ?? 0))
      .map((e, i) => ({ ...e, no: i + 1 }));
  }

  // ------------------------------------------------------------ Yan panel
  const side = h('div.side');
  const tabsEl = h('div.tabs', { role: 'tablist' });
  const body = h('div', { role: 'tabpanel' });
  side.append(tabsEl, body);
  const TABS = [['ozet', 'Özet'], ['hatalar', 'Hatalar'], ['oneriler', 'Öneriler'], ['tablo', 'Hata tablosu'], ['geribildirim', 'Geri bildirim'], ['okuma', 'Okuma']];
  function showTab(t) { if (t !== tab) { pop.hidden = true; } tab = t; drawSide(); }
  function drawSide() {
    const counts = { hatalar: paper.errors?.length || 0, oneriler: paper.suggestions?.length || 0, okuma: paper.readingFlags?.length || 0 };
    tabsEl.replaceChildren(...TABS.map(([k, t]) => h('button', { role: 'tab', 'aria-selected': String(tab === k), onclick: () => showTab(k) }, t, counts[k] ? ` (${counts[k]})` : '')));
    body.replaceChildren(({ ozet: summary, hatalar: errorsTab, oneriler: suggestionsTab, tablo: tableTab, geribildirim: feedbackTab, okuma: readingTab })[tab]());
  }

  function summary() {
    const st = paper.student || {};
    const noIn = h('input', { value: st.no || '', inputmode: 'numeric', style: { width: '110px' }, 'aria-label': 'Okul numarası' });
    const nameSel = roster ? h('select', { 'aria-label': 'Öğrenci' }, h('option', { value: '' }, '— Öğrenci seçin —'), roster.students.map(x => h('option', { value: x.no, selected: x.no === st.no }, app.settings.anonymous ? `${x.no}` : `${x.no} · ${x.name}`))) : null;
    const nameIn = roster ? null : h('input', { value: st.name || '', placeholder: 'Ad Soyad', 'aria-label': 'Ad soyad' });
    nameSel?.addEventListener('change', () => { noIn.value = nameSel.value; });
    noIn.addEventListener('input', () => { if (nameSel) nameSel.value = roster.students.some(x => x.no === noIn.value.trim()) ? noIn.value.trim() : ''; });
    const saveId = async () => {
      const no = noIn.value.trim().replace(/^0+(?=\d)/, '');
      const name = roster ? (roster.students.find(x => x.no === no)?.name || '') : nameIn.value.trim();
      if (!no) return toast('Okul numarasını girin.');
      const dup = all.find(p => p.id !== paper.id && p.student?.no === no);
      if (dup && !(await confirmDialog('Aynı numara', `${no} numaralı başka bir kağıt var. Yine de kaydedilsin mi?`))) return;
      paper.student = { ...st, no, name, confirmed: true, pseudonym: st.pseudonym };
      await persist('Öğrenci kimliği onaylandı.');
    };
    const warnings = [...new Set(paper.pages.flatMap(p => p.warnings || []))];
    return h('div.grid',
      h('div.card.grid',
        h('div.row', h('div', h('div.small.muted', 'Toplam'), h('div.score-big', String(paper.total.grade100)), h('div.small.muted', `${fmt(paper.total.earned)} / ${fmt(paper.total.max)} puan`)), h('span.spacer'),
          h(`span.chip.${STATUS[paper.status]?.[1] || ''}`, STATUS[paper.status]?.[0])),
        h('div.row', h('b', 'Öğrenci'), noIn, nameSel || nameIn, h('button.btn.sm', { onclick: saveId }, st.confirmed ? 'Kimliği güncelle' : 'Kimliği onayla'), st.confirmed ? h('span.chip.ok', 'onaylı') : h('span.chip.warn', 'onay bekliyor')),
        ...warnings.map(w => h('div.notice.small', w))),
      h('div.card', h('h3', 'Soru puanları'), exam.questions.map(q => scoreRow(q))));
  }

  function scoreRow(q) {
    const sc = paper.scores.find(x => x.questionId === q.id) || { questionId: q.id, earned: 0, max: q.points };
    const inp = h('input', { type: 'number', min: 0, max: sc.max, step: 0.5, value: sc.earned, 'aria-label': `Soru ${q.no} puanı` });
    inp.addEventListener('change', async () => {
      const v = Math.max(0, Math.min(sc.max, Number(inp.value) || 0));
      await logEdit('score.edit', { questionId: q.id, earned: sc.earned }, { questionId: q.id, earned: v });
      sc.earned = v; sc.auto = false; sc.needsReview = false; sc.reason = `${sc.reason.split(' · Öğretmen')[0]} · Öğretmen puanı`;
      await persist('Puan güncellendi.');
    });
    const row = h('div', h('div.qscore', h('b', `${q.no}.`), h('div', h('div.small', QUESTION_TYPES[q.type].tr, sc.needsReview ? h('span.chip.c-gray', { style: { marginLeft: '6px' } }, 'kontrol') : null), h('div.small.muted', sc.reason || ''), sc.reviewReason ? h('div.small', { style: { color: 'var(--ink-gray)' } }, sc.reviewReason) : null),
      h('div.row', { style: { gap: '4px', flexWrap: 'nowrap' } }, inp, h('span.small.muted', `/${fmt(sc.max)}`))));
    if (q.type === 'open' && sc.open) {
      const redo = async (kind, before, after) => {
        const r = scoreOpen(q, { points: sc.open.points, language: sc.open.language }, exam.langWeight ?? 30);
        Object.assign(sc, { earned: r.earned, open: r.open, auto: false, needsReview: false, reviewReason: undefined, reason: `${r.reason} · Öğretmen düzenledi` });
        await logEdit(kind, before, after);
        await persist('Puan yeniden hesaplandı.');
      };
      row.append(h('div', { style: { padding: '4px 0 10px 44px' } },
        h('div.small.muted', { style: { margin: '2px 0 6px' } }, q.text),
        sc.open.points.map(pt => {
          const sel = h('select', { 'aria-label': `Soru ${q.no} nokta ${pt.index + 1}`, style: { maxWidth: '150px' } }, Object.entries(VERDICTS).map(([k, v]) => h('option', { value: k, selected: k === pt.verdict }, v.tr)));
          sel.addEventListener('change', () => { const before = { questionId: q.id, point: pt.text, verdict: pt.verdict }; pt.verdict = sel.value; redo('point.edit', before, { questionId: q.id, point: pt.text, verdict: pt.verdict }); });
          return h('div.band', { style: { gridTemplateColumns: '1fr 150px' } },
            h('div', h('div.small', h('b', `${pt.index + 1}. `), pt.text), h('div.small.muted', pt.justification || '—')), sel);
        }),
        sc.open.langWeight > 0 ? (() => {
          const L = sc.open.language;
          const sel = h('select', { 'aria-label': `Soru ${q.no} dil bandı`, style: { maxWidth: '150px' } }, LANG_BANDS.map(b => h('option', { value: b.band, selected: b.band === L.band, title: b.tr }, `${b.band}/4 · ${b.short}`)));
          sel.addEventListener('change', () => { const before = { questionId: q.id, criterion: 'DIL', band: L.band }; L.band = Number(sel.value); redo('band.edit', before, { questionId: q.id, criterion: 'DIL', band: L.band }); });
          return h('div.band', { style: { gridTemplateColumns: '1fr 150px' } },
            h('div', h('div.small', h('b', `Dil doğruluğu (%${sc.open.langWeight})`)), h('div.small.muted', L.justification || '—')), sel);
        })() : h('div.small.muted', 'Dil payı %0: dil hataları işaretlenir, puan kırmaz.')));
    }
    if (q.type === 'writing' && sc.rubric?.length) {
      row.append(h('div', { style: { padding: '4px 0 10px 44px' } }, sc.rubric.map(b => {
        const sel = h('select', { 'aria-label': `${b.criterion} bandı` }, BANDS.map(x => h('option', { value: x.band, selected: x.band === b.band, title: x.tr }, String(x.band))));
        sel.addEventListener('change', async () => {
          const before = { criterion: b.criterion, band: b.band };
          b.band = Number(sel.value);
          sc.earned = rubricPoints(sc.rubric, q.rubric, sc.max); sc.auto = false;
          sc.reason = 'Rubrik: ' + sc.rubric.map(x => `${x.criterion} ${x.band}`).join(' · ') + ' · Öğretmen düzenledi';
          await logEdit('band.edit', before, { criterion: b.criterion, band: b.band });
          await persist('Bant güncellendi.');
        });
        const just = h('textarea', { rows: 2, 'aria-label': `${b.criterion} gerekçesi` }, b.justification);
        just.addEventListener('change', async () => { b.justification = just.value.trim(); await logEdit('band.edit', null, { criterion: b.criterion, justification: b.justification }); await persist(); });
        return h('div.band', h('b', { title: CRITERIA[b.criterion].tr }, b.criterion), sel, h('div', h('div.small.muted', CRITERIA[b.criterion].tr), just));
      })));
    }
    return row;
  }

  function errorsTab() {
    const list = paper.errors || [];
    return h('div.grid',
      h('div.row', h('span.muted.small', list.length ? `${list.length} hata · ${list.filter(e => e.certain === false).length} öğretmen kontrolü` : 'Hata bulunmadı.'), h('span.spacer'),
        h('button.btn.sm', { onclick: () => editError({ questionId: exam.questions.find(q => isTextType(q.type))?.id || exam.questions[0].id, severity: 'bozmuyor', code: 'Gr', certain: true }, true) }, '+ Hata ekle')),
      list.map(e => card('error', e)));
  }
  function suggestionsTab() {
    const list = paper.suggestions || [];
    return h('div.grid', h('p.small.muted', 'Hata olmayan ama daha iyi söylenebilecek ifadeler. Puan kırılmaz.'), list.length ? list.map(x => card('suggestion', x)) : h('p.muted', 'Öneri yok.'));
  }
  function tableTab() {
    const rows = errorTable(paper, exam, lang);
    return h('div.grid',
      h('div.row', h('span.spacer'), h('button.btn.sm', { onclick: async () => { await navigator.clipboard?.writeText(errorTableMarkdown(rows, lang)); toast('Tablo kopyalandı (Markdown).'); } }, 'Kopyala')),
      h('div.table-wrap', h('table', h('thead', h('tr', ['No', 'Soru/Satır', 'Yazılan', 'Doğrusu', 'Tür', 'Açıklama', 'Puan etkisi'].map(t => h('th', t)))),
        h('tbody', rows.map(r => h('tr', { style: r.certain ? null : { color: 'var(--ink-gray)' } }, h('td', String(r.no)), h('td', r.where), h('td', h('del', r.written)), h('td', h('ins', r.correct)), h('td', r.type), h('td', r.explanation), h('td', r.impact)))))));
  }
  function feedbackTab() {
    const fb = paper.feedback || { strength: '', improvements: [], studyTip: '' };
    const strength = h('textarea', { rows: 2 }, fb.strength || '');
    const imps = [0, 1, 2].map(i => h('input', { value: fb.improvements?.[i] || '', placeholder: `Gelişim alanı ${i + 1}` }));
    const tip = h('textarea', { rows: 2 }, fb.studyTip || '');
    const save = async () => {
      const before = structuredClone(fb);
      paper.feedback = { ...fb, strength: strength.value.trim(), improvements: imps.map(x => x.value.trim()).filter(Boolean), studyTip: tip.value.trim(), lang };
      await logEdit('feedback.edit', before, paper.feedback);
      await persist('Geri bildirim kaydedildi.');
    };
    return h('div.card.grid',
      fb.local ? h('div.notice.info.small', 'Bu geri bildirim yapay zekâ olmadan, yalnızca puanlardan üretildi.') : null,
      h('label.f', '💪 Güçlü yön', strength),
      h('div.f', h('span', { style: { fontWeight: 600, fontSize: '.9rem' } }, '🎯 Öncelikli gelişim alanları (en fazla 3)'), imps),
      h('label.f', '📚 Çalışma önerisi', tip),
      h('div.row', h('span.small.muted', `Dil: ${lang === 'en' ? 'İngilizce' : 'Türkçe'} (sınav ayarı)`), h('span.spacer'), h('button.btn.primary', { onclick: save }, 'Kaydet')));
  }
  function readingTab() {
    const reading = paper.reading || {};
    const omr = reading.omr || [];
    const closed = exam.questions.filter(q => QUESTION_TYPES[q.type].closed);
    const parts = [];
    if (closed.length && omr.length) {
      parts.push(h('div.card', h('h3', 'Optik okuma (cihazda)'), h('p.small.muted', 'Yanlış okunan bir işareti düzeltin; puan yeniden hesaplanır.'),
        h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' } }, closed.map(q => {
          const o = omr.find(x => x.questionId === q.id) || { state: 'bos', value: null };
          const sel = h('select', { 'aria-label': `Soru ${q.no} okunan cevap` }, h('option', { value: '', selected: o.state === 'bos' }, 'boş'), optionLetters(q).map(l => h('option', { value: l, selected: o.value === l && o.state !== 'coklu' }, l)), h('option', { value: '*', selected: o.state === 'coklu' }, 'çoklu'));
          sel.addEventListener('change', async () => {
            const before = { questionId: q.id, value: o.value, state: o.state };
            const v = sel.value;
            const n = v === '' ? { questionId: q.id, value: null, state: 'bos', confidence: 1, marked: [] } : v === '*' ? { ...o, state: 'coklu', value: null, confidence: 1 } : { questionId: q.id, value: v, state: 'isaretli', confidence: 1, marked: [v] };
            reading.omr = omr.filter(x => x.questionId !== q.id).concat({ ...n, teacher: true });
            await logEdit('reading.edit', before, { questionId: q.id, value: n.value, state: n.state });
            paper.reading = reading;
            Object.assign(paper, await reassemble(exam, paper));
            await persist(`Soru ${q.no}: ${scoreClosed(q, n).reason}`);
          });
          return h('label.row.small', { style: { gap: '6px', flexWrap: 'nowrap' } }, h('b', `${q.no}.`), sel, o.state === 'belirsiz' || o.state === 'coklu' ? h('span.chip.c-gray', '?') : null);
        }))));
    }
    for (const r of reading.regions || []) {
      const q = qById.get(r.questionId);
      parts.push(h('div.card', h('h3', `${q?.no}. ${QUESTION_TYPES[q?.type]?.tr || ''}${r.page ? ` · sayfa ${r.page}` : ''}`),
        r.lines.map(l => {
          const lineEl = h('div', l.words.map((w, i) => [i ? ' ' : '', h(`span${w.illegible ? '.w-ill' : w.confidence < 0.75 ? '.w-low' : ''}`, { title: `güven %${Math.round(w.confidence * 100)}` }, w.text)]));
          const edit = h('button.btn.sm.ghost', { 'aria-label': `Satır ${l.n} düzenle`, onclick: () => {
            const inp = h('input', { value: lineLayout(l.words).text });
            const ok = h('button.btn.sm', { onclick: async () => {
              const before = lineLayout(l.words).text, words = inp.value.trim().split(/\s+/).filter(Boolean);
              l.words = words.map((t, i) => ({ text: t, confidence: 1, box: words.length === l.words.length ? l.words[i].box : null, teacher: true }));
              await logEdit('reading.edit', { questionId: r.questionId, line: l.n, text: before }, { questionId: r.questionId, line: l.n, text: inp.value.trim() });
              paper.reading = reading; paper.readingEdited = true;
              await persist('Okuma düzeltildi. Puanlamayı güncellemek için “Yeniden değerlendir”e basın.');
            } }, 'Kaydet');
            lineEl.replaceChildren(h('div.row', { style: { flexWrap: 'nowrap' } }, inp, ok)); inp.focus();
          } }, '✎');
          return h('div.reading-line', h('span.muted', String(l.n)), h('div.row', { style: { flexWrap: 'nowrap', alignItems: 'start' } }, lineEl, edit));
        })));
    }
    if (!parts.length) parts.push(h('p.muted', 'Okunan metin yok.'));
    parts.unshift(h('div.row', h('span.small.muted', 'Gri: düşük güven · koyu gri: [okunamadı] (tahmin edilmedi).'), h('span.spacer'),
      h('button.btn.sm', { disabled: !app.settings.apiKey, title: app.settings.apiKey ? '' : 'API anahtarı gerekli', onclick: async e => {
        if (!(await confirmDialog('Yeniden değerlendir', 'Düzeltilmiş okumayla puanlar, hatalar ve geri bildirim yeniden üretilecek. Bu kağıtta elle yaptığınız hata düzenlemeleri sıfırlanır.', { ok: 'Yeniden değerlendir' }))) return;
        e.target.disabled = true; e.target.textContent = 'Değerlendiriliyor…';
        try { Object.assign(paper, await reevaluate(exam, paper)); paper.readingEdited = false; paper.status = 'degerlendirildi'; await persist('Yeniden değerlendirildi.'); }
        catch (err) { toast(err.message || String(err)); e.target.disabled = false; e.target.textContent = 'Yeniden değerlendir'; }
      } }, 'Yeniden değerlendir')));
    return h('div.grid', parts);
  }

  // ------------------------------------------------------------ Alt çubuk: gezinme ve onay
  const bar = h('div.reviewbar');
  function drawBar() {
    const prev = all[idx - 1], next = all[idx + 1];
    const approved = paper.status === 'onaylandi';
    bar.replaceChildren(h('div.in',
      h('a.btn', { href: prev ? `#/sinav/${exam.id}/kagit/${prev.id}` : null, 'aria-disabled': String(!prev), style: prev ? null : { pointerEvents: 'none', opacity: 0.4 }, title: 'Önceki (J)' }, '←', h('span.label', ' Önceki')),
      h('span.small.muted', `${idx + 1}/${all.length}`),
      h('span.spacer'),
      h('button.btn.pane-toggle', { 'aria-label': 'Kağıt / Değerlendirme', title: 'Kağıt ile değerlendirme arasında geç', onclick: () => { layoutEl.dataset.pane = layoutEl.dataset.pane === 'paper' ? 'eval' : 'paper'; pop.hidden = true; } }, '⇄', h('span.label', ' Kağıt / Değerlendirme')),
      h('b', { style: { fontSize: '1.15rem' } }, String(paper.total.grade100)),
      approved
        ? h('button.btn', { onclick: async () => { paper.status = 'degerlendirildi'; paper.approvedAt = null; await logEdit('approve.undo', null, null); await persist('Onay kaldırıldı.'); } }, 'Onayı kaldır')
        : h('button.btn.ok', { onclick: approve, title: 'Onayla ve sonrakine geç (A)' }, '✓ Onayla', h('span.label', next ? ' ve sonraki' : '')),
      h('a.btn', { href: next ? `#/sinav/${exam.id}/kagit/${next.id}` : null, style: next ? null : { pointerEvents: 'none', opacity: 0.4 }, title: 'Sonraki (K)' }, h('span.label', 'Sonraki '), '→')));
  }
  async function approve() {
    if (!paper.student?.no) { showTab('ozet'); return toast('Onaydan önce öğrencinin okul numarasını girin.'); }
    const open = paper.scores.filter(x => x.needsReview).length + paper.errors.filter(e => e.certain === false).length;
    if (paper.readingEdited && !(await confirmDialog('Okuma düzeltildi', 'Okumayı düzelttiniz ama yeniden değerlendirmediniz. Puanlar eski okumaya göre. Yine de onaylansın mı?', { ok: 'Onayla' }))) return;
    if (open && !(await confirmDialog('Kontrol bekleyen maddeler', `${open} madde “Öğretmen kontrolü gerekli” olarak işaretli. Gözden geçirdiyseniz onaylayabilirsiniz.`, { ok: 'Onayla' }))) return;
    paper.status = 'onaylandi'; paper.approvedAt = new Date().toISOString();
    if (!paper.student.confirmed) paper.student.confirmed = true;
    await logEdit('approve', null, { grade100: paper.total.grade100 });
    await persist('Onaylandı.');
    const next = all.slice(idx + 1).find(p => p.status !== 'onaylandi') || all[idx + 1];
    if (next) location.hash = `#/sinav/${exam.id}/kagit/${next.id}`;
  }
  const onKey = e => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.key === 'j' || e.key === 'J') { const p = all[idx - 1]; if (p) location.hash = `#/sinav/${exam.id}/kagit/${p.id}`; }
    else if (e.key === 'k' || e.key === 'K') { const p = all[idx + 1]; if (p) location.hash = `#/sinav/${exam.id}/kagit/${p.id}`; }
    else if ((e.key === 'a' || e.key === 'A') && paper.status !== 'onaylandi') approve();
    else if (/^[1-9]$/.test(e.key)) { const er = paper.errors.find(x => x.no === Number(e.key)); if (er) { showTab('hatalar'); active = er.id; drawMarks(); focusCard(er.id); } }
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => { document.removeEventListener('keydown', onKey); urls.forEach(u => URL.revokeObjectURL(u)); }, { once: true });

  const layoutEl = h('div.review', { 'data-pane': 'eval' },
    h('div.paper-pane', h('div.row', { style: { marginBottom: '8px' } }, pageSel, h('span.spacer'), zoomBar), wrap, h('div', { style: { marginTop: '8px' } }, legend)),
    side);
  mount(
    h('div.row', { style: { marginBottom: '12px' } }, back, h('h1', { style: { margin: 0, fontSize: '1.25rem' } }, studentLabel(paper, app)), h('span.spacer'),
      h('button.btn.sm', { onclick: () => printReport() }, 'Yazdır / PDF')),
    layoutEl, bar);
  await drawPage();
  drawSide();
  drawBar();

  // ------------------------------------------------------------ Öğrenci raporu (yazdır / PDF olarak kaydet)
  function printReport() {
    const rows = errorTable(paper, exam, lang);
    const fb = paper.feedback || {};
    const imgs = paper.pages.map((pg, i) => { const c = inner.cloneNode(true); c.style.width = '100%'; if (i !== pageNo - 1) c.querySelector('img').removeAttribute('src'); return c; });
    const area = h('div.print-only', { style: { padding: '12mm', color: '#000', background: '#fff' } },
      h('h1', `${exam.name} · ${studentLabel(paper, app)}`), h('p', `Not: ${paper.total.grade100} / 100`),
      imgs[pageNo - 1],
      h('h2', 'Hata tablosu'), h('table', h('thead', h('tr', ['No', 'Soru/Satır', 'Yazılan', 'Doğrusu', 'Tür', 'Açıklama', 'Puan etkisi'].map(t => h('th', t)))), h('tbody', rows.map(r => h('tr', [r.no, r.where, r.written, r.correct, r.type, r.explanation, r.impact].map(v => h('td', String(v))))))),
      h('h2', 'Geri bildirim'), h('p', h('b', 'Güçlü yön: '), fb.strength || ''), h('ol', (fb.improvements || []).map(x => h('li', x))), h('p', h('b', 'Çalışma önerisi: '), fb.studyTip || ''));
    document.body.append(area);
    const hidden = $$('main').filter(el => !el.classList.contains('no-print'));
    hidden.forEach(el => el.classList.add('no-print'));
    window.addEventListener('afterprint', () => { area.remove(); hidden.forEach(el => el.classList.remove('no-print')); }, { once: true });
    window.print();
  }
}

/** Dalgalı alt çizgi (öğretmen kalemi gibi). Okuma uyarısında kesikli düz çizgi. */
function wavy(x, y, w, plain) {
  if (plain) return `M${x},${y} h${w}`;
  const step = 12; let d = `M${x},${y}`;
  for (let i = 0; i < w; i += step) { const seg = Math.min(step, w - i); d += ` q${seg / 4},${(i / step) % 2 ? 5 : -5} ${seg / 2},0 t${seg / 2},0`; }
  return d;
}
