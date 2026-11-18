// e-Okul not listesi ve sınıf listesi (CSV).
// Türkçe Excel ";" ayracını ve UTF-8 BOM'u bekler; yoksa "Ş, ğ, ı" bozuk görünür.

const BOM = '﻿';

function cell(v) {
  const s = String(v ?? '');
  // Excel formül enjeksiyonuna karşı (=, +, -, @ ile başlayan hücreler)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCSV(rows) {
  return BOM + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

/**
 * e-Okul not listesi. Yalnızca onaylı kağıtlar yazılır; onaysızlar ayrı döner, arayüz uyarır.
 * @returns {{csv:string, skipped:object[]}}
 */
export function eOkulCSV(exam, papers) {
  const approved = papers.filter(p => p.status === 'onaylandi');
  const skipped = papers.filter(p => p.status !== 'onaylandi');
  const sorted = [...approved].sort((a, b) => (parseInt(a.student?.no, 10) || 0) - (parseInt(b.student?.no, 10) || 0));
  const rows = [['Okul No', 'Adı Soyadı', 'Not']];
  for (const p of sorted) rows.push([p.student?.no ?? '', p.student?.name ?? '', p.total?.grade100 ?? '']);
  return { csv: toCSV(rows), skipped };
}

/** Basit CSV ayrıştırıcı: ";" ya da "," ayraç, tırnaklı alan, BOM. */
export function parseCSV(text) {
  const t = String(text).replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

/**
 * Sınıf listesi: e-Okul'dan alınan ya da elle yazılan "No;Ad Soyad" listesi.
 * Başlık satırı varsa atlanır; sütunlar başlıktan ya da içerikten (sayısal sütun = numara) bulunur.
 */
export function parseRoster(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  let noIdx = -1, nameIdx = -1, start = 0;
  const head = rows[0].map(h => h.trim().toLocaleLowerCase('tr'));
  noIdx = head.findIndex(h => /^(okul\s*)?(no|numara|numarası)$/.test(h));
  nameIdx = head.findIndex(h => /ad/.test(h) && !/^no/.test(h));
  if (noIdx !== -1 || nameIdx !== -1) start = 1;
  if (noIdx === -1) noIdx = rows[start].findIndex(c => /^\d{1,6}$/.test(c.trim()));
  if (nameIdx === -1) nameIdx = rows[start].findIndex((c, i) => i !== noIdx && /\p{L}/u.test(c));
  const out = [];
  const seen = new Set();
  for (const r of rows.slice(start)) {
    const no = String(r[noIdx] ?? '').trim().replace(/^0+(?=\d)/, '');
    const name = String(r[nameIdx] ?? '').trim();
    if (!/^\d{1,6}$/.test(no) || seen.has(no)) continue;
    seen.add(no);
    out.push({ no, name });
  }
  return out;
}

/** Anonim gösterim için kararlı takma ad: aynı numara her zaman aynı takma adı alır. */
export function pseudonym(no, roster) {
  const sorted = [...roster].map(r => r.no).sort((a, b) => Number(a) - Number(b));
  const i = sorted.indexOf(String(no));
  return `Öğrenci ${String((i === -1 ? sorted.length : i) + 1).padStart(2, '0')}`;
}
