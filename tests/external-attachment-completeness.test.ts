import { describe, expect, it } from "vitest";
import { createAdapterRegistry, DEVELOPMENT_FIXTURE_ORIGIN } from "../adapters/registry.js";
import { extract, finalizeStableCompletion } from "../adapters/shared-extractors/extractor.js";
import type { DomCompletionPlan, PlatformAdapter } from "../adapters/types.js";
import { sampleStableSnapshot } from "../extension/content/stable-snapshot.js";
import { renderDocument } from "../runtime/collection/document.js";
import { contentSnapshotSchema } from "../runtime/bridge/validation.js";
import type { Artifact, ContentSnapshot } from "../shared/contracts.js";
import { evaluateContentCompleteness } from "../shared/completeness.js";
import { FixtureNode, FixturePageReader, node } from "./platforms/fixture-reader.js";

const TARGET = "https://papers.example/abs/123v2";
const ROOT = "[data-paper-body]";
const FILE = "a[data-paper-pdf]";
const RULE_ID = "paper.body-and-external-pdf.v1";

function contentId(url: URL): string | null {
  return /^\/abs\/(\d+v\d+)$/.exec(url.pathname)?.[1] ?? null;
}

function paperAdapter(): PlatformAdapter {
  const fixture = createAdapterRegistry({ fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] }).get("development_fixture");
  if (!fixture) throw new Error("Expected development fixture adapter.");
  const completion: DomCompletionPlan = {
    id: RULE_ID,
    content_types: ["article"],
    applies: url => url.hostname === "papers.example" && contentId(url) !== null,
    content_root: ROOT,
    boundary: { type: "root_exhausted" },
    pending_or_truncation: [],
    external_file_attachment: true,
    stability: { sample_count: 2, minimum_window_ms: 700 },
  };
  let adapter: PlatformAdapter;
  adapter = {
    ...fixture,
    id: "paper_fixture",
    version: "1",
    hosts: ["papers.example"],
    supported_url_patterns: ["/abs/:paperIdvN"],
    asset_hosts: ["papers.example"],
    asset_origins: undefined,
    content_types: ["article"],
    required_document_components: ["files"],
    match: url => url.hostname === "papers.example" && contentId(url) !== null,
    completion_rules: [{
      id: RULE_ID,
      content_types: ["article"],
      boundary: "root_exhausted",
      external_file_attachment: true,
      stability: { sample_count: 2, minimum_window_ms: 700 },
      matches: (url, id) => contentId(url) === id,
    }],
    rule: {
      ...fixture.rule,
      id: "paper_fixture",
      version: "1",
      hosts: ["papers.example"],
      supported_url_patterns: ["/abs/:paperIdvN"],
      content_types: ["article"],
      default_content_type: "article",
      contentId,
      canonicalize: url => new URL(url.href),
      selectors: {
        ...fixture.rule.selectors,
        roots: [ROOT],
        title: [],
        authors: [],
        published: [],
        canonical: [],
        images: ["img[data-paper-image]"],
        videos: [],
        audio: [],
        subtitles: [],
        cover: [],
        files: [FILE],
        asset_scope: "root",
        excluded: [],
      },
      file_matches: (target, asset) => {
        const id = contentId(target);
        return !!id && asset.hostname === "papers.example" && asset.pathname === `/pdf/${id}.pdf`;
      },
      completion: [completion],
    },
    extract: (reader, options) => extract(reader, adapter, options),
  };
  return adapter;
}

function paperReader(options: {
  links?: { href: string; visible?: boolean; id?: string }[];
  bodyImage?: FixtureNode;
} = {}): FixturePageReader {
  const paragraph = node("paragraph", "p", "Bound abstract", {}, [node("text", "#text", "Bound abstract")]);
  const after = node("after", "p", "After figure", {}, [node("after-text", "#text", "After figure")]);
  const children = options.bodyImage ? [paragraph, options.bodyImage, after] : [paragraph];
  const root = node("paper-root", "article", options.bodyImage ? "Bound abstract After figure" : "Bound abstract", { "data-paper-body": "" }, children);
  const links = (options.links ?? [{ href: "/pdf/123v2.pdf?download=1" }]).map((link, index) =>
    new FixtureNode(link.id ?? `pdf-${index}`, "a", "Download PDF", {
      href: link.href,
      title: "Full paper PDF",
      "data-paper-pdf": "",
    }, [], link.visible ?? true));
  const reader = new FixturePageReader(TARGET, "Bound paper").add(ROOT, [root]).add(FILE, links);
  if (options.bodyImage) {
    reader.add("img[data-paper-image]", [options.bodyImage], root).add("img", [options.bodyImage], root);
  }
  return reader;
}

function finalize(snapshot: ContentSnapshot, adapter: PlatformAdapter): ContentSnapshot {
  return finalizeStableCompletion(snapshot, adapter, {
    sample_count: 2,
    window_ms: 700,
    fingerprint: "a".repeat(64),
  });
}

describe("adapter-declared external file attachment completeness", () => {
  it("keeps one exact external PDF separate from body order and binds it in proof", () => {
    const adapter = paperAdapter();
    const image = node("body-image", "img", "", { src: "/assets/figure.png", "data-paper-image": "" });
    const sampled = adapter.extract(paperReader({
      bodyImage: image,
      links: [
        { href: "/pdf/123v2.pdf?mobile=1", visible: false, id: "hidden-mobile" },
        { href: "/pdf/123v2.pdf?desktop=1", id: "visible-desktop" },
      ],
    }));

    expect(sampled.blocks).toEqual([
      { type: "paragraph", text: "Bound abstract" },
      { type: "image", asset_id: "paper_fixture:image:001" },
      { type: "paragraph", text: "After figure" },
    ]);
    expect(sampled.assets).toMatchObject([
      { id: "paper_fixture:image:001", role: "image", availability: "available" },
      { role: "file", availability: "available", title: "Full paper PDF" },
    ]);
    const complete = finalize(sampled, adapter);
    const external = complete.assets.find(asset => asset.role === "file")!;
    expect(complete.completeness_proof).toMatchObject({
      ordered_asset_count: 1,
      unplaced_asset_count: 0,
      external_file_asset_id: external.id,
    });
    expect(contentSnapshotSchema.safeParse(complete).success).toBe(true);
    expect(evaluateContentCompleteness(complete, { adapter, urls: [new URL(TARGET)] })).toEqual({ valid: true, complete: true });

    const artifact: Artifact = {
      role: "file",
      path: "/tmp/paper-delivery/assets/paper.pdf",
      media_type: "application/pdf",
      size: 1,
      sha256: "b".repeat(64),
      source_asset_id: external.id,
    };
    const document = renderDocument(complete, [artifact], "/tmp/paper-delivery");
    expect(document.indexOf("Bound abstract")).toBeLessThan(document.indexOf("After figure"));
    expect(document.indexOf("After figure")).toBeLessThan(document.indexOf("[Full paper PDF](assets/paper.pdf)"));
  });

  it.each([
    ["wrong paper version", [{ href: "/pdf/123v3.pdf" }]],
    ["duplicate visible controls", [{ href: "/pdf/123v2.pdf", id: "one" }, { href: "/pdf/123v2.pdf", id: "two" }]],
  ])("does not certify %s and never fabricates a body file position", (_label, links) => {
    const adapter = paperAdapter();
    const snapshot = finalize(adapter.extract(paperReader({ links })), adapter);
    expect(snapshot.completeness).toBe("unknown");
    expect(snapshot.completeness_proof).toBeUndefined();
    expect(snapshot.blocks.some(block => block.type === "file")).toBe(false);
  });

  it("rejects wrong-role, body-positioned, undeclared and missing external evidence", () => {
    const adapter = paperAdapter();
    const complete = finalize(adapter.extract(paperReader()), adapter);
    const externalId = complete.completeness_proof!.external_file_asset_id!;

    const wrongRole = structuredClone(complete);
    wrongRole.assets[0]!.role = "image";
    expect(evaluateContentCompleteness(wrongRole, { adapter, urls: [new URL(TARGET)] }))
      .toMatchObject({ valid: false, issue: { code: "EXTERNAL_FILE_ASSET_ROLE_INVALID" } });

    const inBody = structuredClone(complete);
    inBody.blocks.push({ type: "file", asset_id: externalId });
    expect(evaluateContentCompleteness(inBody, { adapter, urls: [new URL(TARGET)] }))
      .toMatchObject({ valid: false, issue: { code: "EXTERNAL_FILE_ASSET_IN_BODY" } });

    const undeclaredAdapter: PlatformAdapter = {
      ...adapter,
      completion_rules: adapter.completion_rules!.map(rule => ({ ...rule, external_file_attachment: undefined })),
    };
    expect(evaluateContentCompleteness(complete, { adapter: undeclaredAdapter, urls: [new URL(TARGET)] }))
      .toMatchObject({ valid: false, issue: { code: "EXTERNAL_FILE_ASSET_UNDECLARED" } });

    const missing = structuredClone(complete);
    missing.completeness_proof!.external_file_asset_id = "missing-file";
    expect(evaluateContentCompleteness(missing, { adapter, urls: [new URL(TARGET)] }))
      .toMatchObject({ valid: false, issue: { code: "EXTERNAL_FILE_ASSET_MISSING" } });
  });

  it("does not let external-file evidence exempt an unplaced body image", () => {
    const adapter = paperAdapter();
    const complete = finalize(adapter.extract(paperReader()), adapter);
    complete.assets.push({
      id: "unplaced-image",
      role: "image",
      url: "https://papers.example/assets/unplaced.png",
      order: 2,
      availability: "available",
    });
    expect(evaluateContentCompleteness(complete, { adapter, urls: [new URL(TARGET)] }))
      .toMatchObject({ valid: false, issue: { code: "BLOCK_ASSET_SET_MISMATCH" } });
  });

  it("refuses stable completion when the exact attachment URL drifts between samples", async () => {
    const adapter = paperAdapter();
    const readers = [
      paperReader({ links: [{ href: "/pdf/123v2.pdf?signature=first" }] }),
      paperReader({ links: [{ href: "/pdf/123v2.pdf?signature=second" }] }),
    ];
    let now = 1_000;
    const sampled = await sampleStableSnapshot(adapter, new URL(TARGET), () => adapter.extract(readers.shift()!), {
      now: () => now,
      pause: async milliseconds => { now += milliseconds; },
      hash: async () => "c".repeat(64),
    });
    expect(sampled.stability).toBeUndefined();
    expect(sampled.snapshot.completeness).toBe("unknown");
  });
});
