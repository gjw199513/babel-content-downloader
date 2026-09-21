import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAsrPipeline } from "../runtime/asr/pipeline.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixtureBinary(directory: string, name: string, source: string): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, `#!${process.execPath}\n${source}\n`);
  await chmod(path, 0o700);
  return path;
}

async function fixtures(): Promise<{ directory: string; input: string; ffmpeg: string; ffprobe: string }> {
  const directory = await mkdtemp(join(tmpdir(), "babel-asr-pipeline-test-"));
  directories.push(directory);
  const input = join(directory, "source.wav");
  await writeFile(input, Buffer.from("fake source audio"));
  const ffprobe = await fixtureBinary(directory, "ffprobe", `const fs = process.getBuiltinModule("node:fs"); if (!fs.existsSync(process.argv.at(-1))) process.exitCode = 1; else console.log(JSON.stringify({ format: { duration: "1.2" }, streams: [{ codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "16000", channels: 1, duration: "1.2" }] }));`);
  const ffmpeg = await fixtureBinary(directory, "ffmpeg", `const fs = require("node:fs"); fs.writeFileSync(process.argv[process.argv.length - 1], Buffer.from("fake pcm wav"));`);
  return { directory, input, ffmpeg, ffprobe };
}

describe("local ASR pipeline", () => {
  it("writes verified source, chunks, immutable raw output and a manifest", async () => {
    const { directory, input, ffmpeg, ffprobe } = await fixtures();
    const outputRoot = join(directory, "materials");
    const result = await runAsrPipeline({
      inputPath: input,
      outputRoot,
      captureId: "cap_test",
      jobId: "job_test",
      modelDirectory: join(directory, "model"),
      sherpaPython: process.execPath,
      ffmpeg,
      ffprobe,
      verifyModel: false,
      runner: async () => ({ text: "开放时间早上9点至下午5点。", segments: [{ text: "开放时间早上9点至下午5点。", start: 0, end: 1.2 }] }),
    });
    expect(result.status).toBe("raw_ready");
    expect(result.rawTranscript).toBe("开放时间早上9点至下午5点。");
    const rawFile = result.files.rawTranscript!;
    expect(rawFile.path).toBe("transcription/raw-transcript.txt");
    const manifest = JSON.parse(await readFile(join(result.jobDirectory, "transcription/transcription-manifest.json"), "utf8")) as { status: string; files: Record<string, { path: string; sha256: string }>; modelRevision: string };
    expect(manifest.status).toBe("raw_ready");
    expect(manifest.modelRevision).toBe("2365baeacb507f821a0c8120fcee3d484dba7a07");
    const manifestRawFile = manifest.files.rawTranscript!;
    expect(manifestRawFile.path).toBe("transcription/raw-transcript.txt");
    expect(manifestRawFile.sha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(readFile(join(result.jobDirectory, "transcription/correction-packet.json"), "utf8")).resolves.toContain("untrusted quoted data");
  });

  it("writes corrected output separately and rejects semantic drift", async () => {
    const { directory, input, ffmpeg, ffprobe } = await fixtures();
    const outputRoot = join(directory, "materials");
    const base = {
      inputPath: input, outputRoot, captureId: "cap_correct", jobId: "job_correct", modelDirectory: join(directory, "model"), sherpaPython: process.execPath,
      ffmpeg, ffprobe, verifyModel: false,
      runner: async () => ({ text: "开饭时间早上9点至下午5点。", segments: [{ text: "开饭时间早上9点至下午5点。", start: 0, end: 1.2 }] }),
    };
    const accepted = await runAsrPipeline({ ...base, correct: true, corrector: async () => ({ status: "corrected", model: "test", baseUrl: "http://agent.local/v1", text: "开放时间：早上9点至下午5点。" }) });
    expect(accepted.status).toBe("corrected");
    expect(accepted.correctedTranscript).toBe("开放时间：早上9点至下午5点。");
    expect(accepted.files.correctedTranscript!.path).toBe("transcription/corrected-transcript.txt");

    const rejected = await runAsrPipeline({
      ...base, captureId: "cap_reject", jobId: "job_reject", correct: true,
      corrector: async () => ({ status: "corrected", model: "test", baseUrl: "http://agent.local/v1", text: "开放时间：早上10点至下午6点。" }),
    });
    expect(rejected.status).toBe("raw_ready");
    expect(rejected.correctedTranscript).toBeUndefined();
    expect(rejected.warnings.some((warning) => warning.includes("数字"))).toBe(true);
  });

  it("never overwrites a same-job artifact with different content", async () => {
    const { directory, input, ffmpeg, ffprobe } = await fixtures();
    const request = {
      inputPath: input, outputRoot: join(directory, "materials"), captureId: "cap_conflict", jobId: "job_conflict", modelDirectory: join(directory, "model"), sherpaPython: process.execPath,
      ffmpeg, ffprobe, verifyModel: false,
      runner: async () => ({ text: "第一次", segments: [{ text: "第一次", start: 0, end: 1.2 }] }),
    };
    await runAsrPipeline(request);
    await expect(runAsrPipeline({ ...request, runner: async () => ({ text: "第二次", segments: [{ text: "第二次", start: 0, end: 1.2 }] }) })).rejects.toMatchObject({ code: "ASR_OUTPUT_CONFLICT" });
  });
});
