#!/usr/bin/env node

const DEFAULT_BASE_URL = 'https://ollama.com/v1';
const DEFAULT_MODEL = 'gemma4:31b';
const DEFAULT_TIMEOUT_MS = 120_000;

const SENSITIVE_QUERY = /([?&](?:token|signature|sig|sign|auth|session|cookie|xsec|credential|key|nonce|expires?|timestamp|sn)=)[^&#\s)]+/gi;

function safeText(value) {
  return String(value)
    .replace(SENSITIVE_QUERY, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]');
}
function baseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return raw || DEFAULT_BASE_URL;
}

export function agentConfig(env = process.env) {
  const apiKey = env.BABEL_AGENT_API_KEY || env.OPENAI_API_KEY || '';
  const timeout = Number(env.BABEL_AGENT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return {
    type: 'openai-compatible',
    model: env.BABEL_AGENT_MODEL || DEFAULT_MODEL,
    baseUrl: baseUrl(env.BABEL_AGENT_BASE_URL),
    capabilities: ['chat', 'structured', 'embeddings'],
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 600_000) : DEFAULT_TIMEOUT_MS,
    configured: Boolean(apiKey),
    dryRun: env.BABEL_AGENT_DRY_RUN === '1' || env.BABEL_AGENT_DRY_RUN === 'true',
    apiKey,
  };
}

function messageText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(part => typeof part === 'string' ? part : part && typeof part.text === 'string' ? part.text : '').join('');
}

export async function dispatchAgent({ prompt, context = {}, env = process.env } = {}) {
  const config = agentConfig(env);
  const safeContext = safeText(JSON.stringify(context));
  const system = [
    '你是 Babel Content Downloader 的验收 Agent。',
    '只分析给定的脱敏测试摘要，不访问网页，不执行命令，不修改文件。',
    '输出简洁、可读的 Markdown：先给结论，再列出失败、部分成功、跳过和下一步。',
    '不要臆测未提供的平台、正文、媒体或浏览器状态。',
  ].join('\n');
  if (config.dryRun) {
    return {
      status: 'dry_run',
      model: config.model,
      baseUrl: config.baseUrl,
      configured: config.configured,
      text: '# Agent 验收摘要\n\n当前为 dry-run，未调用远程模型。测试摘要已完成脱敏并准备就绪。',
    };
  }
  if (!config.apiKey) {
    return {
      status: 'skipped',
      model: config.model,
      baseUrl: config.baseUrl,
      configured: false,
      reason: 'BABEL_AGENT_API_KEY is not configured',
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + config.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: String(prompt || '请根据以下摘要生成验收报告：') + '\n\n' + safeContext },
        ],
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      return {
        status: 'failed',
        model: config.model,
        baseUrl: config.baseUrl,
        configured: true,
        reason: safeText('HTTP ' + response.status + ': ' + body.slice(0, 600)),
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { status: 'failed', model: config.model, baseUrl: config.baseUrl, configured: true, reason: 'Agent returned non-JSON response' };
    }
    const text = messageText(parsed?.choices?.[0]?.message?.content);
    if (!text) return { status: 'failed', model: config.model, baseUrl: config.baseUrl, configured: true, reason: 'Agent response contained no message content' };
    return { status: 'succeeded', model: config.model, baseUrl: config.baseUrl, configured: true, text: safeText(text) };
  } catch (error) {
    return {
      status: 'failed',
      model: config.model,
      baseUrl: config.baseUrl,
      configured: true,
      reason: safeText(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timer);
  }
}
