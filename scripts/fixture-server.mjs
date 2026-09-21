import http from 'node:http';
import { mkdir, readFile, access, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, '.audit/e2e/fixtures'); await mkdir(directory, { recursive: true });
async function generate(name, args) {
  const path = join(directory, name);
  if (await access(path).then(() => true, () => false)) return;
  await new Promise((resolveChild, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args, path], { stdio: ['ignore', 'ignore', 'pipe'], shell: false });
    let error = ''; child.stderr.on('data', chunk => { error += chunk.toString(); }); child.on('error', reject); child.on('close', code => code === 0 ? resolveChild() : reject(new Error(error)));
  });
}
await generate('image.png', ['-f', 'lavfi', '-i', 'color=c=0x146c94:s=320x180', '-frames:v', '1']);
await generate('podcast.mp4', ['-f', 'lavfi', '-i', 'color=c=0x146c94:s=320x180:r=12:d=2.4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
await writeFile(join(directory, 'subtitles.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:02.400\nBabel fixture: generated test tone, not spoken content.\n');
const media = new Map([['/fixture/assets/image.png', ['image.png', 'image/png']], ['/fixture/assets/podcast.mp4', ['podcast.mp4', 'video/mp4']], ['/fixture/assets/subtitles.vtt', ['subtitles.vtt', 'text/vtt']]]);
const server = http.createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1:4319');
    response.setHeader('cache-control', 'no-store');
    if (url.pathname.startsWith('/fixture/content/')) {
      const podcast = url.pathname.endsWith('/podcast');
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Babel ${podcast ? '音频' : '图文'}开发验收</title><style>body{font:18px/1.7 system-ui;max-width:780px;margin:40px auto;padding:24px}img,video{max-width:100%}aside{color:#667}</style></head><body><aside>自有开发样本，用于验证扩展与运行时；不代表真实平台已通过。</aside><article data-babel-fixture="content"><h1 data-babel-fixture="title">Babel ${podcast ? '可收听内容' : '离线图文'}验收</h1><div data-babel-fixture="author">Babel development fixture</div><time data-babel-fixture="published" datetime="2026-09-18">2026-09-18</time><p>第一段原文。采集结果应保留这句话。</p>${podcast ? '<video data-babel-fixture="video" src="/fixture/assets/podcast.mp4" controls autoplay loop playsinline><track data-babel-fixture="subtitle" kind="subtitles" srclang="en" src="/fixture/assets/subtitles.vtt"></video><p>这段 2.4 秒的测试媒体包含画面和 440 Hz 测试音；下载和提取不应发出声音。</p>' : '<p>图片前的正文。<img data-babel-fixture="image" src="/fixture/assets/image.png" alt="320×180 蓝色测试图">图片后的正文应仍在图片之后。</p><p>最后一段原文。</p>'}</article></body></html>`);
      return;
    }
    const asset = media.get(url.pathname);
    if (asset) { response.setHeader('content-type', asset[1]); response.end(await readFile(join(directory, asset[0]))); return; }
    response.writeHead(404); response.end('Not found');
  })().catch(error => { response.writeHead(500); response.end(String(error)); });
});
server.listen(4319, '127.0.0.1', () => process.stdout.write('Owned fixture server: http://127.0.0.1:4319/fixture/content/article and /fixture/content/podcast\n'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
