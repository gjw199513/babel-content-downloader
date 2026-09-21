import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { validateArchiveAsset } from "../runtime/collection/archive-validation.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function file(name: string, bytes: Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "babel-archive-validation-"));
  directories.push(directory);
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value++) {
    let current = value;
    for (let bit = 0; bit < 8; bit++) current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    table[value] = current >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let current = 0xffffffff;
  for (const value of bytes) current = (current >>> 8) ^ CRC_TABLE[(current ^ value) & 0xff]!;
  return (current ^ 0xffffffff) >>> 0;
}

interface ZipInput {
  name: string;
  data: Buffer | string;
  method?: 0 | 8;
  dataDescriptor?: boolean;
}

interface BuiltEntry {
  name: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressed: Buffer;
  uncompressedSize: number;
  localOffset: number;
}

/** A deliberately small ordinary ZIP writer; the validation code never uses it. */
function zip(inputs: readonly ZipInput[]): Buffer {
  const localParts: Buffer[] = [];
  const entries: BuiltEntry[] = [];
  let localOffset = 0;
  for (const input of inputs) {
    const name = Buffer.from(input.name, "utf8");
    const data = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data, "utf8");
    const method = input.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const dataDescriptor = input.dataDescriptor ?? false;
    const flags = 0x0800 | (dataDescriptor ? 0x0008 : 0);
    const entry: BuiltEntry = { name, flags, method, crc: crc32(data), compressed, uncompressedSize: data.length, localOffset };
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(dataDescriptor ? 0 : entry.crc, 14);
    local.writeUInt32LE(dataDescriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(dataDescriptor ? 0 : data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const descriptor = dataDescriptor
      ? Buffer.from([0x50, 0x4b, 0x07, 0x08, entry.crc & 0xff, (entry.crc >>> 8) & 0xff, (entry.crc >>> 16) & 0xff, (entry.crc >>> 24) & 0xff,
        compressed.length & 0xff, (compressed.length >>> 8) & 0xff, (compressed.length >>> 16) & 0xff, (compressed.length >>> 24) & 0xff,
        data.length & 0xff, (data.length >>> 8) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 24) & 0xff])
      : Buffer.alloc(0);
    localParts.push(local, name, compressed, descriptor);
    localOffset += local.length + name.length + compressed.length + descriptor.length;
    entries.push(entry);
  }

  const centralParts: Buffer[] = [];
  for (const entry of entries) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.compressed.length, 20);
    central.writeUInt32LE(entry.uncompressedSize, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(entry.localOffset, 42);
    centralParts.push(central, entry.name);
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, central, end]);
}

function signatureOffset(bytes: Buffer, signature: number): number {
  for (let offset = 0; offset <= bytes.length - 4; offset++) {
    if (bytes.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error("fixture signature was not found");
}

const office = {
  docx: {
    mainPart: "word/document.xml",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xlsx: {
    mainPart: "xl/workbook.xml",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pptx: {
    mainPart: "ppt/presentation.xml",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
} as const;

type OfficeExtension = keyof typeof office;

interface OfficeZipOptions {
  contentTypes?: string;
  includeMain?: boolean;
  omitSheetRelationship?: boolean;
  worksheetXml?: string;
  mainXml?: string;
  extraEntries?: ZipInput[];
}

function officeZip(extension: OfficeExtension, options: OfficeZipOptions = {}): Buffer {
  const specification = office[extension];
  const contentTypes = options.contentTypes ?? '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/'
    + specification.mainPart + '" ContentType="' + specification.contentType + '"/></Types>';
  const relationships = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/'
    + specification.mainPart + '"/></Relationships>';
  const entries: ZipInput[] = [
    { name: "[Content_Types].xml", data: contentTypes, method: 8 },
    { name: "_rels/.rels", data: relationships },
  ];
  if (options.includeMain === false) return zip(entries);
  if (extension === "docx") {
    entries.push({ name: specification.mainPart, data: options.mainXml ?? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Readable Word body</w:t></w:r></w:p></w:body></w:document>', method: 8 });
  } else if (extension === "xlsx") {
    entries.push(
      { name: specification.mainPart, data: options.mainXml ?? '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet 1" sheetId="1" r:id="rIdSheet1"/></sheets></workbook>', method: 8 },
      { name: "xl/worksheets/sheet 1.xml", data: options.worksheetXml ?? '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>', method: 8 },
    );
    if (!options.omitSheetRelationship) {
      entries.push({ name: "xl/_rels/workbook.xml.rels", data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet%201.xml"/></Relationships>' });
    }
  } else {
    entries.push(
      { name: specification.mainPart, data: options.mainXml ?? '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rIdSlide1"/></p:sldIdLst></p:presentation>', method: 8 },
      { name: "ppt/slides/slide 1.xml", data: '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld/></p:sld>', method: 8 },
      { name: "ppt/_rels/presentation.xml.rels", data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSlide1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="/ppt/slides/slide%201.xml"/></Relationships>' },
    );
  }
  entries.push(...(options.extraEntries ?? []));
  return zip(entries);
}

function epubZip(options: { packageXml?: string; chapterXml?: string } = {}): Buffer {
  const packageXml = options.packageXml ?? '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Babel EPUB</dc:title></metadata><manifest><item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>';
  return zip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', method: 8 },
    { name: "EPUB/package.opf", data: packageXml, method: 8 },
    { name: "EPUB/text/chapter.xhtml", data: options.chapterXml ?? '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Babel EPUB</title></head><body><p>Readable EPUB chapter.</p><a href="https://example.com/read">External link stays unvisited.</a></body></html>', method: 8 },
  ]);
}

describe("ZIP, OOXML and EPUB validation", () => {
  it("accepts stored and deflated ZIP members, including a signed data descriptor", async () => {
    const path = await file("ordinary.zip", zip([
      { name: "stored.txt", data: "ordinary stored member" },
      { name: "deflated.txt", data: "deflated data that is repeated ".repeat(16), method: 8, dataDescriptor: true },
    ]));
    await expect(validateArchiveAsset(path)).resolves.toEqual({ extension: "zip", mediaType: "application/zip" });
  });

  it.each(Object.keys(office) as OfficeExtension[])("recognizes a structurally valid %s with readable main content", async extension => {
    const path = await file("document.zip", officeZip(extension));
    await expect(validateArchiveAsset(path)).resolves.toEqual({ extension, mediaType: office[extension].mediaType });
  });

  it("recognizes an EPUB only when its first stored mimetype, package graph, and XHTML reading body are valid", async () => {
    const path = await file("book.zip", epubZip());
    await expect(validateArchiveAsset(path)).resolves.toEqual({ extension: "epub", mediaType: "application/epub+zip" });
  });

  it("rejects header-only, truncated, CRC-corrupt, and central/local-mismatched ZIPs", async () => {
    const valid = zip([{ name: "entry.txt", data: "integrity matters", method: 8 }]);
    const stored = zip([{ name: "entry.txt", data: "integrity matters" }]);
    const crcCorrupt = Buffer.from(stored);
    const local = signatureOffset(crcCorrupt, 0x04034b50);
    const dataOffset = local + 30 + crcCorrupt.readUInt16LE(local + 26) + crcCorrupt.readUInt16LE(local + 28);
    crcCorrupt[dataOffset] = crcCorrupt[dataOffset]! ^ 0x01;
    const localMismatch = Buffer.from(valid);
    localMismatch.writeUInt16LE(0, signatureOffset(localMismatch, 0x04034b50) + 8);
    const cases = [
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      valid.subarray(0, valid.length - 10),
      crcCorrupt,
      localMismatch,
    ];
    for (const bytes of cases) {
      await expect(validateArchiveAsset(await file("broken.zip", bytes))).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
    }
  });

  it("rejects a ZIP that merely has an Office suffix when the required main member or XML is invalid", async () => {
    await expect(validateArchiveAsset(await file("missing.docx", officeZip("docx", { includeMain: false })), { extension: "docx" }))
      .rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
    const unsafeContentTypes = '<!DOCTYPE Types [<!ENTITY xxe "not-used">]><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
    await expect(validateArchiveAsset(await file("doctype.docx", officeZip("docx", { contentTypes: unsafeContentTypes })), { extension: "docx" }))
      .rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
  });

  it("requires each OOXML main reference and worksheet relationship to resolve to real, well-formed members", async () => {
    await expect(validateArchiveAsset(await file("missing-sheet-relation.xlsx", officeZip("xlsx", { omitSheetRelationship: true })), { extension: "xlsx" }))
      .rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
    await expect(validateArchiveAsset(await file("broken-sheet.xlsx", officeZip("xlsx", { worksheetXml: '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' })), { extension: "xlsx" }))
      .rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
    const missingReference = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:hyperlink r:id="rIdMissing"><w:r><w:t>Broken relationship</w:t></w:r></w:hyperlink></w:body></w:document>';
    await expect(validateArchiveAsset(await file("missing-main-reference.docx", officeZip("docx", { mainXml: missingReference })), { extension: "docx" }))
      .rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
    await expect(validateArchiveAsset(await file("unrelated-bad-xml.docx", officeZip("docx", { extraEntries: [{ name: "customXml/item1.xml", data: "<customXml>" }] })), { extension: "docx" }))
      .rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
  });

  it("rejects empty EPUB packages, missing spine targets, and malformed reading XHTML", async () => {
    const emptyPackage = '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest/><spine/></package>';
    const missingSpineItem = '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="missing"/></spine></package>';
    const brokenXhtml = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Broken</title></head><body><p>broken</body></html>';
    for (const bytes of [epubZip({ packageXml: emptyPackage }), epubZip({ packageXml: missingSpineItem }), epubZip({ chapterXml: brokenXhtml })]) {
      await expect(validateArchiveAsset(await file("invalid.epub", bytes), { extension: "epub" })).rejects.toMatchObject({ code: "INVALID_DOCUMENT" });
    }
  });

  it("reports encrypted, unsupported-compression, and ZIP64 structures as unsupported rather than valid", async () => {
    const valid = zip([{ name: "entry.txt", data: "content", method: 8 }]);
    const encrypted = Buffer.from(valid);
    const encryptedCentral = signatureOffset(encrypted, 0x02014b50);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 0x0001, 6);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(encryptedCentral + 8) | 0x0001, encryptedCentral + 8);
    const unknownMethod = Buffer.from(valid);
    const unknownCentral = signatureOffset(unknownMethod, 0x02014b50);
    unknownMethod.writeUInt16LE(12, 8);
    unknownMethod.writeUInt16LE(12, unknownCentral + 10);
    const zip64 = Buffer.from(valid);
    const end = signatureOffset(zip64, 0x06054b50);
    zip64.writeUInt16LE(0xffff, end + 8);
    zip64.writeUInt16LE(0xffff, end + 10);
    for (const bytes of [encrypted, unknownMethod, zip64]) {
      await expect(validateArchiveAsset(await file("unsupported.zip", bytes))).rejects.toMatchObject({ code: "UNSUPPORTED_ARCHIVE" });
    }
  });

  it("honors cancellation before opening or parsing a ZIP", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(validateArchiveAsset(await file("cancelled.zip", zip([{ name: "entry.txt", data: "content" }])), {}, controller.signal))
      .rejects.toMatchObject({ code: "CANCELLED" });
  });
});
