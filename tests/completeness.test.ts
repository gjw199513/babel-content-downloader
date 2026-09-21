import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterDefinition, ContentSnapshot, JobRecord } from "../shared/contracts.js";
import { evaluateContentCompleteness } from "../shared/completeness.js";
import { contentSnapshotSchema } from "../runtime/bridge/validation.js";
import { JobStore } from "../runtime/storage/job-store.js";

const sourceUrl = "https://example.com/articles/item-1";
const adapter: AdapterDefinition = {
  id: "example",
  version: "2",
  hosts: ["example.com"],
  content_types: ["article"],
  status: "experimental",
  match: url => url.hostname === "example.com" && /^\/articles\/[^/]+$/.test(url.pathname),
  completion_rules: [{
    id: "article-terminal-v1",
    content_types: ["article"],
    boundary: "terminal_observed",
    stability: { sample_count: 2, minimum_window_ms: 700 },
    matches: (url, contentId) => url.pathname === `/articles/${contentId}`,
  }],
};

function snapshot(): ContentSnapshot {
  return {
    schema_version: "1",
    platform: "example",
    adapter_version: "2",
    source_url: sourceUrl,
    canonical_url: sourceUrl,
    platform_content_id: "item-1",
    content_type: "article",
    title: "Bound source item",
    authors: [],
    published_at: null,
    blocks: [{ type: "paragraph", text: "Body" }, { type: "image", asset_id: "image-1" }],
    assets: [{ id: "image-1", role: "image", url: "https://example.com/image.jpg", order: 0, availability: "available" }],
    access_class: "public_free",
    completeness: "complete",
    completeness_proof: {
      version: 1,
      scope: "single_item",
      method: "adapter_bounded_dom",
      rule_id: "article-terminal-v1",
      platform_content_id: "item-1",
      boundary: "terminal_observed",
      pending_marker_count: 0,
      ordered_asset_count: 1,
      unplaced_asset_count: 0,
      stability: { sample_count: 2, window_ms: 700, fingerprint: "a".repeat(64) },
    },
    warnings: [],
  };
}

const binding = { adapter, urls: [new URL(sourceUrl)] };

describe("per-capture content completeness", () => {
  it("accepts current-page HTTP receipts only for the runtime webpage pipeline", () => {
    const page = snapshot();
    page.platform = "web_page";
    page.completeness_proof = {
      ...page.completeness_proof!, method: "http_page_capture", boundary: "response_received",
      rule_id: "web_page.http-response.v1",
    };
    delete page.completeness_proof.stability;
    const pageAdapter: AdapterDefinition = {
      ...adapter, id: "web_page", completion_rules: [{
        id: "web_page.http-response.v1", content_types: ["article"], boundary: "response_received",
        matches: (url, id) => url.href === sourceUrl && id === "item-1",
      }],
    };
    expect(evaluateContentCompleteness(page, { adapter: pageAdapter, urls: [new URL(sourceUrl)] })).toEqual({ valid: true, complete: true });
    // Browser messages cannot forge runtime-only HTTP receipts.
    expect(contentSnapshotSchema.safeParse(page).success).toBe(false);
    expect(evaluateContentCompleteness({ ...page, platform: "example" })).toMatchObject({ valid: false });
    expect(evaluateContentCompleteness({ ...page, access_class: "login_public_free" })).toMatchObject({ valid: false });
    expect(evaluateContentCompleteness({ ...page, assets: [] })).toMatchObject({ valid: false });
    expect(evaluateContentCompleteness(page, { adapter: pageAdapter, urls: [new URL("https://other.example/article")] })).toMatchObject({ valid: false });
    expect(evaluateContentCompleteness({ ...page, completeness_proof: { ...page.completeness_proof, boundary: "root_exhausted" } })).toMatchObject({ valid: false });
  });

  it("binds browser current-page receipts independently of HTTP and platform stability proofs", () => {
    const page = snapshot();
    page.platform = "web_page";
    page.completeness_proof = { version: 1, scope: "single_item", method: "browser_page_capture", boundary: "dom_read",
      rule_id: "web_page.browser-document.v1", platform_content_id: "item-1", pending_marker_count: 0, ordered_asset_count: 1, unplaced_asset_count: 0 };
    const pageAdapter: AdapterDefinition = { ...adapter, id: "web_page", completion_rules: [{
      id: "web_page.browser-document.v1", content_types: ["article"], boundary: "dom_read",
      matches: (url, id) => url.href === sourceUrl && id === "item-1",
    }] };
    expect(evaluateContentCompleteness(page, { adapter: pageAdapter, urls: [new URL(sourceUrl)] })).toEqual({ valid: true, complete: true });
    for (const patch of [ { method: "http_page_capture" }, { boundary: "response_received" }, { rule_id: "web_page.http-response.v1" },
      { stability: { sample_count: 2, window_ms: 700, fingerprint: "a".repeat(64) } } ]) {
      expect(evaluateContentCompleteness({ ...page, completeness_proof: { ...page.completeness_proof, ...patch } as ContentSnapshot["completeness_proof"] })).toMatchObject({ valid: false });
    }
    expect(evaluateContentCompleteness({ ...page, platform: "example" })).toMatchObject({ valid: false });
    expect(evaluateContentCompleteness({ ...page, access_class: "login_public_free" }, { adapter: pageAdapter, urls: [new URL(sourceUrl)] })).toEqual({ valid: true, complete: true });
    expect(evaluateContentCompleteness({ ...page, access_class: "unknown" })).toMatchObject({ valid: false });
    expect(evaluateContentCompleteness({ ...page, assets: [{ ...page.assets[0]!, role: "file" }], blocks: [{ type: "file", asset_id: "image-1" }] })).toMatchObject({ valid: false, issue: { code: "CONTENT_TYPE_NOT_ALLOWED" } });
    expect(evaluateContentCompleteness(page, { adapter: pageAdapter, urls: [new URL("https://example.com/articles/other")] })).toMatchObject({ valid: false });
    expect(evaluateContentCompleteness({ ...page, assets: [] })).toMatchObject({ valid: false });
  });

  it("accepts a structurally complete proof bound to its adapter route, type, id, and version", () => {
    expect(evaluateContentCompleteness(snapshot(), binding)).toEqual({ valid: true, complete: true });
  });

  it("keeps old partial captures usable but never trusts a bare complete claim", () => {
    const legacy = snapshot();
    legacy.completeness = "unknown";
    delete legacy.completeness_proof;
    expect(evaluateContentCompleteness(legacy, binding)).toEqual({ valid: true, complete: false });

    const bare = snapshot();
    delete bare.completeness_proof;
    expect(evaluateContentCompleteness(bare, binding)).toMatchObject({ valid: false, issue: { code: "PROOF_REQUIRED" } });
  });

  it.each([
    ["version", 2, "PROOF_VERSION_UNSUPPORTED"],
    ["scope", "feed", "PROOF_SCOPE_UNSUPPORTED"],
    ["method", "page_says_complete", "PROOF_METHOD_UNSUPPORTED"],
    ["boundary", "guessed", "PROOF_BOUNDARY_INVALID"],
    ["pending_marker_count", 1, "PENDING_MARKERS_PRESENT"],
    ["unplaced_asset_count", 1, "UNPLACED_ASSETS_PRESENT"],
    ["ordered_asset_count", -1, "ORDERED_ASSET_COUNT_INVALID"],
    ["ordered_asset_count", 1.5, "ORDERED_ASSET_COUNT_INVALID"],
    ["ordered_asset_count", 2001, "ORDERED_ASSET_COUNT_INVALID"],
  ])("rejects malformed persisted proof field %s", (field, value, code) => {
    const persisted = JSON.parse(JSON.stringify(snapshot())) as ContentSnapshot;
    (persisted.completeness_proof as unknown as Record<string, unknown>)[field] = value;
    expect(evaluateContentCompleteness(persisted, binding)).toMatchObject({ valid: false, issue: { code } });
  });

  it("rechecks proof literals after a real persistent job-store round trip", async () => {
    const directory = await mkdtemp(join(tmpdir(), "babel-completeness-store-"));
    const store = new JobStore(directory);
    await store.init();
    try {
      const persistedSnapshot = snapshot();
      (persistedSnapshot.completeness_proof as unknown as Record<string, unknown>).pending_marker_count = 1;
      const now = new Date().toISOString();
      const job: JobRecord = {
        id: "job_00000000-0000-4000-8000-000000000010",
        client_id: "test",
        request: { target: { type: "url", url: sourceUrl }, save_as: "document", output: { directory } },
        status: "blocked", stage: "resolving", created_at: now, updated_at: now,
        snapshot: persistedSnapshot, artifacts: [], completeness: { requested_components_complete: false, scope: "single_item" },
        warnings: [], attempts: 1,
      };
      await store.put(job);
      const loaded = await store.get(job.id);
      expect(loaded?.snapshot).toBeDefined();
      expect(evaluateContentCompleteness(loaded!.snapshot!, binding)).toMatchObject({ valid: false, issue: { code: "PENDING_MARKERS_PRESENT" } });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires the ordered block asset set to equal the non-cover source asset set", () => {
    const source = snapshot();
    source.assets.push({ id: "image-2", role: "image", url: "https://example.com/second.jpg", order: 1, availability: "available" });
    expect(evaluateContentCompleteness(source, binding)).toMatchObject({ valid: false, issue: { code: "BLOCK_ASSET_SET_MISMATCH" } });

    source.blocks.push({ type: "image", asset_id: "image-2" });
    expect(evaluateContentCompleteness(source, binding)).toMatchObject({ valid: false, issue: { code: "ORDERED_ASSET_COUNT_MISMATCH" } });
  });

  it("rejects an unknown rule and a rule that does not bind every task/source route", () => {
    const unknownRule = snapshot();
    unknownRule.completeness_proof!.rule_id = "not-advertised";
    expect(evaluateContentCompleteness(unknownRule, binding)).toMatchObject({ valid: false, issue: { code: "COMPLETION_RULE_UNKNOWN" } });

    expect(evaluateContentCompleteness(snapshot(), { adapter, urls: [new URL("https://example.com/articles/other-item")] }))
      .toMatchObject({ valid: false, issue: { code: "COMPLETION_ROUTE_MISMATCH" } });
  });

  it("rejects a weaker boundary than the named completion rule requires", () => {
    const source = snapshot();
    source.completeness_proof!.boundary = "root_exhausted";
    expect(evaluateContentCompleteness(source, binding)).toMatchObject({ valid: false, issue: { code: "COMPLETION_BOUNDARY_MISMATCH" } });
  });

  it("binds stable samples and their observation window to the named rule", () => {
    const missing = snapshot(); delete missing.completeness_proof!.stability;
    expect(evaluateContentCompleteness(missing, binding)).toMatchObject({ valid: false, issue: { code: "STABILITY_PROOF_REQUIRED" } });

    const tooSoon = snapshot(); tooSoon.completeness_proof!.stability!.window_ms = 699;
    expect(evaluateContentCompleteness(tooSoon, binding)).toMatchObject({ valid: false, issue: { code: "STABILITY_WINDOW_INSUFFICIENT" } });

    const unconfiguredAdapter: AdapterDefinition = { ...adapter, completion_rules: adapter.completion_rules!.map(rule => ({ ...rule, stability: undefined })) };
    expect(evaluateContentCompleteness(snapshot(), { adapter: unconfiguredAdapter, urls: [new URL(sourceUrl)] }))
      .toMatchObject({ valid: false, issue: { code: "STABILITY_PROOF_UNDECLARED" } });
  });

  it("rejects adapter version, content type, and content-id drift", () => {
    const version = snapshot(); version.adapter_version = "1";
    expect(evaluateContentCompleteness(version, binding)).toMatchObject({ valid: false, issue: { code: "ADAPTER_VERSION_MISMATCH" } });

    const contentType = snapshot(); contentType.content_type = "post";
    expect(evaluateContentCompleteness(contentType, binding)).toMatchObject({ valid: false, issue: { code: "CONTENT_TYPE_NOT_ALLOWED" } });

    const contentId = snapshot(); contentId.completeness_proof!.platform_content_id = "other-item";
    expect(evaluateContentCompleteness(contentId, binding)).toMatchObject({ valid: false, issue: { code: "CONTENT_ID_MISMATCH" } });
  });
});
