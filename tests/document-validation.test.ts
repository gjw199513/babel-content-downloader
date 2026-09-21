import { mkdtemp, readFile, rm, writeFile, open } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { validatePdfAsset } from '../runtime/collection/pdf-validation.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function file(name: string, bytes: string | Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'babel-document-')); directories.push(directory);
  const path = join(directory, name); await writeFile(path, bytes); return path;
}

/** Small real PDFs with accurate object offsets, including compressed streams. */
function pdf(pages: number, options: { compressed?: boolean; corruptLastStream?: boolean; catalog?: string } = {}): Buffer {
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R ' + (options.catalog ?? '') + ' >>'),
    Buffer.from('<< /Type /Pages /Count ' + pages + ' /Kids [' + Array.from({ length: pages }, (_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];
  for (let i = 0; i < pages; i++) {
    objects.push(Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (5 + i * 2) + ' 0 R >>'));
    const source = Buffer.from('BT /F1 12 Tf 72 720 Td (Babel page ' + (i + 1) + ') Tj ET');
    const stream = options.corruptLastStream && i === pages - 1 ? Buffer.from('broken flate stream') : options.compressed ? deflateSync(source) : source;
    const compressed = options.compressed || options.corruptLastStream && i === pages - 1;
    objects.push(Buffer.concat([Buffer.from('<< /Length ' + stream.length + (compressed ? ' /Filter /FlateDecode' : '') + ' >>\nstream\n'), stream, Buffer.from('\nendstream')]));
  }
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n')]; const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(parts.reduce((n, part) => n + part.length, 0));
    parts.push(Buffer.from((i + 1) + ' 0 obj\n'), objects[i]!, Buffer.from('\nendobj\n'));
  }
  const start = parts.reduce((n, part) => n + part.length, 0);
  parts.push(Buffer.from('xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')
    + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n'));
  return Buffer.concat(parts);
}

describe('complete PDF and plain-file validation', () => {
  it('parses every page in both ordinary and compressed PDFs', async () => {
    for (const compressed of [false, true]) {
      const path = await file('valid.pdf', pdf(2, { compressed }));
      await expect(validatePdfAsset(path)).resolves.toEqual({ extension: 'pdf', mediaType: 'application/pdf', pageCount: 2 });
    }
  });

  it('accepts a real object-stream/xref-stream PDF', async () => {
    const path = await file('object-stream.pdf', await readFile(new URL('./fixtures/pdf-object-stream.pdf', import.meta.url)));
    await expect(validatePdfAsset(path)).resolves.toMatchObject({ pageCount: 1 });
  });

  it('rejects a header-only PDF, a truncated EOF, and a bad cross-reference offset', async () => {
    const valid = pdf(1);
    const cases = [Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n'), valid.subarray(0, valid.length - 8), Buffer.from(valid.toString('latin1').replace(/startxref\n\d+/, 'startxref\n9'), 'latin1')];
    for (const bytes of cases) await expect(validatePdfAsset(await file('broken.pdf', bytes))).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  });

  it('does not accept a document when a later page stream is corrupt', async () => {
    await expect(validatePdfAsset(await file('broken-second-page.pdf', pdf(2, { corruptLastStream: true })))).rejects.toMatchObject({ code: 'DOCUMENT_VALIDATION_INCOMPLETE' });
  });

  it('never follows a document action to an external URL', async () => {
    let requests = 0;
    const server = createServer((_request, response) => { requests++; response.end('unexpected'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture address');
      const catalog = '/OpenAction << /S /URI /URI (http://127.0.0.1:' + address.port + '/action) >>';
      await expect(validatePdfAsset(await file('with-action.pdf', pdf(1, { catalog })))).resolves.toMatchObject({ pageCount: 1 });
      expect(requests).toBe(0);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it('honors cancellation and the file size budget before starting a parser', async () => {
    const path = await file('valid.pdf', pdf(1)); const controller = new AbortController(); controller.abort();
    await expect(validatePdfAsset(path, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    const handle = await open(path, 'r+'); try { await handle.truncate(128 * 1024 ** 2 + 1); } finally { await handle.close(); }
    await expect(validatePdfAsset(path)).rejects.toMatchObject({ code: 'FILE_VALIDATION_LIMIT' });
  });

  it('does not call HTML, binary text, or invalid UTF-8 a plain-text attachment', async () => {
    const { validateDocumentAsset } = await import('../runtime/collection/document-validation.js');
    const asset = { url: 'https://example.com/file.txt', media_type: 'text/plain' };
    for (const bytes of [Buffer.from('<html>Sign in</html>'), Buffer.from([65, 0, 66]), Buffer.from([0xc3, 0x28])]) {
      await expect(validateDocumentAsset(await file('text.bin', bytes), asset, 'text/plain')).rejects.toThrow();
    }
    await expect(validateDocumentAsset(await file('text.bin', '可以阅读的原文\n'), asset, 'text/plain')).resolves.toEqual({ extension: 'txt', mediaType: 'text/plain' });
    await expect(validateDocumentAsset(await file('text.bin', '下载接口返回的正文\n'), asset, 'application/octet-stream')).resolves.toEqual({ extension: 'txt', mediaType: 'text/plain' });
  });

  it('does not let a generic source MIME hide an Office response type', async () => {
    const { validateDocumentAsset } = await import('../runtime/collection/document-validation.js');
    const emptyZip = Buffer.alloc(22); emptyZip.writeUInt32LE(0x06054b50);
    await expect(validateDocumentAsset(await file('download.bin', emptyZip), { url: 'https://example.com/download', media_type: 'application/octet-stream' }, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' });
  });
});
