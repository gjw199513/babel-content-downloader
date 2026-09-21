import { lstat, readFile } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import type { SourceAsset } from '../../shared/contracts.js';
import { EngineError } from '../engines/process.js';

const MAX_SUBTITLE_BYTES = 8 * 1024 ** 2;
const TTML_NAMESPACES = new Set([
  'http://www.w3.org/ns/ttml',
  'http://www.w3.org/2006/10/ttaf1',
  'http://www.w3.org/2006/04/ttaf1',
]);

export interface SubtitleValidation {
  extension: 'vtt' | 'srt' | 'ass' | 'ttml';
  mediaType: 'text/vtt' | 'application/x-subrip' | 'text/x-ssa' | 'application/ttml+xml';
  cueCount: number;
}

class SubtitleSyntaxError extends Error {}

function invalid(message: string): never {
  throw new EngineError('INVALID_SUBTITLE', message);
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new EngineError('CANCELLED', '任务已取消');
}

function normalizeText(bytes: Buffer): string {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { invalid('字幕不是完整、有效的 UTF-8 文本'); }
  text = text!.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.includes('\0')) invalid('字幕包含无效的空字符');
  return text;
}

function blocksAfter(lines: string[], offset: number): string[][] {
  const result: string[][] = [];
  let block: string[] = [];
  for (const line of lines.slice(offset)) {
    if (!line.trim()) {
      if (block.length) { result.push(block); block = []; }
    } else block.push(line);
  }
  if (block.length) result.push(block);
  return result;
}

function parseVttTimestamp(value: string): number | undefined {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
  if (!match) return;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  return Number.isFinite(seconds) ? seconds : undefined;
}

function parseSrtTimestamp(value: string): number | undefined {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(value);
  if (!match) return;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  return Number.isFinite(seconds) ? seconds : undefined;
}

function cueTiming(line: string, parser: (value: string) => number | undefined): { start: number; end: number; settings: string } | undefined {
  const match = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.+))?$/.exec(line);
  if (!match) return;
  const start = parser(match[1]!); const end = parser(match[2]!);
  if (start === undefined || end === undefined) return;
  return { start, end, settings: match[3]?.trim() ?? '' };
}

/**
 * Some platform-produced WebVTT files put a bounded metadata block between the
 * WEBVTT signature and its separating blank line. The WebVTT parsing algorithm
 * collects that block in its "in header" state even though current strict file
 * syntax does not define these historical fields. Accept only the two fields
 * observed in platform output; cue validation below remains unchanged.
 */
function vttBodyOffset(lines: string[]): number {
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0] ?? '')) invalid('WebVTT 字幕缺少规范文件头或头部后的空行');
  const separator = lines.findIndex((line, index) => index > 0 && line === '');
  if (separator < 1) invalid('WebVTT 字幕缺少规范文件头或头部后的空行');
  if (separator === 1) return 2;
  const fields = new Set<string>();
  const header = lines.slice(1, separator);
  if (header.length > 2) invalid('WebVTT 字幕包含不受支持或过多的头部元数据');
  for (const line of header) {
    const match = /^(Kind|Language):[ \t]+([^\s].*)$/.exec(line);
    if (!match || fields.has(match[1]!)) invalid('WebVTT 字幕包含不受支持或重复的头部元数据');
    const [, name, value] = match;
    if (name === 'Kind' && value !== 'captions') invalid('WebVTT 字幕包含不受支持的 Kind 头部值');
    if (name === 'Language' && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value!)) invalid('WebVTT 字幕包含无效的 Language 头部值');
    fields.add(name!);
  }
  return separator + 1;
}

function validateVtt(text: string): SubtitleValidation {
  const lines = text.split('\n');
  const bodyOffset = vttBodyOffset(lines);
  const identifiers = new Set<string>();
  let previousStart = -1;
  let cueCount = 0;
  let cuesStarted = false;
  for (const [blockIndex, block] of blocksAfter(lines, bodyOffset).entries()) {
    const first = block[0]!;
    if (/^NOTE(?:[ \t]|$)/.test(first)) continue;
    if (first === 'STYLE' || first === 'REGION' || block.every(line => /^[A-Z][A-Z0-9-]*=\S+$/.test(line))) {
      if (cuesStarted) invalid(`WebVTT 第 ${blockIndex + 1} 个块在字幕 cue 之后包含头部元数据`);
      if (block.length < 2 && (first === 'STYLE' || first === 'REGION')) invalid(`WebVTT 第 ${blockIndex + 1} 个元数据块不完整`);
      if (first === 'STYLE' && block.slice(1).some(line => line.includes('-->'))) invalid(`WebVTT 第 ${blockIndex + 1} 个样式块包含非法时间箭头`);
      continue;
    }
    cuesStarted = true;
    let timingIndex = 0;
    if (!block[0]!.includes('-->')) timingIndex = 1;
    if (!block[timingIndex]) invalid(`WebVTT 第 ${blockIndex + 1} 个字幕块缺少时间轴`);
    if (timingIndex === 1) {
      const identifier = block[0]!.trim();
      if (!identifier || identifier.includes('-->') || identifiers.has(identifier)) invalid(`WebVTT 第 ${blockIndex + 1} 个字幕标识无效或重复`);
      identifiers.add(identifier);
    }
    const timing = cueTiming(block[timingIndex]!, parseVttTimestamp);
    if (!timing) invalid(`WebVTT 第 ${blockIndex + 1} 个字幕块包含非法时间戳`);
    if (timing.end <= timing.start) invalid(`WebVTT 第 ${blockIndex + 1} 个字幕块结束时间不晚于开始时间`);
    if (timing.start < previousStart) invalid(`WebVTT 第 ${blockIndex + 1} 个字幕块未按开始时间排列`);
    previousStart = timing.start;
    if (timing.settings) {
      if (timing.settings.includes('-->')) invalid(`WebVTT 第 ${blockIndex + 1} 个字幕块包含非法 cue 设置`);
      const names = new Set<string>();
      for (const setting of timing.settings.split(/[ \t]+/)) {
        const match = /^([A-Za-z][A-Za-z0-9-]*):([^\s]+)$/.exec(setting);
        if (!match || names.has(match[1]!)) invalid(`WebVTT 第 ${blockIndex + 1} 个字幕块包含非法或重复的 cue 设置`);
        names.add(match[1]!);
      }
    }
    const payload = block.slice(timingIndex + 1);
    if (!payload.some(line => line.trim()) || payload.some(line => line.includes('-->'))) {
      invalid(`WebVTT 第 ${blockIndex + 1} 个字幕块缺少有效文本或尾部不完整`);
    }
    let inlineTime = timing.start;
    for (const line of payload) {
      for (const match of line.matchAll(/<((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})>/g)) {
        const value = parseVttTimestamp(match[1]!);
        if (value === undefined || value <= inlineTime || value >= timing.end) invalid(`WebVTT 第 ${blockIndex + 1} 个字幕块包含非法内联时间戳`);
        inlineTime = value;
      }
    }
    cueCount++;
  }
  if (!cueCount) invalid('WebVTT 字幕没有可播放的真实 cue');
  return { extension: 'vtt', mediaType: 'text/vtt', cueCount };
}

function validateSrt(text: string): SubtitleValidation {
  let cueCount = 0;
  for (const [blockIndex, block] of blocksAfter(text.split('\n'), 0).entries()) {
    const timingIndex = /^\d+$/.test(block[0]!.trim()) ? 1 : 0;
    if (!block[timingIndex]) invalid(`SRT 第 ${blockIndex + 1} 个字幕块缺少时间轴`);
    const timing = cueTiming(block[timingIndex]!, parseSrtTimestamp);
    if (!timing) invalid(`SRT 第 ${blockIndex + 1} 个字幕块包含非法时间戳`);
    if (timing.end <= timing.start) invalid(`SRT 第 ${blockIndex + 1} 个字幕块结束时间不晚于开始时间`);
    if (!block.slice(timingIndex + 1).some(line => line.trim())) invalid(`SRT 第 ${blockIndex + 1} 个字幕块缺少文本或尾部不完整`);
    cueCount++;
  }
  if (!cueCount) invalid('SRT 字幕没有可播放的真实 cue');
  return { extension: 'srt', mediaType: 'application/x-subrip', cueCount };
}

function parseAssTimestamp(value: string): number | undefined {
  const match = /^(\d+):([0-5]\d):([0-5]\d)\.(\d{2})$/.exec(value.trim());
  if (!match) return;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100;
  return Number.isFinite(seconds) ? seconds : undefined;
}

function splitAssFields(value: string, count: number): string[] | undefined {
  const fields: string[] = [];
  let remaining = value;
  for (let index = 1; index < count; index++) {
    const separator = remaining.indexOf(',');
    if (separator < 0) return;
    fields.push(remaining.slice(0, separator).trim());
    remaining = remaining.slice(separator + 1);
  }
  fields.push(remaining.trim());
  return fields;
}

function validateAss(text: string): SubtitleValidation {
  let section = '';
  let fields: string[] | undefined;
  let sawEvents = false;
  let cueCount = 0;
  for (const [lineIndex, original] of text.split('\n').entries()) {
    const line = original.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = /^\[([^\]]+)]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim().toLowerCase();
      if (section === 'events') { sawEvents = true; fields = undefined; }
      continue;
    }
    if (section !== 'events') continue;
    const format = /^Format\s*:\s*(.+)$/i.exec(line);
    if (format) {
      fields = format[1]!.split(',').map(value => value.trim().toLowerCase());
      if (fields.length < 3 || new Set(fields).size !== fields.length || !fields.includes('start') || !fields.includes('end') || fields.at(-1) !== 'text') {
        invalid(`ASS 第 ${lineIndex + 1} 行的 Events Format 缺少 Start、End 或末尾 Text 字段`);
      }
      continue;
    }
    const event = /^(Dialogue|Comment|Picture|Sound|Movie|Command)\s*:\s*(.*)$/i.exec(line);
    if (!event || !fields) invalid(`ASS 第 ${lineIndex + 1} 行包含无法按 Events Format 解析的事件`);
    const values = splitAssFields(event[2]!, fields.length);
    if (!values) invalid(`ASS 第 ${lineIndex + 1} 行事件字段被截断`);
    const start = parseAssTimestamp(values[fields.indexOf('start')]!);
    const end = parseAssTimestamp(values[fields.indexOf('end')]!);
    if (start === undefined || end === undefined) invalid(`ASS 第 ${lineIndex + 1} 行包含非法时间戳`);
    if (end <= start) invalid(`ASS 第 ${lineIndex + 1} 行结束时间不晚于开始时间`);
    if (event[1]!.toLowerCase() === 'dialogue') {
      if (!values.at(-1)?.trim()) invalid(`ASS 第 ${lineIndex + 1} 行 Dialogue 缺少文本或尾部不完整`);
      cueCount++;
    }
  }
  if (!sawEvents) invalid('ASS 字幕缺少 Events 区段');
  if (!fields) invalid('ASS 字幕缺少有效的 Events Format');
  if (!cueCount) invalid('ASS 字幕没有可播放的 Dialogue 事件');
  return { extension: 'ass', mediaType: 'text/x-ssa', cueCount };
}

interface TtmlTimeContext {
  nominalFrameRate: number;
  frameRate: number;
  subFrameRate: number;
  tickRate: number;
}

interface TtmlFrame {
  local: string;
  ttml: boolean;
  begin: number;
  end: number;
  isParagraph: boolean;
  text: string;
}

function attribute(tag: SaxesTagNS, local: string): string | undefined {
  return Object.values(tag.attributes).find(value => value.local === local)?.value;
}

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) throw new SubtitleSyntaxError(`TTML ${label} 参数无效`);
  return parsed;
}

function ttmlTimeContext(tag: SaxesTagNS): TtmlTimeContext {
  const nominalFrameRate = positiveInteger(attribute(tag, 'frameRate'), 30, 'frameRate');
  let multiplier = 1;
  const multiplierValue = attribute(tag, 'frameRateMultiplier');
  if (multiplierValue !== undefined) {
    const match = /^(\d+)\s+(\d+)$/.exec(multiplierValue.trim());
    const numerator = Number(match?.[1]); const denominator = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 1 || denominator < 1) {
      throw new SubtitleSyntaxError('TTML frameRateMultiplier 参数无效');
    }
    multiplier = numerator / denominator;
  }
  const subFrameRate = positiveInteger(attribute(tag, 'subFrameRate'), 1, 'subFrameRate');
  const frameRate = nominalFrameRate * multiplier;
  const defaultTickRate = frameRate * subFrameRate;
  if (!Number.isFinite(frameRate) || frameRate <= 0 || !Number.isFinite(defaultTickRate) || defaultTickRate <= 0) {
    throw new SubtitleSyntaxError('TTML 帧率或 tickRate 参数超出可验证范围');
  }
  const tickRate = positiveInteger(attribute(tag, 'tickRate'), defaultTickRate, 'tickRate');
  const timeBase = attribute(tag, 'timeBase');
  if (timeBase !== undefined && timeBase !== 'media') throw new SubtitleSyntaxError('TTML 当前时间基准无法完整验证');
  return { nominalFrameRate, frameRate, subFrameRate, tickRate };
}

function parseTtmlTime(value: string, context: TtmlTimeContext): number | undefined {
  let match = /^(\d{2,}):([0-5]\d):([0-5]\d)(?:\.(\d+))?$/.exec(value);
  if (match) {
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] ?? '0'}`);
    return Number.isFinite(seconds) ? seconds : undefined;
  }
  match = /^(\d{2,}):([0-5]\d):([0-5]\d):(\d+)(?:\.(\d+))?$/.exec(value);
  if (match) {
    const frames = Number(match[4]); const subframes = Number(match[5] ?? 0);
    if (frames >= context.nominalFrameRate || subframes >= context.subFrameRate) return;
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      + frames / context.frameRate + subframes / (context.subFrameRate * context.frameRate);
    return Number.isFinite(seconds) ? seconds : undefined;
  }
  match = /^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/.exec(value);
  if (!match) return;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return;
  let seconds: number;
  switch (match[2]) {
    case 'h': seconds = amount * 3600; break;
    case 'm': seconds = amount * 60; break;
    case 's': seconds = amount; break;
    case 'ms': seconds = amount / 1000; break;
    case 'f': seconds = amount / context.frameRate; break;
    case 't': seconds = amount / context.tickRate; break;
    default: return;
  }
  return Number.isFinite(seconds) ? seconds : undefined;
}

function validateTtml(text: string, signal?: AbortSignal): SubtitleValidation {
  const parser = new SaxesParser({ xmlns: true });
  const stack: TtmlFrame[] = [];
  let context: TtmlTimeContext | undefined;
  let ttmlNamespace = '';
  let rootSeen = false;
  let bodyCount = 0;
  let cueCount = 0;
  let events = 0;
  parser.on('doctype', () => { throw new SubtitleSyntaxError('TTML 字幕不允许 DOCTYPE 或自定义实体'); });
  parser.on('opentag', tag => {
    if ((++events & 127) === 0) cancelled(signal);
    if (stack.length >= 256) throw new SubtitleSyntaxError('TTML 字幕 XML 嵌套层级超过验证上限');
    const local = tag.local;
    if (!rootSeen) {
      rootSeen = true;
      if (local !== 'tt' || !TTML_NAMESPACES.has(tag.uri)) throw new SubtitleSyntaxError('TTML 字幕根元素或命名空间无效');
      ttmlNamespace = tag.uri;
      context = ttmlTimeContext(tag);
    }
    if (!context) throw new SubtitleSyntaxError('TTML 字幕缺少根元素');
    const ttml = tag.uri === ttmlNamespace;
    if (ttml && local === 'body' && ++bodyCount > 1) throw new SubtitleSyntaxError('TTML 字幕包含重复的 body 元素');
    if (attribute(tag, 'timeContainer') === 'seq') throw new SubtitleSyntaxError('TTML 顺序时间容器当前无法完整验证');
    const parent = stack.at(-1);
    const parentBegin = parent?.begin ?? 0;
    const parentEnd = parent?.end ?? Number.POSITIVE_INFINITY;
    const beginValue = attribute(tag, 'begin');
    const endValue = attribute(tag, 'end');
    const durationValue = attribute(tag, 'dur');
    const localBegin = beginValue === undefined ? 0 : parseTtmlTime(beginValue, context);
    const localEnd = endValue === undefined ? undefined : parseTtmlTime(endValue, context);
    const duration = durationValue === undefined ? undefined : parseTtmlTime(durationValue, context);
    if (localBegin === undefined || localEnd === undefined && endValue !== undefined || duration === undefined && durationValue !== undefined) {
      throw new SubtitleSyntaxError(`TTML ${local} 元素包含非法时间表达式`);
    }
    if (duration !== undefined && duration <= 0) throw new SubtitleSyntaxError(`TTML ${local} 元素持续时间无效`);
    const begin = parentBegin + localBegin;
    const candidates = [parentEnd];
    if (localEnd !== undefined) candidates.push(parentBegin + localEnd);
    if (duration !== undefined) candidates.push(begin + duration);
    const end = Math.min(...candidates);
    if (Number.isFinite(end) && end <= begin) throw new SubtitleSyntaxError(`TTML ${local} 元素结束时间不晚于开始时间`);
    if (ttml && local === 'p' && !stack.some(frame => frame.ttml && frame.local === 'body')) throw new SubtitleSyntaxError('TTML 字幕段落不在 body 范围内');
    if (ttml && local === 'p' && stack.some(frame => frame.isParagraph)) throw new SubtitleSyntaxError('TTML 字幕包含嵌套的 p 段落');
    if (ttml && local === 'br') {
      const paragraph = [...stack].reverse().find(frame => frame.isParagraph);
      if (paragraph) paragraph.text += '\n';
    }
    stack.push({ local, ttml, begin, end, isParagraph: ttml && local === 'p', text: '' });
  });
  const appendText = (value: string): void => {
    const paragraph = [...stack].reverse().find(frame => frame.isParagraph);
    if (paragraph) paragraph.text += value;
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', () => {
    const frame = stack.pop();
    if (!frame) throw new SubtitleSyntaxError('TTML 字幕 XML 结构不完整');
    if (frame.isParagraph) {
      if (!Number.isFinite(frame.end)) throw new SubtitleSyntaxError('TTML 字幕段落缺少可确定的结束时间');
      if (!frame.text.trim()) throw new SubtitleSyntaxError('TTML 字幕段落缺少文本或尾部不完整');
      cueCount++;
    }
  });
  try { parser.write(text).close(); }
  catch (error) {
    if (error instanceof EngineError) throw error;
    if (error instanceof SubtitleSyntaxError) invalid(error.message);
    invalid('TTML 字幕不是完整、合法且可验证的 XML');
  }
  if (!rootSeen || stack.length || bodyCount !== 1) invalid('TTML 字幕 XML 结构不完整或缺少唯一 body');
  if (!cueCount) invalid('TTML 字幕没有可播放的 p 段落');
  return { extension: 'ttml', mediaType: 'application/ttml+xml', cueCount };
}

function hintedFormat(asset: Pick<SourceAsset, 'media_type'>, declared: string): SubtitleValidation['extension'] | undefined {
  const hint = `${asset.media_type ?? ''};${declared}`.toLowerCase();
  if (hint.includes('vtt')) return 'vtt';
  if (hint.includes('subrip') || hint.includes('srt')) return 'srt';
  if (hint.includes('ttml') || hint.includes('xml')) return 'ttml';
  if (hint.includes('ssa') || hint.includes('ass')) return 'ass';
}

/** Detect and fully validate one source subtitle before it can become an artifact. */
export async function validateSubtitleAsset(path: string, asset: Pick<SourceAsset, 'media_type'>, declared: string, signal?: AbortSignal): Promise<SubtitleValidation> {
  cancelled(signal);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size === 0) invalid('字幕文件为空或不是普通文件');
  if (stat.size > MAX_SUBTITLE_BYTES) throw new EngineError('TEXT_SIZE_LIMIT', '文本附件超过当前可验证的容量上限');
  const text = normalizeText(await readFile(path));
  cancelled(signal);
  const start = text.trimStart();
  let format: SubtitleValidation['extension'] | undefined;
  if (/^WEBVTT(?:[ \t\r\n]|$)/.test(start)) format = 'vtt';
  else if (/^(?:<\?xml\b[\s\S]*?\?>\s*)?<(?:[A-Za-z_][\w.-]*:)?tt(?:\s|>)/.test(start) || /^<\?xml\b/.test(start)) format = 'ttml';
  else if (/^\s*\[(?:Script Info|Events|V4\+? Styles)]/im.test(text)) format = 'ass';
  else if (/\d{2,}:\d{2}:\d{2}[,.]\d{3}[ \t]+-->[ \t]+\d{2,}:\d{2}:\d{2}[,.]\d{3}/.test(text)) format = 'srt';
  else format = hintedFormat(asset, declared);
  if (!format) invalid('字幕内容不属于支持的 VTT、SRT、ASS 或 TTML 格式');
  const result = format === 'vtt' ? validateVtt(text)
    : format === 'srt' ? validateSrt(text)
      : format === 'ass' ? validateAss(text)
        : validateTtml(text, signal);
  cancelled(signal);
  return result;
}
