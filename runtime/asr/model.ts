import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { EngineError } from "../engines/process.js";

export const SENSEVOICE_MODEL = {
  repository: "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
  revision: "2365baeacb507f821a0c8120fcee3d484dba7a07",
  primaryEndpoint: "https://huggingface.co",
  fallbackEndpoint: "https://hf-mirror.com",
  files: [
    { path: "model.int8.onnx", byteLength: 239_233_841, sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51" },
    { path: "tokens.txt", byteLength: 315_894, sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc" },
    { path: "LICENSE", byteLength: 71, sha256: "221c6df10b0931a5629adad671ea48fb7747e034c414b6d2bfa275bc3dd4ea17" },
    { path: "README.md", byteLength: 104, sha256: "763991a00edaea534ab36bf1b7cf89e61e911666dcfabbba71f91f9f7c593a63" },
  ],
} as const;

export type SenseVoiceModelFile = (typeof SENSEVOICE_MODEL.files)[number];

export interface VerifiedSenseVoiceModel {
  directory: string;
  files: { path: SenseVoiceModelFile["path"]; byteLength: number; sha256: string }[];
}

async function hashFile(path: string): Promise<{ byteLength: number; sha256: string }> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new EngineError("ASR_MODEL_FILE_INVALID", "ASR 模型文件不是普通文件", false, "sensevoice-model");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return { byteLength: metadata.size, sha256: hash.digest("hex") };
}

/** Verify every pinned model file before the recognizer is allowed to run. */
export async function verifySenseVoiceModel(directory: string): Promise<VerifiedSenseVoiceModel> {
  if (!isAbsolute(directory) || directory.includes("\0")) throw new EngineError("ASR_MODEL_PATH_INVALID", "ASR 模型目录必须是绝对路径", false, "sensevoice-model");
  const root = resolve(directory);
  const rootStat = await lstat(root).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new EngineError("ASR_MODEL_MISSING", "找不到 SenseVoice 模型目录", true, "sensevoice-model");
    throw error;
  });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new EngineError("ASR_MODEL_PATH_INVALID", "ASR 模型目录不是普通目录", false, "sensevoice-model");

  const verified: VerifiedSenseVoiceModel["files"] = [];
  for (const expected of SENSEVOICE_MODEL.files) {
    const path = join(root, expected.path);
    let actual: { byteLength: number; sha256: string };
    try {
      actual = await hashFile(path);
    } catch (error) {
      if (error instanceof EngineError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new EngineError("ASR_MODEL_MISSING", `缺少固定模型文件 ${expected.path}`, true, "sensevoice-model");
      throw error;
    }
    if (actual.byteLength !== expected.byteLength || actual.sha256 !== expected.sha256) {
      throw new EngineError("ASR_MODEL_INTEGRITY", `固定模型文件 ${expected.path} 的大小或 SHA-256 不匹配`, false, "sensevoice-model");
    }
    verified.push({ path: expected.path, ...actual });
  }
  return { directory: root, files: verified };
}
