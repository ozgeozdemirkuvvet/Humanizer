// Ortak test yardımcıları: sayfayı açar, CDN ve Anthropic API'sini yerelden taklit eder.
// Böylece testler ağ erişimi ve gerçek API anahtarı olmadan, deterministik çalışır.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const APP_URL = 'file://' + path.join(ROOT, 'index.html');
const CACHE = path.join(__dirname, '.cache');
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

/** SDK'yı tarayıcı için tek bir ESM dosyasına paketler (CDN'deki +esm sürümünün yerel karşılığı). */
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

/** Anthropic Messages API'sinin akış (SSE) yanıtını taklit eder. */
function sse(model, text) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let body = ev('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  body += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  for (const chunk of text.match(/[\s\S]{1,24}/g)) body += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: chunk } });
  body += ev('content_block_stop', { index: 0 });
  body += ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  return body + ev('message_stop', {});
}

/**
 * @param {object} o
 * @param {(body:object)=>string} [o.reply]  API isteğine dönecek metni üretir
 * @param {object} [o.viewport]
 */
async function openApp({ reply = () => '', viewport = { width: 1280, height: 900 }, deviceScaleFactor = 1, colorScheme = 'light' } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor, colorScheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.route(SDK_URL, r => r.fulfill({ contentType: 'application/javascript', body: sdkBundle(), headers: { 'access-control-allow-origin': '*' } }));
  await page.route(JSZIP_URL, r => r.fulfill({ contentType: 'application/javascript', path: path.join(ROOT, 'node_modules/jszip/dist/jszip.min.js') }));
  await page.route('https://api.anthropic.com/**', async r => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(r.request().postData());
    requests.push({ body, headers: r.request().headers() });
    return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(body.model, reply(body)) });
  });
  await page.goto(APP_URL);
  return { browser, page, errors, requests };
}

module.exports = { openApp, ROOT };
