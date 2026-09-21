import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collect(path));
    else if (/\.tsx?$/.test(entry.name)) result.push(path);
  }
  return result;
}
const files = process.argv.slice(2).length ? process.argv.slice(2).map(p => resolve(root, p)) : (await Promise.all(['adapters', 'bootstrap', 'extension', 'runtime', 'shared', 'tests'].map(p => collect(join(root, p))))).flat();
const expected = new Set(files.map(p => pathToFileURL(p).href));
const diagnostics = new Map(); const calls = new Map();
let lastPublish = 0; let nextId = 0; let incoming = Buffer.alloc(0); let exited = false;
const server = spawn(process.env.BABEL_LANGUAGE_SERVER ?? 'typescript-language-server', ['--stdio'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let failure = '';
server.stderr.on('data', chunk => { failure = (failure + chunk.toString()).slice(-2000); });
server.once('error', error => { failure = error.message; exited = true; }); server.once('exit', () => { exited = true; });
function send(message) {
  const payload = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
  server.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`), payload]));
}
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolveCall, reject) => {
    const timeout = setTimeout(() => { calls.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    calls.set(id, { resolve: resolveCall, reject, timeout }); send({ id, method, params });
  });
}
server.stdout.on('data', bytes => {
  incoming = Buffer.concat([incoming, bytes]);
  for (;;) {
    const boundary = incoming.indexOf('\r\n\r\n'); if (boundary < 0) return;
    const length = Number(/Content-Length:\s*(\d+)/i.exec(incoming.subarray(0, boundary).toString())?.[1]);
    if (!Number.isInteger(length) || length < 0) { failure = 'Invalid LSP response'; server.kill(); return; }
    if (incoming.length < boundary + 4 + length) return;
    const message = JSON.parse(incoming.subarray(boundary + 4, boundary + 4 + length).toString()); incoming = incoming.subarray(boundary + 4 + length);
    if (message.method && message.id !== undefined) send({ id: message.id, result: message.method === 'workspace/configuration' ? message.params.items.map(() => ({})) : null });
    else if (message.id !== undefined) {
      const call = calls.get(message.id); if (call) { clearTimeout(call.timeout); calls.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); }
    } else if (message.method === 'textDocument/publishDiagnostics' && expected.has(message.params.uri)) { diagnostics.set(message.params.uri, message.params.diagnostics); lastPublish = Date.now(); }
  }
});
try {
  await request('initialize', { processId: process.pid, rootUri: pathToFileURL(root).href, workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'babel-content-downloader' }], capabilities: { textDocument: { publishDiagnostics: { relatedInformation: true } } }, initializationOptions: { tsserver: { path: join(root, 'node_modules/typescript/lib/tsserver.js') }, disableAutomaticTypingAcquisition: true } });
  send({ method: 'initialized', params: {} });
  for (const file of files) send({ method: 'textDocument/didOpen', params: { textDocument: { uri: pathToFileURL(file).href, languageId: 'typescript', version: 1, text: await readFile(file, 'utf8') } } });
  const deadline = Date.now() + 55000;
  while (diagnostics.size < expected.size || Date.now() - lastPublish < 1500) {
    if (exited) throw new Error(`LSP exited: ${failure}`);
    if (Date.now() > deadline) throw new Error(`LSP returned ${diagnostics.size}/${expected.size} files; incomplete validation`);
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  let errors = 0; let warnings = 0;
  for (const [uri, entries] of diagnostics) for (const entry of entries) {
    if (entry.severity === 1) errors++; if (entry.severity === 2) warnings++;
    if (entry.severity <= 2) process.stdout.write(`${fileURLToPath(uri)}:${entry.range.start.line + 1} ${entry.severity === 1 ? 'error' : 'warning'} ${entry.code ?? ''}: ${entry.message}\n`);
  }
  process.stdout.write(`LSP checked ${diagnostics.size} files: ${errors} errors, ${warnings} warnings.\n`); process.exitCode = errors ? 1 : 0;
  await request('shutdown'); send({ method: 'exit' });
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
finally { server.stdin.end(); server.kill(); }
