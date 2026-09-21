import { createReadStream } from 'node:fs';
import { mkdir, lstat, realpath, open, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { basename, extname, join, relative, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AdapterRegistry, Artifact, CollectionExecutor, CollectRequest, ContentSnapshot, JobRecord, SaveComponent, SourceAsset } from '../../shared/contracts.js';
import type { BrowserBridge } from '../bridge/server.js';
import type { ClientGrant, RuntimeConfig } from '../policy/config.js';
import { assertAuthorizedDirectory, createJobWorkspace, safeFileStem } from '../policy/output.js';
import { redactSensitiveText, redactUrl, sanitizeSnapshot } from '../storage/job-store.js';
import { cleanupTemporaryFiles } from '../storage/temporary-files.js';
import { downloadFile, type NetworkPolicy } from '../engines/network.js';
import { downloadMedia, hasVerifiedMediaInputs, hashFile, inspectPlatformMedia, subtitleAssets, type MediaTools } from '../engines/media.js';
import { EngineError, safeMessage } from '../engines/process.js';
import { renderBundleEntry, renderDocument } from './document.js';
import { selectSubtitleLanguages, validateSavePreferences } from './preferences.js';
import { requestedComponents, requiredResultSelection } from './selection.js';
import { assetSourceFingerprint, mediaSourceFingerprint } from './provenance.js';
import { validateSubtitleAsset } from './subtitle-validation.js';
import { validateDocumentAsset } from './document-validation.js';
import { validateImageAsset } from './image-validation.js';
import { evaluateContentCompleteness, type CompletenessBinding } from '../../shared/completeness.js';
import { contentBlockHasText } from '../../shared/content-blocks.js';
import { canFallbackToBrowser, captureWebPage, requiresWebMediaHandling, shouldCaptureWebPage, webPageAdapter } from '../web/http-capture.js';
export { requestedComponents } from './selection.js';

const COMPONENT_ROLE: Record<Exclude<SaveComponent, 'text'>, SourceAsset['role']> = { images: 'image', video: 'video', audio: 'audio', subtitles: 'subtitle', cover: 'cover', files: 'file' };
const hasText = (snapshot: ContentSnapshot): boolean => [...snapshot.blocks, ...(snapshot.relations ?? []).flatMap(relation => relation.blocks)].some(contentBlockHasText);
const allAssets = (snapshot: ContentSnapshot): SourceAsset[] => [
  ...[...snapshot.assets].sort((a, b) => a.order - b.order),
  ...[...(snapshot.relations ?? [])].sort((a, b) => a.order - b.order).flatMap(relation => [...relation.assets].sort((a, b) => a.order - b.order)),
];
const METADATA_DELIVERABLE_ROLES = new Set(['text', 'entry', 'image', 'video', 'audio', 'subtitle', 'cover', 'file']);

/** Safe, local evidence for files already hash-verified inside the result root. */
async function metadataDeliverables(artifacts: Artifact[], root: string) {
  const actualRoot = await realpath(root);
  return Promise.all(artifacts.filter(artifact => METADATA_DELIVERABLE_ROLES.has(artifact.role)).map(async artifact => {
    const path = relative(actualRoot, await realpath(artifact.path));
    if (!path || path.startsWith('..') || isAbsolute(path)) throw new EngineError('UNSAFE_PATH', '交付文件超出任务结果目录');
    return {
      role: artifact.role,
      path,
      media_type: redactSensitiveText(artifact.media_type),
      size: artifact.size,
      sha256: artifact.sha256,
      ...(artifact.duration_seconds !== undefined && Number.isFinite(artifact.duration_seconds) ? { duration_seconds: artifact.duration_seconds } : {}),
      ...(artifact.width !== undefined && Number.isFinite(artifact.width) ? { width: artifact.width } : {}),
      ...(artifact.height !== undefined && Number.isFinite(artifact.height) ? { height: artifact.height } : {}),
      ...(artifact.language ? { language: redactSensitiveText(artifact.language) } : {}),
      ...(artifact.media_processing ? { media_processing: {
        output_container: artifact.media_processing.output_container,
        input_count: artifact.media_processing.input_count,
        ...(artifact.media_processing.audio ? { audio: artifact.media_processing.audio } : {}),
        ...(artifact.media_processing.video ? { video: artifact.media_processing.video } : {}),
        extracted_audio: artifact.media_processing.extracted_audio,
        merged_tracks: artifact.media_processing.merged_tracks,
        ...(artifact.media_processing.clip ? { clip: {
          start_seconds: artifact.media_processing.clip.start_seconds,
          end_seconds: artifact.media_processing.clip.end_seconds,
        } } : {}),
      } } : {}),
      ...(artifact.media_validation && Number.isFinite(artifact.media_validation.expected_duration_seconds) ? { media_validation: {
        full_decode: artifact.media_validation.full_decode,
        expected_duration_seconds: artifact.media_validation.expected_duration_seconds,
        source_duration_verified: artifact.media_validation.source_duration_verified,
        bounded_engine_item: artifact.media_validation.bounded_engine_item,
      } } : {}),
    };
  }));
}

export interface CollectionOptions {
  bridge: Pick<BrowserBridge, 'capture'>;
  registry: AdapterRegistry;
  config: RuntimeConfig;
  clientForId?: (id: string) => ClientGrant | undefined;
  /** Executable overrides are trusted deployment configuration, never MCP parameters. */
  mediaTools?: MediaTools;
}

/**
 * `new` applies to the first capture of a URL task. An automatic retry keeps
 * the same job id and may reuse only the extension-owned tab for that job,
 * instance, adapter, and content. The stored user request stays unchanged.
 */
function captureRequestForRun(job: JobRecord): CollectRequest {
  if (job.request.target.type !== 'url' || job.request.browser?.tab_strategy !== 'new' || (job.automatic_retries ?? 0) === 0) return job.request;
  return { ...job.request, browser: { ...job.request.browser, tab_strategy: 'auto' } };
}

/** The raw URL is available only for the current in-memory run. */
function taskAccessUrl(job: JobRecord): string | undefined {
  return job.request.target.type === 'url' ? job.request.target.url : undefined;
}

function mediaGroups(snapshot: ContentSnapshot, kind: 'video' | 'audio'): { id: string; assets: SourceAsset[]; suffix: string }[] {
  let assets = allAssets(snapshot).filter(a => a.role === kind && a.availability !== 'not_present');
  if (kind === 'audio' && !assets.length) assets = allAssets(snapshot).filter(a => a.role === 'video' && a.availability !== 'not_present');
  if (assets.length <= 1) return [{ id: assets[0]?.id ?? `page-${kind}`, assets: allAssets(snapshot), suffix: '' }];
  return assets.map((asset, index) => ({ id: asset.id, assets: [asset], suffix: `${kind}-${index}` }));
}

function mediaCacheKey(kind: 'video' | 'audio', groupId: string, sourceFingerprint: string): string {
  return `${kind}:${encodeURIComponent(groupId)}:${sourceFingerprint}`;
}

function mediaCacheWorkspace(workspace: string, suffix: string, sourceFingerprint: string): string {
  return join(workspace, suffix, `source-${sourceFingerprint}`);
}

function sourceFingerprints(snapshot: ContentSnapshot): Map<string, string> {
  const current = new Map(allAssets(snapshot).map(asset => [`${asset.role}:${asset.id}`, assetSourceFingerprint(asset)]));
  for (const kind of ['video', 'audio'] as const) {
    for (const group of mediaGroups(snapshot, kind)) current.set(`${kind}:${group.id}`, mediaSourceFingerprint(kind, group.id, group.assets, snapshot.source_url));
  }
  return current;
}

/** A verified bounded media item can fulfill audio/video without proving unrelated page text. */
export function requestedResultComplete(snapshot: ContentSnapshot, components: SaveComponent[], completed: Set<SaveComponent>, artifacts: Artifact[], binding?: CompletenessBinding): boolean {
  const evaluation = evaluateContentCompleteness(snapshot, binding);
  const sourceComplete = evaluation.valid && evaluation.complete;
  return components.length > 0 && components.every(component => {
    if (!completed.has(component)) return false;
    if (sourceComplete) return true;
    if (component !== 'audio' && component !== 'video') return false;
    const groups = mediaGroups(snapshot, component);
    const outputs = artifacts.filter(artifact => artifact.role === component);
    return groups.length === 1 && outputs.length === 1 && outputs.every(artifact => artifact.media_validation?.full_decode
      && artifact.media_validation.source_duration_verified && artifact.media_validation.bounded_engine_item);
  });
}

async function createResultRoot(parent: string, title: string, collision: 'version' | 'fail'): Promise<string> {
  const stem = safeFileStem(title);
  for (let version = 1; version <= 1000; version++) {
    const path = join(parent, version === 1 ? stem : `${stem} (${version})`);
    try { await mkdir(path, { mode: 0o700 }); return path; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (collision === 'fail') throw new EngineError('OUTPUT_EXISTS', '同名结果已存在，已保留原有文件'); }
  }
  throw new EngineError('OUTPUT_EXISTS', '可用文件版本数量超过上限');
}

async function safeOwnRoot(path: string, roots: string[]): Promise<string> {
  const allowed = await assertAuthorizedDirectory(path, roots);
  const stat = await lstat(allowed);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new EngineError('UNSAFE_PATH', '任务目录发生变化，已停止写入');
  return realpath(allowed);
}

async function verifyExisting(artifact: Artifact, root: string): Promise<boolean> {
  try {
    const path = await realpath(artifact.path); const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) return false;
    const actual = await hashFile(artifact.path);
    return actual.size === artifact.size && actual.sha256 === artifact.sha256;
  } catch { return false; }
}

async function validateReusableSourceArtifact(artifact: Artifact, snapshot: ContentSnapshot, signal: AbortSignal): Promise<boolean> {
  if (!['subtitle', 'file', 'image', 'cover'].includes(artifact.role)) return true;
  if (!artifact.source_asset_id) return false;
  const asset = allAssets(snapshot).find(candidate => candidate.id === artifact.source_asset_id && candidate.role === artifact.role);
  if (!asset) return false;
  try {
    const validated = artifact.role === 'subtitle'
      ? await validateSubtitleAsset(artifact.path, asset, artifact.media_type, signal)
      : artifact.role === 'file'
        ? await validateDocumentAsset(artifact.path, asset, artifact.media_type, signal)
        : await validateImageAsset(artifact.path, signal);
    return extname(artifact.path).slice(1).toLowerCase() === validated.extension
      && artifact.media_type.split(';')[0]!.trim().toLowerCase() === validated.mediaType;
  } catch (error) {
    if (signal.aborted || error instanceof EngineError && error.code === 'CANCELLED') throw error;
    if (!(error instanceof EngineError)) throw error;
    return false;
  }
}

async function atomicText(path: string, value: string, previous?: Artifact): Promise<void> {
  try {
    const existing = await hashFile(path);
    if (!previous || existing.sha256 !== previous.sha256 || existing.size !== previous.size) {
      // An interrupted checkpoint may leave the exact deterministic file. Reuse it without writing.
      if (existing.size === Buffer.byteLength(value) && await readFile(path, 'utf8') === value) return;
      throw new EngineError('OUTPUT_CHANGED', '已有文件与任务记录不一致，已保留用户内容；请建立新的版本任务');
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, value, { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}

async function copyArtifact(source: string, target: string, signal: AbortSignal): Promise<void> {
  const handle = await open(target, 'wx', 0o600);
  try { await pipeline(createReadStream(source), handle.createWriteStream(), { signal }); }
  catch (error) { await handle.close().catch(() => undefined); await rm(target, { force: true }); throw error; }
}

async function detectAsset(path: string, asset: SourceAsset, declared: string, signal?: AbortSignal): Promise<{ extension: string; mediaType: string; width?: number; height?: number }> {
  if (asset.role === 'subtitle') return validateSubtitleAsset(path, asset, declared, signal);
  if (asset.role === 'image' || asset.role === 'cover') return validateImageAsset(path, signal);
  return validateDocumentAsset(path, asset, declared, signal);
}

export function createCollectionExecutor(options: CollectionOptions): CollectionExecutor {
  return { async execute(job, signal, checkpoint) {
    const grant = options.clientForId?.(job.client_id) ?? options.config.clients.find(c => c.id === job.client_id);
    if (!grant) throw new EngineError('CLIENT_NOT_AUTHORIZED', '当前客户端未授权');
    const parent = await assertAuthorizedDirectory(job.request.output.directory, grant.output_roots);
    const workspace = await createJobWorkspace(parent, grant.output_roots, job.id);
    const completed = new Set<SaveComponent>(job.checkpoint?.completed_components ?? []);
    const failed: Record<string, string> = {};
    const mediaFiles: Record<string, string[]> = { ...job.checkpoint?.media_files };
    const temporaryArtifacts = new Map((job.checkpoint?.temporary_artifacts ?? []).map(file => [file.path, file]));
    const previous = job.snapshot;
    const previousRoot = job.artifact_root ? await safeOwnRoot(job.artifact_root, grant.output_roots) : undefined;
    const reusableSourceArtifacts = new Map<string, boolean>();
    const previousAdapter = previous ? webPageAdapter(previous) ?? options.registry.match(new URL(previous.canonical_url)) : undefined;
    const previousComponents = previous ? requestedComponents(job.request, previous, previousAdapter) : [];
    let resumeLocal = !!previous && previousComponents.length > 0 && previousComponents.every(c => completed.has(c) || !!mediaFiles[c]?.length);
    if (resumeLocal && previous && previousComponents.every(component => completed.has(component))
      && !requestedResultComplete(previous, previousComponents, completed, job.artifacts)) resumeLocal = false;
    if (resumeLocal && previous) {
      for (const component of previousComponents) {
        if (!completed.has(component) && (component === 'video' || component === 'audio')) {
          for (const group of mediaGroups(previous, component)) {
            const prefix = `${component}:${encodeURIComponent(group.id)}:`;
            const keys = Object.keys(mediaFiles).filter(key => key.startsWith(prefix) && /^[a-f0-9]{64}$/.test(key.slice(prefix.length)));
            if (keys.length !== 1 || !await hasVerifiedMediaInputs(mediaCacheWorkspace(workspace, group.suffix, keys[0]!.slice(prefix.length)), component, previous.source_url, job.request.preferences)) resumeLocal = false;
          }
        }
      }
      for (const artifact of job.artifacts) {
        const reusable = !!previousRoot && await verifyExisting(artifact, previousRoot)
          && await validateReusableSourceArtifact(artifact, previous, signal);
        reusableSourceArtifacts.set(artifact.path, reusable);
        if (!reusable) resumeLocal = false;
      }
    }
    if (!resumeLocal && job.checkpoint?.requires_fresh_url && job.request.target.type === 'url' && job.request.target.url === redactUrl(job.request.target.url)) {
      throw new EngineError('FRESH_URL_REQUIRED', '本地检查点不完整，需要同一内容的新链接以重新识别来源', true);
    }
    const existingAdapter = job.request.target.type === 'url' ? options.registry.match(new URL(job.request.target.url)) : undefined;
    let snapshot: ContentSnapshot;
    if (resumeLocal && previous) snapshot = previous;
    else if (shouldCaptureWebPage(job.request, existingAdapter)) {
      try {
        snapshot = await captureWebPage(job.request, { dnsMode: options.config.dns_mode, allowTestOrigins: options.config.fixture_origins }, signal);
      } catch (httpError) {
        if (!existingAdapter || !canFallbackToBrowser(httpError) || signal.aborted) throw httpError;
        const httpCode = (httpError as { code: string }).code;
        try {
          snapshot = await options.bridge.capture(job.request.target, captureRequestForRun(job), signal, job.id, { web_document: true });
          snapshot.warnings = [...snapshot.warnings, `HTTP_FALLBACK:${httpCode}`];
        } catch (browserError) {
          const failure = browserError as { code?: string; retryable?: boolean };
          throw new EngineError(failure.code ?? 'WEB_BROWSER_FAILED', `HTTP 获取未完成（${httpCode}）；${safeMessage(browserError)}`, failure.retryable === true);
        }
      }
    } else snapshot = await options.bridge.capture(job.request.target, captureRequestForRun(job), signal, job.id);
    if (!resumeLocal && existingAdapter && requiresWebMediaHandling(job.request, snapshot)) {
      snapshot = await options.bridge.capture(job.request.target, captureRequestForRun(job), signal, job.id, { platform_media: true });
    }
    const freshlyCaptured = !resumeLocal;
    if (snapshot.access_class === 'paid' || snapshot.access_class === 'private') throw new EngineError('CONTENT_OUT_OF_SCOPE', '当前来源不属于免费公开内容范围');
    if (snapshot.access_class === 'unknown') throw new EngineError('ACCESS_UNCONFIRMED', '尚未确认来源访问条件，需要完成页面识别后重试', true);
    const adapter = webPageAdapter(snapshot) ?? options.registry.match(new URL(snapshot.canonical_url));
    if (!adapter || adapter.id !== snapshot.platform) throw new EngineError('SOURCE_MISMATCH', '返回内容与平台任务范围不一致');
    const completenessBinding: CompletenessBinding = {
      adapter,
      urls: [new URL(snapshot.source_url), new URL(snapshot.canonical_url), ...(job.request.target.type === 'url' ? [new URL(job.request.target.url)] : [])],
    };
    const completeness = evaluateContentCompleteness(snapshot, completenessBinding);
    if (!completeness.valid) throw new EngineError('COMPLETENESS_PROOF_INVALID', `来源完整性证明未通过验证（${completeness.issue.code}）`);
    if ((snapshot.relations?.length ?? 0) > (job.request.limits?.max_related_items ?? 0)) throw new EngineError('RELATED_SCOPE_EXCEEDED', '返回的关联内容超过明确指定的范围');
    if (new Set(allAssets(snapshot).map(asset => asset.id)).size !== allAssets(snapshot).length) throw new EngineError('ASSET_ID_COLLISION', '目标与关联内容的资源标识重复，无法可靠保存对应关系');
    for (const relation of snapshot.relations ?? []) if (options.registry.match(new URL(relation.source_url))?.id !== adapter.id) throw new EngineError('RELATED_SOURCE_MISMATCH', '关联内容超出当前平台的已适配范围');
    const selection = requiredResultSelection(job.request, snapshot);
    if (selection) return {
      status: 'blocked', stage: 'resolving', snapshot, selection_required: selection,
      error: { code: 'SELECTION_REQUIRED', message: selection.prompt, retryable: false },
      checkpoint: { ...job.checkpoint, workspace },
      completeness: { requested_components_complete: false, scope: snapshot.relations?.length ? 'bounded_related' : 'single_item' },
    };
    const sourceUrl = snapshot.source_url;
    const currentSources = sourceFingerprints(snapshot);
    if (freshlyCaptured) {
      // Drop only checkpoint references. Old media inputs remain untouched, but cannot be
      // selected for a newly observed resource with the same adapter asset ID.
      for (const kind of ['video', 'audio'] as const) {
        const currentKeys = new Set(mediaGroups(snapshot, kind).map(group => mediaCacheKey(kind, group.id, mediaSourceFingerprint(kind, group.id, group.assets, sourceUrl))));
        for (const key of Object.keys(mediaFiles)) if (key.startsWith(`${kind}:`) && !currentKeys.has(key)) delete mediaFiles[key];
        const retained = [...currentKeys].flatMap(key => mediaFiles[key] ?? []);
        if (retained.length) mediaFiles[kind] = retained;
        else delete mediaFiles[kind];
      }
    }
    const maxBytes = Math.min(job.request.limits?.max_bytes ?? 1024 ** 3, 8 * 1024 ** 3);
    const fixtureOrigins = ['development_fixture', 'web_page'].includes(adapter.id) && options.config.fixture_origins.includes(new URL(sourceUrl).origin) ? [new URL(sourceUrl).origin] : [];
    const basePolicy: NetworkPolicy = { ...(adapter.id === 'web_page' ? { publicWeb: true } : {}), allowedHosts: [...adapter.hosts, ...(adapter.asset_hosts ?? [])], extraHttpsPorts: adapter.asset_https_ports, allowTestOrigins: fixtureOrigins, maxBytes, dnsMode: options.config.dns_mode };
    let root = previousRoot ?? await createResultRoot(parent, redactSensitiveText(snapshot.title ?? `${snapshot.platform}-${job.id.slice(-8)}`), job.request.output.collision_policy ?? 'version');
    const assetsDirectory = join(root, 'assets'); await mkdir(assetsDirectory, { recursive: true, mode: 0o700 });
    await safeOwnRoot(assetsDirectory, [root]);
    let artifacts: Artifact[] = [];
    let staleSourceArtifacts = 0;
    let invalidLocalArtifacts = 0;
    for (const artifact of job.artifacts) {
      if (freshlyCaptured && artifact.source_asset_id && (!artifact.source_fingerprint || currentSources.get(`${artifact.role}:${artifact.source_asset_id}`) !== artifact.source_fingerprint)) {
        const invalidLocal = reusableSourceArtifacts.get(artifact.path) === false
          && ['subtitle', 'file', 'image', 'cover'].includes(artifact.role)
          && await lstat(artifact.path).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; });
        if (invalidLocal) invalidLocalArtifacts++;
        else staleSourceArtifacts++;
        continue;
      }
      if (await verifyExisting(artifact, root)
        && (reusableSourceArtifacts.get(artifact.path) ?? await validateReusableSourceArtifact(artifact, snapshot, signal))) artifacts.push(artifact);
      else {
        const exists = await lstat(artifact.path).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; });
        if (exists && ['subtitle', 'file', 'image', 'cover'].includes(artifact.role)) invalidLocalArtifacts++;
        if (exists && !['subtitle', 'file', 'image', 'cover'].includes(artifact.role)) throw new EngineError('OUTPUT_CHANGED', '已保存文件被修改，任务不会覆盖该文件；请建立新版本');
      }
    }
    for (const component of completed) if (!artifacts.some(a => a.role === component || (component !== 'text' && a.role === COMPONENT_ROLE[component]))) completed.delete(component);
    if (!resumeLocal) {
      for (const component of completed) {
        if (component === 'text') { completed.delete(component); continue; }
        const expected = component === 'audio' || component === 'video' ? mediaGroups(snapshot, component).map(group => group.id)
          : allAssets(snapshot).filter(asset => asset.role === COMPONENT_ROLE[component] && asset.availability !== 'not_present').map(asset => asset.id);
        if (!expected.length || expected.some(id => !artifacts.some(artifact => artifact.source_asset_id === id))) completed.delete(component);
      }
    }
    const warnings = [...new Set([...job.warnings, ...snapshot.warnings].map(redactSensitiveText))];
    if (staleSourceArtifacts) warnings.push(`重新识别来源后，${staleSourceArtifacts} 项旧资源已从本次交付关系中移除；原文件保留。`);
    if (invalidLocalArtifacts) warnings.push(`本地复核未通过的 ${invalidLocalArtifacts} 项旧图片、封面、字幕或附件已从本次交付清单移除；原文件保留并重新获取。`);
    const save = async (stage: JobRecord['stage']): Promise<void> => {
      if (signal.aborted) throw new EngineError('CANCELLED', '任务已取消');
      await checkpoint({ status: stage, stage, snapshot, artifact_root: root, artifacts: [...artifacts], warnings: [...warnings], checkpoint: { ...job.checkpoint, workspace, completed_components: [...completed], failed_components: { ...failed }, media_files: { ...mediaFiles }, temporary_artifacts: [...temporaryArtifacts.values()] } });
    };
    const recordTemporary = async (file: { path: string; size: number; sha256: string }): Promise<void> => {
      const previousFile = temporaryArtifacts.get(file.path);
      if (previousFile && (previousFile.sha256 !== file.sha256 || previousFile.size !== file.size)) throw new EngineError('TEMPORARY_FILE_CHANGED', '媒体临时文件已被修改，已保留文件；请新建任务重新获取');
      temporaryArtifacts.set(file.path, file); await save('downloading');
    };
    await save('collecting');
    const components = requestedComponents(job.request, snapshot, adapter);
    if (!components.length) throw new EngineError('CONTENT_UNAVAILABLE', '当前页面没有可确认的正文或媒体');
    validateSavePreferences(job.request.preferences, components);
    const inlineSubtitles = new Map<string, string>();
    let firstError: EngineError | undefined;
    const subtitleSelection = selectSubtitleLanguages(allAssets(snapshot).filter(asset => !asset.id.startsWith('engine-subtitle-')), job.request.preferences?.subtitle_languages);
    if (components.includes('subtitles') && !completed.has('subtitles') && (!subtitleSelection.selected.length || subtitleSelection.missing.length > 0) && adapter.engine === 'yt-dlp') {
      try {
        const info = await inspectPlatformMedia(sourceUrl, basePolicy, signal, options.mediaTools);
        snapshot = { ...snapshot, assets: [...snapshot.assets.filter(a => !a.id.startsWith('engine-subtitle-')), ...subtitleAssets(info, sourceUrl, inlineSubtitles)] };
      } catch (error) { if (signal.aborted) throw error; firstError = error instanceof EngineError ? error : new EngineError('SUBTITLE_LOOKUP_FAILED', safeMessage(error), true); failed.subtitles = firstError.message; }
    }
    for (const component of components.filter(c => c !== 'text')) {
      if (firstError?.code === 'RATE_LIMITED' || firstError?.code === 'SERVICE_UNAVAILABLE') break;
      if (completed.has(component)) continue;
      await save('downloading');
      try {
        const used = artifacts.filter(a => !['metadata', 'manifest'].includes(a.role)).reduce((total, a) => total + a.size, 0);
        const policy = { ...basePolicy, maxBytes: maxBytes - used };
        if (policy.maxBytes <= 0) throw new EngineError('SIZE_LIMIT', '资料已达到任务容量预算');
        if (component === 'video' || component === 'audio') {
          const groups = mediaGroups(snapshot, component); const errors: EngineError[] = [];
          if (groups.length > (job.request.limits?.max_items ?? 100)) throw new EngineError('ITEM_LIMIT', '当前内容的媒体数量超过任务上限');
          for (const group of groups) {
            if (artifacts.some(a => a.role === component && a.source_asset_id === group.id)) continue;
            try {
              const cachePrefix = `${component}:${encodeURIComponent(group.id)}:`;
              const priorKey = !freshlyCaptured ? Object.keys(mediaFiles).find(key => key.startsWith(cachePrefix) && /^[a-f0-9]{64}$/.test(key.slice(cachePrefix.length))) : undefined;
              const sourceFingerprint = priorKey ? priorKey.slice(cachePrefix.length) : mediaSourceFingerprint(component, group.id, group.assets, sourceUrl);
              const cacheKey = mediaCacheKey(component, group.id, sourceFingerprint);
              const mediaWorkspace = mediaCacheWorkspace(workspace, group.suffix, sourceFingerprint); await mkdir(mediaWorkspace, { recursive: true, mode: 0o700 });
              const remaining = maxBytes - artifacts.filter(a => !['manifest', 'metadata'].includes(a.role)).reduce((n, a) => n + a.size, 0);
              const result = await downloadMedia({ kind: component, pageUrl: sourceUrl, assets: group.assets, useEngine: groups.length === 1 && !snapshot.relations?.length && adapter.engine === 'yt-dlp', workspace: mediaWorkspace, policy: { ...policy, maxBytes: remaining }, signal, tools: options.mediaTools, preferences: job.request.preferences, onTemporaryFile: recordTemporary,
                onInputs: async paths => { mediaFiles[cacheKey] = paths; mediaFiles[component] = Object.entries(mediaFiles).filter(([key]) => key.startsWith(`${component}:`)).flatMap(([, files]) => files); await save('finalizing'); } });
              const target = join(assetsDirectory, `${component}-${randomBytes(4).toString('hex')}${extname(result.path)}`);
              await copyArtifact(result.path, target, signal);
              const verified = await hashFile(target);
              if (verified.size > remaining) { await rm(target); throw new EngineError('SIZE_LIMIT', '处理后的媒体超出任务容量预算'); }
              artifacts.push({ role: component, path: target, media_type: result.mediaType, ...verified, source_asset_id: group.id, source_fingerprint: sourceFingerprint, duration_seconds: result.probe.duration, width: result.probe.video?.width, height: result.probe.video?.height, media_validation: result.validation, media_processing: result.processing });
              warnings.push(...result.notes); await save('collecting');
            } catch (error) {
              if (signal.aborted) throw error;
              const mapped = error instanceof EngineError ? error : new EngineError('MEDIA_FAILED', safeMessage(error), true);
              errors.push(mapped);
              if (mapped.code === 'RATE_LIMITED' || mapped.code === 'SERVICE_UNAVAILABLE') break;
            }
          }
          if (errors.length) throw errors.find(error => error.code === 'RATE_LIMITED' || error.code === 'SERVICE_UNAVAILABLE') ?? errors[0];
        } else {
          const subtitles = component === 'subtitles' ? selectSubtitleLanguages(allAssets(snapshot), job.request.preferences?.subtitle_languages) : undefined;
          let assets = subtitles?.selected ?? allAssets(snapshot).filter(a => a.role === COMPONENT_ROLE[component] && a.availability !== 'not_present');
          const selectedImages = component === 'images' ? job.request.preferences?.image_indices : undefined;
          if (selectedImages) {
            if (selectedImages.some(index => !Number.isInteger(index) || index < 1 || index > assets.length)) throw new EngineError('IMAGE_SELECTION_UNAVAILABLE', '未取得指定序号的图片；未改为下载其他图片');
            assets = assets.filter((_, index) => selectedImages.includes(index + 1));
          }
          if (!assets.length) throw component === 'subtitles' && firstError ? firstError : new EngineError(subtitles?.missing.length ? 'SUBTITLE_LANGUAGE_UNAVAILABLE' : 'COMPONENT_NOT_AVAILABLE', subtitles?.missing.length ? `未取得指定语言的字幕：${subtitles.missing.join('、')}` : `当前内容未取得 ${component} 的来源证据`);
          if (assets.length > (job.request.limits?.max_items ?? 100)) throw new EngineError('ITEM_LIMIT', `${component} 数量超过当前任务上限`);
          const assetErrors: EngineError[] = [];
          for (const asset of assets) {
            if (artifacts.some(a => a.source_asset_id === asset.id)) continue;
            try {
              if (asset.availability !== 'available') throw new EngineError('ASSET_UNAVAILABLE', asset.note ?? `资源状态：${asset.availability}`, asset.availability === 'blocked');
              const temp = join(workspace, `asset-${randomBytes(8).toString('hex')}.bin`);
              const remaining = maxBytes - artifacts.reduce((total, a) => total + a.size, 0);
              let downloaded;
              if (inlineSubtitles.has(asset.id)) {
                const data = inlineSubtitles.get(asset.id)!;
                if (Buffer.byteLength(data) > remaining) throw new EngineError('SIZE_LIMIT', '字幕超过剩余容量预算');
                await writeFile(temp, data, { flag: 'wx', mode: 0o600 });
                downloaded = { ...await hashFile(temp), mediaType: asset.media_type ?? 'text/plain' };
              } else downloaded = await downloadFile(asset.url, temp, { ...policy, maxBytes: remaining }, signal, { referer: redactUrl(sourceUrl) });
              await recordTemporary({ path: temp, size: downloaded.size, sha256: downloaded.sha256 });
              const detected = await detectAsset(temp, asset, downloaded.mediaType, signal);
              const target = join(assetsDirectory, `${component}-${String(asset.order + 1).padStart(3, '0')}-${randomBytes(4).toString('hex')}.${detected.extension}`);
              await copyArtifact(temp, target, signal); await rm(temp); temporaryArtifacts.delete(temp);
              artifacts.push({ role: asset.role, path: target, media_type: detected.mediaType, size: downloaded.size, sha256: downloaded.sha256, source_asset_id: asset.id, source_fingerprint: assetSourceFingerprint(asset), width: detected.width, height: detected.height, language: asset.language });
              await save('downloading');
            } catch (error) {
              if (signal.aborted) throw error;
              const mapped = error instanceof EngineError ? error : new EngineError('ASSET_FAILED', safeMessage(error), true);
              assetErrors.push(new EngineError(mapped.code, `${asset.id}: ${mapped.message}`, mapped.retryable, mapped.dependency, mapped.retry_after_ms));
              if (mapped.code === 'RATE_LIMITED' || mapped.code === 'SERVICE_UNAVAILABLE') break;
            }
          }
          if (assetErrors.length) {
            const waitError = assetErrors.find(error => error.code === 'RATE_LIMITED' || error.code === 'SERVICE_UNAVAILABLE');
            const soleSubtitleError = component === 'subtitles' && assetErrors.length === 1 ? assetErrors[0] : undefined;
            throw new EngineError(waitError?.code ?? soleSubtitleError?.code ?? 'ASSETS_PARTIAL', assetErrors.map(error => error.message).join('; '),
              waitError?.retryable ?? assetErrors.some(error => error.retryable), waitError?.dependency, waitError?.retry_after_ms);
          }
          if (subtitles?.missing.length) throw new EngineError('SUBTITLE_LANGUAGE_UNAVAILABLE', `已保存可取得的字幕，仍缺少指定语言：${subtitles.missing.join('、')}`);
        }
        completed.add(component); delete failed[component];
      } catch (error) {
        if (signal.aborted) throw error;
        const mapped = error instanceof EngineError ? error : new EngineError('COLLECTION_FAILED', safeMessage(error), true);
        failed[component] = mapped.message;
        if (!firstError || mapped.code === 'RATE_LIMITED' || mapped.code === 'SERVICE_UNAVAILABLE') firstError = mapped;
      }
      await save('collecting');
      if (firstError?.code === 'RATE_LIMITED' || firstError?.code === 'SERVICE_UNAVAILABLE') break;
    }
    if (components.includes('text')) {
      if (!hasText(snapshot)) failed.text = '来源没有取得可确认的正文，未用标题或生成文本冒充正文。';
      else {
        await save('finalizing');
        const documentPath = join(root, 'content.md');
        await atomicText(documentPath, renderDocument(sanitizeSnapshot(snapshot), artifacts, root, { accessUrl: taskAccessUrl(job) }), artifacts.find(a => a.path === documentPath));
        artifacts = artifacts.filter(a => a.role !== 'text' && a.path !== documentPath);
        artifacts.push({ role: 'text', path: documentPath, media_type: 'text/markdown', ...await hashFile(documentPath) });
        completed.add('text'); delete failed.text;
      }
    }
    if (job.request.save_as === 'bundle' && !artifacts.some(artifact => artifact.role === 'text')) {
      const previousEntry = artifacts.find(artifact => artifact.role === 'entry');
      const deliverables = artifacts.filter(artifact => !['entry', 'manifest', 'metadata'].includes(artifact.role));
      artifacts = artifacts.filter(artifact => artifact.role !== 'entry');
      if (deliverables.length) {
        await save('finalizing');
        const entryPath = join(root, 'content.md');
        await atomicText(entryPath, renderBundleEntry(sanitizeSnapshot(snapshot), deliverables, root, { accessUrl: taskAccessUrl(job) }), previousEntry);
        artifacts.push({ role: 'entry', path: entryPath, media_type: 'text/markdown', ...await hashFile(entryPath) });
      }
    }
    await save('verifying');
    for (const artifact of artifacts) if (!await verifyExisting(artifact, root)) throw new EngineError('ARTIFACT_CHANGED', '已保存文件在交付前发生变化');
    const clean = sanitizeSnapshot(snapshot);
    const contentArtifacts = artifacts.filter(a => !['metadata', 'manifest'].includes(a.role));
    const complete = requestedResultComplete(snapshot, components, completed, artifacts, completenessBinding);
    if (!complete && snapshot.completeness !== 'complete') warnings.push('来源完整性尚未确认，已保存可验证的部分。');
    const manifest = { schema_version: '1', source: clean.canonical_url, requested: components, preferences: job.request.preferences, complete, components_saved: [...completed], relations: clean.relations, assets: allAssets(clean).map(a => ({ ...a, saved: contentArtifacts.filter(f => f.source_asset_id === a.id).map(f => ({ ...f, path: relative(root, f.path) })) })), artifacts: contentArtifacts.map(a => ({ ...a, path: relative(root, a.path) })), missing: failed };
    const manifestPath = join(root, 'assets.json');
    await atomicText(manifestPath, JSON.stringify(manifest, null, 2) + '\n', artifacts.find(a => a.path === manifestPath));
    artifacts = artifacts.filter(a => a.path !== manifestPath); artifacts.push({ role: 'manifest', path: manifestPath, media_type: 'application/json', ...await hashFile(manifestPath) });
    await save('verifying');
    const metadataPath = join(root, 'metadata.json');
    await atomicText(metadataPath, JSON.stringify({ schema_version: '1', job_id: job.id, platform: clean.platform, adapter_version: clean.adapter_version, source_url: clean.source_url, canonical_url: clean.canonical_url, title: clean.title, authors: clean.authors, published_at: clean.published_at, collected_at: job.created_at, access_class: clean.access_class, source_completeness: clean.completeness, requested_components_complete: complete, preferences: job.request.preferences, warnings: [...new Set(warnings.map(redactSensitiveText))], processing: 'source collection; audio extraction and compatible media packaging when requested; no generated transcription or summaries', deliverables: await metadataDeliverables(contentArtifacts, root) }, null, 2) + '\n', artifacts.find(a => a.path === metadataPath));
    artifacts = artifacts.filter(a => a.path !== metadataPath); artifacts.push({ role: 'metadata', path: metadataPath, media_type: 'application/json', ...await hashFile(metadataPath) });
    const usable = contentArtifacts.length > 0;
    const status = complete ? 'succeeded' : usable ? 'partial' : firstError?.retryable ? 'blocked' : 'failed';
    if (complete) {
      const cleanup = await cleanupTemporaryFiles(workspace, workspace, [...temporaryArtifacts.values()]);
      if (cleanup.retained_count) warnings.push(`任务临时目录中保留了 ${cleanup.retained_count}${cleanup.retained_truncated ? ' 项以上' : ' 项'}未登记或已修改的内容，未自动删除。`);
      for (const key of Object.keys(mediaFiles)) delete mediaFiles[key];
      temporaryArtifacts.clear();
    }
    return { status, stage: 'verifying', snapshot, artifact_root: root, artifacts, warnings: [...new Set(warnings)],
      error: complete ? undefined : firstError ? { code: firstError.code, message: firstError.message, retryable: firstError.retryable, dependency: firstError.dependency, retry_after_ms: firstError.retry_after_ms } : { code: 'CONTENT_INCOMPLETE', message: Object.values(failed).join('; ') || '已保存内容，但来源完整性尚未确认。', retryable: true },
      completeness: { requested_components_complete: complete, scope: snapshot.relations?.length ? 'bounded_related' : 'single_item' },
      checkpoint: { ...job.checkpoint, workspace: complete ? undefined : workspace, completed_components: [...completed], failed_components: failed, media_files: mediaFiles, temporary_artifacts: [...temporaryArtifacts.values()] },
    };
  } };
}
