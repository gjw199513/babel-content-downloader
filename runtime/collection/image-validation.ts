import { createHash } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { imageSize } from 'image-size';
import { SaxesParser } from 'saxes';
import { EngineError, runProcess } from '../engines/process.js';

export interface ImageValidation {
  extension: string;
  mediaType: string;
  width: number;
  height: number;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MAX_SVG_BYTES = 4 * 1024 ** 2;
const MAX_SVG_ELEMENTS = 4096;
const MAX_SVG_ATTRIBUTES = 16_384;
const MAX_SVG_DEPTH = 64;
const MAX_SVG_PATH_BYTES = 2 * 1024 ** 2;
const MAX_SVG_TEXT_BYTES = 64 * 1024;
const SVG_NUMBER = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;
const SVG_NUMBER_PATTERN = new RegExp(`^${SVG_NUMBER}$`);
const SVG_TRANSLATE_PATTERN = new RegExp(`^translate\\(\\s*(${SVG_NUMBER})\\s*[, ]\\s*(${SVG_NUMBER})\\s*\\)$`);
const SVG_SCALE_PATTERN = new RegExp(`^scale\\(\\s*(${SVG_NUMBER})(?:\\s*[, ]\\s*(${SVG_NUMBER}))?\\s*\\)$`);
const SVG_NUMBER_TOKEN_PATTERN = new RegExp(SVG_NUMBER, 'g');
const SVG_PATH_PATTERN = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/;
const SVG_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const SVG_LOCAL_REFERENCE_PATTERN = /^url\(#([A-Za-z_][A-Za-z0-9_.-]{0,63})\)$/;
const SVG_COLOR_PATTERN = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
const ALLOWED_SVG_ELEMENTS: Record<string, ReadonlySet<string>> = {
  svg: new Set(['viewBox', 'width', 'height', 'xmlns', 'role', 'aria-label']),
  title: new Set(),
  filter: new Set(['id']),
  feGaussianBlur: new Set(['stdDeviation']),
  linearGradient: new Set(['id', 'x1', 'y1', 'x2', 'y2']),
  stop: new Set(['offset', 'stop-color', 'stop-opacity']),
  clipPath: new Set(['id']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'fill']),
  g: new Set(['transform', 'fill', 'clip-path', 'aria-hidden', 'text-anchor', 'font-family', 'text-rendering', 'font-size']),
  path: new Set(['fill', 'd']),
  text: new Set(['x', 'y', 'textLength', 'fill-opacity', 'filter']),
};
const ALLOWED_SVG_PARENTS: Record<string, ReadonlySet<string>> = {
  svg: new Set(['g']),
  title: new Set(['svg']),
  filter: new Set(['svg']),
  feGaussianBlur: new Set(['filter']),
  linearGradient: new Set(['svg']),
  stop: new Set(['linearGradient']),
  clipPath: new Set(['svg']),
  rect: new Set(['clipPath', 'g']),
  g: new Set(['svg', 'g']),
  path: new Set(['svg', 'g']),
  text: new Set(['g']),
};
const UNSAFE_SVG_ELEMENTS = new Set(['script', 'foreignObject', 'image', 'use', 'a', 'style', 'iframe', 'object', 'embed']);

interface SvgNode {
  key: number;
  tag: string;
  id?: string;
  parent?: SvgNode;
  children: Map<string, number>;
  text: string;
}

interface SvgReference {
  source: number;
  targetId: string;
  targetTag: 'clipPath' | 'filter' | 'linearGradient';
}

function svgError(code: 'INVALID_IMAGE' | 'UNSUPPORTED_IMAGE' | 'FILE_VALIDATION_LIMIT', message: string): never {
  throw new EngineError(code, message);
}

function finiteSvgNumber(value: string, positive = false): number {
  if (!SVG_NUMBER_PATTERN.test(value)) svgError('INVALID_IMAGE', 'SVG 包含无效数值');
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 1_000_000 || positive && parsed <= 0) svgError('FILE_VALIDATION_LIMIT', 'SVG 数值超出解析预算');
  return parsed;
}

function boundedSvgNumber(value: string, minimum: number, maximum: number): number {
  const parsed = finiteSvgNumber(value);
  if (parsed < minimum || parsed > maximum) svgError('FILE_VALIDATION_LIMIT', 'SVG 数值超出解析预算');
  return parsed;
}

function svgFraction(value: string, percentage = false): number {
  const percent = value.endsWith('%');
  const parsed = boundedSvgNumber(percent ? value.slice(0, -1) : value, 0, percent || percentage ? 100 : 1);
  if (percentage && !percent && parsed > 1) svgError('INVALID_IMAGE', 'SVG 比例数值无效');
  return percent ? parsed / 100 : parsed;
}

function svgReference(value: string): string {
  const match = SVG_LOCAL_REFERENCE_PATTERN.exec(value);
  if (!match) svgError('INVALID_IMAGE', 'SVG 资源引用必须指向同一文档内的受控 ID');
  return match[1]!;
}

function safeSvgText(value: string): void {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) svgError('INVALID_IMAGE', 'SVG 文字包含控制字符');
}

/** Accept only bounded static paths and the observed self-contained badge primitives. */
function validateStaticSvg(bytes: Buffer): string {
  if (bytes.length > MAX_SVG_BYTES) svgError('FILE_VALIDATION_LIMIT', 'SVG 超过当前 4 MiB 解析预算');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { svgError('INVALID_IMAGE', 'SVG 不是有效的 UTF-8 XML'); }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) svgError('INVALID_IMAGE', 'SVG 不允许文档类型或实体声明');

  let elements = 0;
  let attributes = 0;
  let depth = 0;
  let rootSeen = false;
  let paths = 0;
  let graphics = 0;
  let pathBytes = 0;
  let textBytes = 0;
  let rootRole: string | undefined;
  let rootLabel: string | undefined;
  let rootTitle: string | undefined;
  let nodeKey = 0;
  const stack: SvgNode[] = [];
  const nodes = new Map<number, SvgNode>();
  const ids = new Map<string, SvgNode>();
  const references: SvgReference[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => svgError('INVALID_IMAGE', 'SVG 不允许文档类型声明'));
  parser.on('processinginstruction', () => svgError('INVALID_IMAGE', 'SVG 不允许处理指令'));
  parser.on('cdata', () => svgError('UNSUPPORTED_IMAGE', 'SVG 不支持 CDATA 内容'));
  parser.on('comment', () => svgError('UNSUPPORTED_IMAGE', 'SVG 不支持注释内容'));
  parser.on('text', (text) => {
    if (!text.trim()) return;
    const node = stack.at(-1);
    if (!node || !['title', 'text'].includes(node.tag)) svgError('UNSUPPORTED_IMAGE', 'SVG 文字只允许出现在受控文字元素中');
    safeSvgText(text);
    textBytes += Buffer.byteLength(text);
    if (textBytes > MAX_SVG_TEXT_BYTES) svgError('FILE_VALIDATION_LIMIT', 'SVG 文字超过解析预算');
    node.text += text;
  });
  parser.on('opentag', (tag) => {
    elements += 1;
    depth += 1;
    if (elements > MAX_SVG_ELEMENTS || depth > MAX_SVG_DEPTH) svgError('FILE_VALIDATION_LIMIT', 'SVG 节点或嵌套超过解析预算');
    if (tag.prefix || tag.uri !== SVG_NAMESPACE) svgError('INVALID_IMAGE', 'SVG 包含非 SVG 命名空间元素');
    const parent = stack.at(-1);
    const isRoot = !rootSeen;
    if (isRoot) {
      if (tag.local !== 'svg') svgError('INVALID_IMAGE', 'SVG 根元素无效');
      rootSeen = true;
    }
    if (UNSAFE_SVG_ELEMENTS.has(tag.local)) svgError('INVALID_IMAGE', 'SVG 包含可执行内容或外部资源构造');
    if (!isRoot && (!parent || !ALLOWED_SVG_PARENTS[tag.local]?.has(parent.tag))) svgError('UNSUPPORTED_IMAGE', 'SVG 图形元素的结构不在受控范围内');
    const allowed = ALLOWED_SVG_ELEMENTS[tag.local];
    if (!allowed) svgError('UNSUPPORTED_IMAGE', 'SVG 包含当前未验证的图形元素');

    const node: SvgNode = { key: ++nodeKey, tag: tag.local, parent, children: new Map(), text: '' };
    nodes.set(node.key, node);
    stack.push(node);
    if (parent) parent.children.set(tag.local, (parent.children.get(tag.local) ?? 0) + 1);

    const values = new Map<string, string>();
    for (const attribute of Object.values(tag.attributes)) {
      attributes += 1;
      if (attributes > MAX_SVG_ATTRIBUTES) svgError('FILE_VALIDATION_LIMIT', 'SVG 属性超过解析预算');
      if (!allowed.has(attribute.local)) {
        const unsafe = /^on/i.test(attribute.local) || ['href', 'src', 'style'].includes(attribute.local);
        svgError(unsafe ? 'INVALID_IMAGE' : 'UNSUPPORTED_IMAGE', unsafe ? 'SVG 包含可执行内容或外部资源属性' : 'SVG 包含当前未验证的属性');
      }
      if (attribute.local === 'xmlns') {
        if (tag.local !== 'svg' || depth !== 1 || attribute.value !== SVG_NAMESPACE) svgError('INVALID_IMAGE', 'SVG 命名空间声明无效');
      } else if (attribute.prefix || attribute.uri) svgError('INVALID_IMAGE', 'SVG 包含带命名空间的属性');
      values.set(attribute.local, attribute.value);
    }

    const id = values.get('id');
    if (id !== undefined) {
      if (!SVG_ID_PATTERN.test(id) || ids.has(id)) svgError('INVALID_IMAGE', 'SVG ID 无效或重复');
      node.id = id;
      ids.set(id, node);
    }
    const addReference = (value: string, targetTag: SvgReference['targetTag']) => {
      references.push({ source: node.key, targetId: svgReference(value), targetTag });
    };

    if (tag.local === 'svg') {
      const viewBox = values.get('viewBox');
      const width = values.get('width');
      const height = values.get('height');
      if (!viewBox && (width === undefined || height === undefined)) svgError('UNSUPPORTED_IMAGE', 'SVG 缺少受控尺寸或 viewBox');
      if (viewBox) {
        const numbers = viewBox.trim().split(/[\s,]+/);
        if (numbers.length !== 4) svgError('INVALID_IMAGE', 'SVG viewBox 无效');
        numbers.forEach((value, index) => finiteSvgNumber(value, index >= 2));
      }
      if ((width === undefined) !== (height === undefined)) svgError('INVALID_IMAGE', 'SVG 宽高声明不完整');
      if (width !== undefined && height !== undefined) {
        const parsedWidth = finiteSvgNumber(width, true);
        const parsedHeight = finiteSvgNumber(height, true);
        if (parsedWidth * parsedHeight > 64 * 1024 ** 2) svgError('FILE_VALIDATION_LIMIT', 'SVG 像素尺寸超过解析预算');
      }
      const role = values.get('role');
      const label = values.get('aria-label');
      if (depth !== 1 && (role !== undefined || label !== undefined)) svgError('INVALID_IMAGE', 'SVG 可访问性属性只允许在根元素');
      if (depth === 1) {
        if ((role === undefined) !== (label === undefined) || role !== undefined && role !== 'img') svgError('INVALID_IMAGE', 'SVG 根可访问性声明无效');
        if (label !== undefined) {
          safeSvgText(label);
          if (!label.trim() || Buffer.byteLength(label) > 1024) svgError('FILE_VALIDATION_LIMIT', 'SVG 标签文字超出解析预算');
        }
        rootRole = role;
        rootLabel = label;
      }
    } else if (tag.local === 'g') {
      const transform = values.get('transform');
      if (transform !== undefined) {
        const translate = SVG_TRANSLATE_PATTERN.exec(transform);
        const scale = SVG_SCALE_PATTERN.exec(transform);
        if (translate) {
          finiteSvgNumber(translate[1]!); finiteSvgNumber(translate[2]!);
        } else if (scale) {
          boundedSvgNumber(scale[1]!, 0.000001, 1000);
          if (scale[2] !== undefined) boundedSvgNumber(scale[2], 0.000001, 1000);
        } else svgError('UNSUPPORTED_IMAGE', 'SVG 仅支持受控平移或缩放变换');
      }
      const fill = values.get('fill');
      if (fill !== undefined && !SVG_COLOR_PATTERN.test(fill)) svgError('UNSUPPORTED_IMAGE', 'SVG 群组填充色不在受控范围内');
      const clipPath = values.get('clip-path');
      if (clipPath !== undefined) addReference(clipPath, 'clipPath');
      const ariaHidden = values.get('aria-hidden');
      if (ariaHidden !== undefined && ariaHidden !== 'true') svgError('INVALID_IMAGE', 'SVG 隐藏标记无效');
      const textAnchor = values.get('text-anchor');
      if (textAnchor !== undefined && !['start', 'middle', 'end'].includes(textAnchor)) svgError('UNSUPPORTED_IMAGE', 'SVG 文字对齐方式不在受控范围内');
      const fontFamily = values.get('font-family');
      if (fontFamily !== undefined && (fontFamily.length > 256 || !/^[A-Za-z0-9 _,-]+$/.test(fontFamily))) svgError('UNSUPPORTED_IMAGE', 'SVG 字体声明不在受控范围内');
      const textRendering = values.get('text-rendering');
      if (textRendering !== undefined && textRendering !== 'geometricPrecision') svgError('UNSUPPORTED_IMAGE', 'SVG 文字渲染模式不在受控范围内');
      const fontSize = values.get('font-size');
      if (fontSize !== undefined) boundedSvgNumber(fontSize, 0.000001, 4096);
    } else if (tag.local === 'path') {
      const path = values.get('d');
      const fill = values.get('fill');
      if (!path || !SVG_PATH_PATTERN.test(path)) svgError('INVALID_IMAGE', 'SVG 路径数据无效');
      for (const number of path.match(SVG_NUMBER_TOKEN_PATTERN) ?? []) finiteSvgNumber(number);
      if (!fill || !/^#[0-9a-fA-F]{6}$/.test(fill)) svgError('UNSUPPORTED_IMAGE', 'SVG 仅支持显式六位十六进制填充色');
      pathBytes += Buffer.byteLength(path);
      paths += 1;
      graphics += 1;
      if (pathBytes > MAX_SVG_PATH_BYTES || paths > MAX_SVG_ELEMENTS) svgError('FILE_VALIDATION_LIMIT', 'SVG 路径超过解析预算');
    } else if (tag.local === 'filter') {
      if (!id) svgError('INVALID_IMAGE', 'SVG filter 缺少受控 ID');
    } else if (tag.local === 'feGaussianBlur') {
      const deviation = values.get('stdDeviation');
      if (!deviation) svgError('INVALID_IMAGE', 'SVG 高斯模糊参数缺失');
      const parts = deviation.trim().split(/[\s,]+/);
      if (parts.length < 1 || parts.length > 2) svgError('INVALID_IMAGE', 'SVG 高斯模糊参数无效');
      parts.forEach((part) => boundedSvgNumber(part, 0, 128));
    } else if (tag.local === 'linearGradient') {
      if (!id) svgError('INVALID_IMAGE', 'SVG 渐变缺少受控 ID');
      for (const key of ['x1', 'y1', 'x2', 'y2']) {
        const value = values.get(key);
        if (value !== undefined) svgFraction(value, true);
      }
    } else if (tag.local === 'stop') {
      const offset = values.get('offset');
      if (!offset) svgError('INVALID_IMAGE', 'SVG 渐变色标缺少位置');
      svgFraction(offset);
      const color = values.get('stop-color');
      if (color !== undefined && !SVG_COLOR_PATTERN.test(color)) svgError('UNSUPPORTED_IMAGE', 'SVG 渐变颜色不在受控范围内');
      const opacity = values.get('stop-opacity');
      if (opacity !== undefined) boundedSvgNumber(opacity, 0, 1);
    } else if (tag.local === 'clipPath') {
      if (!id) svgError('INVALID_IMAGE', 'SVG clipPath 缺少受控 ID');
    } else if (tag.local === 'rect') {
      const width = values.get('width'); const height = values.get('height');
      if (!width || !height) svgError('INVALID_IMAGE', 'SVG 矩形尺寸不完整');
      boundedSvgNumber(width, 0.000001, 1_000_000); boundedSvgNumber(height, 0.000001, 1_000_000);
      if (values.has('x')) finiteSvgNumber(values.get('x')!);
      if (values.has('y')) finiteSvgNumber(values.get('y')!);
      if (values.has('rx')) boundedSvgNumber(values.get('rx')!, 0, 1_000_000);
      const fill = values.get('fill');
      if (parent?.tag === 'clipPath') {
        if (fill !== undefined) svgError('UNSUPPORTED_IMAGE', 'SVG 裁剪矩形不支持填充资源');
      } else if (!fill) svgError('UNSUPPORTED_IMAGE', 'SVG 绘制矩形缺少受控填充');
      else if (SVG_COLOR_PATTERN.test(fill)) { /* bounded static color */ }
      else addReference(fill, 'linearGradient');
      graphics += 1;
    } else if (tag.local === 'text') {
      for (const key of ['x', 'y']) {
        const value = values.get(key);
        if (!value) svgError('INVALID_IMAGE', 'SVG 文字位置不完整');
        finiteSvgNumber(value);
      }
      const length = values.get('textLength');
      if (length !== undefined) boundedSvgNumber(length, 0.000001, 1_000_000);
      const opacity = values.get('fill-opacity');
      if (opacity !== undefined) boundedSvgNumber(opacity, 0, 1);
      const filter = values.get('filter');
      if (filter !== undefined) addReference(filter, 'filter');
      graphics += 1;
    }
  });
  parser.on('closetag', () => {
    const node = stack.pop();
    if (!node) svgError('INVALID_IMAGE', 'SVG XML 结构无效');
    if (node.tag === 'title' || node.tag === 'text') {
      if (!node.text.trim()) svgError('INVALID_IMAGE', 'SVG 文字元素为空');
      if (node.tag === 'title') {
        if (node.parent?.parent) svgError('UNSUPPORTED_IMAGE', 'SVG 标题只允许在根元素');
        if (rootTitle !== undefined) svgError('INVALID_IMAGE', 'SVG 根标题重复');
        rootTitle = node.text.trim();
      }
    } else if (node.text.trim()) svgError('INVALID_IMAGE', 'SVG 图形元素包含非预期文字');
    if (node.tag === 'filter' && node.children.get('feGaussianBlur') !== 1) svgError('UNSUPPORTED_IMAGE', 'SVG filter 仅支持单个高斯模糊节点');
    if (node.tag === 'linearGradient' && (node.children.get('stop') ?? 0) < 2) svgError('UNSUPPORTED_IMAGE', 'SVG 线性渐变至少需要两个色标');
    if (node.tag === 'clipPath' && (node.children.get('rect') ?? 0) !== 1) svgError('UNSUPPORTED_IMAGE', 'SVG clipPath 仅支持单个矩形');
    depth -= 1;
  });
  try { parser.write(source).close(); }
  catch (error) {
    if (error instanceof EngineError) throw error;
    svgError('INVALID_IMAGE', 'SVG XML 结构不完整或无效');
  }
  if (!rootSeen || !graphics || depth !== 0 || stack.length) svgError('INVALID_IMAGE', 'SVG 未包含完整的静态图形');
  if ((rootRole === undefined) !== (rootLabel === undefined)) svgError('INVALID_IMAGE', 'SVG 根可访问性声明不完整');
  if (rootLabel !== undefined && rootTitle !== rootLabel) svgError('INVALID_IMAGE', 'SVG 根标题与可访问标签不一致');
  const graph = new Map<number, number[]>();
  const referencedIds = new Set<string>();
  for (const reference of references) {
    const target = ids.get(reference.targetId);
    if (!target || target.tag !== reference.targetTag) svgError('INVALID_IMAGE', 'SVG 本地资源引用缺失或类型不匹配');
    referencedIds.add(reference.targetId);
    const outgoing = graph.get(reference.source) ?? [];
    outgoing.push(target.key); graph.set(reference.source, outgoing);
  }
  for (const id of ids.keys()) if (!referencedIds.has(id)) svgError('UNSUPPORTED_IMAGE', 'SVG 包含未使用的资源定义');
  const visiting = new Set<number>(); const visited = new Set<number>();
  const visit = (key: number): void => {
    if (visiting.has(key)) svgError('INVALID_IMAGE', 'SVG 本地资源引用形成循环');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const target of graph.get(key) ?? []) visit(target);
    visiting.delete(key); visited.add(key);
  };
  for (const key of nodes.keys()) visit(key);
  return createHash('sha256').update(bytes).digest('hex');
}

/** Decode all pixels/frames before accepting an image; preflight static SVG and preserve source bytes. */
export async function validateImageAsset(path: string, signal?: AbortSignal): Promise<ImageValidation> {
  if (signal?.aborted) throw new EngineError('CANCELLED', '任务已取消');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 8) throw new EngineError('INVALID_IMAGE', '图片不是有效的普通文件');
  if (info.size > 128 * 1024 ** 2) throw new EngineError('FILE_VALIDATION_LIMIT', '图片超过当前 128 MiB 解析预算');
  const handle = await open(path, 'r');
  const prefix = Buffer.alloc(Math.min(info.size, 1024 ** 2));
  try { await handle.read(prefix, 0, prefix.length, 0); } finally { await handle.close(); }
  let header;
  try { header = imageSize(prefix); } catch { throw new EngineError('INVALID_IMAGE', '图片格式或尺寸无法识别'); }
  if (!header.type || !['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff', 'svg'].includes(header.type)) throw new EngineError('UNSUPPORTED_IMAGE', '当前图片格式尚不能完成像素校验');
  if (!header.width || !header.height || header.width * header.height > 64 * 1024 ** 2) throw new EngineError('FILE_VALIDATION_LIMIT', '图片超过当前像素解析预算');
  const svgSha256 = header.type === 'svg' ? validateStaticSvg(await readFile(path)) : undefined;
  const sourceWorker = import.meta.url.endsWith('.ts');
  const worker = fileURLToPath(new URL(sourceWorker ? './image-validation-worker.ts' : './image-validation-worker.js', import.meta.url));
  const args = ['--max-old-space-size=256', ...(sourceWorker ? ['--import', import.meta.resolve('tsx')] : []), worker, path, ...(svgSha256 ? [svgSha256] : [])];
  let stdout: string;
  try { ({ stdout } = await runProcess(process.execPath, args, { signal, timeoutMs: 20_000, maxOutputBytes: 4096 })); }
  catch (error) {
    if (error instanceof EngineError && error.code === 'CANCELLED') throw error;
    if (error instanceof EngineError && (error.code === 'ENGINE_TIMEOUT' || error.code === 'ENGINE_FAILED' && /heap out of memory|allocation failed/i.test(error.message))) throw new EngineError('FILE_VALIDATION_LIMIT', '图片解析超出时间或内存预算');
    throw new EngineError('IMAGE_VALIDATION_UNAVAILABLE', '图片校验进程未能正常运行');
  }
  let reply: { valid?: unknown; code?: unknown; extension?: unknown; mediaType?: unknown; width?: unknown; height?: unknown };
  try {
    reply = JSON.parse(stdout);
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw new Error('Invalid worker reply');
  } catch { throw new EngineError('IMAGE_VALIDATION_UNAVAILABLE', '图片校验进程未返回有效结果'); }
  if (reply.valid !== true) {
    if (reply.code === 'UNAVAILABLE') throw new EngineError('IMAGE_VALIDATION_UNAVAILABLE', '图片解析依赖不可用，请修复安装后续跑');
    if (reply.code === 'LIMIT') throw new EngineError('FILE_VALIDATION_LIMIT', '图片的总像素或帧数超过解析预算');
    if (reply.code === 'UNSUPPORTED') throw new EngineError('UNSUPPORTED_IMAGE', '当前图片格式尚不能完成像素校验');
    throw new EngineError('INVALID_IMAGE', '图片像素或动画帧未通过完整解码');
  }
  const formats: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', heif: 'image/heif', tiff: 'image/tiff', svg: 'image/svg+xml' };
  if (typeof reply.extension !== 'string' || formats[reply.extension] !== reply.mediaType || !Number.isInteger(reply.width) || !Number.isInteger(reply.height) || Number(reply.width) <= 0 || Number(reply.height) <= 0) throw new EngineError('INVALID_IMAGE', '图片校验结果无效');
  const after = await lstat(path);
  if (after.isSymbolicLink() || after.ino !== info.ino || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new EngineError('INVALID_IMAGE', '图片在校验过程中发生变化');
  if (signal?.aborted) throw new EngineError('CANCELLED', '任务已取消');
  return { extension: reply.extension, mediaType: reply.mediaType as string, width: Number(reply.width), height: Number(reply.height) };
}
