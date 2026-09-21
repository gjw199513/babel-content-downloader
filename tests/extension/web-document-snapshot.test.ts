import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { CaptureRequest } from "../../shared/bridge-protocol.js";
import { contentSnapshotSchema } from "../../runtime/bridge/validation.js";
import { WebHtmlExtractionError } from "../../runtime/web/web-document-extractor.js";
import {
  extractWebDocumentSnapshot,
  isWebDocumentCaptureRequest,
  sameWebDocumentTarget,
  routeOnlyExplicitTabObservation,
  WEB_DOCUMENT_RULE_ID,
  type WebDocumentCaptureRequest,
} from "../../extension/content/web-document-snapshot.js";

const contentId = "a".repeat(64);
const publicText = "This browser-visible public article has enough source prose to be read as a current-page document without invoking a platform-specific selector or page action. ".repeat(3);

function request(url = "https://example.test/articles/browser-fallback?view=1&token=secret#section"): WebDocumentCaptureRequest {
  return {
    target: { type: "url", url },
    adapter_id: "medium",
    expected_origin: "https://example.test",
    allow_focus: false,
    max_related_items: 0,
    capture_mode: "snapshot",
    web_document: { content_id: contentId },
  };
}

function withDocument<T>(html: string, url: string, run: (document: Document) => T): T {
  const dom = new JSDOM(html, { url });
  try {
    return run(dom.window.document);
  } finally {
    dom.window.close();
  }
}

describe("extension generic browser-document snapshots", () => {
  it("maps a read-only current DOM into the runtime-selected browser receipt", () => {
    const value = withDocument(
      `<!doctype html><title>Fallback article</title><main><article>
        <h1>Fallback article</h1><p>${publicText}</p>
        <figure><img src="https://images.example.test/diagram.png" alt="Diagram"></figure>
      </article></main>`,
      "https://example.test/articles/browser-fallback?view=1&token=secret#section",
      document => extractWebDocumentSnapshot(document, request(), new URL(document.location.href)),
    );

    expect(value).toMatchObject({
      platform: "web_page",
      adapter_version: "1",
      source_url: "https://example.test/articles/browser-fallback?view=1",
      canonical_url: "https://example.test/articles/browser-fallback?view=1",
      platform_content_id: contentId,
      content_type: "article",
      access_class: "public_free",
      completeness: "complete",
      completeness_proof: {
        method: "browser_page_capture",
        rule_id: WEB_DOCUMENT_RULE_ID,
        boundary: "dom_read",
        platform_content_id: contentId,
        pending_marker_count: 0,
        unplaced_asset_count: 0,
      },
    });
    expect(value.evidence).toEqual(expect.arrayContaining(["capture:browser_dom"]));
    expect(value.assets).toHaveLength(1);
    expect(value.assets[0]?.role).toBe("image");
    expect(contentSnapshotSchema.safeParse(value).success).toBe(true);
  });

  it("keeps login-public-free access honest while still using the browser-only receipt", () => {
    const value = withDocument(
      `<!doctype html><main><article><h1>Article</h1><p>${publicText}</p></article></main>`,
      "https://example.test/articles/browser-fallback?view=1&token=secret",
      document => extractWebDocumentSnapshot(document, request(), new URL(document.location.href), "login_public_free"),
    );

    expect(value.access_class).toBe("login_public_free");
    expect(value.completeness_proof?.method).toBe("browser_page_capture");
    expect(contentSnapshotSchema.safeParse(value).success).toBe(true);
  });

  it("marks pending, missing-image, and clipped DOM output partial instead of certifying it", () => {
    const cases = [
      `<main aria-busy="true"><article><h1>Pending</h1><p>${publicText}</p></article></main>`,
      `<main><article><h1>Image placeholder</h1><p>${publicText}</p><img src="data:image/gif;base64,AAAA"></article></main>`,
      `<main><article><h1>Clipped code</h1><p>${publicText}</p><pre>${"x".repeat(100_001)}</pre></article></main>`,
    ];
    for (const html of cases) {
      const value = withDocument(
        `<!doctype html><title>Partial</title>${html}`,
        "https://example.test/articles/browser-fallback?view=1&token=secret",
        document => extractWebDocumentSnapshot(document, request(), new URL(document.location.href)),
      );
      expect(value.completeness).toBe("partial");
      expect(value.completeness_proof).toBeUndefined();
    }
  });

  it("accepts only an exact URL snapshot with no action or related-content scope", () => {
    const base = request("https://openai.com/zh-Hans-CN/index/gpt-4-research/#reader");
    expect(isWebDocumentCaptureRequest(base)).toBe(true);
    expect(sameWebDocumentTarget(base, new URL("https://openai.com/zh-Hans-CN/index/gpt-4-research/#other"))).toBe(true);
    expect(sameWebDocumentTarget(base, new URL("https://openai.com/index/gpt-4-research/"))).toBe(false);
    expect(sameWebDocumentTarget(base, new URL("https://openai.com/zh-Hans-CN/index/other-article/"))).toBe(false);

    expect(isWebDocumentCaptureRequest({ ...base, capture_mode: "observe" })).toBe(false);
    expect(isWebDocumentCaptureRequest({ ...base, action: { type: "scroll", delta_y: 1 } })).toBe(false);
    expect(isWebDocumentCaptureRequest({ ...base, max_related_items: 1 })).toBe(false);
    expect(isWebDocumentCaptureRequest({
      ...base,
      target: { type: "tab", instance_ref: "instance", tab_id: 1 },
    })).toBe(false);
  });

  it("binds explicit tab DOM to its observed URL and rejects missing, invalid and changed targets", () => {
    const url="https://medium.com/codex/neural-networks-2f0300b4fb00";
    const tab: WebDocumentCaptureRequest={...request(url),target:{type:"tab",instance_ref:"instance",tab_id:42},web_document:{content_id:contentId,url}};
    expect(isWebDocumentCaptureRequest(tab)).toBe(true);
    for(const invalid of [undefined,"file:///tmp/article","javascript:void(0)","https://user:pass@example.test/article"]){
      expect(isWebDocumentCaptureRequest({...tab,web_document:{content_id:contentId,url:invalid}} as CaptureRequest)).toBe(false);
    }
    const value=withDocument(`<main><h1>Article</h1><p>${publicText}</p></main>`,url,document=>extractWebDocumentSnapshot(document,tab,new URL(url)));
    expect(value.source_url).toBe(url);expect(value.platform_content_id).toBe(contentId);
    expect(value.completeness_proof?.method).toBe("browser_page_capture");
    expect(()=>withDocument(`<main><p>${publicText}</p></main>`,url,document=>extractWebDocumentSnapshot(document,tab,new URL(url+"?edition=2")))).toThrow("WEB_DOCUMENT_TARGET_DRIFTED");
    expect(isWebDocumentCaptureRequest({...request(url),web_document:{content_id:contentId,url:url+"?edition=2"}})).toBe(false);
  });

  it("discovers only article identity without asserting access or offering page actions", () => {
    for (const [id,url] of [
      ["medium","https://medium.com/codex/neural-networks-2f0300b4fb00"],
      ["substack","https://example.substack.com/p/research"],
      ["anthropic_blog","https://www.anthropic.com/engineering/research"],
      ["openai_blog","https://openai.com/zh-Hans-CN/index/gpt-4-research/"],
      ["deepmind_blog","https://deepmind.google/blog/research/"],
      ["huggingface","https://huggingface.co/blog/research"],
    ]) {
      const observed=routeOnlyExplicitTabObservation({id:id!,version:"1"},new URL(url!),"Article","instance",42);
      expect(observed).toMatchObject({instance_id:"instance",tab_id:42,url,access_class:"unknown"});
      expect(observed?.action_targets).toBeUndefined();expect(observed?.diagnostic).toBeUndefined();
    }
    for(const [id,url] of [["huggingface","https://huggingface.co/org/model"],["deepmind_blog","https://deepmind.google/research/publications/paper/"],["youtube","https://youtube.com/watch?v=x"]]){
      expect(routeOnlyExplicitTabObservation({id:id!,version:"1"},new URL(url!),"Article","instance",42)).toBeUndefined();
    }
    const original="https://example.substack.com/p/research?token=secret&view=2";
    const observed=routeOnlyExplicitTabObservation({id:"substack",version:"1"},new URL(original),"Article","instance",42)!;
    expect(observed.url).not.toContain("secret");expect(observed.url).toContain("view=2");
    const bound:WebDocumentCaptureRequest={...request(),target:{type:"tab",instance_ref:"instance",tab_id:42},web_document:{content_id:contentId,url:observed.url}};
    expect(sameWebDocumentTarget(bound,new URL(original))).toBe(false);
  });

  it("fails clear structural login shells and empty pages instead of turning them into content", () => {
    expect(() => withDocument(
      `<!doctype html><title>Sign in</title><form><input type="password"></form>`,
      "https://example.test/articles/browser-fallback?view=1&token=secret",
      document => extractWebDocumentSnapshot(document, request(), new URL(document.location.href)),
    )).toThrow(WebHtmlExtractionError);
    expect(() => withDocument(
      `<!doctype html><title>Loading</title><main><h1>Loading</h1><nav><a href="/">Home</a></nav></main>`,
      "https://example.test/articles/browser-fallback?view=1&token=secret",
      document => extractWebDocumentSnapshot(document, request(), new URL(document.location.href)),
    )).toThrow(WebHtmlExtractionError);
  });
});
