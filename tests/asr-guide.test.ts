import { describe, expect, it } from "vitest";
import { ASR_GUIDE, asrGuideMarkdown } from "../runtime/asr/guide.js";

describe("ASR guide contract", () => {
  it("keeps ASR outside MCP execution and exposes the fixed local file contract", () => {
    expect(ASR_GUIDE.architecture).toMatchObject({ executor: "agent", mcpExecutesProcessing: false, browserAutomationAllowed: false });
    expect(ASR_GUIDE.model.files).toHaveLength(4);
    expect(ASR_GUIDE.localFiles.expected).toContain("transcription/raw-transcript.json");
    expect(ASR_GUIDE.localFiles.expected).toContain("transcription/correction-packet.json");
  });

  it("renders a readable guide without secrets or private URL placeholders", () => {
    const markdown = asrGuideMarkdown();
    expect(markdown).toContain("# Babel Content Downloader：视频文字提取 Agent 指南");
    expect(markdown).toContain("model.int8.onnx");
    expect(markdown).toContain("BABEL_AGENT_API_KEY");
    expect(markdown).not.toContain("45eb157");
    expect(markdown).not.toContain("xsec_token=");
  });
});
