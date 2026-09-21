import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  extractWebDocument,
  extractWebHtml,
  WebHtmlExtractionError,
} from "../runtime/web/html-extractor.js";

const pageUrl = "https://articles.example.test/learning/generic-extraction";
const longParagraph = "This public technical article explains a reproducible extraction technique with enough surrounding context for a reader-oriented parser to identify the current article instead of a page heading alone. ".repeat(8);

function allText(result: ReturnType<typeof extractWebHtml>): string {
  return result.blocks.flatMap(block => "text" in block ? [block.text] : block.type === "list" ? block.items : []).join("\n");
}

function thrownCode(callback: () => unknown): string | undefined {
  try {
    callback();
  } catch (error) {
    return error instanceof WebHtmlExtractionError ? error.code : undefined;
  }
  return undefined;
}

describe("generic public HTML extraction", () => {
  it("does not assign dates from unrelated time elements to an article", () => {
    const result=extractWebHtml(`<title>Original article</title><main><h1>Original article</h1><p>March 14, 2023</p><p>${longParagraph}</p><aside><a href="/related">Related article</a><time datetime="2024-01-12T08:00:00Z">January 12, 2024</time></aside></main>`,pageUrl);
    expect(result.published_at).toBeNull();
    expect(allText(result)).toContain("March 14, 2023");
  });

  it("reports visible article embeds before Readability removes them, without fetching them", () => {
    for (const embed of ['<video src="https://example.test/a.mp4"></video>', '<audio src="https://example.test/a.mp3"></audio>', '<iframe src="https://example.test/embed"></iframe>']) {
      const result = extractWebHtml(`<main><h1>Embedded research</h1><p>${longParagraph}</p>${embed}</main>`,pageUrl);
      expect(result.warnings).toContain('media:embedded_content');
      expect(result.assets).toEqual([]);
    }
    const hidden = extractWebHtml(`<main><h1>Article</h1><p>${longParagraph}</p><video hidden src="https://example.test/a.mp4"></video></main>`,pageUrl);
    expect(hidden.warnings).not.toContain('media:embedded_content');
  });

  it("uses Readability first and preserves ordered prose, code, tables, math, quotes, image sources, and citations", () => {
    const html = `<!doctype html>
      <html><head>
        <title>Generic extraction guide</title>
        <meta name="author" content="Ada Lovelace">
        <meta property="article:author" content="Grace Hopper">
        <meta property="article:published_time" content="2026-09-20T08:00:00Z">
      </head><body>
        <script>globalThis.__babel_untrusted_script_executed = true;</script>
        <article>
          <h1>Generic extraction guide</h1>
          <p>${longParagraph}See the <a href="/reference?token=secret#method">source reference</a>.</p>
          <blockquote>Quoted source material remains distinct from normal prose.</blockquote>
          <pre><code class="language-typescript">  const exact = true;\n  console.log(exact);\n</code></pre>
          <table><caption>Measured outcomes</caption><thead><tr><th rowspan="2">Method</th><th colspan="2">Score</th></tr></thead><tbody><tr><td>Reader</td><td>0.93</td></tr></tbody></table>
          <div data-tex="E = mc^2">Rendered formula must not replace source TeX.</div>
          <figure><picture>
            <source srcset="https://cdn.example.test/diagram,small.png 640w, https://cdn.example.test/diagram,large.png 1280w">
            <img src="data:image/gif;base64,AAAA" alt="Architecture diagram">
          </picture><figcaption>Diagram caption</figcaption></figure>
          <p>${longParagraph}</p>
          <a href="https://models.example.test/weights.bin">A linked weight is only a citation.</a>
        </article>
      </body></html>`;

    const result = extractWebHtml(html, pageUrl);

    // Readability is attempted first. Its sanitized fragment drops `data-tex`,
    // so the source-scope structural comparison intentionally retains the
    // current page instead of flattening the formula into ordinary prose.
    expect(result.extraction).toBe("full_page");
    expect(result.warnings).toContain("readability_omitted_structured_content");
    expect(result.title).toBe("Generic extraction guide");
    expect(result.authors).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(result.published_at).toBe("2026-09-20T08:00:00Z");
    expect(result.blocks).toEqual(expect.arrayContaining([
      { type: "quote", text: "Quoted source material remains distinct from normal prose." },
      { type: "code", language: "typescript", text: "  const exact = true;\n  console.log(exact);\n" },
      { type: "math", format: "latex", text: "E = mc^2" },
      expect.objectContaining({ type: "table", caption: "Measured outcomes" }),
    ]));
    const table = result.blocks.find(block => block.type === "table");
    expect(table).toMatchObject({ rows: [[{ text: "Method", header: true, rowspan: 2 }, { text: "Score", header: true, colspan: 2 }], [{ text: "Reader", header: false }, { text: "0.93", header: false }]] });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      role: "image",
      url: "https://cdn.example.test/diagram,large.png",
      title: "Diagram caption",
      availability: "available",
    });
    const imageIndex = result.blocks.findIndex(block => block.type === "image");
    const codeIndex = result.blocks.findIndex(block => block.type === "code");
    expect(imageIndex).toBeGreaterThan(codeIndex);
    expect(allText(result)).toContain("https://articles.example.test/reference#method");
    expect(result.assets.some(asset => asset.url.includes("weights.bin"))).toBe(false);
    expect(allText(result)).not.toContain("__babel_untrusted_script_executed");
    expect((globalThis as { __babel_untrusted_script_executed?: boolean }).__babel_untrusted_script_executed).toBeUndefined();
  });

  it("falls back to readable current-body content when Readability omits main-scoped technical structure", () => {
    const html = `<!doctype html><html><head><title>Current page fallback</title></head><body>
      <header><img src="https://cdn.example.test/navigation-logo.png" alt="Site logo"><a href="/">Site navigation</a></header>
      <main>
        <article><h1>Current page fallback</h1><p>${longParagraph}</p><p>${longParagraph}</p></article>
        <aside class="sidebar"><pre><code class="language-python">    preserved = True\n</code></pre>
          <figure><img src="https://cdn.example.test/current-page.png" alt="Current page image"></figure></aside>
      </main>
    </body></html>`;

    const result = extractWebHtml(html, pageUrl);

    expect(result.extraction).toBe("full_page");
    expect(result.warnings).toContain("readability_omitted_structured_content");
    expect(result.blocks).toEqual(expect.arrayContaining([
      { type: "code", language: "python", text: "    preserved = True\n" },
    ]));
    expect(result.assets.map(asset => asset.url)).toContain("https://cdn.example.test/current-page.png");
    expect(result.assets.map(asset => asset.url)).not.toContain("https://cdn.example.test/navigation-logo.png");
  });

  it("does not assign a picture source rendition to an ambiguous pair of fallback images", () => {
    const html = `<!doctype html><html><head><title>Picture ambiguity</title></head><body><article>
      <h1>Picture ambiguity</h1><p>${longParagraph}</p>
      <picture><source srcset="https://cdn.example.test/wrong-rendition.png 1200w">
        <img src="data:image/gif;base64,AAAA" alt="First placeholder"><img src="data:image/gif;base64,BBBB" alt="Second placeholder">
      </picture>
      <p>${longParagraph}</p>
    </article></body></html>`;

    const result = extractWebHtml(html, pageUrl);

    expect(result.assets).toEqual([]);
    expect(result.warnings).toContain("asset:image:non_http_or_missing_source");
    expect(result.blocks.some(block => block.type === "image")).toBe(false);
  });

  it("rejects structural gates and empty shells without rejecting article prose that discusses sign-in", () => {
    expect(thrownCode(() => extractWebHtml(`<!doctype html><title>Sign in · Example</title><form><input type="password"></form>`, pageUrl)))
      .toBe("ACCESS_NOT_PUBLIC");
    expect(thrownCode(() => extractWebHtml(`<!doctype html><title>Loading</title><main><h1>Loading</h1><nav><a href="/">Home</a></nav></main>`, pageUrl)))
      .toBe("CONTENT_NOT_FOUND");
    for (const title of ["Just a moment...", "Sign in · Example", "Subscribe to continue"]) {
      expect(thrownCode(() => extractWebHtml(`<!doctype html><title>${title}</title><main><p>Please verify your account before continuing to read this content.</p><img src="/brand.png"></main>`, pageUrl))).toBe("ACCESS_NOT_PUBLIC");
    }
    const discussion = extractWebHtml(`<!doctype html><title>A guide to login failures</title><article><h1>A guide to login failures</h1><p>${longParagraph}The word login appears here as technical source prose, not as an access gate.</p></article>`, pageUrl);
    expect(discussion.title).toBe("A guide to login failures");
    expect(discussion.extraction).toBe("readability");
    expect(allText(discussion)).toContain("login appears here");
  });

  it("marks an explicitly busy current-page root instead of certifying its loading content", () => {
    const result = extractWebHtml(`<!doctype html><title>Article</title><main aria-busy="true"><p>${longParagraph}</p></main>`, pageUrl);
    expect(result.warnings).toContain("content_pending:dom");
  });

  it("marks source-body clipping instead of silently presenting a truncated page as intact", () => {
    const oversizedCode = "x".repeat(100_001);
    const result = extractWebHtml(`<!doctype html><title>Bounded code</title><article><h1>Bounded code</h1><p>${longParagraph}</p><pre>${oversizedCode}</pre><p>${longParagraph}</p></article>`, pageUrl);

    expect(result.warnings).toContain("content_truncated:limits");
    expect(result.blocks.find(block => block.type === "code")).toMatchObject({ text: "x".repeat(100_000) });
  });

  it("shares the same document conversion core without requiring JSDOM in a future browser caller", () => {
    const dom = new JSDOM(`<!doctype html><title>DOM core</title><article><h1>DOM core</h1><p>${longParagraph}</p></article>`, { url: pageUrl });
    try {
      const result = extractWebDocument(dom.window.document, pageUrl);
      expect(result.title).toBe("DOM core");
      expect(result.blocks.some(block => block.type === "paragraph")).toBe(true);
    } finally {
      dom.window.close();
    }
  });
});
