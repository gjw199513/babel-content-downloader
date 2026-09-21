import { createHash } from 'node:crypto';
import type { AdapterDefinition, CollectRequest, ContentSnapshot } from '../../shared/contracts.js';
import { fetchHtml, type NetworkPolicy } from '../engines/network.js';
import { EngineError } from '../engines/process.js';
import { redactUrl } from '../storage/job-store.js';
import { extractWebHtml } from './html-extractor.js';

export const WEB_PAGE_VERSION = '1';
const RULE = 'web_page.http-response.v1';
const EXCLUDED = ['sohu.com', 'kuaishou.com', 'gifshow.com', 'toutiao.com', 'ixigua.com', 'baijiahao.baidu.com', '163.com', 'qq.com', 'weibo.com', 'weibo.cn', 'douyin.com', 'iesdouyin.com', 'tiktok.com', 'instagram.com', 'facebook.com', 'fb.com', 'threads.net', 'threads.com', 'pinterest.com', 'linkedin.com', 'jianshu.com', 'csdn.net', 'juejin.cn', 'cnblogs.com', 'douban.com', 'bsky.app', 'tumblr.com', 'quora.com', 'wordpress.com', 'vimeo.com', 'dailymotion.com', 'twitch.tv', 'acfun.cn'];
const SPECIAL = ['youtube.com', 'youtu.be', 'bilibili.com', 'b23.tv', 'zhihu.com', 'x.com', 'twitter.com', 'reddit.com', 'redd.it', 'xiaohongshu.com', 'xhslink.com', 'github.com', 'arxiv.org'];
function hostIs(host: string, domains: readonly string[]): boolean { return domains.some(domain => host === domain || host.endsWith(`.${domain}`)); }

/** Route choice only: public-network and access checks happen during capture. */
export function isWebPageUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  if (hostIs(host, [...EXCLUDED, ...SPECIAL])) return false;
  if (hostIs(host, ['huggingface.co'])) return /^\/blog\/[^/]+\/?$/.test(url.pathname);
  if (hostIs(host, ['deepmind.google']) && !url.pathname.startsWith('/blog/')) return false;
  if (/^\/(?:blog|research|news|articles)?\/?$/.test(url.pathname)) return false;
  if (/\/(?:login|signin|sign-in|signup|sign-up|account|settings|api)(?:\/|$)/i.test(url.pathname)) return false;
  return !/\.(?:pdf|zip|gz|tar|exe|dmg|mp4|mp3|m4a|png|jpg|jpeg|webp|svg|json)$/i.test(url.pathname);
}
export function shouldCaptureWebDocument(request: CollectRequest, existing?: AdapterDefinition): boolean {
  if (request.target.type !== 'url' || !isWebPageUrl(new URL(request.target.url))) return false;
  if (existing && !['medium', 'substack', 'huggingface', 'anthropic_blog', 'deepmind_blog', 'openai_blog'].includes(existing.id)) return false;
  if ((request.limits?.max_related_items ?? 0) > 0) return false;
  if (request.preferences && Object.entries(request.preferences).some(([key, value]) => key !== 'image_indices' && value !== undefined)) return false;
  if (request.include?.some(component => !['text', 'images', 'cover'].includes(component))) return false;
  return !request.save_as || ['auto', 'document', 'images', 'bundle'].includes(request.save_as);
}
/** Explicit existing tabs retain their browser state instead of making an HTTP request. */
export function shouldCaptureWebPage(request: CollectRequest, existing?: AdapterDefinition): boolean {
  return request.browser?.tab_strategy !== 'existing' && shouldCaptureWebDocument(request, existing);
}
/** Full/automatic collection must not silently discard an embedded source. */
export function requiresWebMediaHandling(request: CollectRequest, snapshot: ContentSnapshot): boolean {
  return !request.include && (!request.save_as || ['auto', 'bundle'].includes(request.save_as))
    && !(request.save_as !== 'bundle' && request.preferences?.image_indices?.length)
    && snapshot.platform === 'web_page' && snapshot.warnings.includes('media:embedded_content');
}
export function webPageIdentity(url: string): string { return createHash('sha256').update(redactUrl(url)).digest('hex'); }

/** Rebuilt from persisted URLs on resume; no page-supplied adapter rules are accepted. */
export function webPageAdapter(snapshot: ContentSnapshot): AdapterDefinition | undefined {
  if (snapshot.platform !== 'web_page' || !isWebPageUrl(new URL(snapshot.source_url)) || !isWebPageUrl(new URL(snapshot.canonical_url))) return undefined;
  const urls = new Set([redactUrl(snapshot.source_url), redactUrl(snapshot.canonical_url)]);
  const contentId = webPageIdentity(snapshot.canonical_url);
  return {
    id: 'web_page', version: WEB_PAGE_VERSION, hosts: [...new Set([...urls].map(url => new URL(url).hostname))],
    engine: 'direct', content_types: ['article'], status: 'experimental',
    match: url => urls.has(redactUrl(url.href)),
    completion_rules: [
      { id: RULE, content_types: ['article'], boundary: 'response_received', matches: (url, id) => urls.has(redactUrl(url.href)) && id === contentId },
      { id: 'web_page.browser-document.v1', content_types: ['article'], boundary: 'dom_read', matches: (url, id) => urls.has(redactUrl(url.href)) && id === contentId },
    ],
  };
}
export async function captureWebPage(request: CollectRequest, policy: Pick<NetworkPolicy, 'dnsMode' | 'allowTestOrigins'>, signal: AbortSignal): Promise<ContentSnapshot> {
  if (request.target.type !== 'url') throw new EngineError('URL_REQUIRED', '网页直接抓取需要指定 URL');
  const response = await fetchHtml(request.target.url, { ...policy, allowedHosts: [], publicWeb: true, acceptUrl: isWebPageUrl, maxBytes: request.limits?.max_bytes }, signal);
  if (!isWebPageUrl(new URL(response.finalUrl))) throw new EngineError('TARGET_URL_MISMATCH', '网页跳转到了当前采集范围外');
  let page: ReturnType<typeof extractWebHtml>;
  try { page = extractWebHtml(response.html, response.finalUrl); }
  catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ACCESS_NOT_PUBLIC' || code === 'CONTENT_NOT_FOUND') throw new EngineError(code, code === 'ACCESS_NOT_PUBLIC' ? '目标网页需要访问授权或未返回公开正文' : '目标网页未返回可读取内容');
    throw error;
  }
  if (page.assets.some(asset => asset.role !== 'image' && asset.role !== 'cover')) throw new EngineError('WEB_ASSET_OUT_OF_SCOPE', '通用文章只自动保存正文图片');
  const orderedCount = new Set(page.blocks.flatMap(block => 'asset_id' in block ? [block.asset_id] : [])).size;
  const contentId = webPageIdentity(response.finalUrl);
  const snapshot: ContentSnapshot = {
    schema_version: '1', platform: 'web_page', adapter_version: WEB_PAGE_VERSION,
    source_url: request.target.url, canonical_url: response.finalUrl, platform_content_id: contentId,
    content_type: 'article', title: page.title, authors: page.authors, published_at: page.published_at,
    blocks: page.blocks, assets: page.assets, access_class: 'public_free', completeness: 'complete',
    completeness_proof: { version: 1, scope: 'single_item', method: 'http_page_capture', rule_id: RULE,
      platform_content_id: contentId, boundary: 'response_received', pending_marker_count: 0,
      ordered_asset_count: orderedCount, unplaced_asset_count: 0 },
    warnings: [...page.warnings, 'CURRENT_PAGE_CAPTURE'],
    evidence: [`capture:http`, `extractor:${page.extraction}`, `html-sha256:${response.sha256}`],
  };
  if (requiresWebMediaHandling(request, snapshot)) snapshot.warnings.push('content_pending:embedded_media');
  if (snapshot.warnings.some(warning => warning.startsWith('content_truncated:') || warning.startsWith('content_pending:') || warning.startsWith('asset:image:'))) {
    snapshot.completeness = 'partial';
    delete snapshot.completeness_proof;
  }
  return snapshot;
}

/** Only an explicit runtime-selected browser document command can use this boundary. */
export function validateBrowserWebSnapshot(snapshot: ContentSnapshot, target: URL): AdapterDefinition {
  const expected = redactUrl(target.href);
  if (snapshot.platform !== 'web_page' || snapshot.adapter_version !== WEB_PAGE_VERSION
    || snapshot.content_type !== 'article' || !['public_free', 'login_public_free'].includes(snapshot.access_class)
    || redactUrl(snapshot.source_url) !== expected || redactUrl(snapshot.canonical_url) !== expected
    || snapshot.platform_content_id !== webPageIdentity(target.href)
    || snapshot.relations?.length || snapshot.assets.some(asset => asset.role !== 'image' && asset.role !== 'cover')
    || (snapshot.completeness_proof && snapshot.completeness_proof.method !== 'browser_page_capture')) {
    throw new EngineError('SNAPSHOT_INVALID', '浏览器网页结果与当前请求不一致');
  }
  if (snapshot.completeness === 'complete' && snapshot.warnings.some(warning => /^(content_truncated:|content_pending:|asset:image:)/.test(warning))) {
    throw new EngineError('SNAPSHOT_INVALID', '浏览器网页仍有未完成内容');
  }
  const adapter = webPageAdapter(snapshot);
  if (!adapter) throw new EngineError('SNAPSHOT_INVALID', '浏览器网页超出当前范围');
  return adapter;
}

export function canFallbackToBrowser(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' && ['ACCESS_NOT_PUBLIC', 'CONTENT_NOT_FOUND', 'HTML_REQUIRED', 'EMPTY_RESOURCE',
    'DOWNLOAD_HTTP_ERROR', 'NETWORK_TIMEOUT', 'DNS_RESOLUTION_FAILED', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);
}
