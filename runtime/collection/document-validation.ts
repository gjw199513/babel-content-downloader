import { lstat, open, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { SourceAsset } from '../../shared/contracts.js';
import { EngineError } from '../engines/process.js';
import { validateArchiveAsset } from './archive-validation.js';
import { validatePdfAsset } from './pdf-validation.js';

/** Validate the actual complete file before it can enter the saved manifest. */
export async function validateDocumentAsset(path: string, asset: Pick<SourceAsset, 'url' | 'media_type'>, declared: string, signal?: AbortSignal): Promise<{ extension: string; mediaType: string }> {
  if (signal?.aborted) throw new EngineError('CANCELLED', '任务已取消');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw new EngineError('INVALID_DOCUMENT', '附件不是有效的普通文件');
  const handle = await open(path, 'r');
  const prefix = Buffer.alloc(Math.min(info.size, 8192));
  try { await handle.read(prefix, 0, prefix.length, 0); } finally { await handle.close(); }
  const head = prefix.toString('utf8').trim();
  if (/^(?:<!doctype\s+html|<html|<head|<body)/i.test(head) || /<html[\s>]/i.test(head.slice(0, 512))) throw new EngineError('HTML_ASSET_REJECTED', '下载返回网页或登录页，不能作为附件');
  let extension = '';
  try { extension = extname(new URL(asset.url).pathname).slice(1).toLowerCase(); } catch { /* Signature and declared media type remain available. */ }
  const mediaType = declared.split(';')[0]!.trim().toLowerCase();
  const sourceType = asset.media_type?.split(';')[0]?.trim().toLowerCase();
  if (prefix.subarray(0, 5).toString('ascii') === '%PDF-' || extension === 'pdf' || [mediaType, sourceType].includes('application/pdf')) return validatePdfAsset(path, signal);
  if ((prefix[0] === 0x50 && prefix[1] === 0x4b) || ['zip', 'docx', 'xlsx', 'pptx', 'epub'].includes(extension)
    || [mediaType, sourceType].some(value => value?.includes('officedocument') || value === 'application/epub+zip' || value === 'application/zip')) {
    const archiveMediaType = [sourceType, mediaType].find(value => value?.includes('officedocument') || value === 'application/epub+zip') ?? sourceType ?? mediaType;
    return validateArchiveAsset(path, { extension, mediaType: archiveMediaType }, signal);
  }
  if ([mediaType, sourceType].includes('text/plain') || extension === 'txt') {
    if (info.size > 8 * 1024 ** 2) throw new EngineError('TEXT_SIZE_LIMIT', '文本附件超过当前可验证的容量上限');
    const bytes = await readFile(path);
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new EngineError('INVALID_DOCUMENT', '文本附件不是有效的 UTF-8 文本'); }
    if (bytes.includes(0)) throw new EngineError('INVALID_DOCUMENT', '文本附件包含二进制内容');
    if (signal?.aborted) throw new EngineError('CANCELLED', '任务已取消');
    return { extension: 'txt', mediaType: 'text/plain' };
  }
  throw new EngineError('UNVERIFIED_FILE_TYPE', '附件格式未能通过内容校验，已保留任务诊断');
}
