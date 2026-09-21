import { createUnzip } from 'node:zlib';
import { lookup } from 'node:dns/promises';
import { isIP, connect, type Socket } from 'node:net';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { open, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EngineError } from './process.js';

export interface NetworkPolicy {
  allowedHosts: string[];
  /** Runtime-owned single webpage fetching only; DNS/ports are still checked on every hop. */
  publicWeb?: boolean;
  /** Trusted single-page route restriction, evaluated before each redirect connection. */
  acceptUrl?: (url: URL) => boolean;
  /** Shipped adapter rules for HTTPS CDN endpoints; never accepted from a page or MCP request. */
  extraHttpsPorts?: { host: string; ports: number[] }[];
  /** Operator-controlled owned test origins only; never accepted from MCP input. */
  allowTestOrigins?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  /** Local operator choice; content/MCP requests cannot choose a resolver. */
  dnsMode?: 'system' | 'cloudflare';
}

export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === undefined || b === undefined || c === undefined) return false;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && (b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  // IANA special-purpose ranges, with compressed IPv6 normalized before prefix checks.
  if (isIP(ip) !== 6 || ip.includes('.') || !/^[23][0-9a-f]{3}:/.test(ip)) return false;
  const [left, right] = ip.split('::');
  const before = left ? left.split(':') : []; const after = right ? right.split(':') : [];
  const parts = ip.includes('::') ? [...before, ...Array(8 - before.length - after.length).fill('0'), ...after] : before;
  const first = parseInt(parts[0]!, 16); const second = parseInt(parts[1]!, 16);
  return !((first === 0x2001 && (second < 0x200 || second === 0xdb8)) || first === 0x2002 || (first === 0x3fff && second < 0x1000));
}

export function matchesHost(host: string, allowed: string[]): boolean {
  return allowed.some(item => item.startsWith('*.')
    ? host.endsWith(item.slice(1)) && host !== item.slice(2)
    : host === item);
}

export function publicUrl(value: string): string {
  try { const url = new URL(value); url.username = ''; url.password = ''; url.hash = ''; url.search = ''; return url.href; }
  catch { return '[invalid URL]'; }
}

export function publicDnsAnswers(data: unknown): { address: string }[] {
  if (!data || typeof data !== 'object') throw new EngineError('DNS_RESOLUTION_FAILED', '公网域名解析未返回有效结果', true);
  const response = data as { Status?: number; Answer?: { type?: number; data?: string }[] };
  if (response.Status !== 0 || !Array.isArray(response.Answer)) throw new EngineError('DNS_RESOLUTION_FAILED', '公网域名解析失败', true);
  const addresses = response.Answer.filter(entry => entry.type === 1 && typeof entry.data === 'string').map(entry => ({ address: entry.data! }));
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new EngineError('PRIVATE_ADDRESS_BLOCKED', '公网解析器未提供允许访问的公网地址');
  return addresses;
}

async function cloudflareLookup(hostname: string): Promise<{ address: string }[]> {
  // Fixed public TLS endpoint. Only the already-allowlisted hostname is sent, never page paths or tokens.
  const data = await new Promise<unknown>((resolve, reject) => {
    const request = https.get({ hostname: '1.1.1.1', servername: 'cloudflare-dns.com', path: `/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      headers: { host: 'cloudflare-dns.com', accept: 'application/dns-json' }, timeout: 8000,
    }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new EngineError('DNS_RESOLUTION_FAILED', '公网解析器暂时不可用', true)); return; }
      let body = ''; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 65536) response.destroy(new Error('DNS response too large')); else body += chunk.toString('utf8'); });
      response.on('error', reject);
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new EngineError('DNS_RESOLUTION_FAILED', '公网解析器返回无效数据', true)); } });
    });
    request.on('timeout', () => request.destroy(new EngineError('DNS_RESOLUTION_FAILED', '公网域名解析超时', true)));
    request.on('error', reject);
  });
  return publicDnsAnswers(data);
}

export async function resolveRemote(value: string, policy: NetworkPolicy): Promise<{ url: URL; address: string }> {
  let url: URL;
  try { url = new URL(value); } catch { throw new EngineError('INVALID_URL', '资源地址无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new EngineError('URL_NOT_ALLOWED', '只允许无内嵌凭据的 HTTP/HTTPS 资源');
  if (policy.acceptUrl && !policy.acceptUrl(url)) throw new EngineError('TARGET_URL_MISMATCH', '目标跳转超出当前网页采集范围');
  const fixture = policy.allowTestOrigins?.includes(url.origin) ?? false;
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!fixture && !policy.publicWeb && !matchesHost(hostname, policy.allowedHosts))
    throw new EngineError('ASSET_HOST_NOT_ALLOWED', `资源主机 ${url.hostname} 不在当前平台任务范围内`);
  const allowedExtraPort = url.protocol === 'https:' && policy.extraHttpsPorts?.some(rule => matchesHost(hostname, [rule.host]) && rule.ports.includes(Number(url.port)));
  if (!fixture && url.port && !['80', '443'].includes(url.port) && !allowedExtraPort)
    throw new EngineError('URL_NOT_ALLOWED', '资源使用未授权端口');
  const addresses = isIP(hostname) ? [{ address: hostname }] : !fixture && policy.dnsMode === 'cloudflare' ? await cloudflareLookup(hostname) : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || (!fixture && addresses.some(entry => !isPublicAddress(entry.address))))
    throw new EngineError('PRIVATE_ADDRESS_BLOCKED', '拒绝访问本机、私有或保留网络地址');
  return { url, address: addresses[0]!.address };
}

function cleanHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const next = { ...headers };
  for (const key of ['proxy-authorization', 'proxy-connection', 'connection', 'keep-alive', 'upgrade', 'transfer-encoding']) delete next[key];
  return next;
}

export function retryAfterMilliseconds(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Math.min(Number.MAX_SAFE_INTEGER, Number(text) * 1000);
  if (!/^[A-Za-z]{3,9}[ ,]/.test(text)) return undefined;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

async function openRemote(value: string, policy: NetworkPolicy, signal?: AbortSignal, headers: Record<string, string> = {}, redirects = 0): Promise<{ response: IncomingMessage; finalUrl: string }> {
  if (signal?.aborted) throw new EngineError('CANCELLED', '任务已取消');
  const { url, address } = await resolveRemote(value, policy);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request({
      protocol: url.protocol, hostname: address, port: url.port || undefined,
      servername: url.hostname, path: url.pathname + url.search, method: 'GET', signal,
      headers: { 'user-agent': 'BabelContentDownloader/0.1', 'accept-encoding': 'identity', ...headers, host: url.host },
      timeout: policy.timeoutMs ?? 30_000,
    }, resolve);
    request.on('timeout', () => request.destroy(new EngineError('NETWORK_TIMEOUT', '资源请求超时', true)));
    request.on('error', reject); request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    response.resume();
    if (!response.headers.location || redirects >= 5) throw new EngineError('REDIRECT_LIMIT', '资源重定向无效或超过上限');
    const next = new URL(response.headers.location, url);
    return openRemote(next.href, policy, signal, next.origin === url.origin ? headers : {}, redirects + 1);
  }
  if (response.statusCode !== 200) {
    response.resume();
    const code = response.statusCode === 429 ? 'RATE_LIMITED' : response.statusCode === 503 ? 'SERVICE_UNAVAILABLE' : 'DOWNLOAD_HTTP_ERROR';
    throw new EngineError(code, `资源请求返回 HTTP ${response.statusCode}`, true, undefined, retryAfterMilliseconds(response.headers['retry-after']));
  }
  return { response, finalUrl: url.href };
}

/** Fetch a single public HTML response without executing page scripts or following links. */
export async function fetchHtml(value: string, policy: NetworkPolicy, signal?: AbortSignal): Promise<{ html: string; finalUrl: string; bytes: number; sha256: string }> {
  let opened: Awaited<ReturnType<typeof openRemote>>;
  try { opened = await openRemote(value, policy, signal, { accept: 'text/html,application/xhtml+xml' }); }
  catch (error) {
    if (error instanceof EngineError && error.code === 'DOWNLOAD_HTTP_ERROR' && /HTTP (401|403)\b/.test(error.message)) throw new EngineError('ACCESS_NOT_PUBLIC', '目标网站拒绝访问或需要授权');
    throw error;
  }
  const { response, finalUrl } = opened;
  const contentType = String(response.headers['content-type'] ?? '');
  if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) {
    response.destroy(); throw new EngineError('HTML_REQUIRED', '目标没有返回可读取的 HTML 网页');
  }
  const max = Math.min(policy.maxBytes ?? 8 * 1024 * 1024, 8 * 1024 * 1024);
  if (Number(response.headers['content-length']) > max) { response.destroy(); throw new EngineError('SIZE_LIMIT', '网页超过本次抓取上限'); }
  const encoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase();
  if (!['identity', 'gzip', 'deflate'].includes(encoding)) { response.destroy(); throw new EngineError('HTML_ENCODING_UNSUPPORTED', '网页压缩编码暂不支持'); }
  const body = encoding === 'identity' ? response : response.pipe(createUnzip());
  if (body !== response) response.on('error', error => body.destroy(error));
  const chunks: Buffer[] = []; let size = 0;
  try {
    for await (const chunk of body) {
      if (signal?.aborted) throw new EngineError('CANCELLED', '任务已取消');
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > max) throw new EngineError('SIZE_LIMIT', '网页超过本次抓取上限');
      chunks.push(bytes);
    }
  } catch (error) { body.destroy(); response.destroy(); throw error; }
  if (!size) throw new EngineError('EMPTY_RESOURCE', '网页内容为空');
  const bytes = Buffer.concat(chunks);
  const prefix = bytes.subarray(0, 1024).toString('latin1');
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'utf-8' : undefined;
  const meta = /<meta\b[^>]*\bcharset\s*=\s*["']?([A-Za-z0-9_-]+)/i.exec(prefix)?.[1];
  const charset = bom ?? /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? meta ?? 'utf-8';
  let html: string;
  try { html = new TextDecoder(charset).decode(bytes); }
  catch { throw new EngineError('HTML_ENCODING_UNSUPPORTED', '网页字符编码暂不支持'); }
  return { html, finalUrl, bytes: size, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function downloadFile(value: string, destination: string, policy: NetworkPolicy, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<{ size: number; sha256: string; mediaType: string; sourceUrl: string }> {
  const { response, finalUrl } = await openRemote(value, policy, signal, headers);
  const maximum = policy.maxBytes ?? 512 * 1024 * 1024;
  if (Number(response.headers['content-length']) > maximum) {
    response.destroy(); throw new EngineError('SIZE_LIMIT', '资源超过本次任务的容量预算');
  }
  let size = 0; const hash = createHash('sha256');
  const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    if (size > maximum) callback(new EngineError('SIZE_LIMIT', '资源超过本次任务的容量预算'));
    else { hash.update(chunk); callback(null, chunk); }
  } });
  const handle = await open(destination, 'wx', 0o600).catch(error => { response.destroy(); throw error; });
  try {
    await pipeline(response, limiter, handle.createWriteStream(), { signal });
    if (!size) throw new EngineError('EMPTY_RESOURCE', '下载内容为空');
    return { size, sha256: hash.digest('hex'), mediaType: String(response.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!, sourceUrl: publicUrl(finalUrl) };
  } catch (error) { await handle.close().catch(() => undefined); await unlink(destination).catch(() => undefined); throw error; }
}

/** Every downloader HTTP request and CONNECT target gets a pinned public address. */
export async function createGuardedProxy(policy: NetworkPolicy): Promise<{ url: string; close(): Promise<void>; violation(): EngineError | undefined }> {
  const password = randomBytes(24).toString('hex');
  const expected = Buffer.from(`Basic ${Buffer.from(`babel:${password}`).toString('base64')}`);
  const sockets = new Set<Socket>(); let violation: EngineError | undefined;
  let bytes = 0;
  const limit = policy.maxBytes ?? 2 * 1024 ** 3;
  const authorized = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    const actual = Buffer.from(value);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const noteError = (error: unknown): void => { if (error instanceof EngineError) violation ??= error; };
  function track(socket: Socket): void { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); }
  function budget(chunk: Buffer, upstream: { destroy(error?: Error): unknown }): void {
    bytes += chunk.length;
    if (bytes > limit) { violation = new EngineError('SIZE_LIMIT', '媒体下载超过任务容量预算'); upstream.destroy(violation); }
  }
  const server = http.createServer((request, response) => {
    if (!authorized(request.headers['proxy-authorization'])) { response.writeHead(407); response.end(); return; }
    void (async () => {
      const { url, address } = await resolveRemote(request.url ?? '', policy);
      const outgoing = (url.protocol === 'https:' ? https : http).request({
        protocol: url.protocol, hostname: address, port: url.port || undefined, servername: url.hostname,
        path: url.pathname + url.search, method: request.method,
        headers: { ...cleanHeaders(request.headers), host: url.host }, timeout: policy.timeoutMs ?? 30_000,
      }, incoming => {
        response.writeHead(incoming.statusCode ?? 502, cleanHeaders(incoming.headers));
        incoming.on('data', chunk => budget(chunk as Buffer, incoming));
        incoming.on('error', error => response.destroy(error)); incoming.pipe(response);
      });
      outgoing.on('timeout', () => outgoing.destroy(new Error('Upstream timeout')));
      outgoing.on('error', error => { noteError(error); response.destroy(error); });
      request.on('aborted', () => outgoing.destroy()); request.pipe(outgoing);
    })().catch(error => { noteError(error); response.writeHead(403); response.end('Resource is outside task network scope'); });
  });
  server.on('connection', track);
  server.on('connect', (request, downstream, head) => {
    if (!authorized(request.headers['proxy-authorization'])) { downstream.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return; }
    void (async () => {
      const { url, address } = await resolveRemote(`https://${request.url ?? ''}`, policy);
      const upstream = connect(Number(url.port || 443), address);
      track(upstream);
      upstream.setTimeout(policy.timeoutMs ?? 30_000, () => upstream.destroy());
      upstream.once('connect', () => {
        downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.on('data', chunk => budget(chunk as Buffer, upstream));
        downstream.pipe(upstream); upstream.pipe(downstream);
      });
      upstream.on('error', () => downstream.destroy());
      downstream.on('error', () => upstream.destroy());
      downstream.once('close', () => upstream.destroy());
    })().catch(error => { noteError(error); downstream.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new EngineError('PROXY_START_FAILED', '下载通道启动失败');
  return {
    url: `http://babel:${password}@127.0.0.1:${address.port}`,
    violation: () => violation,
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
