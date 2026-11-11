// Minimal zip o'quvchi (docx = zip). Tashqi paket kerak emas.
import { inflateRawSync } from 'node:zlib';

export function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip emas');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = new Map();
  for (let i = 0; i < n && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    files.set(name, { method, data: buf.subarray(start, start + csize) });
    p += 46 + nl + el + cl;
  }
  return {
    read(name) {
      const f = files.get(name);
      if (!f) return null;
      return f.method === 0 ? f.data : inflateRawSync(f.data, { maxOutputLength: 30 * 1024 * 1024 });
    },
  };
}
