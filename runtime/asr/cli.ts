import { randomUUID } from "node:crypto";
import { readContextFile, runAsrPipeline, type AsrPipelineRequest, type AsrPipelineResult } from "./pipeline.js";
import { EngineError } from "../engines/process.js";

const VALUE_FLAGS = new Set([
  "input",
  "output-root",
  "capture-id",
  "job-id",
  "model-dir",
  "sherpa-python",
  "ffmpeg",
  "ffprobe",
  "threads",
  "chunk-seconds",
  "context-file",
]);

export const ASR_CLI_USAGE = `Usage: node scripts/asr-transcribe.mjs --input <media> --output-root <authorized-root> --model-dir <sensevoice-dir> --sherpa-python <python> [options]

Required:
  --input <path>          Local source media or audio file
  --output-root <path>    Authorized local material root
  --model-dir <path>     Verified SenseVoice model directory
  --sherpa-python <path>  Agent-owned Python with sherpa_onnx installed

Optional:
  --capture-id <id>       Default: capture_local
  --job-id <id>           Default: generated local job id
  --ffmpeg <path>         Default: BABEL_ASR_FFMPEG or ffmpeg
  --ffprobe <path>        Default: BABEL_ASR_FFPROBE or ffprobe
  --threads <n>           Default: 2
  --chunk-seconds <n>     Default: 30
  --context-file <path>   JSON correction context (treated as untrusted data)
  --correct               Ask the Agent LLM for constrained correction
  --help                  Print this usage
`;

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new EngineError("ASR_USAGE", `${flag} 需要一个值\n${ASR_CLI_USAGE}`, false);
  return value;
}

function numberOption(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new EngineError("ASR_USAGE", `${flag} 必须是数字\n${ASR_CLI_USAGE}`, false);
  return parsed;
}

function envValue(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  return names.map(name => env[name]).find(value => Boolean(value));
}

export async function parseAsrArgs(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<AsrPipelineRequest> {
  const values = new Map<string, string>();
  let correct = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") throw new EngineError("ASR_HELP", ASR_CLI_USAGE, false);
    if (argument === "--correct") {
      correct = true;
      continue;
    }
    if (!argument?.startsWith("--") || !VALUE_FLAGS.has(argument.slice(2))) throw new EngineError("ASR_USAGE", `未知参数 ${argument ?? ""}\n${ASR_CLI_USAGE}`, false);
    values.set(argument.slice(2), valueAfter(args, index, argument));
    index++;
  }

  const inputPath = values.get("input");
  const outputRoot = values.get("output-root");
  const modelDirectory = values.get("model-dir") ?? envValue(env, "BABEL_ASR_MODEL_DIR", "ASR_MODEL_DIR");
  const sherpaPython = values.get("sherpa-python") ?? envValue(env, "BABEL_ASR_PYTHON", "ASR_SHERPA_PYTHON");
  if (!inputPath || !outputRoot || !modelDirectory || !sherpaPython) {
    throw new EngineError("ASR_USAGE", `${!inputPath ? "缺少 --input。" : ""}${!outputRoot ? "缺少 --output-root。" : ""}${!modelDirectory ? "缺少 --model-dir 或 BABEL_ASR_MODEL_DIR。" : ""}${!sherpaPython ? "缺少 --sherpa-python 或 BABEL_ASR_PYTHON。" : ""}\n${ASR_CLI_USAGE}`, false);
  }

  const context = await readContextFile(values.get("context-file"));
  return {
    inputPath,
    outputRoot,
    captureId: values.get("capture-id") ?? "capture_local",
    jobId: values.get("job-id") ?? `job_${Date.now()}_${randomUUID().slice(0, 8)}`,
    modelDirectory,
    sherpaPython,
    ffmpeg: values.get("ffmpeg") ?? envValue(env, "BABEL_ASR_FFMPEG") ?? "ffmpeg",
    ffprobe: values.get("ffprobe") ?? envValue(env, "BABEL_ASR_FFPROBE") ?? "ffprobe",
    threads: numberOption(values.get("threads"), "--threads"),
    chunkSeconds: numberOption(values.get("chunk-seconds"), "--chunk-seconds"),
    context,
    correct,
    env,
  };
}

export async function runAsrCli(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<AsrPipelineResult> {
  const request = await parseAsrArgs(args, env);
  return await runAsrPipeline(request);
}

export function asrCliSummary(result: AsrPipelineResult): Record<string, unknown> {
  return {
    status: result.status,
    captureId: result.captureId,
    jobId: result.jobId,
    jobDirectory: result.jobDirectory,
    warnings: result.warnings,
    files: result.files,
  };
}
