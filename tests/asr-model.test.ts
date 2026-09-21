import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SENSEVOICE_MODEL, verifySenseVoiceModel } from "../runtime/asr/model.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("SenseVoice model contract", () => {
  it("publishes the fixed repository, revision and four required files", () => {
    expect(SENSEVOICE_MODEL.repository).toBe("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17");
    expect(SENSEVOICE_MODEL.revision).toBe("2365baeacb507f821a0c8120fcee3d484dba7a07");
    expect(SENSEVOICE_MODEL.files.map((file) => file.path)).toEqual(["model.int8.onnx", "tokens.txt", "LICENSE", "README.md"]);
  });

  it("fails closed when a required model file is missing or has the wrong bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "babel-asr-model-test-"));
    directories.push(directory);
    await expect(verifySenseVoiceModel(directory)).rejects.toMatchObject({ code: "ASR_MODEL_MISSING" });
    await Promise.all(SENSEVOICE_MODEL.files.map((file) => writeFile(join(directory, file.path), "test")));
    await expect(verifySenseVoiceModel(directory)).rejects.toMatchObject({ code: "ASR_MODEL_INTEGRITY" });
  });

  it("rejects a relative model directory", async () => {
    await expect(verifySenseVoiceModel("relative-model")).rejects.toMatchObject({ code: "ASR_MODEL_PATH_INVALID" });
  });
});
