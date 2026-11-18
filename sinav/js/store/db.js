// IndexedDB: tüm veriler yalnızca öğretmenin tarayıcısında. Sunucu yok, üçüncü taraf yok.
// Depolar: exams, papers, images (Blob), rosters, edits, cache (yapay zekâ yanıtları), kv (ayarlar).

const DB_NAME = 'kirmizi-kalem';
const VERSION = 1;
export const STORES = ['exams', 'papers', 'images', 'rosters', 'edits', 'cache', 'kv'];

let dbP = null;
export function openDB() {
  return dbP ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue;
        const os = db.createObjectStore(s, { keyPath: s === 'kv' || s === 'cache' ? 'key' : 'id' });
        if (s === 'papers' || s === 'edits') os.createIndex('examId', 'examId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbP = null; reject(req.error); };
  });
}

async function tx(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let out;
    Promise.resolve(fn(os)).then(v => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('İşlem iptal edildi'));
  });
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const db = {
  get: (s, id) => tx(s, 'readonly', os => wrap(os.get(id))),
  put: (s, v) => tx(s, 'readwrite', os => wrap(os.put(v))),
  del: (s, id) => tx(s, 'readwrite', os => wrap(os.delete(id))),
  all: (s) => tx(s, 'readonly', os => wrap(os.getAll())),
  byExam: (s, examId) => tx(s, 'readonly', os => wrap(os.index('examId').getAll(examId))),
  clear: (s) => tx(s, 'readwrite', os => wrap(os.clear()))
};

export const kv = {
  get: async (key, def) => (await db.get('kv', key))?.value ?? def,
  set: (key, value) => db.put('kv', { key, value })
};

/** Yapay zekâ yanıt önbelleği (claude.js'in beklediği arayüz). */
export const aiCache = {
  get: async key => (await db.get('cache', key))?.value,
  set: (key, value) => db.put('cache', { key, value, at: Date.now() })
};

/** Bir sınavı, kağıtlarını, görüntülerini ve düzenleme günlüğünü siler. */
export async function deleteExam(examId) {
  const papers = await db.byExam('papers', examId);
  for (const p of papers) {
    for (const pg of p.pages || []) { if (pg.imageId) await db.del('images', pg.imageId); if (pg.sourceId) await db.del('images', pg.sourceId); }
    await db.del('papers', p.id);
  }
  for (const e of await db.byExam('edits', examId)) await db.del('edits', e.id);
  await db.del('exams', examId);
}

/** Dönem sonu toplu silme: ayarlar (API anahtarı hariç seçime bağlı) dışında her şey. */
export async function wipeAll({ keepSettings = true } = {}) {
  for (const s of STORES) if (!(keepSettings && s === 'kv')) await db.clear(s);
}

// ---- Şifreli yedek (AES-GCM, PBKDF2-SHA256 250.000 tur) ----
const ITER = 250000;
async function keyFrom(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const blobToB64 = async b => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64ToBlob = (s, type) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };

export async function exportBackup(password) {
  const data = { app: 'kirmizi-kalem', version: 1, at: new Date().toISOString() };
  for (const s of ['exams', 'papers', 'rosters', 'edits']) data[s] = await db.all(s);
  data.images = [];
  for (const im of await db.all('images')) data.images.push({ ...im, blob: undefined, b64: await blobToB64(im.blob), type: im.blob.type });
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(password, salt);
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return new Blob([new TextEncoder().encode('KKYEDEK1'), salt, iv, new Uint8Array(enc)], { type: 'application/octet-stream' });
}

export async function importBackup(file, password) {
  const u = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(u.subarray(0, 8)) !== 'KKYEDEK1') throw new Error('Bu bir Kırmızı Kalem yedeği değil.');
  const salt = u.subarray(8, 24), iv = u.subarray(24, 36);
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await keyFrom(password, salt), u.subarray(36)); }
  catch { throw new Error('Parola yanlış ya da dosya bozuk.'); }
  const data = JSON.parse(new TextDecoder().decode(plain));
  for (const s of ['exams', 'papers', 'rosters', 'edits']) for (const v of data[s] || []) await db.put(s, v);
  for (const im of data.images || []) await db.put('images', { id: im.id, examId: im.examId, kind: im.kind, blob: b64ToBlob(im.b64, im.type) });
  return { exams: data.exams?.length || 0, papers: data.papers?.length || 0 };
}
