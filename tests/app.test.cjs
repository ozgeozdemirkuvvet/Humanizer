// Uçtan uca testler: gerçek tarayıcıda (Chromium) uygulamanın ana akışlarını doğrular.
// Çalıştırma: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { openApp } = require('./helpers.cjs');
const F = require('./fixtures.cjs');

let app;
before(async () => {
  app = await openApp({
    reply: body => body.system.startsWith('You compare')
      ? '{"issues":[]}'
      : F.REWRITE_TR.replace('40 öğrenci', 'birçok öğrenci') // anlam kontrolünün yakalaması gereken bilinçli bir kayıp
  });
});
after(async () => { await app.browser.close(); });

test('yapay zekâ metni yüksek, insan metni düşük skor alır', async () => {
  const [ai, human] = await app.page.evaluate(([a, h]) => [DK.analyze(a), DK.analyze(h)], [F.AI_TEXT_TR, F.HUMAN_TR]);
  assert.ok(ai.overall >= 60, `AI skoru ${ai.overall}`);
  assert.ok(human.overall < 40, `insan skoru ${human.overall}`);
  assert.ok(ai.overall - human.overall >= 30);
  assert.equal(ai.lang, 'tr');
});

test('klişe, üçlü liste, biçim artığı ve görünmez karakter yakalanır', async () => {
  const r = await app.page.evaluate(t => DK.analyze(t), F.AI_TEXT_TR);
  const cats = new Set(r.spans.map(s => s.cat));
  for (const c of ['cliche', 'triad', 'format', 'invis', 'hedge']) assert.ok(cats.has(c), `${c} bulunamadı`);
  assert.ok(r.scores.invis.score >= 60);
});

test('İngilizce klişeler ve Türkçe büyük/küçük İ-ı ayrımı', async () => {
  const r = await app.page.evaluate(() => [DK.analyze("In today's fast-paced world, we must delve into this tapestry. Furthermore, it is crucial."), DK.analyze('AYRICA bu KAPSAMLI çalışma.')]);
  assert.ok(r[0].spans.filter(s => s.cat === 'cliche').length >= 5);
  assert.equal(r[0].lang, 'en');
  assert.equal(r[1].spans.filter(s => s.cat === 'cliche').length, 2);
});

test('analiz arayüzü hatasız çizilir', async () => {
  await app.page.fill('#inputText', F.AI_TEXT_TR);
  await app.page.click('#btnAnalyze');
  assert.equal(await app.page.locator('.score').count(), 6);
  assert.ok(await app.page.locator('.hl .c-cliche').count() > 3);
});

test('üslup profili çıkarılır ve kaydedilir', async () => {
  const { page } = app;
  await page.click('[data-tab=profile]');
  const boxes = page.locator('#samples textarea');
  for (let i = 0; i < 3; i++) await boxes.nth(i).fill(F.SAMPLES[i]);
  await page.click('#btnBuildProfile');
  const p = await page.evaluate(() => JSON.parse(localStorage.getItem('dk.profile')));
  assert.equal(p.sampleCount, 3);
  assert.equal(p.address, 'siz');
  assert.ok(p.connectors.some(c => c.w === 'çünkü'));
  assert.ok(p.signoffs.includes('İyi çalışmalar'));
  assert.ok(p.neverUsed.includes('günümüzde'));
});

test('temizlik görünmez karakterleri ve markdown artıklarını siler', async () => {
  const r = await app.page.evaluate(() => DK.cleanText('**Kalın**​ metin burada﻿', { invis: true, nbsp: true, md: true, spaces: true }));
  assert.equal(r.text, 'Kalın metin burada');
});

test('diff değişiklikleri hunk olarak gruplar', async () => {
  const d = await app.page.evaluate(() => DK.diff('Ayrıca bu çok önemli bir konudur.', 'Bir de bu konu önemli.'));
  assert.equal(d.map(p => p.t === 'eq' ? p.s : p.ins).join(''), 'Bir de bu konu önemli.');
  assert.equal(d.map(p => p.t === 'eq' ? p.s : p.del).join(''), 'Ayrıca bu çok önemli bir konudur.');
});

test('yeniden yazma: doğru API isteği, karşılaştırma, kabul/ret ve anlam kontrolü', async () => {
  const { page, requests } = app;
  await page.evaluate(() => localStorage.setItem('dk.apiKey', JSON.stringify('sk-ant-test')));
  await page.click('[data-tab=analyze]');
  await page.fill('#inputText', F.AI_TEXT_TR);
  await page.click('[data-tab=rewrite]');
  await page.click('#btnRewrite');
  await page.waitForSelector('#compareOut:not([hidden])');

  const req = requests.at(-1);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(req.body.messages[0].content.includes('<writer_style_profile>'), true);
  assert.ok(!req.body.messages[0].content.includes('​'), 'görünmez karakter API’ye gönderilmemeli');

  const meaning = await page.locator('#meaningOut').innerText();
  assert.match(meaning, /40/, 'kaybolan sayı uyarısı bekleniyordu');

  const before = await page.locator('#chCount').innerText();
  await page.locator('#changesList [data-rej]').first().click();
  assert.notEqual(await page.locator('#chCount').innerText(), before);
  await page.click('#btnRejectAll');
  assert.equal(await page.evaluate(() => document.querySelector('#diffRight').innerText), F.AI_TEXT_TR.replace('​', ''));

  await page.click('#btnAiMeaning');
  await page.waitForSelector('#aiMeaningOut .okmsg');
});

test('.docx meta verisi ve izlenen değişiklikler temizlenir', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>');
  zip.file('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Gizli Yazar</dc:creator><cp:lastModifiedBy>Başka Kişi</cp:lastModifiedBy></cp:coreProperties>');
  zip.file('docProps/custom.xml', '<?xml version="1.0"?><Properties/>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p w:rsidR="00AB12CD"><w:r><w:t>Kalan </w:t></w:r><w:ins w:id="1" w:author="Gizli Yazar" w:date="2025-01-01T00:00:00Z"><w:r><w:t>eklenen</w:t></w:r></w:ins><w:del w:id="2" w:author="Gizli Yazar"><w:r><w:delText>silinen</w:delText></w:r></w:del></w:p></w:body></w:document>');
  const file = path.join(os.tmpdir(), `dk-test-${process.pid}.docx`);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));

  const { page } = app;
  await page.click('[data-tab=clean]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.setInputFiles('#docxClean', file)]);
  const out = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
  const all = (await Promise.all(Object.values(out.files).map(f => f.async('string')))).join('\n');
  assert.ok(!all.includes('Gizli Yazar') && !all.includes('Başka Kişi'), 'yazar bilgisi kalmamalı');
  assert.ok(!all.includes('rsid'), 'rsid kalmamalı');
  assert.equal(out.file('docProps/custom.xml'), null);
  assert.ok(!(await out.file('_rels/.rels').async('string')).includes('custom.xml'));
  const doc = await out.file('word/document.xml').async('string');
  assert.ok(doc.includes('eklenen') && !doc.includes('silinen') && !doc.includes('<w:ins'));
  fs.unlinkSync(file);
});

test('dil değişimi ve geçmiş çalışır, konsolda hata yoktur', async () => {
  const { page, errors } = app;
  await page.click('#btnLang');
  assert.equal(await page.locator('[data-tab=analyze]').innerText(), '1 · Analyze');
  await page.click('[data-tab=history]');
  assert.ok(await page.locator('#historyList li').count() >= 1);
  await page.click('#btnLang');
  assert.deepEqual(errors, []);
});
