// Word (.docx) dan abzatslarni o'qiydi: { paragraphs: [{ text, bold }], hasImages, hasTables }
import { readZip } from './zip.mjs';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, g) => {
  if (g[0] === '#') return String.fromCodePoint(g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
  return ENT[g] ?? m;
});
const BOLD = /<w:b(?:\s+w:val="(?:1|true|on)")?\s*\/>/;

export function readDocx(buf) {
  let xml;
  try { xml = readZip(buf).read('word/document.xml'); } catch { xml = null; }
  if (!xml) throw Object.assign(new Error('Bu to\'g\'ri Word (.docx) fayl emas.'), { status: 400 });
  xml = xml.toString('utf8');
  const paragraphs = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []) {
    let text = '', boldChars = 0;
    for (const r of p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || []) {
      let t = '';
      for (const m of r.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)) t += m[1] !== undefined ? decode(m[1]) : m[0] === '<w:tab/>' ? '\t' : '\n';
      text += t;
      if (BOLD.test((r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0])) boldChars += t.replace(/\s/g, '').length;
    }
    const total = text.replace(/\s/g, '').length;
    paragraphs.push({ text, bold: total > 0 && boldChars > total / 2 });
  }
  return { paragraphs, hasImages: /<w:drawing|<w:pict/.test(xml), hasTables: /<w:tbl[\s>]/.test(xml) };
}
