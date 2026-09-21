import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export class EngineError extends Error {
  constructor(public code: string, message: string, public retryable = false, public dependency?: string, public retry_after_ms?: number) {
    super(message); this.name = 'EngineError';
  }
}

export function safeMessage(value: unknown): string {
  return String(value instanceof Error ? value.message : value)
    .replace(/https?:\/\/[^\s"'<>]+/g, '[source URL]')
    .replace(/(?:Bearer|Cookie:|Authorization:)\s+[^\r\n]+/gi, '[redacted]')
    .slice(0, 1000);
}

export interface ProcessOptions {
  signal?: AbortSignal;
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  dependency?: string;
  env?: NodeJS.ProcessEnv;
}

/** Fixed executable + argv only. Webpage strings never become shell commands. */
export async function runProcess(executable: string, args: string[], options: ProcessOptions = {}): Promise<{ stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw new EngineError('CANCELLED', '任务已取消');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', ...options.env },
    });
    let stdout = ''; let stderr = ''; let size = 0; let settled = false;
    const outDecoder = new StringDecoder('utf8'); const errDecoder = new StringDecoder('utf8');
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    function stop(): void {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch { /* Process already exited. */ }
      killTimer = setTimeout(() => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* Process already exited. */ }
      }, 1000);
      killTimer.unref();
    }
    function finish(error?: Error): void {
      if (settled) return;
      settled = true; clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) { stop(); reject(error); }
      else resolve({ stdout, stderr });
    }
    const onAbort = (): void => finish(new EngineError('CANCELLED', '任务已取消'));
    const timer = setTimeout(() => finish(new EngineError('ENGINE_TIMEOUT', '处理达到时间预算，可检查后续跑', true)), options.timeoutMs ?? 120_000);
    timer.unref();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    child.once('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ENOENT'
      ? new EngineError('DEPENDENCY_MISSING', `缺少可执行依赖 ${options.dependency ?? executable}`, true, options.dependency ?? executable)
      : new EngineError('ENGINE_START_FAILED', safeMessage(error), true)));
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxOutputBytes ?? 8 * 1024 * 1024)) finish(new EngineError('ENGINE_OUTPUT_LIMIT', '引擎返回超过允许大小'));
      else stdout += outDecoder.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + errDecoder.write(chunk)).slice(-16000); });
    child.once('close', code => {
      if (killTimer) clearTimeout(killTimer);
      stdout += outDecoder.end(); stderr += errDecoder.end();
      // yt-dlp can exit before our process deadline on a TLS handshake timeout.
      // Only its final transport diagnostic enters the bounded network retry
      // policy; earlier warnings must not turn a final 403 or certificate
      // rejection into an automatic retry.
      const finalDiagnostic = safeMessage(stderr.trim().split(/\r?\n/).at(-1) ?? '');
      const handshakeTimeout = options.dependency === 'yt-dlp' && /\bhandshake(?: operation)? timed out\b/i.test(finalDiagnostic);
      finish(code === 0 ? undefined : new EngineError(handshakeTimeout ? 'NETWORK_TIMEOUT' : 'ENGINE_FAILED', safeMessage(stderr || `引擎退出码 ${code}`), true));
    });
  });
}
