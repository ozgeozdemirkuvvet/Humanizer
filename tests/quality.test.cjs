// Kalite testleri: erişilebilirlik (axe-core, WCAG 2.1 AA), performans, klavye ile kullanım.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openApp } = require('./helpers.cjs');
const F = require('./fixtures.cjs');

let app;
before(async () => { app = await openApp({ reply: () => F.REWRITE_TR }); });
after(async () => { await app.browser.close(); });

/** axe-core'u sayfaya enjekte edip WCAG 2.1 A/AA kurallarını çalıştırır. */
async function axe(page) {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
  return r.violations.map(v => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
}

for (const scheme of ['light', 'dark']) {
  test(`erişilebilirlik: WCAG 2.1 AA ihlali yok (${scheme === 'light' ? 'açık' : 'koyu'} tema, tüm ekranlar)`, async () => {
    const { page } = app;
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => localStorage.setItem('dk.apiKey', JSON.stringify('sk-ant-test')));
    await page.click('[data-tab=analyze]');
    await page.click('#btnDemo');
    const found = [];
    found.push(...await axe(page));
    await page.click('[data-tab=rewrite]'); await page.click('#btnRewrite');
    await page.waitForSelector('#compareOut:not([hidden])');
    found.push(...await axe(page));
    for (const t of ['profile', 'clean', 'history']) { await page.click(`[data-tab=${t}]`); found.push(...await axe(page)); }
    assert.deepEqual([...new Set(found)], []);
  });
}

test('performans: 20.000 kelimelik metin 1 saniyenin altında analiz edilir', async () => {
  const ms = await app.page.evaluate(t => {
    const big = Array(280).fill(t).join('\n\n');
    const t0 = performance.now(); const r = DK.analyze(big); const dt = performance.now() - t0;
    if (r.words < 20000) throw new Error('metin kısa: ' + r.words);
    return dt;
  }, F.AI_TEXT_TR);
  assert.ok(ms < 1000, `${Math.round(ms)} ms`);
});

test('performans: uzun metinlerde diff donmaz', async () => {
  const ms = await app.page.evaluate(([a, b]) => {
    const A = Array(20).fill(a).join('\n\n'), B = Array(20).fill(b).join('\n\n');
    const t0 = performance.now(); DK.diff(A, B); return performance.now() - t0;
  }, [F.AI_TEXT_TR, F.REWRITE_TR]);
  assert.ok(ms < 1500, `${Math.round(ms)} ms`);
});

test('klavye: sekmeler ok tuşlarıyla gezilir, Ctrl+Enter analiz eder', async () => {
  const { page } = app;
  await page.click('[data-tab=analyze]');
  await page.focus('#tab-analyze');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('#tab-rewrite', 'aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-rewrite');
  await page.keyboard.press('End');
  assert.equal(await page.getAttribute('#tab-history', 'aria-selected'), 'true');
  await page.keyboard.press('Home');
  await page.fill('#inputText', F.HUMAN_TR);
  await page.evaluate(() => { document.querySelector('#analysisOut').innerHTML = ''; });
  await page.focus('#inputText');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('#analysisOut .score');
});

test('canlı analiz: sonuç ekrandayken yazdıkça skor güncellenir', async () => {
  const { page } = app;
  await page.click('#btnDemo');
  const before = await page.locator('.gauge').innerText();
  await page.fill('#inputText', F.HUMAN_TR);
  await page.waitForFunction(b => document.querySelector('.gauge').innerText !== b, before);
});

test('PWA: manifest ve service worker dosyaları geçerli', async () => {
  const fs = require('node:fs'); const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(fs.existsSync(path.join(root, m.icons[0].src)));
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /api\.anthropic\.com/);
  assert.deepEqual(app.errors, []);
});
