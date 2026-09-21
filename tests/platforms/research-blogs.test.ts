import { describe, expect, it } from "vitest";
import { extract } from "../../adapters/shared-extractors/extractor.js";
import { matchesAnyHost } from "../../adapters/shared-extractors/url.js";
import { RESEARCH_BLOG_SPECS } from "../../adapters/platforms/research-blogs.js";
import type { PlatformSpec } from "../../adapters/platforms/spec.js";
import type { PlatformAdapter } from "../../adapters/types.js";
import { FixturePageReader, node } from "./fixture-reader.js";

function adapterFrom(spec: PlatformSpec): PlatformAdapter {
  const adapter: PlatformAdapter = {
    id: spec.rule.id,
    version: spec.rule.version,
    hosts: [...spec.rule.hosts],
    supported_url_patterns: [...spec.rule.supported_url_patterns],
    asset_hosts: [...spec.asset_hosts],
    engine: spec.engine,
    validation_status: "unverified",
    content_types: [...spec.rule.content_types],
    status: spec.status,
    rule: spec.rule,
    coverage: spec.coverage,
    match: url => matchesAnyHost(url, spec.rule.hosts) && spec.rule.contentId(url) !== null,
    extract: (reader, options) => extract(reader, adapter, options),
    observe: () => { throw new Error("observe is outside this extractor fixture"); },
    allowsAction: () => false,
  };
  return adapter;
}

function adapter(id: "openai_blog" | "anthropic_blog" | "deepmind_blog"): PlatformAdapter {
  const spec = RESEARCH_BLOG_SPECS.find(candidate => candidate.rule.id === id);
  if (!spec) throw new Error(`Missing ${id} spec`);
  return adapterFrom(spec);
}

function blockText(snapshot: ReturnType<PlatformAdapter["extract"]>): string {
  return snapshot.blocks.flatMap(block => {
    if ("text" in block) return [block.text];
    if (block.type === "list") return block.items;
    return [];
  }).join("\n");
}

describe("official research blog routes", () => {
  it("matches only exact OpenAI, Anthropic, and DeepMind single-content routes", () => {
    const openai = adapter("openai_blog");
    const anthropic = adapter("anthropic_blog");
    const deepmind = adapter("deepmind_blog");

    expect(openai.match(new URL("https://openai.com/index/deep-research-system-card/"))).toBe(true);
    expect(openai.match(new URL("https://www.openai.com/zh-Hans-CN/index/deep-research-system-card/"))).toBe(true);
    expect(openai.match(new URL("https://openai.com/index/"))).toBe(false);
    expect(openai.match(new URL("https://openai.com/research/deep-research-system-card/"))).toBe(false);
    expect(openai.match(new URL("https://openai.com/zh-Hans-CN/index/deep-research-system-card/related"))).toBe(false);
    expect(openai.match(new URL("https://chatgpt.com/index/deep-research-system-card/"))).toBe(false);

    expect(anthropic.match(new URL("https://www.anthropic.com/research/off-switch-dual-use"))).toBe(true);
    expect(anthropic.match(new URL("https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents"))).toBe(true);
    expect(anthropic.match(new URL("https://www.anthropic.com/research"))).toBe(false);
    expect(anthropic.match(new URL("https://www.anthropic.com/news/company-update"))).toBe(false);
    expect(anthropic.match(new URL("https://claude.ai/chat/example"))).toBe(false);
    expect(anthropic.match(new URL("https://platform.claude.com/docs"))).toBe(false);

    expect(deepmind.match(new URL("https://deepmind.google/blog/teaching-ai-to-see-the-world-more-like-we-do/"))).toBe(true);
    expect(deepmind.match(new URL("https://deepmind.google/research/publications/265605/"))).toBe(true);
    expect(deepmind.match(new URL("https://deepmind.google/blog/"))).toBe(false);
    expect(deepmind.match(new URL("https://deepmind.google/research/publications/"))).toBe(false);
    expect(deepmind.match(new URL("https://deepmind.google/models/gemini/"))).toBe(false);
    expect(deepmind.match(new URL("https://accounts.google.com/"))).toBe(false);
  });

  it("extracts an Anthropic research article while excluding related cards and share UI", () => {
    const url = "https://www.anthropic.com/research/off-switch-dual-use";
    const title = node("anthropic-research-title", "h1", "An off switch for dual-use knowledge in AI models");
    const category = node("anthropic-research-category", "div", "Alignment");
    const published = node("anthropic-research-date", "div", "Jul 8, 2026");
    const heroImage = node("anthropic-research-hero", "img", "", {
      src: "https://www-cdn.anthropic.com/images/research-hero.svg",
      alt: "Research illustration",
      width: "1000",
      height: "1000",
    });
    const hero = node("anthropic-research-header", "div", "Alignment An off switch Jul 8, 2026", {}, [
      category,
      title,
      published,
      heroImage,
    ]);
    const body = node("anthropic-research-body", "div", "Research body", {}, [
      node("anthropic-research-p", "p", "Research body", {}, [node("anthropic-research-text", "#text", "Research body")]),
    ]);
    const footnote = node("anthropic-research-footnote", "p", "A source footnote", {}, [
      node("anthropic-research-footnote-text", "#text", "A source footnote"),
    ]);
    const share = node("anthropic-research-share", "div", "Share on X");
    const related = node("anthropic-research-related", "section", "Related content unrelated card", {}, [
      node("anthropic-research-related-text", "p", "Related content unrelated card"),
      node("anthropic-research-related-image", "img", "", { src: "https://www-cdn.anthropic.com/images/related.svg" }),
    ]);
    const root = node(
      "anthropic-research-root",
      "article",
      "Alignment An off switch Jul 8, 2026 Research body A source footnote Share on X Related content unrelated card",
      {},
      [hero, body, footnote, share, related],
    );
    const reader = new FixturePageReader(url, "An off switch for dual-use knowledge in AI models")
      .add("main#main-content > article", [root])
      .add("main#main-content > article h1", [title], root)
      .add("main#main-content > article > .page-wrapper:first-child .body-3.agate", [published], root)
      .add("img", [heroImage, related.childrenNodes[1]!], root)
      .add("main#main-content > article > section", [related], root)
      .add("main#main-content > article [class*='__socialShare']", [share], root)
      .add("main#main-content > article [class*='__subjects']", [category], root);

    const snapshot = adapter("anthropic_blog").extract(reader);
    const delivered = blockText(snapshot);

    expect(snapshot.title).toBe("An off switch for dual-use knowledge in AI models");
    expect(snapshot.published_at).toBe("Jul 8, 2026");
    expect(delivered).toContain("Research body");
    expect(delivered).toContain("A source footnote");
    expect(delivered).not.toContain("Related content");
    expect(delivered).not.toContain("Share on X");
    expect(delivered).not.toContain("Alignment");
    expect(snapshot.assets).toEqual([
      expect.objectContaining({ role: "image", url: "https://www-cdn.anthropic.com/images/research-hero.svg", availability: "available" }),
    ]);
    expect(snapshot.completeness).toBe("unknown");
    expect(snapshot.warnings).toContain("BROWSER_VALIDATION_PENDING");
  });

  it("keeps the source summary and body on an Anthropic engineering article", () => {
    const url = "https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents";
    const hub = node("anthropic-engineering-hub", "a", "Engineering at Anthropic", { href: "/engineering" });
    const title = node("anthropic-engineering-title", "h1", "Effective context engineering for AI agents");
    const published = node("anthropic-engineering-date", "p", "Published Sep 29, 2025");
    const summary = node("anthropic-engineering-summary", "p", "Context is a critical but finite resource.", {}, [
      node("anthropic-engineering-summary-text", "#text", "Context is a critical but finite resource."),
    ]);
    const heroImage = node("anthropic-engineering-hero-image", "img", "", {
      src: "https://www-cdn.anthropic.com/images/engineering-hero.svg",
    });
    const hero = node("anthropic-engineering-hero", "section", "Engineering at Anthropic Effective context Published Sep 29 Context is finite", {
      "aria-label": "Engineering Article Hero",
    }, [hub, heroImage, title, published, summary]);
    const paragraph = node("anthropic-engineering-paragraph", "p", "Article body", {}, [
      node("anthropic-engineering-text", "#text", "Article body"),
    ]);
    const article = node("anthropic-engineering-article", "article", "Article body", {}, [paragraph]);
    const newsletter = node("anthropic-engineering-newsletter", "div", "Get the developer newsletter Please provide your email address", {
      class: "NewsletterSubscribe-module__wrapper",
    }, [
      node("anthropic-engineering-newsletter-text", "p", "Please provide your email address"),
      node("anthropic-engineering-newsletter-image", "img", "", { src: "https://www-cdn.anthropic.com/images/newsletter.svg" }),
    ]);
    const root = node("anthropic-engineering-root", "main", "Effective context Published Sep 29 Context is finite Article body Get the developer newsletter", {}, [hero, article, newsletter]);
    const rootSelector = "main#main-content:has(> section[aria-label='Engineering Article Hero'])";
    const reader = new FixturePageReader(url, "Effective context engineering for AI agents")
      .add(rootSelector, [root])
      .add("section[aria-label='Engineering Article Hero'] h1", [title], root)
      .add("section[aria-label='Engineering Article Hero'] p[class*='__date']", [published], root)
      .add("img", [heroImage, newsletter.childrenNodes[1]!], root)
      .add("section[aria-label='Engineering Article Hero'] > a[href='/engineering']", [hub], root)
      .add("main#main-content > div.page-wrapper > div[class*='NewsletterSubscribe']", [newsletter], root);

    const snapshot = adapter("anthropic_blog").extract(reader);
    const delivered = blockText(snapshot);

    expect(snapshot.title).toBe("Effective context engineering for AI agents");
    expect(snapshot.published_at).toBe("Published Sep 29, 2025");
    expect(delivered).toContain("Context is a critical but finite resource.");
    expect(delivered).toContain("Article body");
    expect(delivered).not.toContain("Engineering at Anthropic");
    expect(delivered).not.toContain("developer newsletter");
    expect(delivered).not.toContain("email address");
    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.assets[0]?.url).toBe("https://www-cdn.anthropic.com/images/engineering-hero.svg");
    expect(snapshot.completeness).toBe("unknown");
  });

  it("requires the exact DeepMind Research marker and copy-link identity", () => {
    const url = "https://deepmind.google/blog/teaching-ai-to-see-the-world-more-like-we-do/";
    const category = node("deepmind-category", "span", "Research");
    const title = node("deepmind-title", "h1", "Teaching AI to see the world more like we do");
    const authors = node("deepmind-authors", "p", "Andrew Lampinen, Klaus Greff");
    const published = node("deepmind-date", "span", "November 11, 2025");
    const copy = node("deepmind-copy", "button", "Copied", { "data-copy-url": url });
    const heroImage = node("deepmind-hero", "img", "", {
      src: "https://lh3.googleusercontent.com/research-hero=w1440",
      alt: "Alignment diagram",
      width: "1440",
      height: "810",
    });
    const audio = node("deepmind-audio", "audio", "", {
      currentSrc: "https://storage.googleapis.com/gdm-deepmind-com-prod-public/media/media/article.wav",
      type: "audio/wav",
    });
    const body = node("deepmind-body", "p", "Research article body", {}, [
      node("deepmind-body-text", "#text", "Research article body"),
    ]);
    const related = node("deepmind-related", "section", "Related posts recommendation", {}, [
      node("deepmind-related-text", "p", "Related posts recommendation"),
    ]);
    const root = node(
      "deepmind-root",
      "main",
      "Research Teaching AI Andrew Lampinen November 11 Research article body Related posts recommendation",
      {},
      [category, title, authors, published, copy, heroImage, audio, body, related],
    );
    const baseReader = () => new FixturePageReader(url, "Teaching AI to see the world more like we do")
      .add("main#page-content", [root])
      .add(".share-list__item--copy[data-copy-url]", [copy], root)
      .add(".cover__text--category", [category], root)
      .add(".cover__text--title", [title], root)
      .add(".cover__text--authors", [authors], root)
      .add(".cover__text--date", [published], root)
      .add(".media-content-wrapper img.picture__image", [heroImage], root)
      .add(".media-content-wrapper audio.media-audio", [audio], root)
      .add("section.section--has-background.section--grey", [related], root);

    const snapshot = adapter("deepmind_blog").extract(baseReader());
    expect(snapshot.platform_content_id).toBe(url);
    expect(snapshot.title).toBe("Teaching AI to see the world more like we do");
    expect(snapshot.authors).toEqual(["Andrew Lampinen, Klaus Greff"]);
    expect(blockText(snapshot)).toContain("Research article body");
    expect(blockText(snapshot)).not.toContain("Related posts");
    expect(snapshot.assets).toEqual([
      expect.objectContaining({ role: "image", url: "https://lh3.googleusercontent.com/research-hero=w1440" }),
      expect.objectContaining({ role: "audio", url: "https://storage.googleapis.com/gdm-deepmind-com-prod-public/media/media/article.wav" }),
    ]);
    expect(snapshot.completeness).toBe("unknown");

    const wrongCategory = node("deepmind-wrong-category", "span", "Models");
    const marketingReader = baseReader().add(".cover__text--category", [wrongCategory], root);
    expect(() => adapter("deepmind_blog").extract(marketingReader)).toThrow(/single-content root/i);

    const wrongCopy = node("deepmind-wrong-copy", "button", "Copied", {
      "data-copy-url": "https://deepmind.google/blog/a-different-article/",
    });
    const driftedReader = baseReader().add(".share-list__item--copy[data-copy-url]", [wrongCopy], root);
    expect(() => adapter("deepmind_blog").extract(driftedReader)).toThrow(/single-content root/i);
  });

  it("extracts only a numeric DeepMind publication and its direct arXiv PDF", () => {
    const url = "https://deepmind.google/research/publications/265605/";
    const title = node("deepmind-publication-title", "h1", "Designing Proactive Thought Partners for Writing");
    const published = node("deepmind-publication-date", "span", "September 1, 2026");
    const copy = node("deepmind-publication-copy", "button", "Copied", { "data-copy-url": url });
    const abstractTitle = node("deepmind-abstract-title", "h2", "Abstract", {}, [node("deepmind-abstract-title-text", "#text", "Abstract")]);
    const abstract = node("deepmind-abstract", "p", "Writing involves diverse cognitive activities.", {}, [
      node("deepmind-abstract-text", "#text", "Writing involves diverse cognitive activities."),
    ]);
    const authors = node("deepmind-publication-authors", "div", "Chao Zhang, Abe Davis");
    const download = node("deepmind-publication-download", "a", "Download", {
      href: "https://arxiv.org/pdf/2609.01588",
      "data-event-content-name": "Download",
    });
    const root = node(
      "deepmind-publication-root",
      "main",
      "Designing Proactive Thought Partners September 1 Abstract Writing Chao Zhang Download",
      {},
      [title, published, copy, abstractTitle, abstract, authors, download],
    );
    const reader = new FixturePageReader(url, "Designing Proactive Thought Partners for Writing")
      .add("main#page-content", [root])
      .add(".share-list__item--copy[data-copy-url]", [copy], root)
      .add(".section-title__title", [title], root)
      .add(".section-title__date", [published], root)
      .add(".publication-authors__content", [authors], root)
      .add("a[data-event-content-name='Download'][href*='arxiv.org/pdf/']", [download], root);

    const snapshot = adapter("deepmind_blog").extract(reader);
    expect(snapshot.title).toBe("Designing Proactive Thought Partners for Writing");
    expect(snapshot.authors).toEqual(["Chao Zhang, Abe Davis"]);
    expect(blockText(snapshot)).toContain("Writing involves diverse cognitive activities.");
    expect(snapshot.assets).toEqual([
      expect.objectContaining({ role: "file", url: "https://arxiv.org/pdf/2609.01588", availability: "available" }),
    ]);
    expect(snapshot.completeness).toBe("unknown");

    const fileMatches = adapter("deepmind_blog").rule.file_matches;
    expect(fileMatches?.(new URL(url), new URL("https://arxiv.org/pdf/2609.01588"))).toBe(true);
    expect(fileMatches?.(new URL(url), new URL("https://arxiv.org/abs/2609.01588"))).toBe(false);
    expect(fileMatches?.(new URL(url), new URL("https://arxiv.org/pdf/not-an-arxiv-id.pdf"))).toBe(false);
    expect(fileMatches?.(new URL(url), new URL("https://drive.google.com/file/d/not-approved"))).toBe(false);
  });

  it("registers OpenAI only as a generic-document navigation route", () => {
    expect(RESEARCH_BLOG_SPECS.map(spec => spec.rule.id)).toEqual(["openai_blog", "anthropic_blog", "deepmind_blog"]);
    const openai = RESEARCH_BLOG_SPECS.find(spec => spec.rule.id === "openai_blog");
    expect(openai?.rule.completion).toBeUndefined();
    expect(openai?.rule.selectors.roots).toEqual(["main", "article", "[role='main']"]);
    expect(RESEARCH_BLOG_SPECS.flatMap(spec => spec.asset_hosts)).not.toContain("google.com");
    expect(RESEARCH_BLOG_SPECS.flatMap(spec => spec.asset_hosts)).not.toContain("chatgpt.com");
    expect(RESEARCH_BLOG_SPECS.flatMap(spec => spec.asset_hosts)).not.toContain("claude.ai");
    expect(RESEARCH_BLOG_SPECS.every(spec => spec.status === "experimental" && spec.coverage.verification === "unverified")).toBe(true);
  });
});
