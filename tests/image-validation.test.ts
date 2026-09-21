import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateImageAsset } from '../runtime/collection/image-validation.js';

let directory: string;
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'babel-image-validation-')); });
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
let index = 0;
async function file(bytes: Buffer): Promise<string> { const path = join(directory, 'image-' + index++); await writeFile(path, bytes); return path; }

const PYPI_BADGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="134" height="20" role="img" aria-label="pypi (stable): v3.16.2"><title>pypi (stable): v3.16.2</title><filter id="blur"><feGaussianBlur stdDeviation="16"/></filter><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="134" height="20" rx="3"/></clipPath><g clip-path="url(#r)"><rect width="81" height="20" fill="#555"/><rect x="81" width="53" height="20" fill="#007ec6"/><rect width="134" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110"><g transform="scale(.1)"><g aria-hidden="true" fill="#010101"><text x="415" y="150" fill-opacity=".8" filter="url(#blur)" textLength="710">pypi (stable)</text><text x="415" y="150" fill-opacity=".3" textLength="710">pypi (stable)</text></g><text x="415" y="140" textLength="710">pypi (stable)</text></g><g transform="scale(.1)"><g aria-hidden="true" fill="#010101"><text x="1065" y="150" fill-opacity=".8" filter="url(#blur)" textLength="430">v3.16.2</text><text x="1065" y="150" fill-opacity=".3" textLength="430">v3.16.2</text></g><text x="1065" y="140" textLength="430">v3.16.2</text></g></g></svg>';

describe('complete image validation', () => {
  it('decodes ordinary PNG, JPEG, WebP and AVIF without modifying the source', async () => {
    for (const format of ['png', 'jpeg', 'webp', 'avif'] as const) {
      const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#25657e' } }).toFormat(format).toBuffer();
      const path = await file(bytes);
      await expect(validateImageAsset(path)).resolves.toMatchObject({ width: 12, height: 8, extension: format === 'jpeg' ? 'jpg' : format });
      expect(await readFile(path)).toEqual(bytes);
    }
  });

  it('accepts the observed static nested path SVG shape and preserves its bytes', async () => {
    const bytes = Buffer.from(`<svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0, 0)">
        <svg viewBox="0 0 1000 1000" height="333.3333333333333" width="333.3333333333333">
          <path fill="#000000" d="M-3.18703e-05 457.606C0.170966 442.459 3.57278 416.702 11.5377 403.688Z"></path>
        </svg>
      </g>
    </svg>`);
    const path = await file(bytes);
    await expect(validateImageAsset(path)).resolves.toEqual({ extension: 'svg', mediaType: 'image/svg+xml', width: 1000, height: 1000 });
    expect(await readFile(path)).toEqual(bytes);
  });

  it('accepts the exact observed 1,331-byte self-contained PyPI badge and preserves its bytes', async () => {
    const bytes = Buffer.from(PYPI_BADGE_SVG);
    expect(bytes).toHaveLength(1331);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('285d906158ffeef49a7b646571e584959b82b93b017292d2d92a0824b6fbe764');
    const path = await file(bytes);
    await expect(validateImageAsset(path)).resolves.toEqual({ extension: 'svg', mediaType: 'image/svg+xml', width: 134, height: 20 });
    expect(await readFile(path)).toEqual(bytes);
  });

  it('rejects executable, external-resource, entity, unsupported and truncated SVG input', async () => {
    const start = '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">';
    const path = '<path fill="#000000" d="M0 0L10 10Z"></path>';
    const invalid = [
      `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${start}${path}</svg>`,
      `${start}<script>throw new Error('run')</script>${path}</svg>`,
      `${start}<path fill="#000000" onload="run()" d="M0 0L10 10Z"></path></svg>`,
      `${start}<image href="https://example.com/external.png" width="10" height="10"/>${path}</svg>`,
      `${start}<foreignObject><div>HTML</div></foreignObject>${path}</svg>`,
      `${start}${path}`,
    ];
    for (const bytes of invalid) await expect(validateImageAsset(await file(Buffer.from(bytes)))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(validateImageAsset(await file(Buffer.from(`${start}<circle fill="#000000" cx="5" cy="5" r="5"/></svg>`)))).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
  });

  it('rejects external, missing, cyclic, duplicate and over-budget badge resources', async () => {
    const start = '<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg">';
    const invalid = [
      `${start}<g><rect width="20" height="20" fill="url(https://example.com/gradient)"/></g></svg>`,
      `${start}<g><rect width="20" height="20" fill="url(#missing)"/></g></svg>`,
      `${start}<linearGradient id="same"><stop offset="0"/><stop offset="1"/></linearGradient><clipPath id="same"><rect width="20" height="20"/></clipPath><g><rect width="20" height="20" fill="url(#same)"/></g></svg>`,
    ];
    for (const source of invalid) await expect(validateImageAsset(await file(Buffer.from(source)))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });

    const cyclic = `${start}<clipPath id="loop"><g clip-path="url(#loop)"><rect width="20" height="20" fill="#000"/></g></clipPath></svg>`;
    await expect(validateImageAsset(await file(Buffer.from(cyclic)))).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' });

    const oversized = `${start}<filter id="blur"><feGaussianBlur stdDeviation="129"/></filter><g fill="#000" font-size="10"><text x="1" y="10" filter="url(#blur)">x</text></g></svg>`;
    await expect(validateImageAsset(await file(Buffer.from(oversized)))).rejects.toMatchObject({ code: 'FILE_VALIDATION_LIMIT' });
  });

  it('rejects a PNG with valid dimensions and truncated IDAT pixels', async () => {
    const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#25657e' } }).png().toBuffer();
    const idat = bytes.indexOf(Buffer.from('IDAT'));
    expect(idat).toBeGreaterThan(30);
    await expect(validateImageAsset(await file(bytes.subarray(0, idat + 5)))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('decodes all frames in an animated GIF and rejects a truncated later frame', async () => {
    const raw = Buffer.from([255, 0, 0, 0, 0, 255]);
    const bytes = await sharp(raw, { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } }).gif({ delay: [100, 100] }).toBuffer();
    const path = await file(bytes);
    await expect(validateImageAsset(path)).resolves.toMatchObject({ width: 1, height: 1, extension: 'gif' });
    await expect(validateImageAsset(await file(bytes.subarray(0, bytes.length - 4)))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('rejects HTML, honors cancellation, and bounds declared pixels', async () => {
    await expect(validateImageAsset(await file(Buffer.from('<html>login required</html>')))).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    const path = await file(await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer());
    const controller = new AbortController(); controller.abort();
    await expect(validateImageAsset(path, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    const header = await readFile(path); header.writeUInt32BE(100_000, 16); header.writeUInt32BE(100_000, 20);
    await expect(validateImageAsset(await file(header))).rejects.toMatchObject({ code: 'FILE_VALIDATION_LIMIT' });
  });
});
