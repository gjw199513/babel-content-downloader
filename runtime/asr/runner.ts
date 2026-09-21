import { runProcess, safeMessage } from "../engines/process.js";
import { join } from "node:path";

export interface AsrSegment {
  text: string;
  start: number;
  end: number;
  language?: string;
  emotion?: string;
  event?: string;
  tokens?: string[];
  tokenTimestamps?: number[];
}

export interface AsrChunkResult {
  text: string;
  duration?: number;
  language?: string;
  segments: AsrSegment[];
}

export interface SherpaRunnerInput {
  wavPath: string;
  modelDirectory: string;
  pythonPath: string;
  threads: number;
  signal?: AbortSignal;
}

export type SherpaRunner = (input: SherpaRunnerInput) => Promise<AsrChunkResult>;

const PYTHON_SENSEVOICE_SCRIPT = `
import json
import sys

config = json.loads(sys.argv[1])
import numpy as np
import soundfile as sf
import sherpa_onnx

samples, sample_rate = sf.read(config["audioPath"], dtype="float32", always_2d=False)
if getattr(samples, "ndim", 1) > 1:
    samples = np.mean(samples, axis=1).astype("float32")
else:
    samples = np.asarray(samples, dtype="float32")

recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    model=config["modelPath"],
    tokens=config["tokensPath"],
    num_threads=int(config.get("threads") or 1),
    provider=config.get("provider") or "cpu",
    language="auto",
    use_itn=True,
)
stream = recognizer.create_stream()
stream.accept_waveform(sample_rate, samples)
recognizer.decode_stream(stream)
result = stream.result
text = str(getattr(result, "text", "") or "").strip()
payload = {
    "text": text,
    "duration": float(len(samples)) / float(sample_rate) if sample_rate else None,
    "language": str(getattr(result, "lang", "") or "") or None,
    "emotion": str(getattr(result, "emotion", "") or "") or None,
    "event": str(getattr(result, "event", "") or "") or None,
    "segments": [{
        "text": text,
        "start": 0.0,
        "end": float(len(samples)) / float(sample_rate) if sample_rate else 0.0,
        "language": str(getattr(result, "lang", "") or "") or None,
        "emotion": str(getattr(result, "emotion", "") or "") or None,
        "event": str(getattr(result, "event", "") or "") or None,
    }] if text else [],
}
print(json.dumps(payload, ensure_ascii=False))
`;

function parseJsonOutput(stdout: string): Record<string, unknown> | undefined {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object") return value as Record<string, unknown>;
    } catch {
      // The runner may print diagnostics before the JSON result.
    }
  }
  return undefined;
}

function asSegment(value: unknown): AsrSegment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.text !== "string" || typeof item.start !== "number" || typeof item.end !== "number" || item.end < item.start) return undefined;
  return {
    text: item.text,
    start: item.start,
    end: item.end,
    ...(typeof item.language === "string" && item.language ? { language: item.language } : {}),
    ...(typeof item.emotion === "string" && item.emotion ? { emotion: item.emotion } : {}),
    ...(typeof item.event === "string" && item.event ? { event: item.event } : {}),
    ...(Array.isArray(item.tokens) ? { tokens: item.tokens.filter((token): token is string => typeof token === "string") } : {}),
    ...(Array.isArray(item.tokenTimestamps) ? { tokenTimestamps: item.tokenTimestamps.filter((timestamp): timestamp is number => typeof timestamp === "number" && Number.isFinite(timestamp)) } : {}),
  };
}

function parseChunkResult(stdout: string): AsrChunkResult {
  const value = parseJsonOutput(stdout);
  if (!value || typeof value.text !== "string") throw new Error("sherpa-onnx 返回了无法解析的 ASR 结果");
  const segments = Array.isArray(value.segments) ? value.segments.map(asSegment).filter((segment): segment is AsrSegment => Boolean(segment)) : [];
  return {
    text: value.text.trim(),
    ...(typeof value.duration === "number" && Number.isFinite(value.duration) ? { duration: value.duration } : {}),
    ...(typeof value.language === "string" && value.language ? { language: value.language } : {}),
    segments,
  };
}

/** Run the reference SenseVoice Python API through an argument-array-only child process. */
export const runSenseVoiceWithPython: SherpaRunner = async ({ wavPath, modelDirectory, pythonPath, threads, signal }) => {
  const result = await runProcess(pythonPath, ["-c", PYTHON_SENSEVOICE_SCRIPT, JSON.stringify({
    audioPath: wavPath,
    modelPath: join(modelDirectory, "model.int8.onnx"),
    tokensPath: join(modelDirectory, "tokens.txt"),
    provider: "cpu",
    threads,
  })], { signal, timeoutMs: 10 * 60_000, maxOutputBytes: 4 * 1024 * 1024, dependency: "sherpa-onnx" });
  try {
    return parseChunkResult(result.stdout);
  } catch (error) {
    throw new Error(`ASR 结果解析失败：${safeMessage(error)}`);
  }
};

export { PYTHON_SENSEVOICE_SCRIPT, parseChunkResult };
