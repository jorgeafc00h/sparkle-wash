#!/usr/bin/env node
// Wraps PNG files into a Windows .ico container (PNG-compressed entries).
// Usage: node scripts/make-ico.cjs out.ico a.png b.png ...
const fs = require('fs');
const [out, ...pngs] = process.argv.slice(2);
if (!out || pngs.length === 0) { console.error('Usage: make-ico.cjs out.ico a.png [b.png ...]'); process.exit(1); }
const images = pngs.map((p) => {
  const buf = fs.readFileSync(p);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${p} is not a PNG`);
  return { buf, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
});
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((im, i) => {
  const o = 6 + 16 * i;
  header[o] = im.w >= 256 ? 0 : im.w;
  header[o + 1] = im.h >= 256 ? 0 : im.h;
  header.writeUInt16LE(1, o + 4);
  header.writeUInt16LE(32, o + 6);
  header.writeUInt32LE(im.buf.length, o + 8);
  header.writeUInt32LE(offset, o + 12);
  offset += im.buf.length;
});
fs.writeFileSync(out, Buffer.concat([header, ...images.map((i) => i.buf)]));
console.log(`wrote ${out} (${images.length} sizes)`);
