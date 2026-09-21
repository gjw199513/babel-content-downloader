import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// A permissive GIF decoder can recover just the first frame of a truncated
// animation. Check the complete block stream and expected frame count first.
function gifFrameCount(bytes: Buffer): number {
  if (!/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')) || bytes.length < 13) throw new Error('Invalid GIF header');
  let offset = 13 + (bytes[10]! & 0x80 ? 3 * 2 ** ((bytes[10]! & 7) + 1) : 0);
  let frames = 0;
  const skipBlocks = (): void => {
    for (;;) {
      if (offset >= bytes.length) throw new Error('Truncated GIF block');
      const length = bytes[offset++]!;
      if (!length) return;
      offset += length;
      if (offset > bytes.length) throw new Error('Truncated GIF block');
    }
  };
  while (offset < bytes.length) {
    const kind = bytes[offset++];
    if (kind === 0x3b) {
      if (!frames || offset !== bytes.length) throw new Error('Invalid GIF trailer');
      return frames;
    }
    if (kind === 0x21) {
      if (offset >= bytes.length) throw new Error('Truncated GIF extension');
      offset++; skipBlocks();
    } else if (kind === 0x2c) {
      if (offset + 9 > bytes.length || !bytes.readUInt16LE(offset + 4) || !bytes.readUInt16LE(offset + 6)) throw new Error('Invalid GIF frame');
      const packed = bytes[offset + 8]!;
      offset += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      if (offset >= bytes.length || bytes[offset]! < 1 || bytes[offset]! > 8) throw new Error('Invalid GIF image data');
      offset++; skipBlocks(); frames++;
      if (frames > 500) return frames;
    } else throw new Error('Invalid GIF block');
  }
  throw new Error('Missing GIF trailer');
}

// Fixed local pixel decoder entry; SVG bytes have already passed the strict parent preflight.
async function validate(): Promise<Record<string, unknown>> {
  const path = process.argv[2];
  if (!path) return { valid: false, code: 'INVALID' };
  const expectedSvgSha256 = process.argv[3];
  let sharp;
  try { sharp = (await import('sharp')).default; }
  catch { return { valid: false, code: 'UNAVAILABLE' }; }
  sharp.cache(false); sharp.concurrency(1);
  let input: string | Buffer = path;
  if (expectedSvgSha256) {
    const bytes = await readFile(path);
    if (!/^[a-f0-9]{64}$/.test(expectedSvgSha256) || createHash('sha256').update(bytes).digest('hex') !== expectedSvgSha256) return { valid: false, code: 'INVALID' };
    input = bytes;
  }
  const decoder = sharp(input, { failOn: 'warning', animated: true, limitInputPixels: 64 * 1024 ** 2, sequentialRead: true });
  let warning = false;
  decoder.on('warning', () => { warning = true; });
  try {
    const metadata = await decoder.metadata();
    const width = metadata.width; const height = metadata.pageHeight ?? metadata.height;
    const pages = metadata.pages ?? 1;
    if (!width || !height || !Number.isSafeInteger(pages) || pages < 1 || pages > 500 || width * height * pages > 64 * 1024 ** 2) return { valid: false, code: 'LIMIT' };
    if (metadata.format === 'gif' && gifFrameCount(await readFile(path)) !== pages) return { valid: false, code: 'INVALID' };
    const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format === 'heif' && metadata.compression === 'av1' ? 'avif' : metadata.format;
    const formats: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heif: 'image/heif', tiff: 'image/tiff', svg: 'image/svg+xml' };
    if (!extension || !formats[extension]) return { valid: false, code: 'UNSUPPORTED' };
    if (expectedSvgSha256 && extension !== 'svg') return { valid: false, code: 'INVALID' };
    // stats forces a complete decode of the input, including every loaded frame.
    await decoder.stats();
    return warning ? { valid: false, code: 'INVALID' } : { valid: true, extension, mediaType: formats[extension], width, height };
  } catch { return { valid: false, code: 'INVALID' }; }
  finally { decoder.destroy(); }
}

try { process.stdout.write(JSON.stringify(await validate()) + '\n'); }
catch { process.stdout.write(JSON.stringify({ valid: false, code: 'UNAVAILABLE' }) + '\n'); }
