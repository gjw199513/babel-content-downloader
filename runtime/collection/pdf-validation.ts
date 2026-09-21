import { open, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EngineError, runProcess } from '../engines/process.js';

const MAX_PDF_BYTES = 128 * 1024 ** 2;
const MAX_PDF_PAGES = 5000;

/** Parse every page in a bounded child process; never render or execute PDF actions. */
export async function validatePdfAsset(path: string, signal?: AbortSignal): Promise<{ extension: 'pdf'; mediaType: 'application/pdf'; pageCount: number }> {
  if (signal?.aborted) throw new EngineError('CANCELLED', '任务已取消');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new EngineError('INVALID_DOCUMENT', 'PDF 来源不是普通文件');
  if (info.size > MAX_PDF_BYTES) throw new EngineError('FILE_VALIDATION_LIMIT', 'PDF 超过当前 128 MiB 解析预算');
  if (info.size < 32) throw new EngineError('INVALID_DOCUMENT', 'PDF 文件不完整');

  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(Math.min(1024, info.size));
    await handle.read(header, 0, header.length, 0);
    if (!/^%PDF-(?:1\.[0-9]|2\.0)[\r\n\s]/.test(header.toString('latin1'))) throw new EngineError('INVALID_DOCUMENT', 'PDF 文件头无效');
    const tail = Buffer.alloc(Math.min(8192, info.size));
    await handle.read(tail, 0, tail.length, info.size - tail.length);
    const match = /startxref\s+(\d+)\s+%%EOF[\x00\x09\x0a\x0c\x0d\x20]*$/.exec(tail.toString('latin1'));
    const xref = Number(match?.[1]);
    if (!match || !Number.isSafeInteger(xref) || xref < 8 || xref >= info.size - 10) throw new EngineError('INVALID_DOCUMENT', 'PDF 缺少完整的交叉引用终点');
    const target = Buffer.alloc(Math.min(1024, info.size - xref));
    await handle.read(target, 0, target.length, xref);
    const targetText = target.toString('latin1').replace(/#([a-fA-F0-9]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (!/^xref\b/.test(targetText) && !(/^\d+\s+\d+\s+obj\b/.test(targetText) && /\/Type\s*\/XRef\b/.test(targetText))) throw new EngineError('INVALID_DOCUMENT', 'PDF 交叉引用位置无效');
  } finally { await handle.close(); }

  const sourceWorker = import.meta.url.endsWith('.ts');
  const worker = fileURLToPath(new URL(sourceWorker ? './pdf-validation-worker.ts' : './pdf-validation-worker.js', import.meta.url));
  const args = ['--max-old-space-size=256', ...(sourceWorker ? ['--import', import.meta.resolve('tsx')] : []), worker, path];
  let result: { stdout: string; stderr: string };
  try {
    result = await runProcess(process.execPath, args, { signal, timeoutMs: 20_000, maxOutputBytes: 4096 });
  } catch (error) {
    if (error instanceof EngineError && error.code === 'CANCELLED') throw error;
    if (error instanceof EngineError && (error.code === 'ENGINE_TIMEOUT' || error.code === 'ENGINE_FAILED' && /heap out of memory|allocation failed/i.test(error.message))) {
      throw new EngineError('FILE_VALIDATION_LIMIT', 'PDF 解析超出时间或内存预算，未确认附件完整');
    }
    throw new EngineError('DOCUMENT_VALIDATION_UNAVAILABLE', 'PDF 校验进程未能正常运行');
  }
  let reply: { valid?: unknown; pages?: unknown; code?: unknown };
  try {
    reply = JSON.parse(result.stdout);
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw new Error('Invalid worker result');
  }
  catch { throw new EngineError('DOCUMENT_VALIDATION_UNAVAILABLE', 'PDF 校验进程未返回有效结果'); }
  if (reply.valid !== true) {
    if (reply.code === 'UNAVAILABLE') throw new EngineError('DOCUMENT_VALIDATION_UNAVAILABLE', 'PDF 校验进程未能完成初始化');
    if (reply.code === 'PASSWORD_REQUIRED') throw new EngineError('DOCUMENT_PASSWORD_REQUIRED', 'PDF 需要密码，未尝试解密或绕过保护');
    if (reply.code === 'LIMIT') throw new EngineError('FILE_VALIDATION_LIMIT', 'PDF 页数超过当前解析预算');
    if (reply.code === 'DIAGNOSTIC') throw new EngineError('DOCUMENT_VALIDATION_INCOMPLETE', 'PDF 页面解析存在未解决的诊断，未确认附件完整');
    throw new EngineError('INVALID_DOCUMENT', 'PDF 文件或页面内容未通过完整解析');
  }
  if (!Number.isInteger(reply.pages) || Number(reply.pages) < 1 || Number(reply.pages) > MAX_PDF_PAGES) throw new EngineError('INVALID_DOCUMENT', 'PDF 未包含可确认的有效页面');
  if (signal?.aborted) throw new EngineError('CANCELLED', '任务已取消');
  return { extension: 'pdf', mediaType: 'application/pdf', pageCount: Number(reply.pages) };
}
