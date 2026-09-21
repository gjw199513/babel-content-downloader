import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat, realpath, unlink } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { basename, join, relative, isAbsolute } from 'node:path';
import type { Artifact, SavePreferences, SourceAsset } from '../../shared/contracts.js';
import { createGuardedProxy, downloadFile, resolveRemote, type NetworkPolicy } from './network.js';
import { EngineError, runProcess } from './process.js';
import { redactUrl } from '../storage/job-store.js';

export interface MediaTools { ytDlp?: string; ffmpeg?: string; ffprobe?: string }
export interface MediaProbe {
  duration: number;
  video?: { codec: string; width: number; height: number };
  audio?: { codec: string; channels: number };
}
interface EngineFormat { format_id: string; vcodec?: string; acodec?: string; protocol?: string; has_drm?: boolean; height?: number; tbr?: number; abr?: number; ext?: string }
export interface EngineInfo {
  id?: string; duration?: number; is_live?: boolean; live_status?: string; _type?: string;
  entries?: EngineInfo[]; formats?: EngineFormat[];
  subtitles?: Record<string, { url?: string; data?: string; ext: string }[]>;
  automatic_captions?: Record<string, { url?: string; data?: string; ext: string }[]>;
}

/** Hash actual bytes; no media is played through the system audio device. */
export async function hashFile(path: string): Promise<{ size: number; sha256: string }> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new EngineError('INVALID_FILE', '资源不是有效的非空本地文件');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return { size: stat.size, sha256: hash.digest('hex') };
}

export async function probeMedia(path: string, signal?: AbortSignal, tools: MediaTools = {}): Promise<MediaProbe> {
  await hashFile(path);
  const result = await runProcess(tools.ffprobe ?? 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', path], { signal, dependency: 'ffprobe' });
  const data = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: { codec_type: string; codec_name: string; width?: number; height?: number; channels?: number; duration?: string }[] };
  const streams = data.streams ?? [];
  const duration = Math.max(Number(data.format?.duration) || 0, ...streams.map(s => Number(s.duration) || 0));
  if (!Number.isFinite(duration) || duration <= 0) throw new EngineError('INVALID_MEDIA', '媒体缺少有效时长，不能作为可播放结果');
  const video = streams.find(s => s.codec_type === 'video'); const audio = streams.find(s => s.codec_type === 'audio');
  return { duration,
    ...(video ? { video: { codec: video.codec_name, width: video.width ?? 0, height: video.height ?? 0 } } : {}),
    ...(audio ? { audio: { codec: audio.codec_name, channels: audio.channels ?? 0 } } : {}),
  };
}

function engineArgs(pageUrl: string, proxy: string): string[] {
  const source = new URL(pageUrl);
  const part = /(^|\.)bilibili\.com$/.test(source.hostname) && /^\d+$/.test(source.searchParams.get('p') ?? '') ? source.searchParams.get('p')! : '1';
  return ['--ignore-config', '--no-plugin-dirs', '--no-remote-components', '--no-exec', '--no-mark-watched', '--no-cache-dir',
    '--no-playlist', '--playlist-items', part, '--no-progress', '--no-warnings', '--socket-timeout', '30', '--retries', '2', '--fragment-retries', '2',
    '--concurrent-fragments', '1', '--abort-on-unavailable-fragments', '--ignore-dynamic-mpd', '--proxy', proxy,
    '--downloader', 'native', '--fixup', 'never'];
}

async function engineRun(pageUrl: string, args: string[], policy: NetworkPolicy, signal?: AbortSignal, tools: MediaTools = {}): Promise<string> {
  await resolveRemote(pageUrl, policy);
  const proxy = await createGuardedProxy(policy);
  try {
    const result = await runProcess(tools.ytDlp ?? 'yt-dlp', [...engineArgs(pageUrl, proxy.url), ...args, '--', pageUrl], {
      signal, timeoutMs: 30 * 60_000, maxOutputBytes: 16 * 1024 ** 2, dependency: 'yt-dlp',
      env: { HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url, ALL_PROXY: proxy.url, http_proxy: proxy.url, https_proxy: proxy.url, all_proxy: proxy.url, NO_PROXY: '', no_proxy: '', PYTHONPATH: '' },
    });
    if (proxy.violation()) throw proxy.violation();
    return result.stdout;
  } catch (error) { throw proxy.violation() ?? error; }
  finally { await proxy.close(); }
}

export async function inspectPlatformMedia(pageUrl: string, policy: NetworkPolicy, signal?: AbortSignal, tools: MediaTools = {}): Promise<EngineInfo> {
  let info = JSON.parse(await engineRun(pageUrl, ['--skip-download', '--dump-single-json'], policy, signal, tools)) as EngineInfo;
  if (info.entries) {
    if (info.entries.length !== 1 || !info.entries[0]) throw new EngineError('MEDIA_SCOPE_UNCLEAR', '来源包含多个媒体对象，需要适配器明确当前内容边界');
    info = info.entries[0];
  }
  if (info.is_live || info.live_status === 'is_live' || info.live_status === 'is_upcoming') throw new EngineError('LIVE_NOT_SUPPORTED', '只收集已发布的有界内容，当前来源为直播或尚未开始');
  return info;
}

export function subtitleAssets(info: EngineInfo, sourceUrl: string, inline: Map<string, string>): SourceAsset[] {
  const captions = { ...info.automatic_captions, ...info.subtitles };
  return Object.entries(captions).flatMap(([language, formats], index) => {
    const best = ['vtt', 'srt', 'ass', 'ttml'].map(ext => formats.find(f => f.ext === ext && ((f.url && /^https?:\/\//.test(f.url)) || typeof f.data === 'string'))).find(Boolean);
    if (!best) return [];
    const id = `engine-subtitle-${index}`;
    if (typeof best.data === 'string') inline.set(id, best.data);
    return [{ id, role: 'subtitle' as const, url: best.url ?? sourceUrl, source_url: sourceUrl, order: index, language, media_type: best.ext === 'vtt' ? 'text/vtt' : best.ext === 'srt' ? 'application/x-subrip' : 'text/plain', availability: 'available' as const }];
  });
}

function hasVideo(format: EngineFormat): boolean { return !!format.vcodec && format.vcodec !== 'none'; }
function hasAudio(format: EngineFormat): boolean { return !!format.acodec && format.acodec !== 'none'; }
export function selectedFormats(info: EngineInfo, kind: 'audio' | 'video', preferences: SavePreferences = {}): EngineFormat[] {
  const formats = (info.formats ?? []).filter(f => !f.has_drm && /^[a-zA-Z0-9._-]+$/.test(f.format_id) && ['http', 'https', 'm3u8_native', 'http_dash_segments'].includes(f.protocol ?? 'https'));
  const audio = formats.filter(hasAudio).sort((a, b) => Number(hasVideo(a)) - Number(hasVideo(b)) || (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0));
  if (kind === 'audio') {
    if (!audio[0]) throw new EngineError('AUDIO_NOT_AVAILABLE', '当前来源没有可取得的音频流');
    return [audio[0]];
  }
  const videoFormats = formats.filter(hasVideo).filter(format => preferences.video_height === undefined || format.height === preferences.video_height);
  if (preferences.video_height !== undefined && !videoFormats.length) throw new EngineError('VIDEO_QUALITY_UNAVAILABLE', `来源没有可取得的 ${preferences.video_height}p 视频；未使用其他画质代替`);
  const video = videoFormats.sort((a, b) => {
    const score = (f: EngineFormat): number => Math.min(f.height ?? 0, 1080) * 10 + (/^(avc1|h264)/.test(f.vcodec ?? '') ? 100 : 0) - Math.max(0, (f.height ?? 0) - 1080);
    return score(b) - score(a) || (b.tbr ?? 0) - (a.tbr ?? 0);
  })[0];
  if (!video) throw new EngineError('VIDEO_NOT_AVAILABLE', '当前来源没有可取得的视频流');
  return hasAudio(video) || !audio[0] ? [video] : [video, audio[0]];
}

interface CachedInput { name: string; size: number; sha256: string }
interface InputCache { source_key: string; files: CachedInput[]; duration?: number; source_asset_id?: string; bounded_engine_item?: boolean }
export interface DownloadMediaOptions {
  kind: 'audio' | 'video'; pageUrl: string; assets: SourceAsset[]; useEngine: boolean;
  workspace: string; policy: NetworkPolicy; signal?: AbortSignal; tools?: MediaTools;
  preferences?: SavePreferences;
  onInputs?: (paths: string[]) => Promise<void>;
  onTemporaryFile?: (file: { path: string; size: number; sha256: string }) => Promise<void>;
}

async function loadInputs(directory: string, key: string): Promise<InputCache | undefined> {
  try {
    const cache = JSON.parse(await readFile(join(directory, 'inputs.json'), 'utf8')) as InputCache;
    if (cache.source_key !== key || !Array.isArray(cache.files) || !cache.files.length || cache.files.length > 2) return undefined;
    for (const file of cache.files) {
      if (basename(file.name) !== file.name || !/^input-[a-zA-Z0-9-]+\.bin$/.test(file.name)) return undefined;
      const actual = await hashFile(join(directory, file.name));
      if (actual.sha256 !== file.sha256 || actual.size !== file.size) return undefined;
    }
    return cache;
  } catch { return undefined; }
}

function inputKey(pageUrl: string, kind: 'audio' | 'video', preferences: SavePreferences = {}): string {
  return createHash('sha256').update(redactUrl(pageUrl) + ':' + kind + (kind === 'video' && preferences.video_height !== undefined ? `:${preferences.video_height}p` : '')).digest('hex');
}

export async function hasVerifiedMediaInputs(workspace: string, kind: 'audio' | 'video', pageUrl: string, preferences?: SavePreferences): Promise<boolean> {
  const key = inputKey(pageUrl, kind, preferences);
  return Boolean(await loadInputs(join(workspace, kind), key));
}

/** Inputs are checkpointed before ffprobe/ffmpeg, so installing a dependency can resume without downloading again. */
export async function downloadMedia(options: DownloadMediaOptions): Promise<{ path: string; mediaType: string; probe: MediaProbe; sourceAssetId?: string; notes: string[]; processing: NonNullable<Artifact['media_processing']>; validation: NonNullable<Artifact['media_validation']> }> {
  const { kind, policy, signal, tools = {}, preferences = {} } = options;
  const directory = join(options.workspace, kind); await mkdir(directory, { recursive: true, mode: 0o700 });
  const actual = await realpath(directory); const rel = relative(await realpath(options.workspace), actual);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new EngineError('UNSAFE_PATH', '媒体临时目录超出任务范围');
  const key = inputKey(options.pageUrl, kind, preferences);
  let cache = await loadInputs(directory, key);
  const notes: string[] = [];
  if (!cache) {
    if (await lstat(join(directory, 'inputs.json')).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }))
      throw new EngineError('MEDIA_CHECKPOINT_CHANGED', '已有媒体检查点未通过校验，已保留其中的文件；请新建任务重新获取');
    const files: CachedInput[] = [];
    let duration: number | undefined; let sourceAssetId: string | undefined; let boundedEngineItem = false;
    const record = async (path: string): Promise<void> => {
      const actual = await hashFile(path); files.push({ name: basename(path), ...actual });
      await options.onTemporaryFile?.({ path, ...actual });
    };
    const direct = options.assets.filter(a => a.availability === 'available' && /^https?:\/\//.test(a.url) && (a.role === kind || (kind === 'audio' && a.role === 'video')))
      .sort((a, b) => Number(a.role !== kind) - Number(b.role !== kind) || (b.width ?? 0) - (a.width ?? 0))[0];
    let directError: unknown;
    if (direct && !(kind === 'video' && options.useEngine)) {
      const path = join(directory, `input-${randomBytes(8).toString('hex')}.bin`);
      try {
        if (/\.(m3u8|mpd)(?:\?|$)/i.test(direct.url) || /mpegurl|dash\+xml/i.test(direct.media_type ?? '')) {
          const info = await inspectPlatformMedia(direct.url, policy, signal, tools);
          const formats = selectedFormats(info, kind, preferences);
          for (const format of formats) {
            const input = join(directory, `input-${randomBytes(8).toString('hex')}.bin`);
            await engineRun(direct.url, ['--no-simulate', '--no-overwrites', '-f', format.format_id, '-o', input], { ...policy, maxBytes: (policy.maxBytes ?? 1024 ** 3) - files.reduce((n, f) => n + f.size, 0) }, signal, tools); await record(input);
          }
          duration = info.duration;
        } else { await downloadFile(direct.url, path, policy, signal, { referer: options.pageUrl }); await record(path); }
        duration ??= direct.duration_seconds; sourceAssetId = direct.id;
      } catch (error) {
        if (signal?.aborted || error instanceof EngineError && (error.code === 'RATE_LIMITED' || error.code === 'SERVICE_UNAVAILABLE')) throw error;
        directError = error; files.length = 0;
      }
    }
    if (!files.length) {
      if (!options.useEngine) throw directError ?? new EngineError('MEDIA_UNAVAILABLE', '没有取得可下载的媒体资源，当前适配器需要补充或登录后重试');
      const info = await inspectPlatformMedia(options.pageUrl, policy, signal, tools);
      for (const format of selectedFormats(info, kind, preferences)) {
        const input = join(directory, `input-${randomBytes(8).toString('hex')}.bin`);
        await engineRun(options.pageUrl, ['--no-simulate', '--no-overwrites', '-f', format.format_id, '-o', input], { ...policy, maxBytes: (policy.maxBytes ?? 1024 ** 3) - files.reduce((n, f) => n + f.size, 0) }, signal, tools); await record(input);
      }
      duration = info.duration;
      boundedEngineItem = Boolean(info.id && Number.isFinite(info.duration) && info.duration! > 0);
      if (directError) notes.push('直接媒体地址失败，使用平台媒体引擎取得同一内容。');
    }
    cache = { source_key: key, files, duration, source_asset_id: sourceAssetId, bounded_engine_item: boundedEngineItem };
    await writeFile(join(directory, 'inputs.json'), JSON.stringify(cache), { flag: 'wx', mode: 0o600 });
  } else notes.push('复用已校验的媒体输入，未重复下载。');
  const inputs = cache.files.map(file => join(directory, file.name));
  for (const file of cache.files) await options.onTemporaryFile?.({ path: join(directory, file.name), size: file.size, sha256: file.sha256 });
  await options.onTemporaryFile?.({ path: join(directory, 'inputs.json'), ...await hashFile(join(directory, 'inputs.json')) });
  await options.onInputs?.(inputs);
  const probes = await Promise.all(inputs.map(path => probeMedia(path, signal, tools)));
  const videoIndex = probes.findIndex(p => p.video); const audioIndex = probes.findIndex(p => p.audio);
  if (kind === 'audio' && audioIndex < 0) throw new EngineError('AUDIO_NOT_PRESENT', '当前媒体没有声音，不能交付为音频');
  if (kind === 'video' && videoIndex < 0) throw new EngineError('VIDEO_NOT_PRESENT', '当前媒体没有画面，不能交付为视频');
  if (kind === 'video' && preferences.video_height !== undefined && probes[videoIndex]!.video!.height !== preferences.video_height)
    throw new EngineError('VIDEO_QUALITY_UNAVAILABLE', `实际视频为 ${probes[videoIndex]!.video!.height}p，未满足指定的 ${preferences.video_height}p`);
  const sourceDuration = cache.duration ?? probes[kind === 'audio' ? audioIndex : videoIndex]!.duration;
  const clip = preferences.clip;
  if (clip && (!Number.isFinite(clip.start_seconds) || !Number.isFinite(clip.end_seconds) || clip.start_seconds < 0 || clip.end_seconds <= clip.start_seconds || clip.end_seconds > sourceDuration + 0.05))
    throw new EngineError('CLIP_OUT_OF_RANGE', '指定片段超出来源时长或范围无效；未替换为其他片段');
  const format = kind === 'audio' ? preferences.audio_format ?? 'm4a' : preferences.video_format ?? 'mp4';
  const output = join(directory, `result-${randomBytes(8).toString('hex')}.${format}`);
  const processing: NonNullable<Artifact['media_processing']> = {
    output_container: format,
    input_count: inputs.length,
    extracted_audio: kind === 'audio' && Boolean(probes[audioIndex]?.video),
    merged_tracks: kind === 'video' && audioIndex >= 0 && audioIndex !== videoIndex,
    ...(clip ? { clip: { start_seconds: clip.start_seconds, end_seconds: clip.end_seconds } } : {}),
  };
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-n'];
  for (const input of inputs) args.push('-protocol_whitelist', 'file,pipe', '-i', input);
  if (clip) args.push('-ss', String(clip.start_seconds), '-t', String(clip.end_seconds - clip.start_seconds));
  if (kind === 'audio') {
    const codec = format === 'mp3' ? 'libmp3lame' : format === 'wav' ? 'pcm_s16le' : format === 'flac' ? 'flac' : !clip && probes[audioIndex]!.audio!.codec === 'aac' ? 'copy' : 'aac';
    processing.audio = codec === 'copy' ? 'copy' : 'transcode';
    args.push('-map', `${audioIndex}:a:0`, '-vn', '-c:a', codec);
    if (codec === 'aac' || codec === 'libmp3lame') args.push('-b:a', '192k');
    args.push('-f', format === 'm4a' ? 'ipod' : format);
  } else {
    const copy = !clip && probes[videoIndex]!.video!.codec === 'h264';
    processing.video = copy ? 'copy' : 'transcode';
    args.push('-map', `${videoIndex}:v:0`, '-c:v', copy ? 'copy' : 'libx264');
    if (!copy) args.push('-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
    if (audioIndex >= 0) {
      const copyAudio = !clip && probes[audioIndex]!.audio!.codec === 'aac';
      processing.audio = copyAudio ? 'copy' : 'transcode';
      args.push('-map', `${audioIndex}:a:0`, '-c:a', copyAudio ? 'copy' : 'aac');
      if (!copyAudio) args.push('-b:a', '192k');
    } else notes.push('来源视频未包含音频轨道。');
    args.push('-f', format === 'mkv' ? 'matroska' : 'mp4');
  }
  args.push('-map_metadata', '-1');
  if (format === 'm4a' || format === 'mp4') args.push('-movflags', '+faststart');
  args.push(output);
  try {
    await runProcess(tools.ffmpeg ?? 'ffmpeg', args, { signal, timeoutMs: 30 * 60_000, dependency: 'ffmpeg' });
    const probe = await probeMedia(output, signal, tools);
    const expected = clip ? clip.end_seconds - clip.start_seconds : sourceDuration;
    if (Math.abs(probe.duration - expected) > Math.max(clip ? 0.15 : 0.2, Math.min(2, expected * 0.02))) throw new EngineError('DURATION_MISMATCH', '结果时长与请求范围不一致，需要检查下载完整性');
    if (kind === 'audio' && (!probe.audio || probe.video)) throw new EngineError('INVALID_AUDIO_OUTPUT', '音频输出的实际内容不符合请求');
    if (kind === 'video' && (!probe.video || (audioIndex >= 0 && !probe.audio))) throw new EngineError('INVALID_VIDEO_OUTPUT', '视频输出缺少预期画面或声音');
    const decoded = await runProcess(tools.ffmpeg ?? 'ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-protocol_whitelist', 'file,pipe', '-i', output, '-f', 'null', '-'], { signal, timeoutMs: 30 * 60_000, dependency: 'ffmpeg' });
    if (decoded.stderr.trim()) throw new EngineError('MEDIA_DECODE_FAILED', '完整解码检查发现媒体错误');
    await options.onTemporaryFile?.({ path: output, ...await hashFile(output) });
    if (clip) notes.push(`按明确请求保存 ${clip.start_seconds}–${clip.end_seconds} 秒片段，保持正常播放速度。`);
    const mediaType = kind === 'video' ? format === 'mkv' ? 'video/x-matroska' : 'video/mp4' : format === 'm4a' ? 'audio/mp4' : format === 'mp3' ? 'audio/mpeg' : format === 'wav' ? 'audio/wav' : 'audio/flac';
    return { path: output, mediaType, probe, sourceAssetId: cache.source_asset_id, notes, processing,
      validation: { full_decode: true, expected_duration_seconds: expected, source_duration_verified: Number.isFinite(cache.duration) && cache.duration! > 0, bounded_engine_item: cache.bounded_engine_item === true } };
  } catch (error) { await unlink(output).catch(() => undefined); throw error; }
}
