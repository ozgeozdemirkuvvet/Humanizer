// Görüntü işleme Web Worker'ı: arayüz donmadan sayfa düzeltme + optik okuma + kırpma.
import { processPage } from './vision/pipeline.js';

self.onmessage = (ev) => {
  const { id, rgba, exam, layout, redact } = ev.data;
  try {
    const res = processPage(rgba, { exam, layout, redact });
    const transfer = [];
    if (res.display) transfer.push(res.display.d.buffer);
    for (const c of res.crops || []) transfer.push(c.img.d.buffer);
    self.postMessage({ id, res }, transfer);
  } catch (e) {
    self.postMessage({ id, error: e.message || String(e) });
  }
};
