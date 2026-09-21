import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAdapterRegistry } from "../../adapters/registry.js";
import { extract } from "../../adapters/shared-extractors/extractor.js";
import { AdapterExtractionError } from "../../adapters/types.js";
import { contentSnapshotSchema } from "../../runtime/bridge/validation.js";
import { FixturePageReader, node } from "./fixture-reader.js";

const registry = createAdapterRegistry();

const GITHUB_LEGACY_PUBLIC_MARKER = "#repository-container-header span.Label.Label--secondary.v-align-middle.mr-1";
const GITHUB_TITLE_COMPONENT_PUBLIC_MARKER = "#repo-title-component span.mr-1.v-align-middle.prc-Label-Label-qG-Zu";
const HF_MODEL_ROOT = "div.model-card-content.prose.hf-sanitized.copiable-code-container";
const HF_MODEL_HEADER = "div.SVELTE_HYDRATER.contents[data-target='ModelHeader'][data-props]";
const HF_BLOG_SHELL = "div.blog-content";
const HF_BLOG_BODY = `${HF_BLOG_SHELL} > div.relative.overflow-clip`;
const HF_PAPER_SECTION = "main > div.container > section.md\\:col-span-7:has(div.SVELTE_HYDRATER.contents > div.pb-8.pr-4.md\\:pr-16)";
const HF_PAPER_BODY = `${HF_PAPER_SECTION} > div.SVELTE_HYDRATER.contents > div.pb-8.pr-4.md\\:pr-16`;
const HF_PAPER_HEADER = `${HF_PAPER_SECTION} > div.SVELTE_HYDRATER.contents > div.pb-10.md\\:pt-3`;
const HF_PAPER_GENERATED_SUMMARY = `${HF_PAPER_BODY} > div.flex.flex-col.gap-y-2\\.5 > div.bg-blue-500\\/6`;
const ARXIV_ABS_MOBILE_PDF = "#abs > a.mobile-submission-download[href^='/pdf/']";
const ARXIV_ABS_DESKTOP_PDF = "#abs-outer > .extra-services > .full-text > ul > li > a.abs-button.download-pdf[href^='/pdf/']";
const ARXIV_HTML_PDF = "nav.html-header-nav > a.header-button[title='Download PDF'][href^='/pdf/']";

const REGISTERED_PLATFORM_IDS = [
  "xiaohongshu",
  "bilibili",
  "weixin_article",
  "zhihu",
  "youtube",
  "x",
  "reddit",
  "medium",
  "substack",
  "github",
  "huggingface",
  "arxiv",
  "openai_blog",
  "anthropic_blog",
  "deepmind_blog",
] as const;

function matchedId(raw: string): string | undefined {
  return registry.match(new URL(raw))?.id;
}

function expectAccessUnconfirmed(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AdapterExtractionError);
  expect((caught as AdapterExtractionError).code).toBe("ACCESS_UNCONFIRMED");
}

function textBlocks(snapshot: ReturnType<typeof extract>): string {
  return snapshot.blocks.flatMap(block => "text" in block ? [block.text] : []).join("\n");
}

describe("first-party research source routes", () => {
  it("accepts only the documented GitHub single-content routes", () => {
    expect(matchedId("https://github.com/openai/openai-python")).toBe("github");
    expect(matchedId("https://github.com/openai/openai-python/blob/main/README.md")).toBe("github");
    expect(matchedId("https://github.com/openai/openai-python/blob/main/docs/SDK%20reference.markdown")).toBe("github");
    expect(matchedId("https://github.com/openai/openai-python/releases/tag/v3.16.2")).toBe("github");

    for (const raw of [
      "https://github.com/openai/openai-python/tree/main",
      "https://github.com/openai/openai-python/issues",
      "https://github.com/openai/openai-python/releases",
      "https://github.com/openai/openai-python/releases/download/v3.16.2/openai.whl",
      "https://github.com/openai/openai-python/blob/main/pyproject.toml",
      "https://github.com/openai/openai-python/raw/main/README.md",
      "https://github.com/openai/openai-python/blob/main/README.md/extra",
      "https://github.com/openai/openai-python/blob/main%2FREADME.md",
    ]) {
      expect(matchedId(raw), raw).toBeUndefined();
    }
  });

  it("uses a rendered GitHub Markdown or release-note root and leaves external badge hosts blocked", () => {
    const github = registry.get("github");
    if (!github) throw new Error("Expected GitHub adapter.");
    const title = node("github-title", "h1", "OpenAI Python API library");
    const code = node("github-code", "pre", "", {}, [node("github-code-text", "#text", "pip install openai")]);
    const relativeImage = node("github-relative-image", "img", "", { src: "/openai/openai-python/raw/main/assets/diagram.png", alt: "Architecture" });
    const externalBadge = node("github-badge", "img", "", { src: "https://camo.githubusercontent.com/proxy/badge", alt: "badge" });
    const publicMarker = node("github-public", "span", "Public");
    const root = node("github-root", "article", "OpenAI Python API library pip install openai", {}, [title, code, relativeImage, externalBadge]);
    const reader = new FixturePageReader("https://github.com/openai/openai-python/blob/main/README.md", "openai-python README")
      .add("article.markdown-body.entry-content.container-lg", [root])
      .add("article.markdown-body.entry-content.container-lg h1", [title], root)
      .add("article.markdown-body.entry-content.container-lg img", [relativeImage, externalBadge], root)
      .add(GITHUB_LEGACY_PUBLIC_MARKER, [publicMarker]);

    const snapshot = extract(reader, github);

    expect(snapshot.title).toBe("OpenAI Python API library");
    expect(snapshot.blocks).toContainEqual({ type: "code", text: "pip install openai" });
    expect(snapshot.assets).toEqual([
      expect.objectContaining({ role: "image", url: "https://github.com/openai/openai-python/raw/main/assets/diagram.png", availability: "available" }),
      expect.objectContaining({ role: "image", url: "https://camo.githubusercontent.com/proxy/badge", availability: "available" }),
    ]);
    expect(snapshot.completeness).toBe("unknown");
    expect(snapshot.completeness_proof).toBeUndefined();
  });

  it("requires GitHub's one exact Public marker before serializing a readable repository body", () => {
    const github = registry.get("github");
    if (!github) throw new Error("Expected GitHub adapter.");
    const title = node("github-private-title", "h1", "Private README");
    const prose = node("github-private-prose", "p", "Visible only to a signed-in repository member.");
    const root = node("github-private-root", "article", "Private README Visible only to a signed-in repository member.", {}, [title, prose]);
    const base = () => new FixturePageReader("https://github.com/openai/openai-python", "Private README")
      .add("article.markdown-body.entry-content.container-lg", [root])
      .add("article.markdown-body.entry-content.container-lg h1", [title], root);

    expectAccessUnconfirmed(() => extract(base(), github));
    const privateMarker = node("github-private-marker", "span", "Private");
    expectAccessUnconfirmed(() => extract(base().add(GITHUB_LEGACY_PUBLIC_MARKER, [privateMarker]), github));
  });

  it("accepts the observed current GitHub title-component Public badge but not duplicate badges", () => {
    const github = registry.get("github");
    if (!github) throw new Error("Expected GitHub adapter.");
    const title = node("github-current-title", "h1", "OpenAI Python API library");
    const prose = node("github-current-prose", "p", "Current public repository documentation.");
    const root = node("github-current-root", "article", "OpenAI Python API library Current public repository documentation.", {}, [title, prose]);
    const currentBadge = node("github-current-public", "span", "Public");
    const legacyBadge = node("github-legacy-public", "span", "Public");
    const base = () => new FixturePageReader("https://github.com/openai/openai-python", "openai-python")
      .add("article.markdown-body.entry-content.container-lg", [root])
      .add("article.markdown-body.entry-content.container-lg h1", [title], root);

    expect(extract(base().add(GITHUB_TITLE_COMPONENT_PUBLIC_MARKER, [currentBadge]), github).access_class).toBe("public_free");
    expectAccessUnconfirmed(() => extract(base()
      .add(GITHUB_TITLE_COMPONENT_PUBLIC_MARKER, [currentBadge])
      .add(GITHUB_LEGACY_PUBLIC_MARKER, [legacyBadge]), github));
  });

  it("accepts only a single model or dataset card, official blog article, or individual paper detail", () => {
    expect(matchedId("https://huggingface.co/rk-transformers/bert-base-uncased")).toBe("huggingface");
    expect(matchedId("https://huggingface.co/datasets/rajpurkar/squad")).toBe("huggingface");
    expect(matchedId("https://huggingface.co/blog/llama2")).toBe("huggingface");
    expect(matchedId("https://huggingface.co/papers/1706.03762")).toBe("huggingface");

    for (const raw of [
      "https://huggingface.co/models",
      "https://huggingface.co/datasets",
      "https://huggingface.co/spaces",
      "https://huggingface.co/rk-transformers/bert-base-uncased/tree/main",
      "https://huggingface.co/rk-transformers/bert-base-uncased/resolve/main/model.safetensors",
      "https://huggingface.co/datasets/rajpurkar/squad/resolve/main/train.parquet",
      "https://huggingface.co/papers",
      "https://huggingface.co/papers/1706.03762/community",
    ]) {
      expect(matchedId(raw), raw).toBeUndefined();
    }
  });

  it("keeps Hugging Face card text and direct body images while never collecting weight or dataset links as files", () => {
    const huggingface = registry.get("huggingface");
    if (!huggingface) throw new Error("Expected Hugging Face adapter.");
    const title = node("hf-title", "h1", "bert-base-uncased (RKNN2)");
    const prose = node("hf-prose", "p", "A model card with a documented usage example.");
    const example = node("hf-example", "pre", "", {}, [node("hf-example-text", "#text", "from transformers import pipeline")]);
    const directImage = node("hf-image", "img", "", { src: "https://cdn-media.huggingface.co/exbert/button.png", alt: "Demo" });
    const modelFile = node("hf-weight", "a", "model.safetensors", { href: "/org/model/resolve/main/model.safetensors" });
    const publicHeader = node("hf-model-header", "div", "", {
      "data-target": "ModelHeader",
      "data-props": JSON.stringify({
        model: { id: "rk-transformers/bert-base-uncased", repoType: "model", private: false, gated: false },
      }),
    });
    const root = node("hf-root", "div", "bert-base-uncased (RKNN2) A model card with a documented usage example.", {}, [title, prose, example, directImage, modelFile]);
    const reader = new FixturePageReader("https://huggingface.co/rk-transformers/bert-base-uncased", "BERT model card")
      .add(HF_MODEL_ROOT, [root])
      .add(`${HF_MODEL_ROOT} h1`, [title], root)
      .add(`${HF_MODEL_ROOT} img`, [directImage], root)
      .add(HF_MODEL_HEADER, [publicHeader]);

    const snapshot = extract(reader, huggingface);

    expect(snapshot.title).toBe("bert-base-uncased (RKNN2)");
    expect(snapshot.blocks).toContainEqual({ type: "code", text: "from transformers import pipeline" });
    expect(snapshot.assets).toEqual([
      expect.objectContaining({ role: "image", url: "https://cdn-media.huggingface.co/exbert/button.png", availability: "available" }),
    ]);
    expect(snapshot.assets.some(asset => asset.role === "file" || asset.url.includes("safetensors"))).toBe(false);
    expect(snapshot.completeness).toBe("unknown");
    expect(snapshot.completeness_proof).toBeUndefined();
  });

  it("requires one bounded, route-bound public Header for Hugging Face model cards", () => {
    const huggingface = registry.get("huggingface");
    if (!huggingface) throw new Error("Expected Hugging Face adapter.");
    const title = node("hf-public-check-title", "h1", "A model card");
    const prose = node("hf-public-check-prose", "p", "Visible model documentation.");
    const root = node("hf-public-check-root", "div", "A model card Visible model documentation.", {}, [title, prose]);
    const readerWith = (props?: string, count = 1) => {
      const reader = new FixturePageReader("https://huggingface.co/rk-transformers/bert-base-uncased", "Model card")
        .add(HF_MODEL_ROOT, [root])
        .add(`${HF_MODEL_ROOT} h1`, [title], root);
      if (props !== undefined) {
        const headers = Array.from({ length: count }, (_, index) => node(`hf-header-${index}`, "div", "", {
          "data-target": "ModelHeader",
          "data-props": props,
        }));
        reader.add(HF_MODEL_HEADER, headers);
      }
      return reader;
    };
    const valid = JSON.stringify({
      model: { id: "rk-transformers/bert-base-uncased", repoType: "model", private: false, gated: false },
    });

    expect(extract(readerWith(valid), huggingface).access_class).toBe("public_free");
    expectAccessUnconfirmed(() => extract(readerWith(), huggingface));
    expectAccessUnconfirmed(() => extract(readerWith("not-json"), huggingface));
    expectAccessUnconfirmed(() => extract(readerWith(JSON.stringify({
      model: { id: "rk-transformers/other", repoType: "model", private: false, gated: false },
    })), huggingface));
    expectAccessUnconfirmed(() => extract(readerWith(JSON.stringify({
      model: { id: "rk-transformers/bert-base-uncased", repoType: "model", private: true, gated: false },
    })), huggingface));
    expectAccessUnconfirmed(() => extract(readerWith(valid, 2), huggingface));
    expectAccessUnconfirmed(() => extract(readerWith(`${valid}${" ".repeat(1_000_001)}`), huggingface));
  });

  it("keeps Hugging Face blog and paper routes outside the model-card Header check and excludes observed paper UI", () => {
    const huggingface = registry.get("huggingface");
    if (!huggingface) throw new Error("Expected Hugging Face adapter.");

    const blogTitle = node("hf-blog-title", "h1", "A public Hugging Face blog article");
    const blogBodyText = node("hf-blog-body-text", "p", "The article's readable body.");
    const blogBody = node("hf-blog-body", "div", "The article's readable body.", {}, [blogBodyText]);
    const blogSignup = node("hf-blog-signup", "div", "Subscribe for updates");
    const blogShell = node("hf-blog-shell", "div", "A public Hugging Face blog article Subscribe for updates The article's readable body.", {}, [blogTitle, blogSignup, blogBody]);
    const blogReader = new FixturePageReader("https://huggingface.co/blog/llama2", "Hugging Face blog")
      .add(HF_BLOG_BODY, [blogBody])
      .add(HF_BLOG_SHELL, [blogShell])
      .add(`${HF_BLOG_SHELL} > h1`, [blogTitle], blogShell)
      .add(`${HF_BLOG_SHELL} > div.mb-4`, [blogSignup], blogShell);
    const blogSnapshot = extract(blogReader, huggingface);
    expect(blogSnapshot.access_class).toBe("public_free");
    expect(textBlocks(blogSnapshot)).toContain("The article's readable body.");
    expect(textBlocks(blogSnapshot)).not.toContain("Subscribe for updates");

    const paperTitle = node("hf-paper-title", "h1", "Attention Is All You Need");
    const paperAuthor = node("hf-paper-author", "div", "Ashish Vaswani");
    const paperDate = node("hf-paper-date", "div", "Published on Jun 12, 2017");
    const paperHeader = node("hf-paper-header", "div", "Papers arxiv:1706.03762 Upvote Authors: Ashish Vaswani", {}, [paperTitle, paperAuthor, paperDate]);
    const abstractHeading = node("hf-paper-abstract-heading", "h2", "Abstract");
    const generatedSummaryText = node("hf-paper-generated-summary-text", "p", "A site-generated synopsis of the paper.");
    const generatedBy = node("hf-paper-generated-by", "div", "Generated by Qwen/Qwen2.5-Coder-32B-Instruct");
    const generatedSummary = node("hf-paper-generated-summary", "div", "A site-generated synopsis of the paper. Generated by Qwen/Qwen2.5-Coder-32B-Instruct", {}, [generatedSummaryText, generatedBy]);
    const abstractText = node("hf-paper-abstract-text", "p", "The Transformer architecture uses attention mechanisms.");
    const paperBody = node("hf-paper-body", "div", "Abstract A site-generated synopsis of the paper. Generated by Qwen/Qwen2.5-Coder-32B-Instruct The Transformer architecture uses attention mechanisms.", {}, [abstractHeading, generatedSummary, abstractText]);
    const hydrator = node("hf-paper-hydrator", "div", "Papers arxiv:1706.03762 Upvote Attention Is All You Need Abstract The Transformer architecture uses attention mechanisms.", {}, [paperHeader, paperBody]);
    const paperSection = node("hf-paper-section", "section", "Papers arxiv:1706.03762 Upvote Attention Is All You Need Abstract The Transformer architecture uses attention mechanisms.", {}, [hydrator]);
    const paperReader = new FixturePageReader("https://huggingface.co/papers/1706.03762", "Hugging Face paper")
      .add(HF_PAPER_BODY, [paperBody])
      .add(HF_PAPER_SECTION, [paperSection])
      .add(`${HF_PAPER_HEADER} h1.mb-2`, [paperTitle], paperSection)
      .add(`${HF_PAPER_HEADER} div.relative.flex.flex-wrap.items-center.gap-2.text-base.leading-tight > div.relative`, [paperAuthor], paperSection)
      .add(`${HF_PAPER_HEADER} div.mb-6.flex.flex-wrap.gap-2.text-sm.text-gray-500 > div`, [paperDate], paperSection)
      .add(HF_PAPER_GENERATED_SUMMARY, [generatedSummary], paperBody);
    const paperSnapshot = extract(paperReader, huggingface);
    expect(paperSnapshot.title).toBe("Attention Is All You Need");
    expect(paperSnapshot.authors).toEqual(["Ashish Vaswani"]);
    expect(textBlocks(paperSnapshot)).toContain("The Transformer architecture uses attention mechanisms.");
    expect(textBlocks(paperSnapshot)).not.toMatch(/Papers|Upvote|Generated by|site-generated synopsis/);
  });

  it("accepts the official versioned or current arXiv article route and binds only its original PDF", () => {
    expect(matchedId("https://arxiv.org/abs/1706.03762v7")).toBe("arxiv");
    expect(matchedId("https://arxiv.org/html/1706.03762v7")).toBe("arxiv");
    expect(matchedId("https://arxiv.org/abs/1706.03762")).toBe("arxiv");
    expect(matchedId("https://arxiv.org/html/1706.03762")).toBe("arxiv");

    for (const raw of [
      "https://arxiv.org/pdf/1706.03762v7",
      "https://arxiv.org/list/cs.AI/recent",
      "https://arxiv.org/abs/1706.03762v0",
      "https://arxiv.org/abs/cs/0101010v1",
      "https://arxiv.org/abs/1706.03762v7/extra",
    ]) {
      expect(matchedId(raw), raw).toBeUndefined();
    }

    const arxiv = registry.get("arxiv");
    if (!arxiv) throw new Error("Expected arXiv adapter.");
    expect(arxiv.required_document_components).toEqual(["files"]);
    expect(arxiv.rule.file_matches?.(
      new URL("https://arxiv.org/abs/1706.03762v7"),
      new URL("https://arxiv.org/pdf/1706.03762v7"),
    )).toBe(true);
    for (const raw of [
      "https://arxiv.org/pdf/1706.03762",
      "https://arxiv.org/pdf/1706.03762v6",
      "https://arxiv.org/pdf/9999.00000v7",
      "https://export.arxiv.org/pdf/1706.03762v7",
      "https://arxiv.org/pdf/1706.03762v7?download=1",
    ]) {
      expect(arxiv.rule.file_matches?.(new URL("https://arxiv.org/abs/1706.03762v7"), new URL(raw)), raw).toBe(false);
    }
    for (const raw of [
      "https://arxiv.org/pdf/1706.03762",
      "https://arxiv.org/pdf/1706.03762v7",
    ]) {
      expect(arxiv.rule.file_matches?.(new URL("https://arxiv.org/abs/1706.03762"), new URL(raw)), raw).toBe(true);
    }
    for (const raw of [
      "https://arxiv.org/pdf/1706.03763",
      "https://arxiv.org/pdf/1706.03763v7",
      "https://arxiv.org/pdf/1706.03762v0",
    ]) {
      expect(arxiv.rule.file_matches?.(new URL("https://arxiv.org/abs/1706.03762"), new URL(raw)), raw).toBe(false);
    }
  });

  it("adds exactly the matched current-version arXiv PDF as a file, never a cited paper PDF", () => {
    const arxiv = registry.get("arxiv");
    if (!arxiv) throw new Error("Expected arXiv adapter.");
    const title = node("arxiv-title", "h1", "Attention Is All You Need");
    const authors = node("arxiv-authors", "div", "Ashish Vaswani, Noam Shazeer");
    const abstract = node("arxiv-abstract", "blockquote", "We propose a simple network architecture based solely on attention mechanisms.");
    const mobilePdf = node("arxiv-mobile-pdf", "a", "View PDF", { href: "/pdf/1706.03762v7" });
    const desktopPdf = node("arxiv-desktop-pdf", "a", "View PDF", { href: "/pdf/1706.03762v7" });
    const sidecarDuplicate = node("arxiv-sidecar-pdf", "a", "Download PDF", { href: "/pdf/1706.03762v7" });
    const citedPdf = node("arxiv-cited-pdf", "a", "Cited PDF", { href: "/pdf/9999.00000v1" });
    const root = node("arxiv-root", "div", "Attention Is All You Need Ashish Vaswani", {}, [title, authors, abstract]);
    const reader = new FixturePageReader("https://arxiv.org/abs/1706.03762v7", "Attention Is All You Need")
      .add("#abs", [root])
      .add("#abs h1.title", [title], root)
      .add("#abs div.authors", [authors], root)
      // The real desktop abs page hides the mobile control and exposes this
      // exact Access Paper descendant instead.
      .add(ARXIV_ABS_MOBILE_PDF, [])
      .add(ARXIV_ABS_DESKTOP_PDF, [desktopPdf])
      .add(ARXIV_HTML_PDF, [])
      // This confirms the new strict selectors do not consult the former
      // broad route and cannot duplicate the matched source PDF.
      .add("a[href^='/pdf/']", [desktopPdf, sidecarDuplicate, citedPdf]);

    const snapshot = extract(reader, arxiv);

    expect(snapshot.platform_content_id).toBe("1706.03762v7");
    expect(snapshot.assets).toEqual([
      expect.objectContaining({
        role: "file",
        url: "https://arxiv.org/pdf/1706.03762v7",
        availability: "available",
      }),
    ]);
    // The desktop PDF is an explicit attachment outside the abstract root.
    expect(snapshot.blocks.some(block => block.type === "file")).toBe(false);
    expect(snapshot.completeness).toBe("unknown");
    expect(snapshot.completeness_proof).toBeUndefined();

    // A responsive page may expose both controls. They point to one required
    // document, so the same URL must not become two file assets or blocks.
    const duplicateControlReader = new FixturePageReader("https://arxiv.org/abs/1706.03762v7", "Attention Is All You Need")
      .add("#abs", [root])
      .add("#abs h1.title", [title], root)
      .add("#abs div.authors", [authors], root)
      .add(ARXIV_ABS_MOBILE_PDF, [mobilePdf])
      .add(ARXIV_ABS_DESKTOP_PDF, [desktopPdf]);
    const duplicateControlSnapshot = extract(duplicateControlReader, arxiv);
    expect(duplicateControlSnapshot.assets.filter(asset => asset.role === "file")).toEqual([
      expect.objectContaining({ url: "https://arxiv.org/pdf/1706.03762v7" }),
    ]);
    expect(duplicateControlSnapshot.blocks.filter(block => block.type === "file")).toHaveLength(0);

    const htmlTitle = node("arxiv-html-title", "h1", "Attention Is All You Need");
    const htmlAuthorOneNote = node("arxiv-html-author-one-note", "span", "1 footnotemark: 1", { class: "ltx_note ltx_role_footnotemark" });
    const htmlAuthorTwoNote = node("arxiv-html-author-two-note", "span", "2 footnotemark: 2", { class: "ltx_note ltx_role_footnotemark" });
    const htmlAuthorOne = node("arxiv-html-author-one", "span", "", {}, [node("arxiv-html-author-one-name", "#text", "Ashish Vaswani"), htmlAuthorOneNote]);
    const htmlAuthorTwo = node("arxiv-html-author-two", "span", "", {}, [node("arxiv-html-author-two-name", "#text", "Noam Shazeer"), htmlAuthorTwoNote]);
    const htmlAuthorNotes = node("arxiv-html-author-notes", "span", "x".repeat(1_686));
    const htmlAuthors = node("arxiv-html-authors", "div", "Ashish Vaswani Noam Shazeer author affiliations and notes", {}, [htmlAuthorOne, htmlAuthorTwo, htmlAuthorNotes]);
    const htmlProse = node("arxiv-html-prose", "p", "The full HTML paper body reports 41.8 BLEU.");
    const htmlRoot = node("arxiv-html-root", "article", "Attention Is All You Need The full HTML paper body.", {}, [htmlTitle, htmlAuthors, htmlProse]);
    const htmlPdf = node("arxiv-html-pdf", "a", "Download PDF", { href: "/pdf/1706.03762v7" });
    const htmlReader = new FixturePageReader("https://arxiv.org/html/1706.03762v7", "Attention Is All You Need")
      .add("#abs", [])
      .add("article.ltx_document", [htmlRoot])
      .add("article.ltx_document h1.ltx_title_document", [htmlTitle], htmlRoot)
      .add("article.ltx_document div.ltx_authors .ltx_personname", [htmlAuthorOne, htmlAuthorTwo], htmlRoot)
      .add("article.ltx_document div.ltx_authors .ltx_personname > .ltx_note.ltx_role_footnotemark", [htmlAuthorOneNote, htmlAuthorTwoNote])
      .add(ARXIV_HTML_PDF, [htmlPdf]);
    const htmlSnapshot = extract(htmlReader, arxiv);
    expect(htmlSnapshot.authors).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(htmlSnapshot.authors.join(" ")).not.toMatch(/footnotemark|\b[12]\b/);
    expect(textBlocks(htmlSnapshot)).toContain("The full HTML paper body reports 41.8 BLEU.");
    expect(contentSnapshotSchema.safeParse(htmlSnapshot).success).toBe(true);
    expect(htmlSnapshot.assets).toEqual([
      expect.objectContaining({ role: "file", url: "https://arxiv.org/pdf/1706.03762v7", availability: "available" }),
    ]);

    const currentPdf = node("arxiv-current-pdf", "a", "View PDF", { href: "/pdf/1706.03762" });
    const currentReader = new FixturePageReader("https://arxiv.org/abs/1706.03762", "Attention Is All You Need")
      .add("#abs", [root])
      .add("#abs h1.title", [title], root)
      .add("#abs div.authors", [authors], root)
      .add(ARXIV_ABS_MOBILE_PDF, [currentPdf]);
    const currentSnapshot = extract(currentReader, arxiv);
    expect(currentSnapshot.platform_content_id).toBe("1706.03762");
    expect(currentSnapshot.assets).toEqual([
      expect.objectContaining({ role: "file", url: "https://arxiv.org/pdf/1706.03762", availability: "available" }),
    ]);
  });

  it("registers the bounded OpenAI navigation route and matching extension page permissions", () => {
    const ids = registry.list().map(adapter => adapter.id);
    expect(ids).toEqual(REGISTERED_PLATFORM_IDS);
    expect(matchedId("https://openai.com/index/deep-research-system-card/")).toBe("openai_blog");
    expect(matchedId("https://www.openai.com/zh-Hans-CN/index/deep-research-system-card/")).toBe("openai_blog");
    expect(matchedId("https://openai.com/research/deep-research-system-card/")).toBeUndefined();

    const manifest = JSON.parse(readFileSync(new URL("../../extension/manifest.json", import.meta.url), "utf8")) as {
      host_permissions: string[];
      content_scripts: { matches: string[] }[];
    };
    const expected = [
      "https://github.com/*",
      "https://huggingface.co/*",
      "https://arxiv.org/*",
      "https://openai.com/*",
      "https://www.openai.com/*",
      "https://anthropic.com/*",
      "https://www.anthropic.com/*",
      "https://deepmind.google/*",
    ];
    for (const pattern of expected) {
      expect(manifest.host_permissions).toContain(pattern);
      expect(manifest.content_scripts[0]?.matches).toContain(pattern);
    }
  });
});
