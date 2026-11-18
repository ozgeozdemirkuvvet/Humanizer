// Claude çağrıları: resmî Anthropic JS SDK'sı (sabit sürüm, yalnızca gerektiğinde yüklenir),
// öğretmenin kendi API anahtarı, akış (streaming), yapılandırılmış çıktı ve yanıt önbelleği.
//
// - Varsayılan model Claude Opus 5.5. Opus 5.5 / Sonnet 5.5'te sunucu tarafı yedek model açık:
//   bir güvenlik sınıflandırıcısı isteği reddederse API isteği uygun bir modelle tamamlar.
// - Tutarlılık: aynı girdi (model + istem + içerik) SHA-256 ile anahtarlanır; ikinci kez aynı
//   kağıt ya da aynı metin gelirse aynı sonuç önbellekten döner ("aynı yanıt her zaman aynı puanı alır").

import { READ_SCHEMA, EVAL_SCHEMA, normalizeRead, normalizeEval } from './schemas.js';
import { READ_SYSTEM, READ_SYSTEM_FREEFORM, readUserContent, evalSystem, evalUserText } from './prompts.js';

export const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (önerilen)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (daha hızlı)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (en ekonomik)' }
];
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];

let sdkP = null;
export function loadSDK() {
  return sdkP ||= import(SDK_URL).then(m => m.Anthropic ?? m.default).catch(e => { sdkP = null; throw new Error('Anthropic kütüphanesi yüklenemedi (internet bağlantısını kontrol edin).', { cause: e }); });
}

export async function makeClient(apiKey) {
  if (!apiKey) throw new AIError('API anahtarı girilmedi. Ayarlar’dan ekleyin.', 'no-key');
  const Anthropic = await loadSDK();
  return { Anthropic, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 }) };
}

export class AIError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** SDK hata sınıflarını öğretmenin anlayacağı mesaja çevirir (en özelden en genele). */
export function apiErrorMessage(Anthropic, e) {
  if (e instanceof AIError) return e.message;
  if (Anthropic && e instanceof Anthropic.APIUserAbortError) return 'Durduruldu.';
  if (Anthropic && e instanceof Anthropic.AuthenticationError) return 'API anahtarı geçersiz (401). Ayarları kontrol edin.';
  if (Anthropic && e instanceof Anthropic.PermissionDeniedError) return 'Bu anahtarın seçili modele erişimi yok (403).';
  if (Anthropic && e instanceof Anthropic.NotFoundError) return 'Model bulunamadı (404). Ayarlardan başka bir model seçin.';
  if (Anthropic && e instanceof Anthropic.RateLimitError) return 'Hız sınırına ulaşıldı (429). Eşzamanlı iş sayısını azaltıp yeniden deneyin.';
  if (Anthropic && e instanceof Anthropic.BadRequestError) return 'İstek reddedildi (400): ' + (e.error?.error?.message || e.message);
  if (Anthropic && e instanceof Anthropic.APIConnectionError) return 'API’ye ulaşılamadı (ağ bağlantısı).';
  if (Anthropic && e instanceof Anthropic.APIError) return `API hatası ${e.status ?? ''}: ${e.message}`;
  if (e instanceof SyntaxError) return 'Modelin yanıtı okunamadı.';
  return e?.message || String(e);
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Yapılandırılmış çıktılı tek çağrı.
 * @returns {Promise<{data:object, model:string, usage:object, cached:boolean}>}
 */
export async function callStructured({ client, model, system, content, schema, effort = 'medium', signal, cache, cacheKeyParts }) {
  const key = cache && cacheKeyParts ? await sha256(JSON.stringify(cacheKeyParts)) : null;
  if (key) {
    const hit = await cache.get(key);
    if (hit) return { ...hit, cached: true };
  }
  const params = {
    model,
    max_tokens: 32000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    output_config: { effort, format: { type: 'json_schema', schema } }
  };
  if (FALLBACK_MODELS.includes(model)) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
  const stream = client.beta.messages.stream(params, { signal });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new AIError('Model bu isteği reddetti' + (msg.stop_details?.category ? ` (${msg.stop_details.category})` : '') + '. Öğretmen değerlendirmesi gerekli.', 'refusal');
  if (msg.stop_reason === 'max_tokens') throw new AIError('Yanıt uzunluk sınırına ulaştı; kağıt çok uzun olabilir.', 'max_tokens');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const data = JSON.parse(text);
  const out = { data, model: msg.model, usage: msg.usage };
  if (key) await cache.set(key, out);
  return { ...out, cached: false };
}

/**
 * Aşama A: kırpıntıları okur (görsel → metin + güven + kutu).
 * @param {object} ctx {client, model, cache, signal, effort}
 * @param {object[]} crops [{regionId, questionId, kind, jpeg(base64), firstLine, lastLine}]
 */
export async function readCrops(ctx, exam, crops) {
  if (!crops.length) return { regions: [], answers: [], model: null };
  const free = crops.length === 1 && crops[0].kind === 'page';
  const system = free ? READ_SYSTEM_FREEFORM : READ_SYSTEM;
  const content = readUserContent(exam, crops);
  const res = await callStructured({
    ...ctx, effort: ctx.readEffort || 'medium', system, content, schema: READ_SCHEMA,
    cacheKeyParts: ['read-v1', ctx.model, system, exam.questions.map(q => [q.id, q.type]), crops.map(c => [c.regionId, c.kind, c.firstLine, c.hash || c.jpeg])]
  });
  const ids = free ? exam.questions.map(q => q.id) : crops.map(c => c.regionId);
  return { ...normalizeRead(res.data, ids), model: res.model, cached: res.cached };
}

/**
 * Aşama B: yalnızca metinle değerlendirme (rubrik, hatalar, kurallar, öneriler, geri bildirim).
 */
export async function evaluate(ctx, exam, regions, wrong, prefs) {
  const system = evalSystem(exam);
  const text = evalUserText(exam, regions, wrong, prefs);
  const res = await callStructured({
    ...ctx, effort: ctx.evalEffort || 'high', system, content: [{ type: 'text', text }], schema: EVAL_SCHEMA,
    cacheKeyParts: ['eval-v1', ctx.model, system, text]
  });
  return { ...normalizeEval(res.data), model: res.model, cached: res.cached };
}
