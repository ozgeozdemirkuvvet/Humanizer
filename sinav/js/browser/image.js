// Tarayıcıya özgü görüntü girişi/çıkışı: dosya → RGBA sayfalar (JPEG/PNG/HEIC*/PDF),
// RGBA → JPEG (base64 ya da Blob). *HEIC yalnızca tarayıcı destekliyorsa (Safari).

export const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.min.mjs';
export const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';
const MAX_SIDE = 3200; // telefon fotoğraflarını makul boyuta indir (bellek + hız)

let pdfP = null;
function loadPdf() {
  return pdfP ||= import(PDFJS_URL).then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; }).catch(e => { pdfP = null; throw new Error('PDF okuyucu yüklenemedi (internet bağlantısını kontrol edin).', { cause: e }); });
}

function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

function drawToRGBA(src, sw, sh) {
  const s = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const w = Math.round(sw * s), h = Math.round(sh * s);
  const c = canvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  return { w, h, d: id.data };
}

/** Bir dosyadan sayfa listesi: [{ rgba, name }] */
export async function fileToPages(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await loadPdf();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = Math.min(150 / 72 * 1.4, MAX_SIDE / Math.max(vp0.width, vp0.height)); // ~210 dpi
      const vp = page.getViewport({ scale });
      const c = canvas(Math.round(vp.width), Math.round(vp.height));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
      out.push({ rgba: { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data }, name: `${file.name} · s.${i}` });
    }
    return out;
  }
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`${file.name}: bu görüntü biçimi tarayıcıda açılamadı (JPG ya da PNG deneyin).`); }
  const rgba = drawToRGBA(bmp, bmp.width, bmp.height);
  bmp.close?.();
  return [{ rgba, name: file.name }];
}

function toCanvas(img) {
  const c = canvas(img.w, img.h);
  const ctx = c.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.d.buffer, img.d.byteOffset, img.d.length), img.w, img.h), 0, 0);
  return c;
}

export async function toJpegBlob(img, quality = 0.85) {
  const c = toCanvas(img);
  if (c.convertToBlob) return c.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}

export async function toJpegBase64(img, quality = 0.85) {
  const blob = await toJpegBlob(img, quality);
  const u = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Blob → RGBA (yeniden işleme için saklanan özgün fotoğraftan). */
export async function blobToRGBA(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const r = drawToRGBA(bmp, bmp.width, bmp.height);
  bmp.close?.();
  return r;
}
