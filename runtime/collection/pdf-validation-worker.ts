import { readFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// This is an internal, fixed entry point. It receives only an already-downloaded
// local file, has a bounded parent process, and never invokes PDF viewer actions.
async function validate(): Promise<{ valid: boolean; pages?: number; code?: string }> {
  const input = process.argv[2];
  if (!input) return { valid: false, code: 'INVALID' };
  let sawDiagnostic = false;
  // Optional canvas startup warnings do not concern non-rendering validation.
  console.warn = () => undefined;
  console.log = () => undefined;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageRoot = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
  const resourceFolders: Record<string, string> = {
    cMapUrl: join(packageRoot, 'cmaps'),
    standardFontDataUrl: join(packageRoot, 'standard_fonts'),
    wasmUrl: join(packageRoot, 'wasm'),
  };
  class LocalBinaryDataFactory {
    async fetch(request: { kind: string; filename: string }): Promise<Uint8Array> {
      const folder = resourceFolders[request.kind];
      if (!folder || typeof request.filename !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(request.filename) || request.filename.includes('..')) throw new Error('Invalid built-in PDF resource');
      return new Uint8Array(await readFile(join(folder, request.filename)));
    }
  }
  // Fonts, CMaps and codecs can only come from the installed library above.
  // PDF URLs, external references and document actions never become fetches.
  globalThis.fetch = async () => { throw new Error('Network is disabled during PDF validation'); };
  console.warn = () => { sawDiagnostic = true; };
  console.log = () => { sawDiagnostic = true; };
  const bytes = await readFile(input);
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), stopAtErrors: true,
    disableRange: true, disableStream: true, disableAutoFetch: true,
    useWorkerFetch: false, useSystemFonts: false, disableFontFace: true,
    enableXfa: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    cMapUrl: resourceFolders.cMapUrl + sep, cMapPacked: true,
    standardFontDataUrl: resourceFolders.standardFontDataUrl + sep,
    wasmUrl: resourceFolders.wasmUrl + sep,
    BinaryDataFactory: LocalBinaryDataFactory,
    verbosity: pdfjs.VerbosityLevel.WARNINGS,
  });
  try {
    const document = await task.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1) return { valid: false, code: 'INVALID' };
    if (document.numPages > 5000) return { valid: false, code: 'LIMIT' };
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      if (page.view.length !== 4 || !page.view.every(Number.isFinite) || page.view[2]! <= page.view[0]! || page.view[3]! <= page.view[1]!) return { valid: false, code: 'INVALID' };
      await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE });
      page.cleanup();
    }
    return sawDiagnostic ? { valid: false, code: 'DIAGNOSTIC' } : { valid: true, pages: document.numPages };
  } catch (error) {
    return { valid: false, code: error instanceof Error && error.name === 'PasswordException' ? 'PASSWORD_REQUIRED' : 'INVALID' };
  } finally { await task.destroy(); }
}

try { process.stdout.write(JSON.stringify(await validate()) + '\n'); }
catch { process.stdout.write(JSON.stringify({ valid: false, code: 'UNAVAILABLE' }) + '\n'); }
