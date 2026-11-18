// Uçtan uca tarayıcı testi (Chromium + Playwright). Ağ yok: Anthropic SDK'sı yerelden paketlenir,
// API taklit edilir (SSE). Akış: sınıf listesi → sınav tanımı → cevap kağıdı → sentetik fotoğraf
// yükleme → otomatik değerlendirme → inceleme (işaretler, açıklamalar, düzenleme, onay) → e-Okul CSV.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { layoutSheet } from '../js/vision/sheet.js';
import { optionLetters } from '../js/core/codes.js';
import { rasterSheet, photograph, rng } from './synth.mjs';
import { encodeGrayPNG } from './png.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, 'tests/.cache');
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.css': 'text/css' };

function sdkBundle() {
  const out = path.join(CACHE, 'anthropic-sdk.mjs');
  if (!fs.existsSync(out)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const entry = path.join(CACHE, 'entry.mjs');
    fs.writeFileSync(entry, 'export * from "@anthropic-ai/sdk"; export { default } from "@anthropic-ai/sdk";');
    require('esbuild').buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', outfile: out, nodePaths: [path.join(ROOT, 'node_modules')], logLevel: 'error' });
  }
  return fs.readFileSync(out, 'utf8');
}
function sse(model, text) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let body = ev('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  body += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  for (const chunk of text.match(/[\s\S]{1,400}/g)) body += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: chunk } });
  body += ev('content_block_stop', { index: 0 });
  body += ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  return body + ev('message_stop', {});
}

/** Taklit Claude: okuma isteğine sabit el yazısı, değerlendirme isteğine sabit hatalar. */
const OPEN_ANSWER = ['He go to London', 'for visit his grandmother'];
const WRITING = ['Last summer I go to Antalya with my family', 'We swim in the sea every day', 'It was very good holiday'];
function mockReply(body) {
  const user = body.messages[0].content;
  const isRead = !!body.output_config.format.schema.properties.regions;
  if (isRead && /Questions on this paper/.test(user[0].text)) {
    // Serbest kağıt: tüm sayfa tek görüntü; kapalı uçlu ve kısa cevaplar answers[], writing bölge olarak
    const qs = [...user[0].text.matchAll(/question_id "([^"]+)" \(Q\d+, (\w+)/g)];
    return {
      answers: qs.filter(([, , t]) => t !== 'writing').map(([, id, t]) => ({ question_id: id, value: t === 'gap' ? 'went' : 'C', confidence: 0.93 })),
      regions: qs.filter(([, , t]) => t === 'writing').map(([, id]) => ({ region_id: id, lines: WRITING.map((t, i) => ({ n: i + 1, words: t.split(' ').map((w, k) => ({ text: w, confidence: 0.95, box: [80 + k * 60, 520 + i * 40, 130 + k * 60, 550 + i * 40] })) })) }))
    };
  }
  if (isRead) {
    const regions = [];
    for (const c of user) {
      const m = c.type === 'text' && /region_id "([^"]+)" — (writing|short|open-ended)/.exec(c.text);
      if (!m) continue;
      const words = t => t.split(' ').map((w, i) => ({ text: w, confidence: 0.96, box: [70 + i * 95, 30, 150 + i * 95, 95] }));
      if (m[2] === 'open-ended') regions.push({ region_id: m[1], lines: OPEN_ANSWER.map((t, i) => ({ n: i + 1, words: words(t).map(w => ({ ...w, box: [w.box[0], 60 + i * 300, w.box[2], 300 + i * 300] })) })) });
      else if (m[2] === 'short') regions.push({ region_id: m[1], lines: [{ n: 1, words: [{ text: 'went', confidence: 0.95, box: [40, 200, 220, 800] }] }] });
      else regions.push({ region_id: m[1], lines: WRITING.map((t, i) => ({ n: i + 1, words: words(t).map(w => ({ ...w, box: [w.box[0], 20 + i * 125, w.box[2], 100 + i * 125] })) })) });
    }
    return { regions, answers: [] };
  }
  const text = user[0].text;
  const wrong = [...text.matchAll(/question_id "([^"]+)" \(Q(\d+), (mc|tf|match|gap)\)/g)].map(m => m[1]);
  return {
    open: [...text.matchAll(/<open question_id="([^"]+)"[\s\S]*?<content_points>\n([\s\S]*?)\n<\/content_points>/g)].map(m => ({
      question_id: m[1],
      points: m[2].split('\n').map((_, i) => ({ index: i, verdict: i === 0 ? 'karsilandi' : 'kismen', justification: i === 0 ? 'Londra’ya gittiğini yazmış.' : 'Ziyaret amacı var ama eksik ifade edilmiş.' })),
      language: { band: 2, justification: 'Geçmiş zaman ve edat hataları var.' },
      errors: [
        { line: 1, quote: 'go', occurrence: 1, code: 'T', rule_id: 'past-simple', correction: 'went', original: 'He go to London for visit his grandmother', corrected: 'He went to London for visit his grandmother', severity: 'bozmuyor', criterion: 'GRA', certain: true, uncertain_reason: '' },
        { line: 2, quote: 'for visit', occurrence: 1, code: 'WW', rule_id: 'purpose-to-infinitive', correction: 'to visit', original: 'He go to London for visit his grandmother', corrected: 'He go to London to visit his grandmother', severity: 'bozmuyor', criterion: 'GRA', certain: true, uncertain_reason: '' }
      ],
      suggestions: []
    })),
    writing: [...text.matchAll(/<writing question_id="([^"]+)"/g)].map(m => ({
      question_id: m[1],
      rubric: [{ criterion: 'TA', band: 4, justification: 'Tatil anlatılmış; kapanış eksik.' }, { criterion: 'CC', band: 3, justification: 'Basit bağlaçlar.' }, { criterion: 'LR', band: 3, justification: 'Günlük kelimeler.' }, { criterion: 'GRA', band: 2, justification: 'Geçmiş zaman hataları sistematik.' }],
      errors: [
        { line: 1, quote: 'go', occurrence: 1, code: 'T', rule_id: 'past-simple', correction: 'went', original: WRITING[0], corrected: WRITING[0].replace(' go ', ' went '), severity: 'bozmuyor', criterion: 'GRA', certain: true, uncertain_reason: '' },
        { line: 2, quote: 'swim', occurrence: 1, code: 'T', rule_id: 'past-simple', correction: 'swam', original: WRITING[1], corrected: WRITING[1].replace('swim', 'swam'), severity: 'bozmuyor', criterion: 'GRA', certain: true, uncertain_reason: '' },
        { line: 3, quote: 'was very', occurrence: 1, code: '^', rule_id: 'article-a-singular', correction: 'was a very', original: WRITING[2], corrected: 'It was a very good holiday', severity: 'bozmuyor', criterion: 'GRA', certain: true, uncertain_reason: '' }
      ],
      suggestions: [{ line: 3, quote: 'very good', suggestion: 'wonderful', reason: 'Daha zengin bir sıfat.' }]
    })),
    rules: [
      { rule_id: 'past-simple', code: 'T', explanation: "'last summer' geçmiş zamanı gösterir; fiil 2. hâline geçmelidir.", example: 'We visited our grandparents last weekend.' },
      { rule_id: 'article-a-singular', code: 'Art', explanation: 'Tekil sayılabilen isimden önce a/an gerekir.', example: 'It was a great day.' },
      { rule_id: 'purpose-to-infinitive', code: 'WW', explanation: 'Amaç bildirirken "for + fiil" değil "to + fiil" kullanılır.', example: 'She went to the shop to buy bread.' }
    ],
    answer_notes: wrong.map(id => ({ question_id: id, code: 'Key', rule_id: `key-${id}`, explanation: 'Doğru seçenek anlamı tamamlar.', example: 'She went home.', severity: 'bozuyor' })),
    feedback: { strength: 'Tatilini sırayla ve anlaşılır anlatmışsın.', improvements: ['Geçmiş zaman (V2)', 'a/an kullanımı'], study_tip: 'Her gün 5 düzensiz fiille geçmiş zaman cümlesi yaz.' }
  };
}

let server, browser, base, ctx;
const apiCalls = [];
before(async () => {
  server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/sinav/index.html`;
  browser = await chromium.launch();
  ctx = await browser.newContext({ acceptDownloads: true }); // testler arasında ortak IndexedDB
});
after(async () => { await browser?.close(); server?.close(); });

async function newPage({ viewport = { width: 1366, height: 900 }, latency = 0 } = {}) {
  const page = await ctx.newPage();
  await page.setViewportSize(viewport);
  const context = { close: () => page.close() };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(SDK_URL, r => r.fulfill({ contentType: 'application/javascript', body: sdkBundle(), headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://api.anthropic.com/**', async r => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(r.request().postData());
    apiCalls.push(body);
    if (latency) await new Promise(res => setTimeout(res, latency));
    return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(body.model, JSON.stringify(mockReply(body))) });
  });
  return { context, page, errors };
}

/** Sınav için sentetik öğrenci fotoğrafı (PNG). */
function studentPhoto(exam, { number, answers, seed }) {
  const layout = layoutSheet(exam);
  const marks = Object.entries(answers).map(([questionId, option]) => ({ questionId, option, kind: 'full' }));
  const sheet = rasterSheet(layout, 1, { number, marks, k: 1.25, seed });
  const r = rng(seed);
  const photo = photograph(sheet, { seed, angle: (r() - 0.5) * 10, size: [1500, 2050], shadow: 0.25, noise: 7 });
  return { name: `ogrenci-${number}.png`, mimeType: 'image/png', buffer: encodeGrayPNG(photo) };
}

/** SHOTS=klasör verilirse önemli ekranların görüntüsü alınır (belgeler ve gözle denetim için). */
async function shot(page, name) {
  if (!process.env.SHOTS) return;
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`), fullPage: false });
}

async function axe(page) {
  await page.addScriptTag({ path: path.join(ROOT, 'node_modules/axe-core/axe.min.js') });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }));
  return r.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
}

test('uçtan uca: sınav tanımla → yükle → değerlendir → incele → düzenle → onayla → e-Okul CSV', async () => {
  const { page, errors, context } = await newPage();
  await page.goto(base);
  await page.getByRole('heading', { name: 'İlk sınavınızı tanımlayın' }).waitFor();
  await shot(page, '1-ana-sayfa');
  assert.deepEqual(await axe(page), [], 'ana sayfa erişilebilirlik');

  // Ayarlar: API anahtarı
  await page.getByRole('link', { name: 'Ayarlar' }).click();
  await page.getByLabel('Anthropic API anahtarı').fill('sk-ant-test');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.getByText('Ayarlar kaydedildi.').waitFor();

  // Sınıf listesi
  await page.getByRole('link', { name: 'Sınıflar' }).click();
  await page.getByLabel('Şube').fill('9-A');
  await page.getByLabel('Öğrenciler').fill('Okul No;Adı Soyadı\n101;Ayşe Yılmaz\n102;Can Demir\n103;Elif Kaya');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.getByText('9-A: 3 öğrenci kaydedildi.').waitFor();

  // Sınav tanımı
  await page.getByRole('link', { name: 'Sınavlar' }).click();
  await page.getByRole('link', { name: 'Yeni sınav oluştur' }).click();
  await page.getByLabel('Sınav adı').fill('9. Sınıf 1. Yazılı');
  await page.getByLabel('Şube').fill('9-A');
  await page.getByRole('button', { name: '⚡ Hızlı ekle' }).click();
  await page.getByLabel('Soru tipi').selectOption('mc');
  await page.getByLabel('Soru sayısı').fill('4');
  await page.getByLabel('Her biri kaç puan').fill('10');
  await page.getByRole('dialog').getByRole('button', { name: 'Ekle', exact: true }).click();
  for (const [no, key] of [[1, 'B'], [2, 'A'], [3, 'C'], [4, 'D']]) await page.getByRole('group', { name: `Soru ${no} cevap anahtarı` }).getByRole('button', { name: key }).click();
  await page.getByRole('button', { name: '+ Boşluk doldurma (tek kelime)' }).click();
  await page.getByLabel('Doğru cevap').fill('went');
  await page.locator('.q').nth(4).getByLabel('Puan').fill('10');
  await page.getByRole('button', { name: '+ Writing (kompozisyon)' }).click();
  const wq = page.locator('.q').nth(5);
  await wq.getByLabel('Puan').fill('50');
  await wq.getByLabel('Satır sayısı (kağıtta)').fill('8');
  await wq.getByLabel('Görev (yönerge)').fill('Write about your last holiday (40–60 words).');
  await page.getByText('Toplam: 100 puan').waitFor();
  await shot(page, '2-sinav-tanimi');
  assert.deepEqual(await axe(page), [], 'sınav düzenleyici erişilebilirlik');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.getByRole('heading', { name: 'Kağıtları yükleyin' }).waitFor();

  // Cevap kağıdı
  await page.getByRole('link', { name: 'Cevap kağıdı' }).click();
  await page.getByRole('heading', { name: 'Cevap kağıdı' }).waitFor();
  await shot(page, '3-cevap-kagidi');
  assert.equal(await page.locator('.no-print svg.sheet-page').count(), 1);
  await page.getByRole('link', { name: 'Geri' }).click();

  // Fotoğrafları üret ve yükle
  const exam = (await page.evaluate(() => window.KK.db.all('exams')))[0];
  const qs = exam.questions;
  const students = [
    { number: '101', answers: { [qs[0].id]: 'B', [qs[1].id]: 'A', [qs[2].id]: 'C', [qs[3].id]: 'D' }, seed: 11 },
    { number: '102', answers: { [qs[0].id]: 'B', [qs[1].id]: 'C', [qs[2].id]: 'C', [qs[3].id]: 'A' }, seed: 12 },
    { number: '103', answers: { [qs[0].id]: 'A', [qs[1].id]: 'A', [qs[3].id]: 'D' }, seed: 13 }
  ];
  assert.ok(qs.slice(0, 4).every(q => optionLetters(q).length === 4));
  await page.locator('input[type=file]').setInputFiles(students.map(s => studentPhoto(exam, s)));
  await page.locator('tr[data-paper]').nth(2).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('tr[data-paper] .chip.warn').length >= 3 && ![...document.querySelectorAll('tr[data-paper]')].some(r => /Değerlendiriliyor|bekleniyor/.test(r.textContent)), null, { timeout: 60000 });
  const rows = await page.locator('tr[data-paper]').allInnerTexts();
  await shot(page, '4-kagitlar');
  assert.match(rows[0], /101 · Ayşe Yılmaz/);
  assert.match(rows[1], /102 · Can Demir/);
  assert.match(rows[2], /103 · Elif Kaya/);
  // Kişisel veri: hiçbir istekte ad ya da numara yok
  const sent = JSON.stringify(apiCalls);
  for (const t of ['Ayşe', 'Yılmaz', 'Can Demir', 'Elif', '"101"', '"102"']) assert.ok(!sent.includes(t), `istekte ${t} olmamalı`);
  assert.ok(apiCalls.every(c => c.model === 'claude-opus-5-5' && c.output_config?.format?.type === 'json_schema'));

  // İnceleme
  await page.getByRole('link', { name: /İncelemeye başla/ }).click();
  await page.locator('.paper-inner img[src^="blob:"]').waitFor();
  assert.match(await page.locator('h1').innerText(), /101 · Ayşe Yılmaz/);
  // Ayşe: kapalı uçlu hepsi doğru (40) + boşluk 10 + writing 50×(4+3+3+2)/20 = 30 → 80
  assert.equal(await page.locator('.score-big').innerText(), '80');
  const markCount = await page.locator('svg g.mark').count();
  assert.ok(markCount >= 4, `kağıt üzerinde işaret: ${markCount}`);
  await page.getByRole('tab', { name: /Hatalar/ }).click();
  await page.getByText('Bu hata kağıtta 2 kez geçiyor (Satır 1, 2)').waitFor();
  assert.equal(await page.getByText('Açıklama: bkz. hata 1').count(), 1);
  // Etikete dokun → açıklama açılır
  await page.locator('svg g.mark[aria-label^="Hata 1"]').click();
  await page.locator('.popover').getByText("'last summer' geçmiş zamanı gösterir").waitFor();
  await shot(page, '5-inceleme-hata');
  assert.deepEqual(await axe(page), [], 'inceleme ekranı erişilebilirlik');
  // Hata sil (öğretmen düzenlemesi kaydedilir)
  await page.locator('.side .ecard').nth(2).getByRole('button', { name: 'Sil' }).click();
  await page.getByLabel('Neden (isteğe bağlı)').fill('Bu seviyede işaretlemeyelim');
  await page.getByRole('dialog').getByRole('button', { name: 'Sil' }).click();
  await page.getByText('Hata silindi.').waitFor();
  const edits = await page.evaluate(() => window.KK.db.all('edits'));
  assert.equal(edits[0].kind, 'error.delete');
  assert.equal(edits[0].before.code, '^');
  // Bant düzenle → puan yeniden hesaplanır (GRA 2 → 3: 50×13/20 = 32,5 → toplam 82,5 → 83)
  await page.getByRole('tab', { name: 'Özet' }).click();
  await page.getByLabel('GRA bandı').selectOption('3');
  await page.getByText('Bant güncellendi.').waitFor();
  assert.equal(await page.locator('.score-big').innerText(), '83');
  await shot(page, '6-inceleme-ozet');
  await page.getByRole('tab', { name: 'Hata tablosu' }).click();
  await shot(page, '7-hata-tablosu');
  // Geri bildirim
  await page.getByRole('tab', { name: 'Geri bildirim' }).click();
  assert.equal(await page.getByLabel('💪 Güçlü yön').inputValue(), 'Tatilini sırayla ve anlaşılır anlatmışsın.');
  // Onayla → sonraki kağıt
  await page.getByRole('button', { name: /✓ Onayla/ }).click();
  await page.waitForFunction(() => /102/.test(document.querySelector('h1')?.textContent || ''));
  // Can: S2 ve S4 yanlış → 20 + 10 + 30 = 60; yanlış cevap hataları kağıtta işaretli
  assert.equal(await page.locator('.score-big').innerText(), '60');
  await page.getByRole('tab', { name: /Hatalar/ }).click();
  assert.ok(await page.getByText('Doğru seçenek anlamı tamamlar.').count() >= 1);
  await page.keyboard.press('a');
  await page.waitForFunction(() => /103/.test(document.querySelector('h1')?.textContent || ''));
  // Elif: S1 yanlış, S3 boş → 20 + 10 + 30 = 60
  assert.equal(await page.locator('.score-big').innerText(), '60');
  await page.getByRole('button', { name: /✓ Onayla/ }).click();
  await page.waitForTimeout(300);

  // Sonuçlar ve e-Okul CSV
  await page.goto(base + `#/sinav/${exam.id}/sonuclar`);
  await page.getByRole('button', { name: 'e-Okul CSV indir' }).waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'e-Okul CSV indir' }).click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  await shot(page, '8-sonuclar');
  assert.equal(csv, '﻿Okul No;Adı Soyadı;Not\r\n101;Ayşe Yılmaz;83\r\n102;Can Demir;60\r\n103;Elif Kaya;60\r\n');
  assert.deepEqual(await axe(page), [], 'sonuçlar erişilebilirlik');

  // Tutarlılık: aynı kağıt yeniden yüklenirse API'ye gitmeden aynı puanı alır
  const before = apiCalls.length;
  await page.goto(base + `#/sinav/${exam.id}`);
  await page.locator('input[type=file]').setInputFiles([studentPhoto(exam, students[1])]);
  await page.waitForFunction(() => document.querySelectorAll('tr[data-paper]').length === 4 && document.querySelectorAll('tr[data-paper] .chip.warn').length >= 1, null, { timeout: 30000 });
  const papers = await page.evaluate(() => window.KK.db.all('papers'));
  const again = papers.filter(p => p.student.no === '102').find(p => p.status === 'degerlendirildi');
  assert.equal(again.total.grade100, 60);
  // Okuma (görüntü) önbellekten gelir; değerlendirme yalnızca öğretmen tercihleri değiştiği için yeniden istenir
  const fresh = apiCalls.slice(before);
  assert.equal(fresh.length, 1, 'okuma önbellekten gelmeli');
  assert.ok(!fresh[0].output_config.format.schema.properties.regions, 'yeni çağrı değerlendirme olmalı');
  const prefText = fresh[0].messages[0].content[0].text;
  assert.match(prefText, /<teacher_preferences>[\s\S]*Do not mark "was very" as \^[\s\S]*Bu seviyede işaretlemeyelim/);
  assert.match(prefText, /<teacher_preferences>[\s\S]*GRA from band 2 to 3/);

  // Anonim mod
  await page.goto(base + '#/ayarlar');
  await page.getByLabel(/Anonim mod/).check();
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.goto(base + `#/sinav/${exam.id}`);
  await page.locator('tr[data-paper]').first().waitFor();
  const anon = await page.locator('tbody').innerText();
  assert.ok(!/Ayşe|Can Demir|Elif/.test(anon) && /Öğrenci 01/.test(anon), anon);

  assert.deepEqual(errors, []);
  await context.close();
});

test('telefon görünümü: yatay taşma yok, kağıt/değerlendirme geçişi çalışıyor', async () => {
  const { page, context, errors } = await newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base);
  await page.waitForFunction(() => window.KK);
  const exams = await page.evaluate(() => window.KK.db.all('exams'));
  assert.ok(exams.length, 'önceki testin verisi');
  const papers = await page.evaluate(() => window.KK.db.all('papers'));
  for (const url of ['', `#/sinav/${exams[0].id}`, `#/sinav/${exams[0].id}/duzenle`, `#/sinav/${exams[0].id}/kagit/${papers[0].id}`]) {
    await page.goto(base + url);
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `${url || 'ana sayfa'}: ${over}px yatay taşma`);
  }
  assert.equal(await page.locator('.paper-pane').isVisible(), false);
  await page.getByRole('button', { name: 'Kağıt / Değerlendirme' }).click();
  assert.equal(await page.locator('.paper-pane').isVisible(), true);
  await shot(page, '9-telefon-kagit');
  assert.deepEqual(errors, []);
  await context.close();
});

test('performans: 30 kağıtlık sınıf, gecikmeli taklit API ile 10 dakikanın çok altında işlenir', async () => {
  const { page, context, errors } = await newPage({ latency: 1500 });
  await page.goto(base);
  await page.waitForFunction(() => window.KK);
  const exam = (await page.evaluate(() => window.KK.db.all('exams')))[0];
  // Yeni sınav kopyası (temiz kağıt listesi, aynı yerleşim)
  const copy = await page.evaluate(async (ex) => { const c = { ...ex, id: 'perf-' + ex.id, name: 'Performans' }; await window.KK.db.put('exams', c); return c; }, exam);
  const files = [];
  const r = rng(77);
  for (let i = 0; i < 30; i++) {
    const answers = Object.fromEntries(copy.questions.slice(0, 4).map(q => [q.id, 'ABCD'[Math.floor(r() * 4)]]));
    const f = studentPhoto(copy, { number: String(200 + i), answers, seed: 100 + i });
    const dir = path.join(CACHE, 'perf'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, f.name), f.buffer);
    files.push(path.join(dir, f.name));
  }
  await page.goto(base + `#/sinav/${copy.id}`);
  const t0 = Date.now();
  await page.locator('input[type=file]').setInputFiles(files);
  await page.waitForFunction(() => document.querySelectorAll('tr[data-paper]').length === 30 && [...document.querySelectorAll('tr[data-paper]')].every(r => /İncelemeye hazır/.test(r.textContent)), null, { timeout: 300000, polling: 500 });
  const secs = (Date.now() - t0) / 1000;
  const papers = (await page.evaluate(() => window.KK.db.all('papers'))).filter(p => p.examId === copy.id);
  const nos = new Set(papers.map(p => p.student.no));
  console.log(`# 30 kağıt: ${secs.toFixed(1)} sn (API çağrısı başına 1,5 sn taklit gecikme, eşzamanlı 6) · tanınan numara ${nos.size}/30`);
  assert.equal(nos.size, 30);
  assert.ok(secs < 600);
  assert.deepEqual(errors, []);
  await context.close();
});

test('serbest kağıt: köşe işaretçisi yok → kırp, eğikliği düzelt, üst bandı kartart, tüm sayfa okunur', async () => {
  const { page, context, errors } = await newPage();
  await page.goto(base);
  await page.waitForFunction(() => window.KK);
  const exam = await page.evaluate(async () => {
    const ex = { id: 'serbest-1', name: 'Serbest Quiz', grade: '11', className: '9-A', cefr: 'B1', explainLang: 'tr', spelling: 'esnek', sheetMode: 'serbest', redactTop: 0.15, pagesPerStudent: 1,
      questions: [
        { id: 'm1', no: 1, type: 'mc', points: 20, options: 4, key: ['B'], text: 'He ___ tennis every Sunday. A) play B) plays C) playing D) played' },
        { id: 'g1', no: 2, type: 'gap', points: 20, key: ['went'] },
        { id: 'w1', no: 3, type: 'writing', points: 60, text: 'Write about your holiday.', minWords: 20, maxWords: 80, lines: 10, rubric: { TA: 1, CC: 1, LR: 1, GRA: 1 } }
      ], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await window.KK.db.put('exams', ex); return ex;
  });
  // Öğretmenin kendi kağıdı: başlık, sorular ve el yazısı satırları; 4° eğik çekilmiş
  const W = 1240, H = 1754, d = new Float32Array(W * H).fill(248);
  const bar = (x, y, w, h, v = 40) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) d[yy * W + xx] = v; };
  bar(100, 80, 500, 14); bar(100, 130, 300, 10); // ad / numara (karartılacak)
  for (let i = 0; i < 26; i++) { const y = 300 + i * 48; let x = 100; const r = rng(i + 5); while (x < 1050) { const len = 30 + r() * 110; bar(Math.round(x), y, Math.round(len), 5, 60); x += len + 18; } }
  const photo = photograph({ w: W, h: H, d }, { seed: 4, angle: 4, persp: 0.01, size: [1500, 2050], shadow: 0.2 });
  await page.goto(base + `#/sinav/${exam.id}`);
  const before = apiCalls.length;
  await page.locator('input[type=file]').setInputFiles([{ name: 'serbest.png', mimeType: 'image/png', buffer: encodeGrayPNG(photo) }]);
  await page.waitForFunction(() => [...document.querySelectorAll('tr[data-paper]')].some(r => /İncelemeye hazır/.test(r.textContent)), null, { timeout: 60000 });
  const calls = apiCalls.slice(before);
  assert.equal(calls.length, 2, 'bir okuma + bir değerlendirme');
  assert.equal(calls[0].messages[0].content.filter(c => c.type === 'image').length, 1, 'tüm sayfa tek görüntü');
  const paper = (await page.evaluate(() => window.KK.db.all('papers'))).find(p => p.examId === 'serbest-1');
  assert.ok(paper.pages[0].detect.redactPx > 200, 'üst bant karartılmalı');
  assert.ok(Math.abs(paper.pages[0].detect.skewDeg) >= 2, `eğiklik bulunmalı: ${paper.pages[0].detect.skewDeg}`);
  assert.equal(paper.student.no, '');
  // S1 yanlış (C), S2 doğru, writing 60×12/20 = 36 → 56
  assert.equal(paper.total.grade100, 56);
  assert.ok(paper.errors.some(e => e.questionId === 'm1' && e.quote === 'C' && e.correction === 'B'));
  assert.ok(paper.errors.some(e => e.questionId === 'w1' && e.box && e.line === 1), 'writing hatası kağıt üzerinde konumlanmalı');
  // Kimlik: öğretmen listeden seçer, sonra onaylar
  await page.locator(`tr[data-paper="${paper.id}"]`).click();
  await page.locator('.paper-inner img[src^="blob:"]').waitFor();
  await page.getByLabel('Öğrenci', { exact: true }).selectOption('102');
  await page.getByRole('button', { name: 'Kimliği onayla' }).click();
  await page.getByText('Öğrenci kimliği onaylandı.').waitFor();
  await page.getByRole('button', { name: /✓ Onayla/ }).click();
  await page.waitForFunction(id => window.KK.db.get('papers', id).then(p => p.status === 'onaylandi'), paper.id);
  assert.deepEqual(errors, []);
  await context.close();
});

test('tamamı açık uçlu sınav: soru kağıda basılır, içerik noktaları + dil payıyla puanlanır, öğretmen kararı değiştirir', async () => {
  const { page, context, errors } = await newPage();
  await page.goto(base + '#/sinav/yeni');
  await page.getByLabel('Sınav adı').fill('11. Sınıf Okuma Yazılısı');
  await page.getByLabel('Şube').fill('9-A');
  await page.getByLabel('Açık uçlu sorularda dil payı').selectOption('30');
  await page.getByRole('button', { name: '⚡ Hızlı ekle' }).click();
  await page.getByLabel('Soru sayısı').fill('3');
  await page.getByRole('dialog').getByRole('button', { name: 'Ekle', exact: true }).click();
  const qs = [
    ['Why did Tom go to London? Answer according to the text.', 'He went to London to visit his grandmother.', 'Londra’ya gitti\nbüyükannesini ziyaret etmek için'],
    ['What did Tom do on Saturday?', 'He went to a museum with his cousin.', ''],
    ['Would you like to visit London? Why?', 'Any reasonable personal answer with a reason.', '']
  ];
  for (const [i, [text, model, kp]] of qs.entries()) {
    const card = page.locator('.q').nth(i);
    await card.getByLabel('Soru (kağıda basılır)').fill(text);
    await card.getByLabel('Örnek doğru cevap').fill(model);
    if (kp) await card.getByLabel(/Olması gereken noktalar/).fill(kp);
  }
  await page.getByText('Toplam: 30 puan').waitFor();
  assert.equal(await page.locator('.notice.err').count(), 0, await page.locator('.notice.err').allInnerTexts().then(x => x.join(' | ')));
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.getByRole('heading', { name: 'Kağıtları yükleyin' }).waitFor();
  // Cevap kağıdında soru metinleri basılı
  await page.getByRole('link', { name: 'Cevap kağıdı' }).click();
  await page.getByRole('heading', { name: 'Cevap kağıdı' }).waitFor();
  const svgText = await page.locator('.no-print svg.sheet-page').first().textContent();
  assert.match(svgText, /1\. Why did Tom go to London\?/);
  assert.match(svgText, /3\. Would you like to visit London\? Why\?/);
  await shot(page, '10-acik-uclu-kagit');
  const exam = (await page.evaluate(() => window.KK.db.all('exams'))).find(e => e.name === '11. Sınıf Okuma Yazılısı');
  assert.equal(exam.questions.every(q => q.type === 'open'), true);
  await page.goto(base + `#/sinav/${exam.id}`);
  await page.locator('input[type=file]').setInputFiles([studentPhoto(exam, { number: '101', answers: {}, seed: 31 })]);
  await page.waitForFunction(() => [...document.querySelectorAll('tr[data-paper]')].some(r => /İncelemeye hazır/.test(r.textContent)), null, { timeout: 60000 });
  const req = apiCalls.at(-1).messages[0].content[0].text;
  assert.match(req, /<open question_id="[^"]+" no="1" points="10">[\s\S]*<model_answer>He went to London to visit his grandmother\.<\/model_answer>[\s\S]*0: Londra’ya gitti\n1: büyükannesini ziyaret etmek için/);
  assert.match(apiCalls.at(-1).system[0].text, /Language accuracy counts for 30%/);
  await page.locator('tr[data-paper]').first().click();
  await page.locator('.paper-inner img[src^="blob:"]').waitFor();
  // S1: 2 nokta (karşılandı + kısmen) → 7×0,75 + 3×2/4 = 6,75 → 7 ; S2, S3: 1 nokta → 7 + 1,5 = 8,5 ; toplam 24/30 → 80
  assert.equal(await page.locator('.score-big').innerText(), '80');
  assert.equal(await page.getByLabel('Soru 1 nokta 2').inputValue(), 'kismen');
  await page.getByText('Ziyaret amacı var ama eksik ifade edilmiş.').first().waitFor();
  assert.ok(await page.locator('svg g.mark').count() >= 6, 'her sorunun dil hataları kağıt üzerinde');
  await page.getByRole('tab', { name: /Hatalar/ }).click();
  await page.getByText('Amaç bildirirken "for + fiil" değil "to + fiil" kullanılır.').first().waitFor();
  assert.ok(await page.getByText("Dil puanını etkiliyor (sorunun %30'i)").count() >= 1);
  await shot(page, '11-acik-uclu-inceleme');
  // Öğretmen kararı: 2. nokta tam karşılanmış → 7 + 1,5 = 8,5 → 25,5/30 → 85
  await page.getByRole('tab', { name: 'Özet' }).click();
  await page.getByLabel('Soru 1 nokta 2').selectOption('karsilandi');
  await page.getByText('Puan yeniden hesaplandı.').waitFor();
  assert.equal(await page.locator('.score-big').innerText(), '85');
  await shot(page, '12-acik-uclu-ozet');
  const edits = await page.evaluate(() => window.KK.db.all('edits'));
  assert.ok(edits.some(e => e.kind === 'point.edit' && e.after.verdict === 'karsilandi'));
  await page.getByRole('button', { name: /✓ Onayla/ }).click();
  await page.waitForFunction(() => window.KK.db.all('papers').then(ps => ps.some(p => p.status === 'onaylandi' && p.total.grade100 === 85)));
  assert.deepEqual(errors, []);
  await context.close();
});
