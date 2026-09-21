#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { agentConfig, dispatchAgent } from './agent-dispatch.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'cancelled']);
const SENSITIVE_QUERY_KEY = /^(?:token|signature|sig|sign|auth|session|cookie|xsec|credential|key|nonce|expires?|timestamp)$/i;
const SENSITIVE_CONTENT = /(?:[?&](?:token|signature|sig|sign|auth|session|cookie|xsec|credential|key|nonce|expires?|timestamp)=|["'](?:token|signature|sig|sign|auth|session|cookie|xsec|credential|key|nonce|expires?|timestamp)["']\s*:)/i;
const IDENTITY_QUERY = new Set(['p', 'v', 'id', 'vid', 'bvid', 'aid', 'story_fbid', 'fbid', 'page']);

export const PLATFORM_MATRIX = [
  ['xiaohongshu', '小红书'],
  ['bilibili', 'B站'],
  ['weixin_article', '微信公众号'],
  ['zhihu', '知乎'],
  ['youtube', 'YouTube'],
  ['x', 'X'],
  ['reddit', 'Reddit'],
  ['medium', 'Medium'],
  ['substack', 'Substack'],
  ['github', 'GitHub'],
  ['huggingface', 'Hugging Face'],
  ['arxiv', 'arXiv'],
  ['openai_blog', 'OpenAI Blog'],
  ['anthropic_blog', 'Anthropic Blog'],
  ['deepmind_blog', 'Google DeepMind'],
].map(([id, name]) => ({ id, name }));

function nowId() {
  const value = new Date();
  const pad = number => String(number).padStart(2, '0');
  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
    '-',
    pad(value.getHours()),
    pad(value.getMinutes()),
    pad(value.getSeconds()),
  ].join('');
}

function sleep(milliseconds) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds));
}

function markdownCell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function publicUrl(raw) {
  try {
    const parsed = new URL(raw);
    for (const key of [...parsed.searchParams.keys()]) {
      const wechatIdentity = parsed.hostname === 'mp.weixin.qq.com' && new Set(['__biz', 'mid', 'idx', 'sn']).has(key);
      if ((!IDENTITY_QUERY.has(key) && !wechatIdentity) || SENSITIVE_QUERY_KEY.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.href;
  } catch {
    return '[invalid-url]';
  }
}

function needsDirectAccessLink(raw) {
  return publicUrl(raw) !== raw;
}

function safePath(value) {
  return typeof value === 'string' && isAbsolute(value) ? value : undefined;
}

function fileLink(path, label) {
  const safe = safePath(path);
  return safe ? '[' + label + '](' + safe.replace(/ /g, '%20') + ')' : '—';
}

function parseArgs(argv) {
  const args = {
    manifest: process.env.BABEL_PLATFORM_URLS_FILE,
    output: process.env.BABEL_MATRIX_OUTPUT_DIR,
    report: process.env.BABEL_MATRIX_REPORT_DIR || join(PROJECT_ROOT, '.audit', 'platform-matrix'),
    only: [],
    client: process.env.BABEL_BCD_CLIENT || 'codex',
    cli: process.env.BABEL_BCD_CLI || join(PROJECT_ROOT, 'dist', 'bootstrap', 'cli.js'),
    pollMs: Number(process.env.BABEL_MATRIX_POLL_MS || DEFAULT_POLL_MS),
    timeoutMs: Number(process.env.BABEL_MATRIX_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    strict: false,
    checkOnly: false,
    dryRun: false,
    dryRunAgent: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--manifest') args.manifest = argv[++index];
    else if (value === '--output') args.output = argv[++index];
    else if (value === '--report-dir') args.report = argv[++index];
    else if (value === '--only') args.only = String(argv[++index] || '').split(',').map(item => item.trim()).filter(Boolean);
    else if (value === '--client') args.client = argv[++index];
    else if (value === '--cli') args.cli = argv[++index];
    else if (value === '--poll-ms') args.pollMs = Number(argv[++index]);
    else if (value === '--timeout-ms') args.timeoutMs = Number(argv[++index]);
    else if (value === '--strict') args.strict = true;
    else if (value === '--check-only') args.checkOnly = true;
    else if (value === '--dry-run') args.dryRun = true;
    else if (value === '--dry-run-agent') args.dryRunAgent = true;
    else if (value === '--help' || value === '-h') {
      console.log([
        'Usage: node scripts/platform-matrix.mjs [options]',
        '',
        '--manifest FILE       JSON object or {"cases":[...]} with platform URLs',
        '--only IDS            Comma-separated platform IDs',
        '--check-only          Run babel_content_check without collection',
        '--strict              Require every selected platform to pass',
        '--dry-run             Validate manifest/report flow without MCP calls',
        '--dry-run-agent       Do not call the remote Agent model',
        '--output DIR          Authorized runtime output directory',
        '--report-dir DIR      Markdown report directory',
      ].join('\n'));
      process.exit(0);
    }
  }
  if (!Number.isFinite(args.pollMs) || args.pollMs < 100) args.pollMs = DEFAULT_POLL_MS;
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1_000) args.timeoutMs = DEFAULT_TIMEOUT_MS;
  return args;
}

async function readUrlManifest(path) {
  if (!path) return {};
  const value = JSON.parse(await readFile(resolve(path), 'utf8'));
  const source = Array.isArray(value) ? value : Array.isArray(value?.cases) ? value.cases : value;
  const entries = {};
  if (!source || typeof source !== 'object') throw new Error('Platform URL manifest must be an object or a cases array');
  if (Array.isArray(source)) {
    for (const item of source) {
      if (item && typeof item.platform === 'string') entries[item.platform] = item;
    }
  } else {
    for (const [id, item] of Object.entries(source)) entries[id] = typeof item === 'string' ? { url: item } : item;
  }
  return entries;
}

async function configuredOutputRoot(clientId) {
  const configPath = process.env.BABEL_CONTENT_CONFIG;
  if (!configPath) return join(PROJECT_ROOT, '.babel-content', 'platform-matrix');
  try {
    const config = JSON.parse(await readFile(resolve(configPath), 'utf8'));
    const grant = Array.isArray(config.clients) ? config.clients.find(item => item?.id === clientId) : undefined;
    const root = grant?.output_roots?.[0];
    return typeof root === 'string' && isAbsolute(root) ? join(root, 'platform-matrix') : join(PROJECT_ROOT, '.babel-content', 'platform-matrix');
  } catch {
    return join(PROJECT_ROOT, '.babel-content', 'platform-matrix');
  }
}

function envManifest() {
  const entries = {};
  for (const platform of PLATFORM_MATRIX) {
    const key = 'BABEL_PLATFORM_' + platform.id.toUpperCase() + '_URL';
    if (process.env[key]) entries[platform.id] = { url: process.env[key] };
  }
  if (process.env.BABEL_PLATFORM_URLS_JSON) {
    const value = JSON.parse(process.env.BABEL_PLATFORM_URLS_JSON);
    for (const [id, item] of Object.entries(value || {})) entries[id] = typeof item === 'string' ? { url: item } : item;
  }
  return entries;
}

async function loadCases(args) {
  const fromFile = await readUrlManifest(args.manifest);
  const merged = { ...envManifest(), ...fromFile };
  const selected = args.only.length ? new Set(args.only) : undefined;
  return PLATFORM_MATRIX
    .filter(platform => !selected || selected.has(platform.id))
    .map(platform => {
      const raw = merged[platform.id];
      if (!raw || typeof raw.url !== 'string' || !raw.url.trim()) {
        return { ...platform, url: undefined, saveAs: 'document', missing: true };
      }
      let parsed;
      try { parsed = new URL(raw.url); } catch { parsed = undefined; }
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        return { ...platform, url: undefined, saveAs: raw.save_as || raw.saveAs || 'document', invalid: true };
      }
      return {
        ...platform,
        url: parsed.href,
        saveAs: raw.save_as || raw.saveAs || 'document',
        browser: raw.browser,
      };
    });
}

function extractToolValue(envelope) {
  const result = envelope?.result || {};
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  const text = Array.isArray(result.content) ? result.content.find(item => item?.type === 'text')?.text : undefined;
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { message: text }; }
}

class McpStdioClient {
  constructor(cli, clientId) {
    this.child = spawn(process.execPath, [cli, 'mcp', clientId], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.child.stdout.on('data', chunk => this.onStdout(String(chunk)));
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-4_000); });
    this.child.on('error', error => this.failAll(error));
    this.child.on('exit', (code, signal) => this.failAll(new Error('MCP proxy exited: ' + String(code ?? signal))));
  }

  onStdout(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(String(message.error.message || 'MCP error')));
      else pending.resolve(message);
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  request(method, params, timeoutMs = 60_000) {
    const id = this.nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(method + ' timed out'));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async initialize() {
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'babel-platform-matrix', version: '0.1.0' },
    });
    this.notify('notifications/initialized', {});
  }

  async call(name, args, timeoutMs = 60_000) {
    const envelope = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    return { ...extractToolValue(envelope), mcpError: envelope.result?.isError === true };
  }

  async close() {
    this.failAll(new Error('MCP client closed'));
    this.child.kill('SIGTERM');
    await sleep(50);
  }
}

async function pollJob(client, jobId, args) {
  const deadline = Date.now() + args.timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    try {
      latest = await client.call('babel_content_job_get', { job_id: jobId, artifact_offset: 0, artifact_limit: 50 }, Math.max(60_000, args.pollMs * 3));
    } catch {
      // The local stdio proxy can lose one HTTP exchange while the runtime is
      // writing a checkpoint. Keep the job id and retry within the matrix
      // deadline; a single dropped status read is not a platform failure.
      await sleep(args.pollMs);
      continue;
    }
    // A retryable job is reported as blocked while its bounded retry timer is
    // sleeping. Do not turn that intermediate state into a matrix failure;
    // wait for the actual terminal result unless no retry is scheduled.
    if (TERMINAL.has(latest.status) || (latest.status === 'blocked' && !latest.retry_at)) return latest;
    await sleep(args.pollMs);
  }
  return { ...(latest || {}), status: 'blocked', error: { code: 'MATRIX_TIMEOUT', message: 'platform matrix polling timed out' } };
}

async function validateDeliverables(record, caseValue) {
  const job = record.job;
  const documentPath = safePath(job?.content_files?.document || job?.content_files?.entry);
  const metadataPath = safePath(job?.content_files?.metadata);
  const manifestPath = safePath(job?.content_files?.manifest);
  const result = {
    documentPath,
    metadataPath,
    manifestPath,
    documentExists: false,
    publicLink: false,
    directAccessLink: false,
    metadataSafe: true,
    manifestSafe: true,
  };
  if (documentPath) {
    try {
      const content = await readFile(documentPath, 'utf8');
      result.documentExists = content.trim().length > 0;
      result.publicLink = content.includes('来源：<');
      result.directAccessLink = needsDirectAccessLink(caseValue.url) ? content.includes(caseValue.url) : result.documentExists;
    } catch { /* report the missing file, not a guessed success */ }
  }
  for (const [key, path] of [['metadataSafe', metadataPath], ['manifestSafe', manifestPath]]) {
    if (!path) continue;
    try {
      const content = await readFile(path, 'utf8');
      result[key] = !SENSITIVE_CONTENT.test(content);
    } catch {
      result[key] = false;
    }
  }
  return result;
}

function classify(record) {
  if (record.status === 'skipped') return 'skipped';
  if (record.status === 'dry_run') return 'dry_run';
  if (record.status === 'check_passed') return 'check_passed';
  if (record.status === 'blocked' || record.status === 'failed') return record.status;
  if (record.jobStatus === 'succeeded' && record.deliverables?.documentExists && record.deliverables?.publicLink && record.deliverables?.directAccessLink && record.deliverables?.metadataSafe && record.deliverables?.manifestSafe) return 'passed';
  if (record.jobStatus === 'partial') return 'partial';
  return 'failed';
}

async function runCase(client, caseValue, args, outputRoot, runId) {
  if (caseValue.missing) return { ...caseValue, status: 'skipped', reason: '没有提供当前平台的具体内容 URL' };
  if (caseValue.invalid) return { ...caseValue, status: 'skipped', reason: 'URL 不是 HTTP(S)' };
  if (args.dryRun) return { ...caseValue, status: 'dry_run', publicUrl: publicUrl(caseValue.url), reason: 'dry-run 未调用 MCP' };
  const check = await client.call('babel_content_check', {
    target: { type: 'url', url: caseValue.url },
    save_as: caseValue.saveAs,
  });
  const adapterId = check.adapter?.id || 'unregistered';
  const bridgeConnected = check.bridge?.connected === true;
  const browserReady = check.browser_required !== true || bridgeConnected || check.connection_state === 'ready_http';
  if (check.mcpError || !browserReady || (!check.adapter && check.connection_state !== 'ready_http')) {
    return {
      ...caseValue,
      status: 'blocked',
      publicUrl: publicUrl(caseValue.url),
      check: { connectionState: check.connection_state, adapter: adapterId, browserReady, bridgeConnected },
      reason: check.message || '运行时或浏览器未达到可采集状态',
    };
  }
  if (args.checkOnly) {
    return { ...caseValue, status: 'check_passed', publicUrl: publicUrl(caseValue.url), check: { connectionState: check.connection_state, adapter: adapterId, browserReady, bridgeConnected }, reason: 'check-only 未启动下载' };
  }
  const platformOutput = join(outputRoot, caseValue.id);
  const collect = await client.call('babel_content_collect', {
    target: { type: 'url', url: caseValue.url },
    save_as: caseValue.saveAs,
    output: { directory: platformOutput, collision_policy: 'version' },
    browser: { ...(caseValue.browser || {}), tab_strategy: caseValue.browser?.tab_strategy || 'auto', allow_focus: caseValue.browser?.allow_focus ?? false },
    idempotency_key: 'platform-matrix-' + runId + '-' + caseValue.id,
  });
  if (collect.mcpError || !collect.job_id) {
    return {
      ...caseValue,
      status: 'failed',
      publicUrl: publicUrl(caseValue.url),
      check: { connectionState: check.connection_state, adapter: adapterId, browserReady, bridgeConnected },
      reason: collect.message || 'babel_content_collect did not return a job',
    };
  }
  const job = await pollJob(client, collect.job_id, args);
  const deliverables = await validateDeliverables({ job }, caseValue);
  return {
    ...caseValue,
    status: classify({ jobStatus: job.status, deliverables }),
    publicUrl: publicUrl(caseValue.url),
    check: { connectionState: check.connection_state, adapter: adapterId, browserReady, bridgeConnected },
    jobId: collect.job_id,
    jobStatus: job.status,
    completeness: job.completeness,
    artifactCount: job.artifact_count,
    error: job.error,
    warnings: job.warnings,
    deliverables,
  };
}

function reportStatus(status) {
  return {
    passed: '通过',
    partial: '部分完成',
    blocked: '阻塞',
    failed: '失败',
    skipped: '跳过',
    dry_run: '演练',
    check_passed: '检查通过',
  }[status] || status;
}

function reportLink(path, label) {
  const safe = safePath(path);
  return safe ? fileLink(safe, label) : '—';
}

async function writeReport({ args, runId, records, agent, reportPath }) {
  const counts = records.reduce((result, record) => {
    const key = classify(record);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const lines = [
    '# Babel Content Downloader · 多平台自动验收报告',
    '',
    '> 本报告由本机 MCP + 浏览器运行时矩阵脚本生成。公开报告只保留脱敏 URL；短期访问凭证只可能存在于权限受限的本地 content.md。',
    '',
    '## 总览',
    '',
    '| 项目 | 结果 |',
    '| --- | --- |',
    '| 运行批次 | ' + runId + ' |',
    '| 选择范围 | ' + records.length + ' 个平台 |',
    '| 通过 | ' + (counts.passed || 0) + ' |',
    '| 部分完成 | ' + (counts.partial || 0) + ' |',
    '| 阻塞 / 失败 | ' + ((counts.blocked || 0) + (counts.failed || 0)) + ' |',
    '| 未配置 / 跳过 | ' + (counts.skipped || 0) + ' |',
    '| Agent | ' + agent.status + ' · ' + agent.model + ' |',
    '',
    '## 平台结果',
    '',
    '| 平台 | 目标 | 适配器 | 任务 | 完整性 | 原始链接 | 本地交付 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const record of records) {
    const deliverables = record.deliverables;
    const local = deliverables?.documentExists ? reportLink(deliverables.documentPath, 'content.md') : '—';
    const linkStatus = deliverables?.documentExists ? (deliverables.directAccessLink ? '可跳转' : '缺少原始链接') : '未确认';
    lines.push('| ' + markdownCell(record.name) + ' | ' + markdownCell(record.publicUrl || (record.url ? publicUrl(record.url) : '未提供')) + ' | ' + markdownCell(record.check?.adapter || '—') + ' | ' + markdownCell(reportStatus(record.status)) + ' | ' + markdownCell(record.completeness?.requested_components_complete === true ? 'complete' : record.completeness ? 'partial/unknown' : '—') + ' | ' + linkStatus + ' | ' + local + ' |');
  }
  lines.push('', '## 逐平台证据', '');
  for (const record of records) {
    const deliverables = record.deliverables;
    lines.push('### ' + record.name + '（' + record.id + '）', '');
    lines.push('- 结果：' + reportStatus(record.status));
    lines.push('- 目标：' + (record.publicUrl || (record.url ? publicUrl(record.url) : '未提供')));
    lines.push('- 适配器：' + (record.check?.adapter || '未执行'));
    if (record.jobId) lines.push('- 任务：' + record.jobId + ' · 状态：' + (record.jobStatus || '—'));
    if (record.reason) lines.push('- 说明：' + markdownCell(record.reason));
    if (deliverables) {
      lines.push('- 原始链接：' + (deliverables.documentExists && deliverables.directAccessLink ? '可在本地 content.md 跳转' : '未确认'));
      lines.push('- metadata/assets 脱敏：' + (deliverables.metadataSafe && deliverables.manifestSafe ? '通过' : '未通过'));
      lines.push('- 文件：' + reportLink(deliverables.documentPath, 'content.md') + ' · ' + reportLink(deliverables.manifestPath, 'assets.json') + ' · ' + reportLink(deliverables.metadataPath, 'metadata.json'));
    }
    if (record.error) lines.push('- 错误：' + markdownCell(record.error.code || record.error.message));
    lines.push('');
  }
  lines.push(
    '## Agent 派发',
    '',
    '- 类型：' + agentConfig().type,
    '- 模型：' + markdownCell(agent.model),
    '- Base URL：' + markdownCell(agent.baseUrl),
    '- 状态：' + markdownCell(agent.status),
  );
  if (agent.reason) lines.push('- 说明：' + markdownCell(agent.reason));
  if (agent.text) lines.push('', agent.text.trim());
  lines.push(
    '',
    '## 验收边界',
    '',
    '- 通过只表示本次 URL 的 check、MCP 任务、至少一个本地文档和链接/脱敏检查都通过。',
    '- fixture_verified、HTTP 成功、媒体工具可用或脚本生成报告，都不能替代真实浏览器页面和平台内容的当前验收。',
    '- 未配置 URL 的平台显示为跳过，不会被伪装成通过；使用 --strict 可让 CI 在未覆盖或非通过时退出失败。',
    '',
  );
  await writeFile(reportPath, lines.join('\n'), { mode: 0o600 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = nowId();
  const cases = await loadCases(args);
  const reportRoot = resolve(args.report);
  const outputBase = args.output ? resolve(args.output) : await configuredOutputRoot(args.client);
  const outputRoot = join(outputBase, runId);
  const runReportRoot = join(reportRoot, runId);
  await mkdir(runReportRoot, { recursive: true, mode: 0o700 });
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const records = [];
  let client;
  try {
    if (!args.dryRun) {
      client = new McpStdioClient(resolve(args.cli), args.client);
      await client.initialize();
    }
    for (const caseValue of cases) {
      process.stdout.write('Testing ' + caseValue.id + '...\n');
      const record = await runCase(client, caseValue, args, outputRoot, runId);
      records.push(record);
      process.stdout.write(caseValue.id + ': ' + reportStatus(record.status) + '\n');
    }
  } finally {
    if (client) await client.close();
  }
  const context = {
    run_id: runId,
    records: records.map(record => ({
      platform: record.id,
      status: classify(record),
      public_url: record.publicUrl || (record.url ? publicUrl(record.url) : undefined),
      adapter: record.check?.adapter,
      job_status: record.jobStatus,
      completeness: record.completeness,
      direct_access_link: record.deliverables?.directAccessLink,
      local_document: Boolean(record.deliverables?.documentExists),
      metadata_safe: record.deliverables ? record.deliverables.metadataSafe && record.deliverables.manifestSafe : undefined,
      reason: record.reason,
    })),
  };
  const agentEnv = { ...process.env };
  if (args.dryRunAgent) agentEnv.BABEL_AGENT_DRY_RUN = '1';
  const agent = await dispatchAgent({
    env: agentEnv,
    prompt: '请复核这次多平台收集矩阵，按平台给出结论，并明确哪些平台仍需要补 URL、登录、浏览器重载或人工复核。',
    context,
  });
  const agentPath = join(runReportRoot, 'agent-summary.md');
  if (agent.text) await writeFile(agentPath, agent.text.trim() + '\n', { mode: 0o600 });
  const reportPath = join(runReportRoot, 'report.md');
  await writeReport({ args, runId, records, agent, reportPath });
  const publicRun = {
    run_id: runId,
    report: reportPath,
    output_root: outputRoot,
    agent: { status: agent.status, model: agent.model, baseUrl: agent.baseUrl, configured: agent.configured },
    records: records.map(record => ({
      platform: record.id,
      status: classify(record),
      public_url: record.publicUrl || (record.url ? publicUrl(record.url) : undefined),
      job_id: record.jobId,
      job_status: record.jobStatus,
      reason: record.reason,
      document: record.deliverables?.documentPath,
    })),
  };
  await writeFile(join(runReportRoot, 'result.json'), JSON.stringify(publicRun, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write('Report: ' + reportPath + '\n');
  const failures = records.some(record => {
    const status = classify(record);
    return status === 'failed' || status === 'blocked' || (args.strict && status !== 'passed' && status !== 'check_passed');
  });
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
});
