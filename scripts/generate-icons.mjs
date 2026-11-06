import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function createPng(width, height, rgbaBuffer) {
  const rawData = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rawData[y * (width * 4 + 1)] = 0;
    rgbaBuffer.copy(rawData, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const deflated = zlib.deflateSync(rawData);
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(8 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    let crc = 0xFFFFFFFF;
    for (let i = 4; i < 8 + len; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([header, makeChunk('IHDR', ihdr), makeChunk('IDAT', deflated), makeChunk('IEND', Buffer.alloc(0))]);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const ringRadius = size * 0.32;
  const ringThick = Math.max(2, size * 0.08);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const bgDist = Math.hypot(x - center, y - center);
      if (bgDist <= size * 0.46) {
        rgba[idx] = 15; rgba[idx+1] = 23; rgba[idx+2] = 42; rgba[idx+3] = 255;
      }

      const lx = center - size * 0.06;
      const ly = center - size * 0.06;
      const lensDist = Math.hypot(x - lx, y - ly);
      if (lensDist >= ringRadius - ringThick && lensDist <= ringRadius) {
        rgba[idx] = 99; rgba[idx+1] = 102; rgba[idx+2] = 241; rgba[idx+3] = 255;
      } else if (lensDist < ringRadius - ringThick) {
        rgba[idx] = 30; rgba[idx+1] = 41; rgba[idx+2] = 59; rgba[idx+3] = 255;
      }

      const hx1 = lx + ringRadius * 0.7;
      const hy1 = ly + ringRadius * 0.7;
      const hx2 = center + size * 0.35;
      const hy2 = center + size * 0.35;
      const handleThick = Math.max(2, size * 0.07);

      const dx = hx2 - hx1, dy = hy2 - hy1;
      const lenSq = dx*dx + dy*dy;
      const t = Math.max(0, Math.min(1, ((x - hx1)*dx + (y - hy1)*dy) / lenSq));
      const px = hx1 + t * dx;
      const py = hy1 + t * dy;
      const hDist = Math.hypot(x - px, y - py);
      if (hDist <= handleThick) {
        rgba[idx] = 168; rgba[idx+1] = 85; rgba[idx+2] = 247; rgba[idx+3] = 255;
      }
    }
  }
  return createPng(size, size, rgba);
}

export function generateIcons() {
  const buildDir = path.join(rootDir, 'build');
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  const png16 = renderIcon(16);
  const png32 = renderIcon(32);
  const png48 = renderIcon(48);
  const png256 = renderIcon(256);

  const images = [
    { width: 16, height: 16, png: png16 },
    { width: 32, height: 32, png: png32 },
    { width: 48, height: 48, png: png48 },
    { width: 0, height: 0, png: png256 },
  ];

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const dirEntries = [];
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.width, 0);
    entry.writeUInt8(img.height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += img.png.length;
  }

  const ico = Buffer.concat([header, ...dirEntries, ...images.map(i => i.png)]);

  fs.writeFileSync(path.join(buildDir, 'icon.png'), png256);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
  console.log(`[QuickFind:Build] Icons generated: build/icon.png, build/icon.ico (${ico.length} bytes)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateIcons();
}

