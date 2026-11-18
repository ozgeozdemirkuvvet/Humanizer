// Bağımlılıksız, en küçük PNG kodlayıcı (gri tonlamalı, 8 bit). Testlerde sentetik fotoğrafları yüklemek için.
import { deflateSync } from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** @param {{w:number,h:number,d:ArrayLike<number>}} g gri görüntü */
export function encodeGrayPNG(g) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(g.w, 0); ihdr.writeUInt32BE(g.h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((g.w + 1) * g.h);
  for (let y = 0; y < g.h; y++) { raw[y * (g.w + 1)] = 0; for (let x = 0; x < g.w; x++) raw[y * (g.w + 1) + 1 + x] = g.d[y * g.w + x]; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 3 })), chunk('IEND', Buffer.alloc(0))]);
}
