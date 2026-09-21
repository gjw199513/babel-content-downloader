import { describe, expect, it } from "vitest";
import type { AdapterDefinition, ContentSnapshot } from "../../shared/contracts.js";
import { sampleStableSnapshot, stableSnapshotMaterial } from "../../extension/content/stable-snapshot.js";

const sourceUrl = "https://www.zhihu.com/question/1/answer/2";
const adapter: AdapterDefinition = {
  id: "zhihu",
  version: "2026.09.19.1",
  hosts: ["www.zhihu.com"],
  content_types: ["article"],
  status: "experimental",
  match: url => url.hostname === "www.zhihu.com" && /^\/question\/1\/answer\/[^/]+$/.test(url.pathname),
  completion_rules: [{
    id: "zhihu-answer-terminal-v1",
    content_types: ["article"],
    boundary: "terminal_observed",
    stability: { sample_count: 2, minimum_window_ms: 700 },
    matches: (url, contentId) => url.pathname === `/question/1/answer/${contentId}`,
  }],
};

function snapshot(overrides: Partial<ContentSnapshot> = {}): ContentSnapshot {
  return {
    schema_version: "1", platform: "zhihu", adapter_version: "2026.09.19.1", source_url: sourceUrl, canonical_url: sourceUrl,
    platform_content_id: "2", content_type: "article", authors: ["author"], published_at: null,
    blocks: [{ type: "paragraph", text: "正文" }, { type: "image", asset_id: "image-1" }],
    assets: [{ id: "image-1", role: "image", url: "https://pic.example/one.jpg", order: 0, availability: "available" }],
    access_class: "public_free", completeness: "unknown", warnings: ["COMPLETENESS_NOT_CONFIRMED_BY_BROWSER"],
    ...overrides,
  };
}

function clock(windowMs = 700) {
  let current = 1000;
  const pauses: number[] = [];
  return {
    pauses,
    dependencies: {
      now: () => current,
      pause: async (milliseconds: number) => { pauses.push(milliseconds); current += windowMs; },
      hash: async () => "a".repeat(64),
    },
  };
}

describe("content-script stable snapshot sampling", () => {
  it("returns bounded stability evidence after two identical snapshots over the shipped window", async () => {
    const source = snapshot();
    let reads = 0;
    const timer = clock();
    const result = await sampleStableSnapshot(adapter, new URL(sourceUrl), () => { reads++; return structuredClone(source); }, timer.dependencies);
    expect(reads).toBe(2);
    expect(timer.pauses).toEqual([700]);
    expect(result.stability).toEqual({ sample_count: 2, window_ms: 700, fingerprint: "a".repeat(64) });
    expect(result.snapshot.completeness).toBe("unknown");
  });

  it.each([
    ["content id", (second: ContentSnapshot) => { second.platform_content_id = "3"; }],
    ["body blocks", (second: ContentSnapshot) => { second.blocks[0] = { type: "paragraph", text: "变化正文" }; }],
    ["asset source", (second: ContentSnapshot) => { second.assets[0]!.url = "https://pic.example/two.jpg"; }],
    ["asset order", (second: ContentSnapshot) => { second.assets.unshift({ id: "image-2", role: "image", url: "https://pic.example/two.jpg", order: 0, availability: "available" }); }],
  ])("does not certify stability when %s drifts", async (_label, mutate) => {
    const first = snapshot(); const second = structuredClone(first); mutate(second);
    const samples = [first, second];
    const result = await sampleStableSnapshot(adapter, new URL(sourceUrl), () => samples.shift()!, clock().dependencies);
    expect(result.snapshot).toBe(second);
    expect(result.stability).toBeUndefined();
  });

  it("does not certify a timer that returned before the minimum window", async () => {
    const source = snapshot();
    const result = await sampleStableSnapshot(adapter, new URL(sourceUrl), () => structuredClone(source), clock(699).dependencies);
    expect(result.stability).toBeUndefined();
  });

  it("does not wait or hash for an adapter without a shipped stability rule", async () => {
    const fixture = { ...adapter, completion_rules: adapter.completion_rules!.map(rule => ({ ...rule, stability: undefined })) };
    let reads = 0;
    const timer = clock();
    const result = await sampleStableSnapshot(fixture, new URL(sourceUrl), () => { reads++; return snapshot(); }, timer.dependencies);
    expect(reads).toBe(1);
    expect(timer.pauses).toEqual([]);
    expect(result.stability).toBeUndefined();
  });

  it("uses volatile asset URLs in the comparison material without exposing them in proof fields", () => {
    const first = snapshot();
    const second = snapshot({ assets: [{ ...first.assets[0]!, url: `${first.assets[0]!.url}?token=changed` }] });
    expect(stableSnapshotMaterial(first)).not.toBe(stableSnapshotMaterial(second));
  });
});
