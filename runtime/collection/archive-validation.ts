import { createReadStream } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { SaxesParser, type SaxesTagNS } from "saxes";
import { EngineError } from "../engines/process.js";

export type ArchiveExtension = "zip" | "docx" | "xlsx" | "pptx" | "epub";

export interface ArchiveAssetHints {
  extension?: string;
  mediaType?: string;
}

export interface ArchiveAssetValidation {
  extension: ArchiveExtension;
  mediaType: string;
}

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_DATA_DESCRIPTOR = 0x08074b50;
const ZIP_CENTRAL_DIRECTORY_DIGITAL_SIGNATURE = 0x05054b50;
const ZIP64_EXTRA_FIELD = 0x0001;

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_CENTRAL_DIRECTORY_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_XML_BYTES = 32 * 1024 * 1024;
const MAX_STRUCTURED_XML_PARTS = 2_000;
const MAX_STRUCTURED_XML_BYTES = 128 * 1024 * 1024;
const MAX_MIMETYPE_BYTES = 256;
const MAX_VALIDATION_MS = 15_000;
const MAX_EOCD_SCAN_BYTES = 22 + 65_535;

const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELATIONSHIP_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/package/2006/relationships",
  "http://purl.oclc.org/ooxml/package/relationships",
]);
const OFFICE_DOCUMENT_RELATIONSHIP_TYPES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
]);
const OFFICE_DOCUMENT_RELATIONSHIP_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
const EPUB_CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";
const EPUB_PACKAGE_NS = "http://www.idpf.org/2007/opf";
const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

const OFFICE_KINDS = {
  docx: {
    mainPart: "word/document.xml",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    root: "document",
    namespaces: new Set([
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      "http://purl.oclc.org/ooxml/wordprocessingml/main",
    ]),
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xlsx: {
    mainPart: "xl/workbook.xml",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    root: "workbook",
    namespaces: new Set([
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "http://purl.oclc.org/ooxml/spreadsheetml/main",
    ]),
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pptx: {
    mainPart: "ppt/presentation.xml",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    root: "presentation",
    namespaces: new Set([
      "http://schemas.openxmlformats.org/presentationml/2006/main",
      "http://purl.oclc.org/ooxml/presentationml/main",
    ]),
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
} as const;

type OfficeExtension = keyof typeof OFFICE_KINDS;
type StructuredExtension = Exclude<ArchiveExtension, "zip">;

interface ValidationContext {
  signal?: AbortSignal;
  deadline: number;
  expandedBytes: number;
}

interface ZipEntry {
  index: number;
  name: string;
  nameBytes: Buffer;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  localOffset?: number;
  dataOffset?: number;
  dataEnd?: number;
  archiveEnd?: number;
}

interface ZipArchive {
  entries: ZipEntry[];
  centralDirectoryStart: number;
  offsetAdjustment: number;
}

function invalidArchive(message: string): EngineError {
  return new EngineError("INVALID_ARCHIVE", message);
}

function invalidDocument(message: string): EngineError {
  return new EngineError("INVALID_DOCUMENT", message);
}

function unsupportedArchive(message: string): EngineError {
  return new EngineError("UNSUPPORTED_ARCHIVE", message);
}

function validationLimit(message: string): EngineError {
  return new EngineError("FILE_VALIDATION_LIMIT", message);
}

function cancelled(): EngineError {
  return new EngineError("CANCELLED", "任务已取消");
}

function assertActive(context: ValidationContext): void {
  if (context.signal?.aborted) throw cancelled();
  if (Date.now() > context.deadline) throw validationLimit("归档验证超过 15 秒处理预算");
}

function checkedEnd(start: number, length: number, limit: number, message: string): number {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start > limit || length > limit - start) {
    throw invalidArchive(message);
  }
  return start + length;
}

async function readExact(handle: FileHandle, position: number, length: number, context: ValidationContext, message: string): Promise<Buffer> {
  assertActive(context);
  if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0) throw invalidArchive(message);
  const buffer = Buffer.allocUnsafe(length);
  const result = await handle.read(buffer, 0, length, position);
  assertActive(context);
  if (result.bytesRead !== length) throw invalidArchive(message);
  return buffer;
}

function hasZip64Extra(extra: Buffer, label: string): boolean {
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) throw invalidArchive(label + " 的 extra 字段截断");
    const id = extra.readUInt16LE(offset);
    const length = extra.readUInt16LE(offset + 2);
    offset += 4;
    if (length > extra.length - offset) throw invalidArchive(label + " 的 extra 字段长度无效");
    if (id === ZIP64_EXTRA_FIELD) return true;
    offset += length;
  }
  return false;
}

function decodeEntryName(bytes: Buffer, flags: number): string {
  try {
    return flags & 0x0800
      ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      : bytes.toString("latin1");
  } catch {
    throw invalidArchive("ZIP 成员名不是有效 UTF-8");
  }
}

function validateEntryFeatureSupport(flags: number, method: number, label: string): void {
  if (flags & 0x0001 || flags & 0x0040 || flags & 0x2000) throw unsupportedArchive(label + " 使用加密 ZIP 成员，当前验证器不支持");
  if (method !== 0 && method !== 8) throw unsupportedArchive(label + " 使用未支持的 ZIP 压缩方法 " + method);
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value++) {
    let current = value;
    for (let bit = 0; bit < 8; bit++) current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    table[value] = current >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function updateCrc32(current: number, bytes: Buffer): number {
  let crc = current >>> 0;
  for (const value of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ value) & 0xff]!;
  return crc >>> 0;
}

function finalCrc32(current: number): number {
  return (current ^ 0xffffffff) >>> 0;
}

function parseCentralDirectory(data: Buffer, entryCount: number, context: ValidationContext): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  let declaredExpandedBytes = 0;
  for (let index = 0; index < entryCount; index++) {
    assertActive(context);
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw invalidArchive("ZIP 中央目录成员头缺失或截断");
    }
    const flags = data.readUInt16LE(offset + 8);
    const method = data.readUInt16LE(offset + 10);
    const crc32 = data.readUInt32LE(offset + 16);
    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const diskStart = data.readUInt16LE(offset + 34);
    const localHeaderOffset = data.readUInt32LE(offset + 42);
    const end = checkedEnd(offset + 46, nameLength + extraLength + commentLength, data.length, "ZIP 中央目录成员长度无效");
    const nameBytes = Buffer.from(data.subarray(offset + 46, offset + 46 + nameLength));
    const extra = data.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
    if (!nameBytes.length || nameBytes.includes(0)) throw invalidArchive("ZIP 成员名为空或包含 NUL");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff || diskStart === 0xffff || hasZip64Extra(extra, "ZIP 中央目录")) {
      throw unsupportedArchive("ZIP64 归档当前验证器不支持");
    }
    if (diskStart !== 0) throw unsupportedArchive("多磁盘 ZIP 当前验证器不支持");
    validateEntryFeatureSupport(flags, method, "ZIP 成员");
    if (uncompressedSize > MAX_ENTRY_EXPANDED_BYTES) throw validationLimit("ZIP 单个成员超过 128 MiB 展开预算");
    declaredExpandedBytes += uncompressedSize;
    if (!Number.isSafeInteger(declaredExpandedBytes) || declaredExpandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw validationLimit("ZIP 成员声明的总展开量超过 512 MiB 预算");
    }
    entries.push({
      index,
      name: decodeEntryName(nameBytes, flags),
      nameBytes,
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = end;
  }
  if (offset < data.length) {
    if (offset + 6 > data.length || data.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_DIGITAL_SIGNATURE || offset + 6 + data.readUInt16LE(offset + 4) !== data.length) {
      throw invalidArchive("ZIP 中央目录包含未识别尾部数据");
    }
  }
  return entries;
}

async function locateCentralDirectory(handle: FileHandle, fileSize: number, context: ValidationContext): Promise<ZipArchive> {
  if (fileSize < 22) throw invalidArchive("文件过短，缺少 ZIP 末端目录");
  const tailLength = Math.min(fileSize, MAX_EOCD_SCAN_BYTES);
  const tailOffset = fileSize - tailLength;
  const tail = await readExact(handle, tailOffset, tailLength, context, "无法读取 ZIP 末端目录");
  let eocdOffset = -1;
  let eocdRelative = -1;
  for (let offset = tail.length - 22; offset >= 0; offset--) {
    if (tail.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === tail.length) {
      eocdRelative = offset;
      eocdOffset = tailOffset + offset;
      break;
    }
  }
  if (eocdOffset < 0 || eocdRelative < 0) throw invalidArchive("缺少有效 ZIP 中央目录结束记录");
  const disk = tail.readUInt16LE(eocdRelative + 4);
  const centralDisk = tail.readUInt16LE(eocdRelative + 6);
  const entriesOnDisk = tail.readUInt16LE(eocdRelative + 8);
  const entryCount = tail.readUInt16LE(eocdRelative + 10);
  const centralSize = tail.readUInt32LE(eocdRelative + 12);
  const centralOffset = tail.readUInt32LE(eocdRelative + 16);
  if (entriesOnDisk === 0xffff || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw unsupportedArchive("ZIP64 归档当前验证器不支持");
  }
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw unsupportedArchive("多磁盘 ZIP 当前验证器不支持");
  if (entryCount > MAX_ENTRIES) throw validationLimit("ZIP 成员数量超过 10000 项预算");
  if (centralSize > MAX_CENTRAL_DIRECTORY_BYTES) throw validationLimit("ZIP 中央目录超过 32 MiB 预算");
  if (entryCount === 0 && centralSize !== 0) throw invalidArchive("空 ZIP 的中央目录大小无效");

  const starts = [...new Set([centralOffset, eocdOffset - centralSize])].filter(start =>
    Number.isSafeInteger(start) && start >= 0 && start <= eocdOffset && centralSize <= eocdOffset - start,
  );
  let lastError: unknown;
  for (const centralStart of starts) {
    try {
      if (centralStart < centralOffset) continue;
      if (entryCount > 0) {
        const signature = await readExact(handle, centralStart, 4, context, "无法读取 ZIP 中央目录");
        if (signature.readUInt32LE(0) !== ZIP_CENTRAL_DIRECTORY_HEADER) continue;
      }
      const data = centralSize ? await readExact(handle, centralStart, centralSize, context, "无法读取 ZIP 中央目录") : Buffer.alloc(0);
      const entries = parseCentralDirectory(data, entryCount, context);
      return { entries, centralDirectoryStart: centralStart, offsetAdjustment: centralStart - centralOffset };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof EngineError) throw lastError;
  throw invalidArchive("ZIP 中央目录偏移无效");
}

async function validateDataDescriptor(handle: FileHandle, entry: ZipEntry, centralDirectoryStart: number, context: ValidationContext): Promise<number> {
  const dataEnd = entry.dataEnd!;
  const available = centralDirectoryStart - dataEnd;
  if (available < 12) throw invalidArchive("ZIP 数据描述符截断");
  const bytes = await readExact(handle, dataEnd, Math.min(16, available), context, "无法读取 ZIP 数据描述符");
  const unsignedMatches = bytes.length >= 12
    && bytes.readUInt32LE(0) === entry.crc32
    && bytes.readUInt32LE(4) === entry.compressedSize
    && bytes.readUInt32LE(8) === entry.uncompressedSize;
  const signedMatches = bytes.length >= 16
    && bytes.readUInt32LE(0) === ZIP_DATA_DESCRIPTOR
    && bytes.readUInt32LE(4) === entry.crc32
    && bytes.readUInt32LE(8) === entry.compressedSize
    && bytes.readUInt32LE(12) === entry.uncompressedSize;
  if (!signedMatches && !unsignedMatches) throw invalidArchive("ZIP 数据描述符与中央目录不一致");
  return dataEnd + (signedMatches ? 16 : 12);
}

async function prepareLocalEntries(handle: FileHandle, archive: ZipArchive, fileSize: number, context: ValidationContext): Promise<void> {
  const ranges: { start: number; end: number }[] = [];
  for (const entry of archive.entries) {
    assertActive(context);
    const localOffset = checkedEnd(entry.localHeaderOffset, archive.offsetAdjustment, archive.centralDirectoryStart, "ZIP 本地成员偏移无效");
    if (localOffset >= archive.centralDirectoryStart || localOffset + 30 > archive.centralDirectoryStart || localOffset + 30 > fileSize) {
      throw invalidArchive("ZIP 本地成员头超出数据区域");
    }
    const header = await readExact(handle, localOffset, 30, context, "无法读取 ZIP 本地成员头");
    if (header.readUInt32LE(0) !== ZIP_LOCAL_FILE_HEADER) throw invalidArchive("ZIP 本地成员头签名无效");
    const flags = header.readUInt16LE(6);
    const method = header.readUInt16LE(8);
    const crc32 = header.readUInt32LE(14);
    const compressedSize = header.readUInt32LE(18);
    const uncompressedSize = header.readUInt32LE(22);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    if (flags !== entry.flags || method !== entry.method) throw invalidArchive("ZIP 本地成员与中央目录的压缩参数不一致");
    validateEntryFeatureSupport(flags, method, "ZIP 本地成员");
    const localHeaderEnd = checkedEnd(localOffset + 30, nameLength + extraLength, archive.centralDirectoryStart, "ZIP 本地成员头长度无效");
    const nameBytes = await readExact(handle, localOffset + 30, nameLength, context, "无法读取 ZIP 本地成员名");
    if (!nameBytes.equals(entry.nameBytes)) throw invalidArchive("ZIP 本地成员名与中央目录不一致");
    const extra = await readExact(handle, localOffset + 30 + nameLength, extraLength, context, "无法读取 ZIP 本地成员 extra 字段");
    if (hasZip64Extra(extra, "ZIP 本地成员")) throw unsupportedArchive("ZIP64 归档当前验证器不支持");
    if (flags & 0x0008) {
      if ((crc32 !== 0 && crc32 !== entry.crc32)
        || (compressedSize !== 0 && compressedSize !== entry.compressedSize)
        || (uncompressedSize !== 0 && uncompressedSize !== entry.uncompressedSize)) {
        throw invalidArchive("ZIP 本地成员的数据描述符前字段与中央目录不一致");
      }
    } else if (crc32 !== entry.crc32 || compressedSize !== entry.compressedSize || uncompressedSize !== entry.uncompressedSize) {
      throw invalidArchive("ZIP 本地成员与中央目录的 CRC 或大小不一致");
    }
    const dataEnd = checkedEnd(localHeaderEnd, entry.compressedSize, archive.centralDirectoryStart, "ZIP 成员压缩数据超出归档范围");
    entry.localOffset = localOffset;
    entry.dataOffset = localHeaderEnd;
    entry.dataEnd = dataEnd;
    entry.archiveEnd = flags & 0x0008
      ? await validateDataDescriptor(handle, entry, archive.centralDirectoryStart, context)
      : dataEnd;
    ranges.push({ start: localOffset, end: entry.archiveEnd });
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index]!.start < ranges[index - 1]!.end) throw invalidArchive("ZIP 本地成员数据区域重叠");
  }
}

interface EntryReadOptions {
  accountExpandedBytes: boolean;
  collectLimit?: number;
}

async function readEntry(
  path: string,
  handle: FileHandle,
  entry: ZipEntry,
  context: ValidationContext,
  options: EntryReadOptions,
): Promise<Buffer | undefined> {
  assertActive(context);
  if (entry.uncompressedSize > (options.collectLimit ?? MAX_ENTRY_EXPANDED_BYTES)) {
    throw validationLimit("必要 ZIP 成员超过当前解析容量预算");
  }
  if (entry.compressedSize === 0) {
    if (entry.method !== 0 || entry.uncompressedSize !== 0 || entry.crc32 !== 0) throw invalidArchive("ZIP 空成员的压缩信息无效");
    return options.collectLimit === undefined ? undefined : Buffer.alloc(0);
  }
  const source = createReadStream(path, {
    fd: handle.fd,
    autoClose: false,
    start: entry.dataOffset!,
    end: entry.dataEnd! - 1,
    highWaterMark: 64 * 1024,
  });
  const inflater = entry.method === 8 ? createInflateRaw() : undefined;
  const forwardSourceError = (error: Error): void => { inflater?.destroy(error); };
  if (inflater) source.once("error", forwardSourceError);
  const output = inflater ? source.pipe(inflater) : source;
  const onAbort = (): void => {
    const error = cancelled();
    source.destroy(error);
    inflater?.destroy(error);
  };
  context.signal?.addEventListener("abort", onAbort, { once: true });
  let crc32 = 0xffffffff;
  let expanded = 0;
  let collected = 0;
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of output) {
      assertActive(context);
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      expanded += bytes.length;
      if (expanded > entry.uncompressedSize) throw invalidArchive("ZIP 成员展开大小超过中央目录声明");
      if (options.accountExpandedBytes) {
        context.expandedBytes += bytes.length;
        if (context.expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) throw validationLimit("ZIP 实际总展开量超过 512 MiB 预算");
      }
      if (options.collectLimit !== undefined) {
        collected += bytes.length;
        if (collected > options.collectLimit) throw validationLimit("必要 ZIP 成员超过当前解析容量预算");
        chunks.push(bytes);
      }
      crc32 = updateCrc32(crc32, bytes);
    }
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw invalidArchive("ZIP 成员无法解压");
  } finally {
    context.signal?.removeEventListener("abort", onAbort);
    if (inflater) source.off("error", forwardSourceError);
  }
  if (expanded !== entry.uncompressedSize || finalCrc32(crc32) !== entry.crc32) {
    throw invalidArchive("ZIP 成员的展开大小或 CRC 校验失败");
  }
  return options.collectLimit === undefined ? undefined : Buffer.concat(chunks, collected);
}

function exactEntry(entries: readonly ZipEntry[], name: string, documentName: string): ZipEntry {
  const matches = entries.filter(entry => entry.name === name);
  if (matches.length !== 1) throw invalidDocument(documentName + " 缺少或重复必要成员 " + name);
  return matches[0]!;
}

function optionalEntry(entries: readonly ZipEntry[], name: string): ZipEntry | undefined {
  const matches = entries.filter(entry => entry.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function decodeXml(bytes: Buffer, name: string): string {
  if (bytes.length > MAX_XML_BYTES) throw validationLimit(name + " 超过 32 MiB XML 解析预算");
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
    const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
  } catch {
    throw invalidDocument(name + " 不是可解析的 UTF XML");
  }
}

interface XmlVisitor {
  open(tag: SaxesTagNS, depth: number): void;
  close?(tag: SaxesTagNS, depth: number): void;
  text?(value: string, depth: number): void;
}

function parseXml(bytes: Buffer, name: string, visitor: XmlVisitor, context?: ValidationContext): void {
  if (context) assertActive(context);
  const parser = new SaxesParser({ xmlns: true });
  let parserError: Error | undefined;
  let hasDoctype = false;
  let roots = 0;
  let depth = 0;
  let ended = false;
  parser.on("error", error => { parserError ??= error; });
  parser.on("doctype", () => { hasDoctype = true; });
  parser.on("opentag", tag => {
    if (context) assertActive(context);
    if (depth === 0) roots++;
    visitor.open(tag, depth);
    depth++;
  });
  parser.on("closetag", tag => {
    if (context) assertActive(context);
    depth--;
    if (depth < 0) throw invalidDocument(name + " 的 XML 层级无效");
    visitor.close?.(tag, depth);
  });
  parser.on("text", value => {
    if (context) assertActive(context);
    visitor.text?.(value, depth);
  });
  parser.on("end", () => { ended = true; });
  try {
    parser.write(decodeXml(bytes, name)).close();
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw invalidDocument(name + " 的 XML 结构无效");
  }
  if (context) assertActive(context);
  if (hasDoctype) throw invalidDocument(name + " 不允许包含 DOCTYPE");
  if (parserError || !ended || roots !== 1 || depth !== 0) throw invalidDocument(name + " 的 XML 结构无效");
}

function attribute(tag: SaxesTagNS, name: string): string | undefined {
  return tag.attributes[name]?.value;
}

function normalizedMemberPath(value: string | undefined): string | undefined {
  if (!value || value.includes("\0") || value.includes("\\") || value.startsWith("/") || value.includes("?") || value.includes("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return undefined;
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length ? parts.join("/") : undefined;
}

function relationshipAttribute(tag: SaxesTagNS, local: "id" | "embed" | "link"): string | undefined {
  for (const attributeValue of Object.values(tag.attributes)) {
    if (OFFICE_DOCUMENT_RELATIONSHIP_NAMESPACES.has(attributeValue.uri) && attributeValue.local === local) return attributeValue.value;
  }
  return undefined;
}

function collectOfficeRelationshipReferences(tag: SaxesTagNS, references: Set<string>): void {
  for (const local of ["id", "embed", "link"] as const) {
    const value = relationshipAttribute(tag, local);
    if (value === "") throw invalidDocument("Office XML 包含空关系引用");
    if (value) references.add(value);
  }
}

function decodePartSegment(value: string, label: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.includes("\0") || decoded.includes("\\") || decoded.includes("/")) {
      throw invalidDocument(label + " 包含无效 ZIP 成员路径片段");
    }
    return decoded;
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw invalidDocument(label + " 包含无效百分号编码");
  }
}

/** Resolves a package-relative URI without following it outside the archive. */
function resolveInternalMemberPath(sourcePart: string, target: string, label: string): string {
  if (!target || target.includes("\0") || target.includes("\\") || target.includes("?")) {
    throw invalidDocument(label + " 的内部目标无效");
  }
  const fragment = target.indexOf("#");
  const targetPath = fragment >= 0 ? target.slice(0, fragment) : target;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(targetPath) || targetPath.startsWith("//")) {
    throw invalidDocument(label + " 的内部目标不能是外部 URI");
  }
  const parts = targetPath.startsWith("/") ? [] : sourcePart ? sourcePart.split("/").slice(0, -1) : [];
  for (const rawPart of targetPath.split("/")) {
    if (!rawPart) continue;
    const part = decodePartSegment(rawPart, label);
    if (part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw invalidDocument(label + " 的内部目标越出归档根目录");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  if (!parts.length) throw invalidDocument(label + " 的内部目标为空");
  return parts.join("/");
}

function externalUri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.startsWith("//");
}

function uniqueEntryMap(entries: readonly ZipEntry[], documentName: string): Map<string, ZipEntry> {
  const result = new Map<string, ZipEntry>();
  for (const entry of entries) {
    if (result.has(entry.name)) throw invalidDocument(documentName + " 包含重复 ZIP 成员 " + entry.name);
    result.set(entry.name, entry);
  }
  return result;
}

function isOoxmlXmlPart(name: string): boolean {
  return /\.(?:xml|rels|vml)$/i.test(name);
}

interface PackageRelationship {
  id: string;
  type: string;
  external: boolean;
  target?: string;
}

interface RelationshipPart {
  sourcePart: string;
  relationships: Map<string, PackageRelationship>;
}

interface OoxmlParts {
  entriesByName: Map<string, ZipEntry>;
  xmlByName: Map<string, Buffer>;
  relationshipsBySource: Map<string, RelationshipPart>;
}

function relationshipSourcePart(name: string, entriesByName: ReadonlyMap<string, ZipEntry>): string {
  if (name === "_rels/.rels") return "";
  const parts = name.split("/");
  if (parts.length < 2 || parts[parts.length - 2] !== "_rels") throw invalidDocument(name + " 不是有效 Office relationship part");
  const relationshipName = parts[parts.length - 1]!;
  if (!relationshipName.endsWith(".rels") || relationshipName.length === ".rels".length) {
    throw invalidDocument(name + " 不是有效 Office relationship part");
  }
  const sourcePart = [...parts.slice(0, -2), relationshipName.slice(0, -".rels".length)].join("/");
  if (!entriesByName.has(sourcePart)) throw invalidDocument(name + " 对应的源成员不存在");
  return sourcePart;
}

function parseRelationshipPart(
  bytes: Buffer,
  name: string,
  sourcePart: string,
  entriesByName: ReadonlyMap<string, ZipEntry>,
  context: ValidationContext,
): RelationshipPart {
  const relationships = new Map<string, PackageRelationship>();
  parseXml(bytes, name, {
    open(tag, depth) {
      if (depth === 0) {
        if (tag.local !== "Relationships" || !RELATIONSHIP_NAMESPACES.has(tag.uri)) throw invalidDocument(name + " 根元素无效");
        return;
      }
      if (depth !== 1 || tag.local !== "Relationship" || !RELATIONSHIP_NAMESPACES.has(tag.uri)) {
        throw invalidDocument(name + " 的关系结构无效");
      }
      const id = attribute(tag, "Id");
      const type = attribute(tag, "Type");
      const rawTarget = attribute(tag, "Target");
      const mode = attribute(tag, "TargetMode");
      if (!id || !type || !rawTarget || relationships.has(id)) throw invalidDocument(name + " 的关系定义无效或重复");
      if (mode && mode !== "Internal" && mode !== "External") throw invalidDocument(name + " 的 TargetMode 无效");
      const external = mode === "External";
      const target = external ? undefined : resolveInternalMemberPath(sourcePart, rawTarget, name);
      if (target && !entriesByName.has(target)) throw invalidDocument(name + " 的内部关系目标不存在: " + target);
      relationships.set(id, { id, type, external, target });
    },
  }, context);
  return { sourcePart, relationships };
}

async function readXmlEntry(path: string, handle: FileHandle, entry: ZipEntry, context: ValidationContext): Promise<Buffer> {
  const bytes = await readEntry(path, handle, entry, context, { accountExpandedBytes: false, collectLimit: MAX_XML_BYTES });
  if (!bytes) throw invalidArchive("读取 ZIP XML 成员时未获得数据");
  return bytes;
}

async function readOoxmlParts(path: string, handle: FileHandle, archive: ZipArchive, context: ValidationContext, documentName: string): Promise<OoxmlParts> {
  const entriesByName = uniqueEntryMap(archive.entries, documentName);
  const xmlEntries = archive.entries.filter(entry => isOoxmlXmlPart(entry.name));
  if (xmlEntries.length > MAX_STRUCTURED_XML_PARTS) throw validationLimit(documentName + " 的 XML 成员数量超过 2000 项预算");
  const xmlByName = new Map<string, Buffer>();
  let xmlBytes = 0;
  for (const entry of xmlEntries) {
    assertActive(context);
    const bytes = await readXmlEntry(path, handle, entry, context);
    xmlBytes += bytes.length;
    if (xmlBytes > MAX_STRUCTURED_XML_BYTES) throw validationLimit(documentName + " 的 XML 总量超过 128 MiB 预算");
    parseXml(bytes, entry.name, { open() { /* Strict syntax pass for every declared XML/rels part. */ } }, context);
    xmlByName.set(entry.name, bytes);
  }
  const relationshipsBySource = new Map<string, RelationshipPart>();
  for (const entry of xmlEntries.filter(entry => entry.name.endsWith(".rels"))) {
    const sourcePart = relationshipSourcePart(entry.name, entriesByName);
    if (relationshipsBySource.has(sourcePart)) throw invalidDocument(documentName + " 包含同一源成员的重复 relationship part");
    const bytes = xmlByName.get(entry.name);
    if (!bytes) throw invalidDocument(entry.name + " 未能读取");
    relationshipsBySource.set(sourcePart, parseRelationshipPart(bytes, entry.name, sourcePart, entriesByName, context));
  }
  return { entriesByName, xmlByName, relationshipsBySource };
}

function parseContentTypes(bytes: Buffer, context: ValidationContext): Map<string, string> {
  const types = new Map<string, string>();
  parseXml(bytes, "[Content_Types].xml", {
    open(tag, depth) {
      if (depth === 0) {
        if (tag.local !== "Types" || tag.uri !== CONTENT_TYPES_NS) throw invalidDocument("[Content_Types].xml 根元素无效");
      } else if (depth === 1 && tag.local === "Override" && tag.uri === CONTENT_TYPES_NS) {
        const part = attribute(tag, "PartName");
        const contentType = attribute(tag, "ContentType");
        if (!part || !contentType || !part.startsWith("/") || normalizedMemberPath(part.slice(1)) !== part.slice(1) || types.has(part)) {
          throw invalidDocument("[Content_Types].xml 的 Override 无效");
        }
        types.set(part, contentType);
      }
    },
  }, context);
  return types;
}

function requiredXmlPart(parts: OoxmlParts, name: string, documentName: string): Buffer {
  if (!parts.entriesByName.has(name)) throw invalidDocument(documentName + " 缺少必要成员 " + name);
  const bytes = parts.xmlByName.get(name);
  if (!bytes) throw invalidDocument(documentName + " 的必要成员不是可验证 XML: " + name);
  return bytes;
}

function requiredRelationship(parts: OoxmlParts, sourcePart: string, id: string, documentName: string): PackageRelationship {
  const relationship = parts.relationshipsBySource.get(sourcePart)?.relationships.get(id);
  if (!relationship) throw invalidDocument(documentName + " 的关系引用未定义: " + id);
  return relationship;
}

function requireOfficeRelationshipReferences(parts: OoxmlParts, sourcePart: string, references: ReadonlySet<string>, documentName: string): void {
  for (const id of references) requiredRelationship(parts, sourcePart, id, documentName);
}

function xmlRoot(bytes: Buffer, name: string, context: ValidationContext): { local: string; uri: string } {
  let root: { local: string; uri: string } | undefined;
  parseXml(bytes, name, {
    open(tag, depth) {
      if (depth === 0) root = { local: tag.local, uri: tag.uri };
    },
  }, context);
  if (!root) throw invalidDocument(name + " 缺少 XML 根元素");
  return root;
}

function validateDocxMainXml(bytes: Buffer, name: string, context: ValidationContext): Set<string> {
  const references = new Set<string>();
  let body = false;
  parseXml(bytes, name, {
    open(tag, depth) {
      if (depth === 0 && (tag.local !== "document" || !OFFICE_KINDS.docx.namespaces.has(tag.uri))) throw invalidDocument(name + " 根元素无效");
      collectOfficeRelationshipReferences(tag, references);
      if (depth === 1 && tag.local === "body" && OFFICE_KINDS.docx.namespaces.has(tag.uri)) body = true;
    },
  }, context);
  if (!body) throw invalidDocument(name + " 缺少 w:body 正文容器");
  return references;
}

function validateXlsxMainXml(bytes: Buffer, name: string, context: ValidationContext): { references: Set<string>; sheetIds: string[] } {
  const references = new Set<string>();
  const sheetIds: string[] = [];
  let sheetsDepth: number | undefined;
  parseXml(bytes, name, {
    open(tag, depth) {
      if (depth === 0 && (tag.local !== "workbook" || !OFFICE_KINDS.xlsx.namespaces.has(tag.uri))) throw invalidDocument(name + " 根元素无效");
      collectOfficeRelationshipReferences(tag, references);
      if (depth === 1 && tag.local === "sheets" && OFFICE_KINDS.xlsx.namespaces.has(tag.uri)) {
        sheetsDepth = depth;
      } else if (sheetsDepth !== undefined && depth === sheetsDepth + 1 && tag.local === "sheet" && OFFICE_KINDS.xlsx.namespaces.has(tag.uri)) {
        const id = relationshipAttribute(tag, "id");
        if (!id) throw invalidDocument(name + " 的 sheet 缺少 r:id");
        sheetIds.push(id);
      }
    },
    close(tag, depth) {
      if (sheetsDepth === depth && tag.local === "sheets" && OFFICE_KINDS.xlsx.namespaces.has(tag.uri)) sheetsDepth = undefined;
    },
  }, context);
  if (!sheetIds.length) throw invalidDocument(name + " 缺少实际 sheet 关系");
  return { references, sheetIds };
}

function validatePptxMainXml(bytes: Buffer, name: string, context: ValidationContext): { references: Set<string>; slideIds: string[] } {
  const references = new Set<string>();
  const slideIds: string[] = [];
  let slideListDepth: number | undefined;
  parseXml(bytes, name, {
    open(tag, depth) {
      if (depth === 0 && (tag.local !== "presentation" || !OFFICE_KINDS.pptx.namespaces.has(tag.uri))) throw invalidDocument(name + " 根元素无效");
      collectOfficeRelationshipReferences(tag, references);
      if (depth === 1 && tag.local === "sldIdLst" && OFFICE_KINDS.pptx.namespaces.has(tag.uri)) {
        slideListDepth = depth;
      } else if (slideListDepth !== undefined && depth === slideListDepth + 1 && tag.local === "sldId" && OFFICE_KINDS.pptx.namespaces.has(tag.uri)) {
        const id = relationshipAttribute(tag, "id");
        if (!id) throw invalidDocument(name + " 的 slide 缺少 r:id");
        slideIds.push(id);
      }
    },
    close(tag, depth) {
      if (slideListDepth === depth && tag.local === "sldIdLst" && OFFICE_KINDS.pptx.namespaces.has(tag.uri)) slideListDepth = undefined;
    },
  }, context);
  return { references, slideIds };
}

function requireInternalRelationshipTarget(parts: OoxmlParts, sourcePart: string, id: string, documentName: string): string {
  const relationship = requiredRelationship(parts, sourcePart, id, documentName);
  if (relationship.external || !relationship.target) throw invalidDocument(documentName + " 的内容关系不能指向外部目标");
  return relationship.target;
}

function validateXlsxSheets(parts: OoxmlParts, mainPart: string, sheetIds: readonly string[], context: ValidationContext): void {
  const legalRoots = new Set(["worksheet", "chartsheet", "dialogsheet", "macrosheet"]);
  let worksheetCount = 0;
  for (const id of sheetIds) {
    const target = requireInternalRelationshipTarget(parts, mainPart, id, "XLSX");
    const bytes = parts.xmlByName.get(target);
    if (!bytes) throw invalidDocument("XLSX sheet 关系未指向 XML 工作表成员: " + target);
    const root = xmlRoot(bytes, target, context);
    if (root.uri !== SPREADSHEET_NS || !legalRoots.has(root.local)) throw invalidDocument("XLSX sheet 关系未指向有效工作表根: " + target);
    if (root.local === "worksheet") worksheetCount++;
  }
  if (!worksheetCount) throw invalidDocument("XLSX 缺少实际 worksheet 正文成员");
}

function validatePptxSlides(parts: OoxmlParts, mainPart: string, slideIds: readonly string[], context: ValidationContext): void {
  for (const id of slideIds) {
    const target = requireInternalRelationshipTarget(parts, mainPart, id, "PPTX");
    const bytes = parts.xmlByName.get(target);
    if (!bytes) throw invalidDocument("PPTX slide 关系未指向 XML 幻灯片成员: " + target);
    const root = xmlRoot(bytes, target, context);
    if (root.local !== "sld" || root.uri !== PRESENTATION_NS) throw invalidDocument("PPTX slide 关系未指向有效 sld 根: " + target);
  }
}

async function validateOfficeArchive(path: string, handle: FileHandle, archive: ZipArchive, extension: OfficeExtension, context: ValidationContext): Promise<ArchiveAssetValidation> {
  const specification = OFFICE_KINDS[extension];
  const parts = await readOoxmlParts(path, handle, archive, context, extension);
  const contentTypes = requiredXmlPart(parts, "[Content_Types].xml", extension);
  const types = parseContentTypes(contentTypes, context);
  if (types.get("/" + specification.mainPart) !== specification.contentType) {
    throw invalidDocument(extension + " 的主文档 ContentType 不匹配");
  }
  const rootRelationships = parts.relationshipsBySource.get("");
  const officeTargets = rootRelationships
    ? [...rootRelationships.relationships.values()].filter(relationship => OFFICE_DOCUMENT_RELATIONSHIP_TYPES.has(relationship.type) && !relationship.external)
    : [];
  if (officeTargets.length !== 1 || officeTargets[0]!.target !== specification.mainPart) {
    throw invalidDocument(extension + " 的根 relationships 未唯一指向主文档");
  }
  const mainBytes = requiredXmlPart(parts, specification.mainPart, extension);
  if (extension === "docx") {
    requireOfficeRelationshipReferences(parts, specification.mainPart, validateDocxMainXml(mainBytes, specification.mainPart, context), "DOCX");
  } else if (extension === "xlsx") {
    const workbook = validateXlsxMainXml(mainBytes, specification.mainPart, context);
    requireOfficeRelationshipReferences(parts, specification.mainPart, workbook.references, "XLSX");
    validateXlsxSheets(parts, specification.mainPart, workbook.sheetIds, context);
  } else {
    const presentation = validatePptxMainXml(mainBytes, specification.mainPart, context);
    requireOfficeRelationshipReferences(parts, specification.mainPart, presentation.references, "PPTX");
    validatePptxSlides(parts, specification.mainPart, presentation.slideIds, context);
  }
  return { extension, mediaType: specification.mediaType };
}

function parseEpubContainer(bytes: Buffer, context: ValidationContext): string {
  const paths: string[] = [];
  parseXml(bytes, "META-INF/container.xml", {
    open(tag, depth) {
      if (depth === 0) {
        if (tag.local !== "container" || tag.uri !== EPUB_CONTAINER_NS) throw invalidDocument("EPUB container.xml 根元素无效");
      } else if (depth === 2 && tag.local === "rootfile" && tag.uri === EPUB_CONTAINER_NS) {
        if (attribute(tag, "media-type") !== "application/oebps-package+xml") return;
        const path = normalizedMemberPath(attribute(tag, "full-path"));
        if (!path) throw invalidDocument("EPUB rootfile 路径无效");
        paths.push(path);
      }
    },
  }, context);
  if (paths.length !== 1) throw invalidDocument("EPUB 必须有一个可验证的 package rootfile");
  return paths[0]!;
}

interface EpubManifestItem {
  id: string;
  mediaType: string;
  target?: string;
}

interface EpubPackage {
  manifest: Map<string, EpubManifestItem>;
  spine: string[];
}

function parseEpubPackage(bytes: Buffer, name: string, entriesByName: ReadonlyMap<string, ZipEntry>, context: ValidationContext): EpubPackage {
  let metadata = false;
  let manifest = false;
  let spine = false;
  let manifestDepth: number | undefined;
  let spineDepth: number | undefined;
  const items = new Map<string, EpubManifestItem>();
  const spineItems: string[] = [];
  parseXml(bytes, name, {
    open(tag, depth) {
      if (depth === 0) {
        if (tag.local !== "package" || tag.uri !== EPUB_PACKAGE_NS) throw invalidDocument(name + " 不是有效 EPUB package");
      } else if (depth === 1 && tag.uri === EPUB_PACKAGE_NS) {
        if (tag.local === "metadata") metadata = true;
        if (tag.local === "manifest") {
          manifest = true;
          manifestDepth = depth;
        }
        if (tag.local === "spine") {
          spine = true;
          spineDepth = depth;
        }
      } else if (manifestDepth !== undefined && depth === manifestDepth + 1 && tag.local === "item" && tag.uri === EPUB_PACKAGE_NS) {
        const id = attribute(tag, "id");
        const href = attribute(tag, "href");
        const mediaType = attribute(tag, "media-type");
        if (!id || !href || !mediaType || items.has(id)) throw invalidDocument(name + " 的 manifest item 无效或重复");
        const target = externalUri(href) ? undefined : resolveInternalMemberPath(name, href, name + " manifest");
        if (target && !entriesByName.has(target)) throw invalidDocument(name + " 的 manifest 目标不存在: " + target);
        items.set(id, { id, mediaType, target });
      } else if (spineDepth !== undefined && depth === spineDepth + 1 && tag.local === "itemref" && tag.uri === EPUB_PACKAGE_NS) {
        const idref = attribute(tag, "idref");
        if (!idref) throw invalidDocument(name + " 的 spine itemref 缺少 idref");
        spineItems.push(idref);
      }
    },
    close(tag, depth) {
      if (manifestDepth === depth && tag.local === "manifest" && tag.uri === EPUB_PACKAGE_NS) manifestDepth = undefined;
      if (spineDepth === depth && tag.local === "spine" && tag.uri === EPUB_PACKAGE_NS) spineDepth = undefined;
    },
  }, context);
  if (!metadata || !manifest || !spine) throw invalidDocument(name + " 缺少 EPUB package 的必要结构");
  if (!items.size) throw invalidDocument(name + " 的 manifest 没有实际内容成员");
  if (!spineItems.length) throw invalidDocument(name + " 的 spine 没有阅读顺序成员");
  return { manifest: items, spine: spineItems };
}

function validateEpubReadingXhtml(bytes: Buffer, name: string, context: ValidationContext): void {
  let bodyDepth: number | undefined;
  let body = false;
  let readableContent = false;
  parseXml(bytes, name, {
    open(tag, depth) {
      if (depth === 0 && (tag.local !== "html" || tag.uri !== XHTML_NS)) throw invalidDocument(name + " 不是 XHTML html 根元素");
      if (depth === 1 && tag.local === "body" && tag.uri === XHTML_NS) {
        body = true;
        bodyDepth = depth;
      } else if (bodyDepth !== undefined && depth > bodyDepth && tag.uri === XHTML_NS
        && new Set(["img", "svg", "math", "video", "audio", "object"]).has(tag.local)) {
        readableContent = true;
      }
    },
    close(tag, depth) {
      if (bodyDepth === depth && tag.local === "body" && tag.uri === XHTML_NS) bodyDepth = undefined;
    },
    text(value, depth) {
      if (bodyDepth !== undefined && depth > bodyDepth && /\S/u.test(value)) readableContent = true;
    },
  }, context);
  if (!body || !readableContent) throw invalidDocument(name + " 缺少可验证的 XHTML 正文 body 内容");
}

async function validateEpubArchive(path: string, handle: FileHandle, archive: ZipArchive, context: ValidationContext): Promise<ArchiveAssetValidation> {
  const entriesByName = uniqueEntryMap(archive.entries, "EPUB");
  const mimetype = exactEntry(archive.entries, "mimetype", "EPUB");
  const container = exactEntry(archive.entries, "META-INF/container.xml", "EPUB");
  const firstLocalOffset = Math.min(...archive.entries.map(entry => entry.localOffset ?? Number.MAX_SAFE_INTEGER));
  if (mimetype.index !== 0 || mimetype.localOffset !== firstLocalOffset || mimetype.method !== 0) {
    throw invalidDocument("EPUB mimetype 必须是首个未压缩成员");
  }
  const mimetypeBytes = await readEntry(path, handle, mimetype, context, { accountExpandedBytes: false, collectLimit: MAX_MIMETYPE_BYTES }) ?? Buffer.alloc(0);
  if (!mimetypeBytes.equals(Buffer.from("application/epub+zip", "ascii"))) throw invalidDocument("EPUB mimetype 成员无效");
  const packagePath = parseEpubContainer(await readXmlEntry(path, handle, container, context), context);
  const packageEntry = exactEntry(archive.entries, packagePath, "EPUB");
  const packageDocument = parseEpubPackage(await readXmlEntry(path, handle, packageEntry, context), packagePath, entriesByName, context);
  for (const idref of packageDocument.spine) {
    const item = packageDocument.manifest.get(idref);
    if (!item) throw invalidDocument(packagePath + " 的 spine 引用未在 manifest 中声明: " + idref);
    if (item.mediaType !== "application/xhtml+xml" || !item.target) {
      throw invalidDocument(packagePath + " 的 spine 必须指向归档内 XHTML 正文成员: " + idref);
    }
    const entry = entriesByName.get(item.target);
    if (!entry) throw invalidDocument(packagePath + " 的 spine 正文成员不存在: " + item.target);
    validateEpubReadingXhtml(await readXmlEntry(path, handle, entry, context), item.target, context);
  }
  return { extension: "epub", mediaType: "application/epub+zip" };
}

function normalizedHintExtension(value: string | undefined): ArchiveExtension | undefined {
  const extension = value?.trim().replace(/^\.+/, "").toLowerCase();
  return extension === "zip" || extension === "docx" || extension === "xlsx" || extension === "pptx" || extension === "epub"
    ? extension
    : undefined;
}

function hintedMediaExtension(value: string | undefined): ArchiveExtension | undefined {
  switch (value?.split(";", 1)[0]?.trim().toLowerCase()) {
    case "application/zip": return "zip";
    case "application/epub+zip": return "epub";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return "xlsx";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return "pptx";
    default: return undefined;
  }
}

function expectedStructuredExtension(hints: ArchiveAssetHints): StructuredExtension | undefined {
  const extension = normalizedHintExtension(hints.extension);
  const mediaType = hintedMediaExtension(hints.mediaType);
  const structuredExtension = extension === "zip" ? undefined : extension;
  const structuredMediaType = mediaType === "zip" ? undefined : mediaType;
  if (structuredExtension && structuredMediaType && structuredExtension !== structuredMediaType) {
    throw invalidDocument("文件扩展名与声明的归档媒体类型冲突");
  }
  return structuredExtension ?? structuredMediaType;
}

function looksLikeEpub(entries: readonly ZipEntry[]): boolean {
  return !!optionalEntry(entries, "mimetype") && !!optionalEntry(entries, "META-INF/container.xml");
}

function possibleOfficeExtensions(entries: readonly ZipEntry[]): OfficeExtension[] {
  if (!optionalEntry(entries, "[Content_Types].xml") || !optionalEntry(entries, "_rels/.rels")) return [];
  return (Object.keys(OFFICE_KINDS) as OfficeExtension[]).filter(extension => !!optionalEntry(entries, OFFICE_KINDS[extension].mainPart));
}

async function detectStructuredArchive(path: string, handle: FileHandle, archive: ZipArchive, context: ValidationContext): Promise<ArchiveAssetValidation | undefined> {
  if (looksLikeEpub(archive.entries)) {
    try {
      return await validateEpubArchive(path, handle, archive, context);
    } catch (error) {
      if (!(error instanceof EngineError) || error.code !== "INVALID_DOCUMENT") throw error;
    }
  }
  for (const extension of possibleOfficeExtensions(archive.entries)) {
    try {
      return await validateOfficeArchive(path, handle, archive, extension, context);
    } catch (error) {
      if (!(error instanceof EngineError) || error.code !== "INVALID_DOCUMENT") throw error;
    }
  }
  return undefined;
}

/**
 * Validates ZIP structure and every member's decompression/CRC without
 * unpacking files to disk, executing content, or accessing the network.
 * Office and EPUB types are returned only after their required XML members,
 * package relationships and main document members pass strict checks.
 */
export async function validateArchiveAsset(path: string, hints: ArchiveAssetHints = {}, signal?: AbortSignal): Promise<ArchiveAssetValidation> {
  if (signal?.aborted) throw cancelled();
  const before = await lstat(path).catch(() => undefined);
  if (!before?.isFile() || before.isSymbolicLink() || before.size <= 0) throw invalidArchive("附件不是有效的非空常规 ZIP 文件");
  if (before.size > MAX_ARCHIVE_BYTES) throw validationLimit("ZIP 文件超过 512 MiB 验证预算");
  const context: ValidationContext = { signal, deadline: Date.now() + MAX_VALIDATION_MS, expandedBytes: 0 };
  const handle = await open(path, "r");
  try {
    const archive = await locateCentralDirectory(handle, before.size, context);
    await prepareLocalEntries(handle, archive, before.size, context);
    for (const entry of archive.entries) {
      await readEntry(path, handle, entry, context, { accountExpandedBytes: true });
    }
    const expected = expectedStructuredExtension(hints);
    const result = expected === "epub"
      ? await validateEpubArchive(path, handle, archive, context)
      : expected
        ? await validateOfficeArchive(path, handle, archive, expected, context)
        : await detectStructuredArchive(path, handle, archive, context) ?? { extension: "zip" as const, mediaType: "application/zip" };
    const after = await lstat(path).catch(() => undefined);
    if (!after || after.isSymbolicLink() || after.size !== before.size || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs) {
      throw invalidArchive("附件在验证期间发生变化");
    }
    return result;
  } finally {
    await handle.close();
  }
}
