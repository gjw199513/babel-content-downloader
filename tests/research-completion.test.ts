import { describe, expect, it } from "vitest";
import { createAdapterRegistry } from "../adapters/registry.js";
import { extract, finalizeStableCompletion } from "../adapters/shared-extractors/extractor.js";
import { AdapterExtractionError, type PlatformAdapter } from "../adapters/types.js";
import { sampleStableSnapshot } from "../extension/content/stable-snapshot.js";
import { contentSnapshotSchema } from "../runtime/bridge/validation.js";
import { FixturePageReader, node, type FixtureNode } from "./platforms/fixture-reader.js";

const registry = createAdapterRegistry();

const GITHUB_README_ROOT = "article.markdown-body.entry-content.container-lg";
const GITHUB_FALLBACK_ROOT = "div[data-pjax='true'][data-test-selector='body-content'].markdown-body";
const GITHUB_CURRENT_PUBLIC = "#repo-title-component span.mr-1.v-align-middle.prc-Label-Label-qG-Zu";
const HF_MODEL_ROOT = "div.model-card-content.prose.hf-sanitized.copiable-code-container";
const HF_DATASET_ROOT = "div.prose.pl-6.-ml-6.hf-sanitized.copiable-code-container";
const HF_DATASET_HEADER = "div.SVELTE_HYDRATER.contents[data-target='DatasetHeader'][data-props]";
const HF_MODEL_HEADER = "div.SVELTE_HYDRATER.contents[data-target='ModelHeader'][data-props]";
const HF_PAPER_SECTION = "main > div.container > section.md\\:col-span-7:has(div.SVELTE_HYDRATER.contents > div.pb-8.pr-4.md\\:pr-16)";
const HF_PAPER_BODY = `${HF_PAPER_SECTION} > div.SVELTE_HYDRATER.contents > div.pb-8.pr-4.md\\:pr-16`;
const HF_PAPER_HEADER = `${HF_PAPER_SECTION} > div.SVELTE_HYDRATER.contents > div.pb-10.md\\:pt-3`;
const HF_PAPER_GENERATED_SUMMARY = `${HF_PAPER_BODY} > div.flex.flex-col.gap-y-2\\.5 > div.bg-blue-500\\/6`;
const ANTHROPIC_ENGINEERING_ROOT = "main#main-content:has(> section[aria-label='Engineering Article Hero'])";

function adapter(id: "github" | "huggingface" | "arxiv" | "anthropic_blog" | "deepmind_blog"): PlatformAdapter {
  const value = registry.get(id);
  if (!value) throw new Error(`Expected ${id} adapter.`);
  return value;
}

function finalProof(snapshot: ReturnType<PlatformAdapter["extract"]>, value: PlatformAdapter) {
  return finalizeStableCompletion(snapshot, value, {
    sample_count: 2,
    window_ms: 700,
    fingerprint: "a".repeat(64),
  });
}

function stableClock() {
  let now = 10;
  return {
    now: () => now,
    pause: async (milliseconds: number) => { now += milliseconds; },
    hash: async () => "b".repeat(64),
  };
}

async function sampledProof(value: PlatformAdapter, url: string, read: () => ReturnType<PlatformAdapter["extract"]>) {
  const sampled = await sampleStableSnapshot(value, new URL(url), read, stableClock());
  expect(sampled.stability).toEqual({ sample_count: 2, window_ms: 700, fingerprint: "b".repeat(64) });
  return finalizeStableCompletion(sampled.snapshot, value, sampled.stability!);
}

type GitHubFixtureOptions = {
  rootSelector?: typeof GITHUB_README_ROOT | typeof GITHUB_FALLBACK_ROOT;
  roots?: FixtureNode[];
  loading?: boolean;
  error?: boolean;
  iframe?: boolean;
  body?: string;
};

function githubReader(options: GitHubFixtureOptions = {}): FixturePageReader {
  const rootSelector = options.rootSelector ?? GITHUB_README_ROOT;
  const body = options.body ?? "A readable source paragraph.";
  const title = node("github-title", "h1", "OpenAI Python API library");
  const prose = node("github-prose", "p", body, {}, [node("github-prose-text", "#text", body)]);
  const badge = node("github-badge", "img", "", { src: "https://camo.githubusercontent.com/proxy/pypi-badge" });
  const children = [title, prose, badge];
  if (options.loading) children.push(node("github-loading", "div", "Loading source content", { "aria-busy": "true" }));
  if (options.error) children.push(node("github-error", "include-fragment", "Uh oh! There was an error while loading.", { class: "is-error" }));
  if (options.iframe) children.push(node("github-unmapped-frame", "iframe", "", { src: "https://github.com/openai/openai-python/embed" }));
  const root = node("github-root", rootSelector === GITHUB_README_ROOT ? "article" : "div", body, {}, children);
  const roots = options.roots ?? [root];
  const marker = node("github-public", "span", "Public");
  const reader = new FixturePageReader("https://github.com/openai/openai-python", "OpenAI Python API library")
    .add(rootSelector, roots)
    .add(GITHUB_CURRENT_PUBLIC, [marker]);

  for (const current of roots) {
    reader
      .add(`${rootSelector} h1`, [title], current)
      .add(`${rootSelector} img`, [badge], current);
    if (options.loading) reader.add("[aria-busy='true']", [children.find(child => child.id === "github-loading")!], current);
    if (options.error) reader.add("include-fragment.is-error", [children.find(child => child.id === "github-error")!], current);
  }
  return reader;
}

type HuggingFaceModelFixtureOptions = {
  body?: string;
  roots?: FixtureNode[];
  headerId?: string;
  gated?: boolean;
  loading?: boolean;
};

function huggingFaceModelRoot(id: string, body: string, loading = false): FixtureNode {
  const title = node(`${id}-title`, "h1", "all-MiniLM-L6-v2");
  const prose = node(`${id}-prose`, "p", body, {}, [node(`${id}-text`, "#text", body)]);
  const children = [title, prose];
  if (loading) children.push(node(`${id}-loading`, "div", "Loading model card", { "aria-busy": "true" }));
  return node(id, "div", `all-MiniLM-L6-v2 ${body}`, {}, children);
}

function huggingFaceModelReader(options: HuggingFaceModelFixtureOptions = {}): FixturePageReader {
  const body = options.body ?? "A public model card with reproducible usage instructions.";
  const roots = options.roots ?? [huggingFaceModelRoot("hf-model-root", body, options.loading)];
  const headerId = options.headerId ?? "sentence-transformers/all-MiniLM-L6-v2";
  const header = node("hf-model-public-header", "div", "", {
    "data-target": "ModelHeader",
    "data-props": JSON.stringify({
      model: { id: headerId, repoType: "model", private: false, gated: options.gated ?? false },
    }),
  });
  const reader = new FixturePageReader(
    "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2",
    "sentence-transformers/all-MiniLM-L6-v2",
  ).add(HF_MODEL_ROOT, roots).add(HF_MODEL_HEADER, [header]);
  for (const root of roots) {
    const title = root.childrenNodes.find(child => child.tag === "h1");
    if (title) reader.add(`${HF_MODEL_ROOT} h1`, [title], root);
    if (options.loading) {
      const loading = root.childrenNodes.find(child => child.attrs["aria-busy"] === "true");
      if (loading) reader.add("[aria-busy='true']", [loading], root);
    }
  }
  return reader;
}

type HuggingFaceDatasetFixtureOptions = {
  body?: string;
  roots?: FixtureNode[];
  headerId?: string;
  gated?: boolean;
  private?: boolean;
  loading?: boolean;
};

function huggingFaceDatasetRoot(id: string, body: string, loading = false): FixtureNode {
  const title = node(`${id}-title`, "h1", "all-nli");
  const prose = node(`${id}-prose`, "p", body, {}, [node(`${id}-text`, "#text", body)]);
  const children = [title, prose];
  if (loading) children.push(node(`${id}-loading`, "div", "Loading dataset card", { "aria-busy": "true" }));
  return node(id, "div", `all-nli ${body}`, {}, children);
}

function huggingFaceDatasetReader(options: HuggingFaceDatasetFixtureOptions = {}): FixturePageReader {
  const body = options.body ?? "A public dataset card with reproducible usage instructions.";
  const roots = options.roots ?? [huggingFaceDatasetRoot("hf-dataset-root", body, options.loading)];
  const headerId = options.headerId ?? "sentence-transformers/all-nli";
  const header = node("hf-dataset-public-header", "div", "", {
    "data-target": "DatasetHeader",
    "data-props": JSON.stringify({
      dataset: { id: headerId, repoType: "dataset", private: options.private ?? false, gated: options.gated ?? false },
    }),
  });
  const reader = new FixturePageReader(
    "https://huggingface.co/datasets/sentence-transformers/all-nli",
    "sentence-transformers/all-nli",
  ).add(HF_DATASET_ROOT, roots).add(HF_DATASET_HEADER, [header]);
  for (const root of roots) {
    const title = root.childrenNodes.find(child => child.tag === "h1");
    if (title) reader.add(`${HF_DATASET_ROOT} h1`, [title], root);
    if (options.loading) {
      const loading = root.childrenNodes.find(child => child.attrs["aria-busy"] === "true");
      if (loading) reader.add("[aria-busy='true']", [loading], root);
    }
  }
  return reader;
}

function huggingFacePaperReader(): FixturePageReader {
  const title = node("hf-paper-title", "h1", "Attention Is All You Need");
  const author = node("hf-paper-author", "div", "Ashish Vaswani");
  const published = node("hf-paper-published", "div", "Published on Jun 13, 2017");
  const header = node("hf-paper-header", "div", "Attention Is All You Need Ashish Vaswani Published on Jun 13, 2017", {}, [title, author, published]);
  const abstractHeading = node("hf-abstract-heading", "h2", "Abstract");
  const generated = node("hf-generated", "div", "A generated summary Generated by Qwen", {}, [node("hf-generated-text", "p", "A generated summary Generated by Qwen")]);
  const source = node("hf-source-abstract", "p", "The source paper abstract is preserved.", {}, [node("hf-source-abstract-text", "#text", "The source paper abstract is preserved.")]);
  const abstractBody = node("hf-paper-body", "div", "Abstract A generated summary Generated by Qwen The source paper abstract is preserved.", {}, [abstractHeading, generated, source]);
  const hydrator = node("hf-hydrator", "div", "Attention Is All You Need Abstract The source paper abstract is preserved.", {}, [header, abstractBody]);
  const section = node("hf-paper-section", "section", "Attention Is All You Need Abstract The source paper abstract is preserved.", {}, [hydrator]);
  return new FixturePageReader("https://huggingface.co/papers/1706.03762", "Attention Is All You Need")
    .add(HF_PAPER_BODY, [abstractBody])
    .add(HF_PAPER_SECTION, [section])
    .add(`${HF_PAPER_HEADER} h1.mb-2`, [title], section)
    .add(`${HF_PAPER_HEADER} div.relative.flex.flex-wrap.items-center.gap-2.text-base.leading-tight > div.relative`, [author], section)
    .add(`${HF_PAPER_HEADER} div.mb-6.flex.flex-wrap.gap-2.text-sm.text-gray-500 > div`, [published], section)
    .add(HF_PAPER_GENERATED_SUMMARY, [generated], abstractBody);
}

function anthropicEngineeringReader(): FixturePageReader {
  const title = node("anthropic-title", "h1", "Effective context engineering for AI agents");
  const published = node("anthropic-published", "p", "Published Sep 29, 2025");
  const summary = node("anthropic-summary", "p", "Context is a critical but finite resource.", {}, [node("anthropic-summary-text", "#text", "Context is a critical but finite resource.")]);
  const image = node("anthropic-hero-image", "img", "", { src: "https://www.anthropic.com/_next/image?url=hero.png" });
  const hub = node("anthropic-hub", "a", "Engineering at Anthropic", { href: "/engineering" });
  const hero = node("anthropic-hero", "section", "Effective context engineering Context is a critical but finite resource.", { "aria-label": "Engineering Article Hero" }, [hub, title, published, summary, image]);
  const articleText = node("anthropic-article-text", "p", "Article source body.", {}, [node("anthropic-article-text-node", "#text", "Article source body.")]);
  const article = node("anthropic-article", "article", "Article source body.", {}, [articleText]);
  const newsletter = node("anthropic-newsletter", "div", "Get the developer newsletter", { class: "NewsletterSubscribe-module__wrapper" }, [node("anthropic-newsletter-text", "p", "Get the developer newsletter")]);
  const wrapper = node("anthropic-page-wrapper", "div", "Article source body. Get the developer newsletter", { class: "page-wrapper" }, [article, newsletter]);
  const root = node("anthropic-main", "main", "Effective context engineering Context is a critical but finite resource. Article source body. Get the developer newsletter", {}, [hero, wrapper]);
  return new FixturePageReader("https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents", "Effective context engineering for AI agents")
    .add(ANTHROPIC_ENGINEERING_ROOT, [root])
    .add("section[aria-label='Engineering Article Hero'] h1", [title], root)
    .add("section[aria-label='Engineering Article Hero'] p[class*='__date']", [published], root)
    .add("section[aria-label='Engineering Article Hero'] > a[href='/engineering']", [hub], root)
    .add("img", [image], root)
    .add("main#main-content > div.page-wrapper > div[class*='NewsletterSubscribe']", [newsletter], root);
}

function deepMindPublicationReader(copyUrl = "https://deepmind.google/research/publications/265605/"): FixturePageReader {
  const title = node("deepmind-title", "h1", "Designing Proactive Thought Partners for Writing");
  const date = node("deepmind-date", "span", "September 1, 2026");
  const copy = node("deepmind-copy", "button", "Copied", { "data-copy-url": copyUrl });
  const share = node("deepmind-share", "button", "Share", { "aria-expanded": "false" });
  const abstractTitle = node("deepmind-abstract-title", "h2", "Abstract");
  const abstract = node("deepmind-abstract", "p", "Writing involves diverse cognitive activities.", {}, [node("deepmind-abstract-text", "#text", "Writing involves diverse cognitive activities.")]);
  const authors = node("deepmind-authors", "div", "Chao Zhang, Abe Davis");
  const venue = node("deepmind-venue", "div", "Venue: arXiv");
  const download = node("deepmind-download", "a", "Download", { href: "https://arxiv.org/pdf/2609.01588", "data-event-content-name": "Download" });
  const viewPublication = node("deepmind-view-publication", "a", "View publication", { href: "https://arxiv.org/abs/2609.01588", "data-event-content-name": "View publication" });
  const root = node("deepmind-root", "main", "Designing Proactive Thought Partners Abstract Writing involves diverse cognitive activities. Chao Zhang Venue arXiv Download", {}, [title, date, copy, share, abstractTitle, abstract, authors, venue, download, viewPublication]);
  return new FixturePageReader("https://deepmind.google/research/publications/265605/", "Designing Proactive Thought Partners for Writing")
    .add("main#page-content", [root])
    .add(".share-list__item--copy[data-copy-url]", [copy], root)
    .add(".share-toggle__button", [share], root)
    .add(".section-title__title", [title], root)
    .add(".section-title__date", [date], root)
    .add(".publication-authors__content", [authors], root)
    .add("a[data-event-content-name='Download'][href*='arxiv.org/pdf/']", [download], root)
    .add(".publication-actions a[data-event-content-name='View publication']", [viewPublication], root);
}

describe("evidence-bounded research completion plans", () => {
  it.each([
    ["GitHub README", "github", "https://github.com/openai/openai-python", "github.public-readme.markdown-root.v1", () => githubReader()],
    ["Hugging Face model card", "huggingface", "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2", "huggingface.model.public-card-root.v1", () => huggingFaceModelReader()],
    ["Hugging Face dataset card", "huggingface", "https://huggingface.co/datasets/sentence-transformers/all-nli", "huggingface.dataset.public-card-root.v1", () => huggingFaceDatasetReader()],
    ["Hugging Face paper", "huggingface", "https://huggingface.co/papers/1706.03762", "huggingface.paper.abstract-root.v1", huggingFacePaperReader],
    ["Anthropic engineering", "anthropic_blog", "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents", "anthropic.engineering.main-root.v1", anthropicEngineeringReader],
    ["DeepMind publication", "deepmind_blog", "https://deepmind.google/research/publications/265605/", "deepmind.publication.main-root.v1", deepMindPublicationReader],
  ] as const)("certifies only a stable, fully mapped %s root", async (_label, id, url, ruleId, makeReader) => {
    const value = adapter(id);
    const snapshot = value.extract(makeReader());
    expect(snapshot.completeness).toBe("unknown");
    expect(value.completion_rules).toContainEqual(expect.objectContaining({
      id: ruleId,
      boundary: "root_exhausted",
      stability: { sample_count: 2, minimum_window_ms: 700 },
    }));

    const complete = await sampledProof(value, url, () => value.extract(makeReader()));
    expect(complete).toMatchObject({
      completeness: "complete",
      completeness_proof: {
        rule_id: ruleId,
        boundary: "root_exhausted",
        stability: { sample_count: 2, window_ms: 700, fingerprint: "b".repeat(64) },
      },
    });
    expect(contentSnapshotSchema.safeParse(complete).success).toBe(true);
  });

  it("keeps root-local loading, error, and unmapped iframe media from certifying a GitHub README", () => {
    const value = adapter("github");
    for (const [label, reader] of [
      ["loading", githubReader({ loading: true })],
      ["error", githubReader({ error: true })],
      ["iframe", githubReader({ iframe: true })],
    ] as const) {
      const snapshot = value.extract(reader);
      expect(finalProof(snapshot, value).completeness, label).toBe("unknown");
    }
  });

  it("does not certify an arbitrary fallback root, duplicate exact root, or absent GitHub root", async () => {
    const value = adapter("github");
    const fallback = await sampledProof(value, "https://github.com/openai/openai-python", () => value.extract(githubReader({ rootSelector: GITHUB_FALLBACK_ROOT })));
    expect(fallback.completeness).toBe("unknown");

    const first = node("github-duplicate-first", "article", "First readable source", {}, [node("github-duplicate-first-text", "p", "First readable source")]);
    const second = node("github-duplicate-second", "article", "Second readable source", {}, [node("github-duplicate-second-text", "p", "Second readable source")]);
    const duplicate = value.extract(githubReader({ roots: [first, second] }));
    expect(finalProof(duplicate, value).completeness).toBe("unknown");

    expect(() => value.extract(new FixturePageReader("https://github.com/openai/openai-python", "Missing README")
      .add(GITHUB_CURRENT_PUBLIC, [node("github-missing-public", "span", "Public")]))).toThrow(AdapterExtractionError);
  });

  it("does not produce stability evidence when a README body changes between samples", async () => {
    const value = adapter("github");
    const samples = [githubReader({ body: "First source body." }), githubReader({ body: "Changed source body." })];
    const result = await sampleStableSnapshot(value, new URL("https://github.com/openai/openai-python"), () => value.extract(samples.shift()!), stableClock());
    expect(result.stability).toBeUndefined();
    expect(result.snapshot.completeness).toBe("unknown");
  });

  it("keeps a Hugging Face model unknown when its public identity, gate, unique root, pending state, or stable body is unproven", async () => {
    const value = adapter("huggingface");
    for (const [label, reader] of [
      ["wrong route identity", huggingFaceModelReader({ headerId: "sentence-transformers/other-model" })],
      ["gated", huggingFaceModelReader({ gated: true })],
    ] as const) {
      try {
        value.extract(reader);
        throw new Error(`${label} unexpectedly extracted`);
      } catch (error) {
        expect(error, label).toMatchObject({ code: "ACCESS_UNCONFIRMED" });
      }
    }

    const duplicateRoots = [
      huggingFaceModelRoot("hf-model-root-one", "First visible model card."),
      huggingFaceModelRoot("hf-model-root-two", "Second visible model card."),
    ];
    const duplicate = value.extract(huggingFaceModelReader({ roots: duplicateRoots }));
    expect(finalProof(duplicate, value).completeness).toBe("unknown");

    const pending = value.extract(huggingFaceModelReader({ loading: true }));
    expect(finalProof(pending, value).completeness).toBe("unknown");

    const samples = [
      huggingFaceModelReader({ body: "First stable-sample body." }),
      huggingFaceModelReader({ body: "Changed stable-sample body." }),
    ];
    const changed = await sampleStableSnapshot(
      value,
      new URL("https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2"),
      () => value.extract(samples.shift()!),
      stableClock(),
    );
    expect(changed.stability).toBeUndefined();
    expect(changed.snapshot.completeness).toBe("unknown");
  });

  it("keeps a Hugging Face dataset unknown when its public identity, gate, unique root, pending state, or stable body is unproven", async () => {
    const value = adapter("huggingface");
    for (const [label, reader] of [
      ["wrong route identity", huggingFaceDatasetReader({ headerId: "sentence-transformers/other-dataset" })],
      ["gated", huggingFaceDatasetReader({ gated: true })],
      ["private", huggingFaceDatasetReader({ private: true })],
    ] as const) {
      try {
        value.extract(reader);
        throw new Error(`${label} unexpectedly extracted`);
      } catch (error) {
        expect(error, label).toMatchObject({ code: "ACCESS_UNCONFIRMED" });
      }
    }

    const duplicateRoots = [
      huggingFaceDatasetRoot("hf-dataset-root-one", "First visible dataset card."),
      huggingFaceDatasetRoot("hf-dataset-root-two", "Second visible dataset card."),
    ];
    const duplicate = value.extract(huggingFaceDatasetReader({ roots: duplicateRoots }));
    expect(finalProof(duplicate, value).completeness).toBe("unknown");

    const pending = value.extract(huggingFaceDatasetReader({ loading: true }));
    expect(finalProof(pending, value).completeness).toBe("unknown");

    const samples = [
      huggingFaceDatasetReader({ body: "First stable-sample body." }),
      huggingFaceDatasetReader({ body: "Changed stable-sample body." }),
    ];
    const changed = await sampleStableSnapshot(
      value,
      new URL("https://huggingface.co/datasets/sentence-transformers/all-nli"),
      () => value.extract(samples.shift()!),
      stableClock(),
    );
    expect(changed.stability).toBeUndefined();
    expect(changed.snapshot.completeness).toBe("unknown");
  });

  it("binds the dataset proof only to dataset routes and excludes file trees", () => {
    const value = adapter("huggingface");
    const rule = value.completion_rules?.find(rule => rule.id === "huggingface.dataset.public-card-root.v1");
    expect(rule).toBeDefined();
    for (const raw of [
      "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2",
      "https://huggingface.co/blog/llama2",
      "https://huggingface.co/papers/1706.03762",
      "https://huggingface.co/datasets/sentence-transformers/all-nli/tree/main",
    ]) {
      const url = new URL(raw);
      expect(rule!.matches(url, value.rule.contentId(url) ?? "dataset:sentence-transformers/all-nli"), raw).toBe(false);
    }
    expect(value.extract(huggingFaceDatasetReader()).assets).toEqual([]);
  });

  it("does not let unvalidated research routes inherit a completion plan", () => {
    const cases = [
      [adapter("github"), "https://github.com/openai/openai-python/blob/main/README.md"],
      [adapter("github"), "https://github.com/openai/openai-python/releases/tag/v3.16.2"],
      [adapter("huggingface"), "https://huggingface.co/blog/llama2"],
      [adapter("anthropic_blog"), "https://www.anthropic.com/research/an-off-switch-for-dual-use-knowledge"],
      [adapter("deepmind_blog"), "https://deepmind.google/blog/teaching-ai-to-see-the-world-more-like-we-do/"],
    ] as const;

    for (const [value, raw] of cases) {
      const url = new URL(raw);
      const contentId = value.rule.contentId(url);
      expect(contentId, raw).not.toBeNull();
      expect(value.completion_rules?.some(rule => rule.matches(url, contentId!)), raw).toBe(false);
    }
  });

  it("limits arXiv external-file completion to observed abstract pages and requires DeepMind publication files", () => {
    const arxiv = adapter("arxiv");
    const abs = new URL("https://arxiv.org/abs/1706.03762v7");
    const html = new URL("https://arxiv.org/html/1706.03762v7");
    const contentId = arxiv.rule.contentId(abs);
    expect(contentId).toBe("1706.03762v7");
    expect(arxiv.completion_rules).toContainEqual(expect.objectContaining({
      id: "arxiv.abs.source-root.external-pdf.v1",
      boundary: "root_exhausted",
      external_file_attachment: true,
      stability: { sample_count: 2, minimum_window_ms: 700 },
    }));
    expect(arxiv.completion_rules?.some(rule => rule.matches(abs, contentId!))).toBe(true);
    expect(arxiv.completion_rules?.some(rule => rule.matches(html, contentId!))).toBe(false);

    const deepmind = adapter("deepmind_blog");
    expect(deepmind.document_components_for_url?.(new URL("https://deepmind.google/research/publications/265605/"))).toEqual(["files"]);
    expect(deepmind.document_components_for_url?.(new URL("https://deepmind.google/blog/teaching-ai-to-see-the-world-more-like-we-do/"))).toEqual([]);
  });

  it("rejects a DeepMind publication whose copy-link binds another target", () => {
    const value = adapter("deepmind_blog");
    expect(() => value.extract(deepMindPublicationReader("https://deepmind.google/research/publications/999999/")))
      .toThrow(/single-content root/i);
  });
});
