import { describe, expect, it } from "vitest";
import { actionTargets, automaticExpandTarget, extract, finalizeStableCompletion, nodeForAdapterAction } from "../../adapters/shared-extractors/extractor.js";
import { AdapterExtractionError, type PlatformAdapter } from "../../adapters/types.js";
import { createAdapterRegistry, DEVELOPMENT_FIXTURE_ORIGIN, listPlatformCoverage } from "../../adapters/registry.js";
import { contentSnapshotSchema, parseBridgeResponse } from "../../runtime/bridge/validation.js";
import { evaluateContentCompleteness } from "../../shared/completeness.js";
import { FixtureNode, FixturePageReader, node } from "./fixture-reader.js";

const registry = createAdapterRegistry();

const RETAINED_PLATFORM_IDS = [
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

const REMOVED_PLATFORM_URLS = {
  douyin: "https://www.douyin.com/video/7117200114686414094",
  kuaishou: "https://www.kuaishou.com/short-video/3xgcpnkzc7gmai6",
  weixin_channels: "https://channels.weixin.qq.com/web/pages/feed?finderUserName=example",
  weibo: "https://weibo.com/1234567890/AbCdEf12",
  toutiao: "https://www.toutiao.com/article/7664358973897851442/",
  xigua: "https://www.ixigua.com/1234567890123456789",
  baijiahao: "https://baijiahao.baidu.com/s?id=1234567890123456789",
  netease: "https://www.163.com/dy/article/ABC123.html",
  sohu: "https://www.sohu.com/a/887256733_99994080",
  penguin: "https://page.om.qq.com/page/abc123",
  tiktok: "https://www.tiktok.com/@creator/video/1234567890123456789",
  instagram: "https://www.instagram.com/p/ABCdef123/",
  facebook: "https://www.facebook.com/NASA/posts/900549688107075",
  threads: "https://www.threads.com/@alice/post/ABCdef1",
  pinterest: "https://www.pinterest.com/pin/362962051216937379/",
  linkedin: "https://www.linkedin.com/posts/example_1234567890",
  jianshu: "https://www.jianshu.com/p/abc123",
  csdn: "https://blog.csdn.net/example/article/details/123456",
  juejin: "https://juejin.cn/post/1234567890123456789",
  cnblogs: "https://www.cnblogs.com/example/p/123.html",
  douban: "https://www.douban.com/note/123456789/",
  bluesky: "https://bsky.app/profile/example.com/post/3abc",
  tumblr: "https://example.tumblr.com/post/123456789/example",
  quora: "https://www.quora.com/Example-question/answer/Example-user",
  wordpress_com: "https://example.wordpress.com/2026/09/19/post/",
  vimeo: "https://vimeo.com/123456789",
  dailymotion: "https://www.dailymotion.com/video/x123abc",
  twitch: "https://www.twitch.tv/videos/123456789",
  acfun: "https://www.acfun.cn/v/ac12345678",
} as const;

function adapter(id: string) {
  const found = registry.get(id);
  if (!found) throw new Error(`Missing adapter ${id}`);
  return found;
}

describe("platform registry coverage", () => {
  it("exposes exactly the fifteen retained platforms and leaves every removed platform unregistered", () => {
    const coverage = listPlatformCoverage();
    expect(coverage.map(item => item.id)).toEqual(RETAINED_PLATFORM_IDS);
    expect(registry.list().map(item => item.id)).toEqual(RETAINED_PLATFORM_IDS);
    expect(coverage.every(item => item.tier === "baseline" && item.implementation === "implemented")).toBe(true);

    for (const [id, value] of Object.entries(REMOVED_PLATFORM_URLS)) {
      expect(registry.get(id), `${id} must not remain registered`).toBeUndefined();
      expect(registry.match(new URL(value)), `${value} must not match a retained adapter`).toBeUndefined();
      expect(coverage.some(item => item.id === id), `${id} must not remain in coverage`).toBe(false);
    }

    expect(registry.match(new URL("https://www.xiaohongshu.com/explore"))).toBeUndefined();
    expect(registry.match(new URL("https://www.youtube.com/results?search_query=example"))).toBeUndefined();
    expect(registry.match(new URL("https://notx.com/user/status/123456"))).toBeUndefined();
    expect(registry.match(new URL("https://openai.com/index/deep-research-system-card/"))?.id).toBe("openai_blog");
    expect(registry.match(new URL("https://openai.com/research/deep-research-system-card/"))).toBeUndefined();
  });

  it("adds the local fixture adapter only for the exact trusted development origin", () => {
    const disabled = createAdapterRegistry();
    const enabled = createAdapterRegistry({ fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] });
    expect(disabled.match(new URL("http://127.0.0.1:4319/fixture/content/alpha"))).toBeUndefined();
    expect(enabled.match(new URL("http://127.0.0.1:4319/fixture/content/alpha"))?.id).toBe("development_fixture");
    expect(enabled.match(new URL("http://127.0.0.1:4320/fixture/content/alpha"))).toBeUndefined();
  });

  it("extracts the controlled fixture body in source order without promoting byline metadata to content", () => {
    const fixture = createAdapterRegistry({ fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] }).get("development_fixture");
    if (!fixture) throw new Error("Expected the opt-in development fixture adapter.");
    const title = node("fixture-title", "h1", "离线图文验收");
    const author = node("fixture-author", "div", "Babel development fixture");
    const published = node("fixture-time", "time", "2026-09-18", { datetime: "2026-09-18" });
    const before = node("fixture-before", "#text", "图片前的正文。");
    const image = node("fixture-image", "img", "", { src: "/fixture/assets/image.png", alt: "蓝色测试图" });
    const after = node("fixture-after", "#text", "图片后的正文应仍在图片之后。");
    const paragraph = node("fixture-paragraph", "p", "", {}, [before, image, after]);
    const root = node("fixture-root", "article", "离线图文验收 Babel development fixture 2026-09-18 图片前的正文。图片后的正文应仍在图片之后。", {}, [title, author, published, paragraph]);
    const reader = new FixturePageReader("http://127.0.0.1:4319/fixture/content/article", "Babel 图文开发验收")
      .add("[data-babel-fixture='content']", [root])
      .add("[data-babel-fixture='title']", [title], root)
      .add("[data-babel-fixture='author']", [author], root)
      .add("time[data-babel-fixture='published']", [published], root)
      .add("img[data-babel-fixture='image']", [image], root);

    const snapshot = fixture.extract(reader);

    expect(snapshot.completeness).toBe("complete");
    expect(snapshot.completeness_proof).toEqual({
      version: 1,
      scope: "single_item",
      method: "adapter_bounded_dom",
      rule_id: "development_fixture.bounded_root.v1",
      platform_content_id: "article",
      boundary: "root_exhausted",
      pending_marker_count: 0,
      ordered_asset_count: 1,
      unplaced_asset_count: 0,
    });
    expect(fixture.completion_rules).toEqual([
      expect.objectContaining({
        id: "development_fixture.bounded_root.v1",
        content_types: ["article", "image_note", "video", "audio", "mixed"],
        boundary: "root_exhausted",
      }),
    ]);
    expect(fixture.completion_rules?.[0]?.matches(new URL("http://127.0.0.1:4319/fixture/content/article"), "article")).toBe(true);
    expect(fixture.completion_rules?.[0]?.matches(new URL("http://127.0.0.1:4319/fixture/content/article"), "article-other")).toBe(false);
    expect(snapshot.blocks).toEqual([
      { type: "heading", level: 1, text: "离线图文验收" },
      { type: "paragraph", text: "图片前的正文。" },
      { type: "image", asset_id: "development_fixture:image:001", caption: "蓝色测试图" },
      { type: "paragraph", text: "图片后的正文应仍在图片之后。" },
    ]);
    expect(snapshot.blocks.some(block => "text" in block && block.text.includes("Babel development fixture"))).toBe(false);
    expect(snapshot.assets).toMatchObject([{ role: "image", url: "http://127.0.0.1:4319/fixture/assets/image.png", availability: "available" }]);
  });

  it("omits missing or invalid image dimensions before validating the fixture snapshot through the bridge", () => {
    const fixture = createAdapterRegistry({ fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] }).get("development_fixture");
    if (!fixture) throw new Error("Expected the opt-in development fixture adapter.");
    const title = node("dimensions-title", "h1", "图片尺寸协议回归");
    const missing = node("image-missing", "img", "", { src: "/fixture/assets/missing.png" });
    const empty = node("image-empty", "img", "", { src: "/fixture/assets/empty.png", width: "", height: " " });
    const zero = node("image-zero", "img", "", { src: "/fixture/assets/zero.png", width: "0", height: "000" });
    const invalid = node("image-invalid", "img", "", { src: "/fixture/assets/invalid.png", width: "wide", height: "-1" });
    const fractional = node("image-fractional", "img", "", { src: "/fixture/assets/fractional.png", width: "1.5", height: "1e3" });
    const partial = node("image-partial", "img", "", { src: "/fixture/assets/partial.png", width: "0", height: "720" });
    const valid = node("image-valid", "img", "", { src: "/fixture/assets/valid.png", width: "1440", height: "900" });
    const images = [missing, empty, zero, invalid, fractional, partial, valid];
    const root = node("dimensions-root", "article", "图片尺寸协议回归", {}, [title, ...images]);
    const reader = new FixturePageReader("http://127.0.0.1:4319/fixture/content/dimensions", "图片尺寸协议回归")
      .add("[data-babel-fixture='content']", [root])
      .add("[data-babel-fixture='title']", [title], root)
      .add("img[data-babel-fixture='image']", images, root);

    const snapshot = fixture.extract(reader);
    const assets = snapshot.assets.filter(asset => asset.role === "image");

    expect(assets).toHaveLength(7);
    for (const asset of assets.slice(0, 5)) {
      expect(asset).not.toHaveProperty("width");
      expect(asset).not.toHaveProperty("height");
    }
    expect(assets[5]).toMatchObject({ height: 720 });
    expect(assets[5]).not.toHaveProperty("width");
    expect(assets[6]).toMatchObject({ width: 1440, height: 900 });
    expect(snapshot.completeness).toBe("complete");

    expect(contentSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(parseBridgeResponse({
      version: 1,
      request_id: "11111111-1111-4111-8111-111111111111",
      nonce: "fixture-dimensions",
      session_id: "22222222-2222-4222-8222-222222222222",
      ok: true,
      result: { snapshot },
    })).toMatchObject({ ok: true, result: { snapshot: { assets } } });
  });

  it("only emits a controlled proof when its bounded fixture root, boundary, relations, and asset placement all agree", () => {
    const fixture = createAdapterRegistry({ fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] }).get("development_fixture");
    if (!fixture) throw new Error("Expected the opt-in development fixture adapter.");
    const plan = fixture.rule.completion?.[0];
    if (!plan) throw new Error("Expected the controlled fixture completion plan.");

    const makeReader = (root: FixtureNode, title: FixtureNode, images: FixtureNode[]) => {
      return new FixturePageReader("http://127.0.0.1:4319/fixture/content/proof", "受控完整性证明")
        .add("[data-babel-fixture='content']", [root])
        .add("[data-babel-fixture='title']", [title], root)
        .add("img[data-babel-fixture='image']", images, root);
    };
    const makeRoot = (prefix: string, extras: FixtureNode[] = []) => {
      const title = node(`${prefix}-title`, "h1", "受控完整性证明");
      const prose = node(`${prefix}-prose`, "p", "", {}, [node(`${prefix}-text`, "#text", "正文")]);
      const image = node(`${prefix}-image`, "img", "", { src: "/fixture/assets/proof.png" });
      const root = node(`${prefix}-root`, "article", "受控完整性证明 正文", {}, [title, prose, image, ...extras]);
      return { root, title, image };
    };
    const normal = makeRoot("proof");

    const noPlanAdapter: PlatformAdapter = {
      ...fixture,
      coverage: { ...fixture.coverage, verification: "browser_verified" },
      rule: { ...fixture.rule, completion: undefined },
    };
    expect(extract(makeReader(normal.root, normal.title, [normal.image]), noPlanAdapter).completeness).toBe("unknown");

    const terminal = node("proof-terminal", "div", "文章结尾");
    const terminalFixture = makeRoot("terminal", [terminal]);
    const terminalAdapter: PlatformAdapter = {
      ...fixture,
      rule: {
        ...fixture.rule,
        completion: [{
          ...plan,
          boundary: { type: "terminal_observed", selectors: ["[data-babel-fixture='terminal']"] },
        }],
      },
    };
    expect(extract(makeReader(terminalFixture.root, terminalFixture.title, [terminalFixture.image]), terminalAdapter).completeness).toBe("unknown");
    const terminalReader = makeReader(terminalFixture.root, terminalFixture.title, [terminalFixture.image])
      .add("[data-babel-fixture='terminal']", [terminal], terminalFixture.root);
    expect(extract(terminalReader, terminalAdapter).completeness_proof?.boundary).toBe("terminal_observed");

    const pending = node("proof-pending", "div", "继续加载");
    const pendingFixture = makeRoot("pending", [pending]);
    const pendingAdapter: PlatformAdapter = {
      ...fixture,
      rule: { ...fixture.rule, completion: [{ ...plan, pending_or_truncation: ["[data-babel-fixture='pending']"] }] },
    };
    const pendingReader = makeReader(pendingFixture.root, pendingFixture.title, [pendingFixture.image])
      .add("[data-babel-fixture='pending']", [pending], pendingFixture.root);
    expect(extract(pendingReader, pendingAdapter).completeness).toBe("unknown");

    const trappedImage = node("proof-trapped-image", "img", "", { src: "/fixture/assets/trapped.png" });
    const ignoredScript = node("proof-script", "script", "", {}, [trappedImage]);
    const unplacedFixture = makeRoot("unplaced", [ignoredScript]);
    const unplacedReader = makeReader(unplacedFixture.root, unplacedFixture.title, [unplacedFixture.image, trappedImage]);
    expect(extract(unplacedReader, fixture).completeness).toBe("unknown");

    const relatedAdapter: PlatformAdapter = {
      ...fixture,
      rule: {
        ...fixture.rule,
        relations: {
          item_roots: [],
          permalink_links: [],
          continuation_parent_links: [],
          quote_roots: [],
          repost_roots: [],
        },
      },
    };
    const relatedFixture = makeRoot("related");
    expect(extract(makeReader(relatedFixture.root, relatedFixture.title, [relatedFixture.image]), relatedAdapter, { max_related_items: 1 }).completeness).toBe("unknown");
  });

  it("skips button UI text while preserving only registered button media in source order", () => {
    const fixture = createAdapterRegistry({ fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] }).get("development_fixture");
    if (!fixture) throw new Error("Expected the opt-in development fixture adapter.");

    const buttonAdapter: PlatformAdapter = {
      ...fixture,
      rule: {
        ...fixture.rule,
        selectors: {
          ...fixture.rule.selectors,
          excluded: ["[data-button-excluded]"],
        },
      },
    };

    const makeFixture = (prefix: string, includeUnknownMedia: boolean) => {
      const title = node(`${prefix}-title`, "h1", "按钮媒体边界");
      const beforeText = "原文保留 read image description";
      const directUi = node(`${prefix}-direct-ui`, "button", "read image description", {}, [
        node(`${prefix}-direct-ui-text`, "#text", "read image description"),
      ]);
      const wrappedUi = node(`${prefix}-wrapped-ui`, "span", "wrapped button UI", {}, [
        node(`${prefix}-wrapped-button`, "button", "wrapped button UI", {}, [node(`${prefix}-wrapped-button-text`, "#text", "wrapped button UI")]),
      ]);
      const image = node(`${prefix}-image`, "img", "", { src: "/fixture/assets/button-image.png", "data-babel-fixture": "image" });
      const excludedImage = node(`${prefix}-excluded-image`, "img", "", { src: "/fixture/assets/excluded-button-image.png", "data-babel-fixture": "image" });
      const excludedControl = node(`${prefix}-excluded-control`, "span", "excluded UI", { "data-button-excluded": "true" }, [excludedImage]);
      const video = node(`${prefix}-video`, "video", "", { src: "/fixture/assets/button-video.mp4", "data-babel-fixture": "video" });
      const imageButton = node(`${prefix}-image-button`, "button", "image control text", {}, [image, excludedControl]);
      const videoButton = node(`${prefix}-video-button`, "button", "video control text", {}, [video]);
      const paragraph = node(`${prefix}-paragraph`, "p", "", {}, [
        node(`${prefix}-before-text`, "#text", beforeText),
        imageButton,
        node(`${prefix}-after-text`, "#text", "段落后文"),
      ]);
      const quote = node(`${prefix}-quote`, "blockquote", "", {}, [
        node(`${prefix}-quote-before`, "#text", "引用前文"),
        videoButton,
        node(`${prefix}-quote-after`, "#text", "引用后文"),
      ]);
      const unknownImage = node(`${prefix}-unknown-image`, "img", "", { src: "/fixture/assets/unregistered.png" });
      const unknownButton = node(`${prefix}-unknown-button`, "button", "unknown media UI", {}, [unknownImage]);
      const root = node(`${prefix}-root`, "article", "按钮媒体边界", {}, [
        title,
        directUi,
        wrappedUi,
        paragraph,
        quote,
        ...(includeUnknownMedia ? [unknownButton] : []),
      ]);
      const reader = new FixturePageReader(`http://127.0.0.1:4319/fixture/content/${prefix}`, "按钮媒体边界")
        .add("[data-babel-fixture='content']", [root])
        .add("[data-babel-fixture='title']", [title], root)
        .add("img[data-babel-fixture='image']", [image, excludedImage], root)
        .add("video[data-babel-fixture='video']", [video], root)
        .add("[data-button-excluded]", [excludedControl], root);
      return { reader, beforeText };
    };

    const controlled = makeFixture("button-media", false);
    const snapshot = extract(controlled.reader, buttonAdapter);
    expect(snapshot.blocks).toEqual([
      { type: "heading", level: 1, text: "按钮媒体边界" },
      { type: "paragraph", text: controlled.beforeText },
      { type: "image", asset_id: "development_fixture:image:001" },
      { type: "paragraph", text: "段落后文" },
      { type: "quote", text: "引用前文" },
      { type: "video", asset_id: "development_fixture:video:002" },
      { type: "quote", text: "引用后文" },
    ]);
    expect(snapshot.assets.map(asset => asset.role)).toEqual(["image", "video"]);
    expect(JSON.stringify(snapshot.blocks).match(/read image description/g)).toHaveLength(1);
    expect(JSON.stringify(snapshot.blocks)).not.toMatch(/wrapped button UI|image control text|video control text|excluded UI|unknown media UI/);
    expect(snapshot.completeness).toBe("complete");

    const unknown = makeFixture("button-unknown", true);
    const unknownSnapshot = extract(unknown.reader, buttonAdapter);
    expect(unknownSnapshot.assets.map(asset => asset.role)).toEqual(["image", "video"]);
    expect(unknownSnapshot.blocks).toEqual(snapshot.blocks);
    expect(unknownSnapshot.completeness).toBe("unknown");
    expect(unknownSnapshot.completeness_proof).toBeUndefined();

    const imageOnlyAdapter: PlatformAdapter = {
      ...fixture,
      rule: {
        ...fixture.rule,
        selectors: { ...fixture.rule.selectors, title: [] },
      },
    };
    const imageOnly = node("button-only-image", "img", "", { src: "/fixture/assets/button-only.png", "data-babel-fixture": "image" });
    const imageOnlyButton = node("button-only-control", "button", "read image description", {}, [imageOnly]);
    const imageOnlyRoot = node("button-only-root", "article", "read image description", {}, [imageOnlyButton]);
    const imageOnlyReader = new FixturePageReader("http://127.0.0.1:4319/fixture/content/button-only", "button-only shell")
      .add("[data-babel-fixture='content']", [imageOnlyRoot])
      .add("img[data-babel-fixture='image']", [imageOnly], imageOnlyRoot);
    const imageOnlySnapshot = extract(imageOnlyReader, imageOnlyAdapter);
    expect(imageOnlySnapshot.blocks).toEqual([{ type: "image", asset_id: "development_fixture:image:001" }]);
    expect(imageOnlySnapshot.completeness).toBe("complete");
  });

  it("preserves two image occurrences with the same source URL and proves their separate body positions", () => {
    const fixture = createAdapterRegistry({ fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] }).get("development_fixture");
    if (!fixture) throw new Error("Expected the opt-in development fixture adapter.");
    const title = node("duplicate-title", "h1", "重复图片位置");
    const before = node("duplicate-before", "#text", "第一处前");
    const first = node("duplicate-image-one", "img", "", { src: "/fixture/assets/reused.png" });
    const middle = node("duplicate-middle", "#text", "第二处前");
    const second = node("duplicate-image-two", "img", "", { src: "/fixture/assets/reused.png" });
    const paragraph = node("duplicate-paragraph", "p", "", {}, [before, first, middle, second]);
    const root = node("duplicate-root", "article", "重复图片位置 第一处前 第二处前", {}, [title, paragraph]);
    const reader = new FixturePageReader("http://127.0.0.1:4319/fixture/content/duplicate", "重复图片位置")
      .add("[data-babel-fixture='content']", [root])
      .add("[data-babel-fixture='title']", [title], root)
      .add("img[data-babel-fixture='image']", [first, second], root);

    const snapshot = fixture.extract(reader);

    expect(snapshot.assets.filter(asset => asset.role === "image")).toEqual([
      expect.objectContaining({ id: "development_fixture:image:001", url: "http://127.0.0.1:4319/fixture/assets/reused.png", order: 1 }),
      expect.objectContaining({ id: "development_fixture:image:002", url: "http://127.0.0.1:4319/fixture/assets/reused.png", order: 2 }),
    ]);
    expect(snapshot.blocks.flatMap(block => block.type === "image" ? [block.asset_id] : [])).toEqual([
      "development_fixture:image:001",
      "development_fixture:image:002",
    ]);
    expect(snapshot.completeness_proof?.ordered_asset_count).toBe(2);
  });

  it("does not split a selected player and its source descendant into two media occurrences", () => {
    const fixture = createAdapterRegistry({ fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] }).get("development_fixture");
    if (!fixture) throw new Error("Expected the opt-in development fixture adapter.");
    const title = node("player-title", "h1", "一个播放器");
    const source = node("player-source", "source", "", { src: "/fixture/assets/high.mp4" });
    const video = node("player-video", "video", "", { src: "/fixture/assets/low.mp4" }, [source]);
    const root = node("player-root", "article", "一个播放器", {}, [title, video]);
    const reader = new FixturePageReader("http://127.0.0.1:4319/fixture/content/player", "一个播放器")
      .add("[data-babel-fixture='content']", [root])
      .add("[data-babel-fixture='title']", [title], root)
      .add("video[data-babel-fixture='video']", [video], root)
      .add("video[data-babel-fixture='video'] source", [source], root)
      .add("source", [source], video);
    const playerAdapter: PlatformAdapter = {
      ...fixture,
      rule: {
        ...fixture.rule,
        completion: undefined,
        selectors: {
          ...fixture.rule.selectors,
          videos: ["video[data-babel-fixture='video']", "video[data-babel-fixture='video'] source"],
        },
      },
    };

    const snapshot = extract(reader, playerAdapter);

    expect(snapshot.assets.filter(asset => asset.role === "video")).toEqual([
      expect.objectContaining({ id: "development_fixture:video:001", url: "http://127.0.0.1:4319/fixture/assets/low.mp4" }),
    ]);
    expect(snapshot.blocks.flatMap(block => block.type === "video" ? [block.asset_id] : [])).toEqual(["development_fixture:video:001"]);
  });
});

describe("specific extraction families", () => {
  it("keeps Xiaohongshu source identity safe while retaining ordered inline media", () => {
    const title = node("title", "h1", "秋日笔记");
    const author = node("author", "a", "小王");
    const published = node("published", "time", "2026-09-18", { datetime: "2026-09-18T10:00:00+08:00" });
    const firstText = node("first-text", "#text", "第一段文案");
    const firstImage = node("image-1", "img", "", { "data-original": "https://sns-img-qc.xhscdn.com/original-1.jpg", src: "https://sns-img-qc.xhscdn.com/thumb-1.jpg" });
    const secondText = node("second-text", "#text", "第二段文案");
    const secondImage = node("image-2", "img", "", { srcset: "https://sns-img-qc.xhscdn.com/low-2.jpg 400w, https://sns-img-qc.xhscdn.com/original-2.jpg 1440w" });
    const video = node("video", "video", "", { src: "https://sns-video-bd.xhscdn.com/note.mp4" });
    const subtitle = node("subtitle", "track", "", { src: "https://sns-video-bd.xhscdn.com/note.zh.vtt", srclang: "zh" });
    const paragraph = node("paragraph", "p", "", {}, [firstText, firstImage, secondText, secondImage, video]);
    const root = node("root", "div", "", {}, [paragraph]);
    const cover = node("cover", "meta", "", { content: "https://sns-img-qc.xhscdn.com/cover.jpg" });
    const reader = new FixturePageReader("https://www.xiaohongshu.com/explore/abc123?xsec_token=secret&xsec_source=share", "秋日笔记")
      .add("#noteContainer", [root])
      .add("#detail-title", [title], root)
      .add("#userPageContainer .username", [author], root)
      .add("time", [published], root)
      .add(".swiper-slide img", [firstImage, secondImage], root)
      .add("[data-testid='note-video'] video", [video], root)
      .add("video track[kind='captions']", [subtitle], root)
      .add("meta[property='og:image']", [cover]);

    const snapshot = adapter("xiaohongshu").extract(reader);
    expect(snapshot.platform_content_id).toBe("abc123");
    expect(snapshot.source_url).not.toContain("xsec_token");
    expect(snapshot.assets.map(asset => [asset.role, asset.url, asset.order])).toEqual([
      ["cover", "https://sns-img-qc.xhscdn.com/cover.jpg", 0],
      ["image", "https://sns-img-qc.xhscdn.com/original-1.jpg", 1],
      ["image", "https://sns-img-qc.xhscdn.com/original-2.jpg", 2],
      ["video", "https://sns-video-bd.xhscdn.com/note.mp4", 3],
      ["subtitle", "https://sns-video-bd.xhscdn.com/note.zh.vtt", 4],
    ]);
    expect(snapshot.blocks.map(block => block.type)).toEqual(["heading", "paragraph", "image", "paragraph", "image", "video"]);
    expect(snapshot.completeness).toBe("unknown");
  });

  it("uses the observed Zhihu RichText body instead of its TOC wrapper and scopes metadata to the same article", () => {
    const title = node("zhihu-title", "h1", "嵌套正文");
    const author = node("zhihu-author", "span", "苏洋");
    const unrelatedAuthor = node("zhihu-sidebar-author", "span", "侧栏作者");
    const published = node("zhihu-published", "meta", "", { content: "2022-12-29T22:54:00+08:00" });
    const unrelatedPublished = node("zhihu-sidebar-published", "meta", "", { content: "1999-01-01T00:00:00+08:00" });
    const section = node("zhihu-section", "h2", "正文开始");
    const plainStart = node("zhihu-plain-start", "span", "前缀");
    const plainContinue = node("zhihu-plain-continue", "span", "续写");
    const first = node("zhihu-first", "p", "", {}, [node("zhihu-first-text", "#text", "第一段")]);
    const image = node("zhihu-image", "img", "", { src: "https://picx.zhimg.com/nested-order.jpg" });
    const figure = node("zhihu-figure", "figure", "", {}, [image]);
    const second = node("zhihu-second", "p", "", {}, [node("zhihu-second-text", "#text", "第二段")]);
    // Browser innerText on these wrappers contains both paragraphs. The
    // extractor must recurse instead of flattening that value into one block.
    const innerWrapper = node("zhihu-inner-wrapper", "span", "第一段 第二段", {}, [first, figure, second]);
    const outerWrapper = node("zhihu-outer-wrapper", "span", "第一段 第二段", {}, [innerWrapper]);
    const plainEnd = node("zhihu-plain-end", "span", "尾注");
    const body = node("zhihu-rich-text", "div", "正文开始 前缀 续写 第一段 第二段 尾注", {}, [
      section,
      plainStart,
      plainContinue,
      outerWrapper,
      plainEnd,
    ]);
    const toc = node("zhihu-toc", "div", "目录 收起 技术 其他", {}, [
      node("zhihu-toc-text", "#text", "目录 收起 技术 其他"),
    ]);
    const content = node("zhihu-content", "span", "", {}, [body]);
    const contentWrapper = node("zhihu-content-wrapper", "div", "", {}, [content]);
    const rootWrapper = node("zhihu-root-wrapper", "div", "", {}, [toc, contentWrapper]);
    const itemRoot = node("zhihu-item-root", "div", "", {}, [rootWrapper]);
    const header = node("zhihu-header", "header", "", {}, [title, author]);
    const article = node("zhihu-article", "article", "", {}, [header, itemRoot, published]);
    const reader = new FixturePageReader("https://zhuanlan.zhihu.com/p/595291507", "嵌套正文")
      .add(".Post-RichTextContainer .RichText.ztext.Post-RichText", [body])
      .add("article.Post-Main.Post-NormalMain", [article])
      .add(".Post-Title", [title])
      .add("[itemprop='author'] .AuthorInfo-name", [author, unrelatedAuthor])
      .add("[itemprop='author'] .AuthorInfo-name", [author], article)
      .add("[itemprop='datePublished']", [published, unrelatedPublished])
      .add("[itemprop='datePublished']", [published], article)
      .add(".Post-RichTextContainer img", [image]);

    const snapshot = adapter("zhihu").extract(reader);

    expect(snapshot.blocks).toEqual([
      { type: "heading", level: 1, text: "嵌套正文" },
      { type: "heading", level: 2, text: "正文开始" },
      { type: "paragraph", text: "前缀 续写" },
      { type: "paragraph", text: "第一段" },
      { type: "image", asset_id: "zhihu:image:001" },
      { type: "paragraph", text: "第二段" },
      { type: "paragraph", text: "尾注" },
    ]);
    expect(snapshot.authors).toEqual(["苏洋"]);
    expect(snapshot.published_at).toBe("2022-12-29T22:54:00+08:00");
    expect(snapshot.evidence).toContain("body_root:.Post-RichTextContainer .RichText.ztext.Post-RichText");
    expect(snapshot.blocks.some(block => "text" in block && /目录|收起|技术 其他/.test(block.text))).toBe(false);
    expect(snapshot.assets.filter(asset => asset.role === "image")).toHaveLength(1);
    expect(snapshot.completeness).toBe("unknown");
  });

  it("requires the observed Zhihu column article terminal adjacency and stable-sample gate before a production proof", () => {
    const zhihu = adapter("zhihu");
    const makeReader = (prefix: string, terminalImmediatelyFollowsBody: boolean) => {
      const title = node(`${prefix}-title`, "h1", "专栏正文");
      const author = node(`${prefix}-author`, "span", "作者");
      const published = node(`${prefix}-published`, "meta", "", { content: "2022-12-29T22:54:00+08:00" });
      const prose = node(`${prefix}-prose`, "p", "", {}, [node(`${prefix}-text`, "#text", "正文段落")]);
      const image = node(`${prefix}-image`, "img", "", { src: "https://picx.zhimg.com/article-image.jpg" });
      const richText = node(`${prefix}-richtext`, "div", "正文段落", {}, [prose, node(`${prefix}-figure`, "figure", "", {}, [image])]);
      const outerBody = node(`${prefix}-outer`, "div", "", {}, [node(`${prefix}-content`, "span", "", {}, [richText])]);
      const terminal = node(`${prefix}-terminal`, "div", "编辑于 2022-12-29 22:54");
      const topics = node(`${prefix}-topics`, "div", "话题");
      const header = node(`${prefix}-header`, "header", "", {}, [title, author]);
      const article = node(
        `${prefix}-article`,
        "article",
        "专栏正文 作者 正文段落 编辑于 2022-12-29 22:54",
        {},
        terminalImmediatelyFollowsBody
          ? [published, header, outerBody, terminal, topics]
          : [published, header, outerBody, topics, terminal],
      );
      const reader = new FixturePageReader("https://zhuanlan.zhihu.com/p/595291507", "专栏正文")
        .add(".Post-RichTextContainer .RichText.ztext.Post-RichText", [richText])
        .add("article.Post-Main.Post-NormalMain", [article])
        .add(".Post-Title", [title])
        .add("[itemprop='author'] .AuthorInfo-name", [author], article)
        .add("[itemprop='datePublished']", [published], article)
        .add(".Post-RichTextContainer img", [image], richText)
        .add(".Post-RichTextContainer", [outerBody], article)
        .add(".ContentItem-time[role='button']", [terminal], article);
      return reader;
    };

    const snapshot = zhihu.extract(makeReader("adjacent", true));

    expect(snapshot.completeness).toBe("unknown");
    expect(snapshot.completeness_proof).toBeUndefined();
    expect(finalizeStableCompletion(snapshot, zhihu, {
      sample_count: 2,
      window_ms: 699,
      fingerprint: "a".repeat(64),
    }).completeness).toBe("unknown");
    const complete = finalizeStableCompletion(snapshot, zhihu, {
      sample_count: 2,
      window_ms: 700,
      fingerprint: "a".repeat(64),
    });
    expect(complete).toMatchObject({
      completeness: "complete",
      completeness_proof: {
        rule_id: "zhihu.column.richtext.time-terminal.v1",
        boundary: "terminal_observed",
        stability: { sample_count: 2, window_ms: 700, fingerprint: "a".repeat(64) },
      },
    });
    expect(contentSnapshotSchema.safeParse(complete).success).toBe(true);
    expect(evaluateContentCompleteness(complete, {
      adapter: zhihu,
      urls: [new URL("https://zhuanlan.zhihu.com/p/595291507")],
    })).toEqual({ valid: true, complete: true });
    expect(zhihu.completion_rules).toContainEqual(expect.objectContaining({
      id: "zhihu.column.richtext.time-terminal.v1",
      boundary: "terminal_observed",
      stability: { sample_count: 2, minimum_window_ms: 700 },
    }));
    expect(zhihu.coverage.verification).toBe("unverified");

    const nonAdjacent = zhihu.extract(makeReader("non-adjacent", false));
    expect(finalizeStableCompletion(nonAdjacent, zhihu, {
      sample_count: 2,
      window_ms: 700,
      fingerprint: "b".repeat(64),
    }).completeness).toBe("unknown");
  });

  it("uses the observed Substack body root so article-level subscription and reaction UI cannot enter prose", () => {
    const substack = adapter("substack");
    const title = node("substack-title", "h1", "有界图片正文");
    const subtitle = node("substack-subtitle", "h3", "真实文章副标题");
    const author = node("substack-author", "a", "发布者", { href: "https://substack.com/@publisher" });
    const published = node("substack-published", "time", "2026-09-19", { datetime: "2026-09-19T10:00:00Z" });
    const first = node("substack-first", "img", "", {
      src: "https://images.unsplash.com/photo-article?w=424",
      srcset: "https://images.unsplash.com/photo-article?w=424 424w, https://images.unsplash.com/photo-article?w=1456 1456w",
    });
    const proxy424 = "https://substackcdn.com/image/fetch/w_424,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fimages.example.test%2Farticle.jpg";
    const proxy1456 = "https://substackcdn.com/image/fetch/w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fimages.example.test%2Farticle.jpg";
    const second = node("substack-second", "img", "", {
      src: proxy424,
      srcset: `${proxy424} 424w, ${proxy424.replace("w_424", "w_848")} 848w, ${proxy424.replace("w_424", "w_1272")} 1272w, ${proxy1456} 1456w`,
    });
    const firstFigure = node("substack-first-figure", "figure", "", {}, [node("substack-first-link", "a", "", {}, [node("substack-first-inset", "div", "", {}, [first])])]);
    const secondFigure = node("substack-second-figure", "figure", "", {}, [node("substack-second-link", "a", "", {}, [node("substack-second-inset", "div", "", {}, [second])])]);
    const repeatedSubtitle = node("substack-repeated-subtitle", "p", "", {}, [node("substack-repeated-subtitle-text", "#text", "真实文章副标题")]);
    const body = node("substack-body", "div", "正文图一 正文图二 真实文章副标题", {}, [
      node("substack-before", "p", "", {}, [node("substack-before-text", "#text", "正文图一")]),
      firstFigure,
      secondFigure,
      repeatedSubtitle,
    ]);
    const availableContent = node("substack-available-content", "div", "正文图一 正文图二", {}, [body]);
    const postBody = node("substack-post-body", "div", "正文图一 正文图二", {}, [availableContent]);
    const avatar = node("substack-avatar", "img", "", { src: "https://substackcdn.com/image/fetch/w_64,c_limit/avatar.png" });
    const modalAvatar = node("substack-modal-avatar", "img", "", { src: "https://substackcdn.com/image/fetch/w_64,c_limit/modal-avatar.png" });
    const header = node("substack-header", "header", "", {}, [title, subtitle, author, published, avatar]);
    const subscribeModal = node("substack-modal", "aside", "", {}, [modalAvatar]);
    const subscription = node("substack-subscription", "div", "非正文订阅引导", {}, [node("substack-subscription-text", "#text", "非正文订阅引导")]);
    const reactions = node("substack-reactions", "div", "非正文互动计数", {}, [node("substack-reactions-text", "#text", "非正文互动计数")]);
    const article = node("substack-article", "article", "有界图片正文 发布者 2026-09-19 正文图一 正文图二 非正文订阅引导 非正文互动计数", {}, [
      header,
      subscription,
      postBody,
      reactions,
      subscribeModal,
    ]);
    const reader = new FixturePageReader("https://example.substack.com/p/bounded-images", "有界图片正文")
      .add("article.typography.newsletter-post.post", [article])
      .add("article.typography.newsletter-post.post .dt-post-body .available-content > .body.markup", [body])
      .add("article.typography.newsletter-post.post .post-header h1.post-title", [title], article)
      .add("article.typography.newsletter-post.post .post-header h3.subtitle", [subtitle], article)
      .add("article.typography.newsletter-post.post .post-header a[href*='substack.com/@']", [author], article)
      .add("article.typography.newsletter-post.post .post-header time", [published], article)
      .add("article h1", [title], article)
      .add(".byline a", [author], article)
      .add("article time", [published], article)
      .add("article.typography.newsletter-post.post .body.markup figure img", [first, second], body);

    const snapshot = substack.extract(reader);

    expect(snapshot.authors).toEqual(["发布者"]);
    expect(snapshot.published_at).toBe("2026-09-19T10:00:00Z");
    expect(snapshot.blocks.slice(0, 2)).toEqual([
      { type: "heading", level: 1, text: "有界图片正文" },
      { type: "heading", level: 3, text: "真实文章副标题" },
    ]);
    expect(snapshot.blocks.filter(block => "text" in block && block.text === "真实文章副标题")).toEqual([
      { type: "heading", level: 3, text: "真实文章副标题" },
      { type: "paragraph", text: "真实文章副标题" },
    ]);
    expect(snapshot.assets.filter(asset => asset.role === "image").map(asset => asset.url)).toEqual([
      "https://images.unsplash.com/photo-article?w=1456",
      proxy1456,
    ]);
    expect(snapshot.assets.some(asset => asset.url.includes("avatar"))).toBe(false);
    expect(snapshot.blocks.flatMap(block => block.type === "image" ? [block.asset_id] : [])).toEqual([
      "substack:image:001",
      "substack:image:002",
    ]);
    expect(snapshot.blocks.some(block => "text" in block && /非正文订阅引导|非正文互动计数/.test(block.text))).toBe(false);
    expect(snapshot.completeness).toBe("unknown");
    const complete = finalizeStableCompletion(snapshot, substack, {
      sample_count: 2,
      window_ms: 700,
      fingerprint: "c".repeat(64),
    });
    expect(complete).toMatchObject({
      completeness: "complete",
      completeness_proof: {
        rule_id: "substack.public-post.body-root.v1",
        boundary: "root_exhausted",
        stability: { sample_count: 2, window_ms: 700, fingerprint: "c".repeat(64) },
      },
    });
    expect(evaluateContentCompleteness(complete, {
      adapter: substack,
      urls: [new URL("https://example.substack.com/p/bounded-images")],
    })).toEqual({ valid: true, complete: true });
    expect(substack.completion_rules).toContainEqual(expect.objectContaining({
      id: "substack.public-post.body-root.v1",
      boundary: "root_exhausted",
      stability: { sample_count: 2, minimum_window_ms: 700 },
    }));

    const exactBodyPlan = {
      id: "substack.fixture.exact-body.v1",
      content_types: ["article"] as const,
      applies: (url: URL) => url.hostname === "example.substack.com" && /^\/p\//.test(url.pathname),
      content_root: "article.typography.newsletter-post.post .dt-post-body .available-content > .body.markup",
      boundary: { type: "root_exhausted" as const },
      pending_or_truncation: [],
    };
    const broadFallback: PlatformAdapter = {
      ...substack,
      rule: {
        ...substack.rule,
        completion: [exactBodyPlan],
        selectors: { ...substack.rule.selectors, roots: ["article.typography.newsletter-post.post"] },
      },
    };
    const fallbackSnapshot = extract(reader, broadFallback);
    expect(fallbackSnapshot.completeness).toBe("unknown");
    expect(fallbackSnapshot.completeness_proof).toBeUndefined();
  });

  it("keeps a Substack leading text only once and never borrows it through an ambiguous metadata shell", () => {
    const substack = adapter("substack");
    const title = node("leading-title", "h1", "文章标题");
    const bodySubtitle = node("leading-in-body", "h3", "正文中的副标题");
    const prose = node("leading-prose", "p", "", {}, [node("leading-text", "#text", "正文内容")]);
    const body = node("leading-body", "div", "正文中的副标题 正文内容", {}, [bodySubtitle, prose]);
    const available = node("leading-available", "div", "", {}, [body]);
    const postBody = node("leading-post-body", "div", "", {}, [available]);
    const header = node("leading-header", "header", "", {}, [title]);
    const article = node("leading-article", "article", "", {}, [header, postBody]);
    const duplicateReader = new FixturePageReader("https://example.substack.com/p/leading-text", "文章标题")
      .add("article.typography.newsletter-post.post", [article])
      .add("article.typography.newsletter-post.post .dt-post-body .available-content > .body.markup", [body])
      .add("article.typography.newsletter-post.post .post-header h1.post-title", [title], article)
      .add("article.typography.newsletter-post.post .post-header h3.subtitle", [bodySubtitle], article);

    const duplicateSnapshot = substack.extract(duplicateReader);
    expect(duplicateSnapshot.blocks.filter(block => "text" in block && block.text === "正文中的副标题")).toEqual([
      { type: "heading", level: 3, text: "正文中的副标题" },
    ]);

    const outsideSubtitle = node("ambiguous-subtitle", "h3", "不应从模糊壳读取");
    const outsideHeader = node("ambiguous-header", "header", "", {}, [title, outsideSubtitle]);
    const ambiguousBody = node("ambiguous-body", "div", "正文内容", {}, [prose]);
    const ambiguousAvailable = node("ambiguous-available", "div", "", {}, [ambiguousBody]);
    const ambiguousPostBody = node("ambiguous-post-body", "div", "", {}, [ambiguousAvailable]);
    const ambiguousArticle = node("ambiguous-article", "article", "", {}, [outsideHeader, ambiguousPostBody]);
    const outerShell = node("ambiguous-shell", "main", "", {}, [ambiguousArticle]);
    const ambiguousReader = new FixturePageReader("https://example.substack.com/p/ambiguous-shell", "页面标题")
      .add("article.typography.newsletter-post.post .dt-post-body .available-content > .body.markup", [ambiguousBody])
      .add("article.typography.newsletter-post.post", [ambiguousArticle])
      .add("main.article-shell", [outerShell])
      .add("article.typography.newsletter-post.post .post-header h1.post-title", [title], ambiguousArticle)
      .add("article.typography.newsletter-post.post .post-header h3.subtitle", [outsideSubtitle], ambiguousArticle)
      .add("article h1", [title]);
    const ambiguousAdapter: PlatformAdapter = {
      ...substack,
      rule: {
        ...substack.rule,
        selectors: {
          ...substack.rule.selectors,
          metadata_roots: ["article.typography.newsletter-post.post", "main.article-shell"],
        },
      },
    };

    const ambiguousSnapshot = extract(ambiguousReader, ambiguousAdapter);
    expect(ambiguousSnapshot.title).toBeUndefined();
    expect(ambiguousSnapshot.blocks.some(block => "text" in block && /不应从模糊壳读取|文章标题/.test(block.text))).toBe(false);
    expect(finalizeStableCompletion(ambiguousSnapshot, ambiguousAdapter, {
      sample_count: 2,
      window_ms: 700,
      fingerprint: "f".repeat(64),
    }).completeness).toBe("unknown");
  });

  it("keeps a legitimate document-wide og:title fallback for platforms without a metadata root", () => {
    const medium = adapter("medium");
    const prose = node("fallback-prose", "p", "", {}, [node("fallback-prose-text", "#text", "正文内容")]);
    const root = node("fallback-root", "div", "正文内容", {}, [prose]);
    const ogTitle = node("fallback-og-title", "meta", "", { content: "仅有 OG 标题的文章" });
    const reader = new FixturePageReader("https://medium.com/@example/only-og-title-abcdef12", "浏览器标题")
      .add("article", [root])
      .add("meta[property='og:title']", [ogTitle]);

    const snapshot = medium.extract(reader);

    expect(snapshot.title).toBe("仅有 OG 标题的文章");
    expect(snapshot.blocks[0]).toEqual({ type: "heading", level: 1, text: "仅有 OG 标题的文章" });
  });

  it("does not flatten a nested excluded X quote into target text or media", () => {
    const targetTitle = node("x-target-title", "div", "目标帖子标题");
    const targetHeading = node("x-target-heading", "h2", "目标正文");
    const targetText = node("x-target-text", "p", "", {}, [node("x-target-text-node", "#text", "仅保留这段正文")]);
    const targetImage = node("x-target-image", "img", "", { src: "https://pbs.twimg.com/media/target.jpg" });
    const targetLink = node("x-target-link", "a", "", { href: "/alice/status/123456789" });
    const quoteText = node("x-quote-text", "p", "", {}, [node("x-quote-text-node", "#text", "引用回复不得泄入")]);
    const quoteImage = node("x-quote-image", "img", "", { src: "https://pbs.twimg.com/media/quote.jpg" });
    const quoteLink = node("x-quote-link", "a", "", { href: "/bob/status/987654321" });
    const quoteRoot = node("x-quote-root", "div", "引用回复不得泄入", {}, [quoteText, quoteImage, quoteLink]);
    const wrapper = node("x-inline-wrapper", "span", "仅保留这段正文 引用回复不得泄入", {}, [targetText, targetImage, quoteRoot]);
    const targetRoot = node("x-target-root", "article", "目标帖子标题 目标正文 仅保留这段正文 引用回复不得泄入", {}, [
      targetTitle,
      targetHeading,
      targetLink,
      wrapper,
    ]);
    const reader = new FixturePageReader("https://x.com/alice/status/123456789", "目标帖子标题")
      .add("article[data-testid='tweet']", [targetRoot])
      .add("a[href*='/status/']", [targetLink, quoteLink], targetRoot)
      .add("[data-testid='quoted-tweet']", [quoteRoot], targetRoot)
      .add("article[data-testid='tweet'] [data-testid='tweetText']", [targetTitle], targetRoot)
      .add("article[data-testid='tweet'] [data-testid='tweetPhoto'] img", [targetImage, quoteImage], targetRoot);

    const snapshot = adapter("x").extract(reader);

    expect(snapshot.blocks).toEqual([
      { type: "paragraph", text: "目标帖子标题" },
      { type: "heading", level: 2, text: "目标正文" },
      { type: "paragraph", text: "仅保留这段正文" },
      { type: "image", asset_id: "x:image:001" },
    ]);
    expect(snapshot.assets.map(asset => asset.url)).toEqual(["https://pbs.twimg.com/media/target.jpg"]);
    expect(snapshot.blocks.some(block => "text" in block && block.text.includes("引用回复"))).toBe(false);
  });

  it("uses the Bilibili target root and does not absorb a recommended video", () => {
    const body = node("body", "p", "原视频简介");
    const root = node("root", "div", "", {}, [body]);
    const title = node("title", "h1", "目标视频");
    const author = node("author", "a", "目标 UP");
    const time = node("time", "time", "2026-09-18", { datetime: "2026-09-18T08:00:00Z" });
    const targetVideo = node("target-video", "video", "", { src: "https://upos-sz-mirrorcos.bilivideo.com/target.mp4" });
    const recommendedVideo = node("recommended-video", "video", "", { src: "https://upos-sz-mirrorcos.bilivideo.com/recommended.mp4" });
    const reader = new FixturePageReader("https://www.bilibili.com/video/BV1Ab411c7de?p=2", "目标视频")
      .add("#mirror-vdcon", [root])
      .add("h1.video-title", [title], root)
      .add(".up-name", [author], root)
      .add("time", [time], root)
      .add(".bpx-player-video-wrap video", [targetVideo])
      .add("video", [targetVideo, recommendedVideo]);

    const snapshot = adapter("bilibili").extract(reader);
    expect(snapshot.canonical_url).toContain("p=2");
    expect(snapshot.blocks.some(block => "text" in block && block.text.includes("推荐"))).toBe(false);
    expect(snapshot.assets.filter(asset => asset.role === "video").map(asset => asset.url)).toEqual(["https://upos-sz-mirrorcos.bilivideo.com/target.mp4"]);
    expect(adapter("bilibili").asset_hosts).toEqual(expect.arrayContaining([
      "*.mcdn.bilivideo.cn",
      "*.edge.mountaintoys.cn",
    ]));
    expect(adapter("bilibili").asset_https_ports).toEqual([
      { host: "*.mcdn.bilivideo.cn", ports: [8082] },
      { host: "*.edge.mountaintoys.cn", ports: [4483] },
    ]);
  });

  it("keeps WeChat article identity while redacting its signed navigation parameter", () => {
    const body = node("wechat-body", "p", "文章正文");
    const root = node("wechat-root", "div", "文章正文", {}, [body]);
    const reader = new FixturePageReader("https://mp.weixin.qq.com/s?__biz=MzAxMDAwMDAwMA%3D%3D&mid=123456&idx=1&sn=signed-share-proof", "文章")
      .add("#js_content", [root]);

    const snapshot = adapter("weixin_article").extract(reader);

    expect(snapshot.platform_content_id).toBe("MzAxMDAwMDAwMA==:123456:1");
    expect(snapshot.source_url).toContain("__biz=");
    expect(snapshot.source_url).toContain("mid=123456");
    expect(snapshot.source_url).not.toContain("sn=");
  });

  it("uses YouTube metadata rather than the broad primary column", () => {
    const description = node("description", "div", "", {}, [node("description-text", "#text", "目标视频说明")]);
    const metadata = node("metadata", "div", "", {}, [description]);
    const title = node("title", "h1", "目标 YouTube 视频");
    const author = node("author", "a", "目标频道");
    const player = node("player", "video", "", { src: "https://rr1---sn.googlevideo.com/videoplayback?id=target" });
    const recommended = node("recommended", "p", "推荐视频标题");
    const reader = new FixturePageReader("https://www.youtube.com/watch?v=abcDEF12345&utm_source=share", "目标 YouTube 视频")
      .add("ytd-watch-metadata", [metadata])
      .add("h1.ytd-watch-metadata", [title], metadata)
      .add("#owner #channel-name a", [author], metadata)
      .add(".html5-video-player video", [player])
      .add("#primary-inner", [recommended]);

    const snapshot = adapter("youtube").extract(reader);
    expect(snapshot.platform_content_id).toBe("abcDEF12345");
    expect(snapshot.blocks.some(block => "text" in block && block.text.includes("推荐视频"))).toBe(false);
    expect(snapshot.assets.filter(asset => asset.role === "video").map(asset => asset.url)).toEqual(["https://rr1---sn.googlevideo.com/videoplayback?id=target"]);
  });

  it("selects the requested X status card and excludes a reply card", () => {
    const targetText = node("target-text", "div", "", {}, [node("target-text-node", "#text", "目标帖子正文")]);
    const targetImage = node("target-image", "img", "", { src: "https://pbs.twimg.com/media/target.jpg" });
    const targetLink = node("target-link", "a", "", { href: "/alice/status/123456789" });
    // Time and media links may both point at the same requested post. The
    // legacy card matcher accepts either exact parsed permalink; only narrow
    // Self-bound route plans require exactly one matching permalink.
    const targetMediaLink = node("target-media-link", "a", "", { href: "/alice/status/123456789" });
    const targetRoot = node("target-root", "article", "", {}, [targetText, targetImage, targetLink, targetMediaLink]);
    const replyText = node("reply-text", "div", "", {}, [node("reply-text-node", "#text", "其他人的回复")]);
    const replyLink = node("reply-link", "a", "", { href: "/bob/status/987654321" });
    const replyRoot = node("reply-root", "article", "", {}, [replyText, replyLink]);
    const author = node("author", "span", "Alice");
    const time = node("time", "time", "2026-09-18", { datetime: "2026-09-18T09:00:00Z" });
    const reader = new FixturePageReader("https://x.com/alice/status/123456789", "目标帖子")
      .add("article[data-testid='tweet']", [targetRoot, replyRoot])
      .add("a[href*='/status/']", [targetLink, targetMediaLink], targetRoot)
      .add("a[href*='/status/']", [replyLink], replyRoot)
      .add("article[data-testid='tweet'] [data-testid='tweetText']", [targetText], targetRoot)
      .add("article[data-testid='tweet'] [data-testid='User-Name']", [author], targetRoot)
      .add("article[data-testid='tweet'] time", [time], targetRoot)
      .add("article[data-testid='tweet'] [data-testid='tweetPhoto'] img", [targetImage], targetRoot);

    const snapshot = adapter("x").extract(reader);
    expect(snapshot.blocks.some(block => "text" in block && block.text.includes("其他人的回复"))).toBe(false);
    expect(snapshot.assets.filter(asset => asset.role === "image")).toHaveLength(1);
    expect(snapshot.authors).toEqual(["Alice"]);
  });

  it("requires the target card's exact permalink and never borrows a nested quote link", () => {
    const requestedId = "123456789";
    const prefixLink = node("x-prefix-link", "a", "", { href: "/alice/status/1234567890" });
    const prefixRoot = node("x-prefix-root", "article", "", {}, [node("x-prefix-body", "#text", "前缀碰撞卡"), prefixLink]);
    const prefixReader = new FixturePageReader(`https://x.com/alice/status/${requestedId}`, "prefix collision")
      .add("article[data-testid='tweet']", [prefixRoot])
      .add("a[href*='/status/']", [prefixLink], prefixRoot);
    expect(() => adapter("x").extract(prefixReader)).toThrowError(AdapterExtractionError);

    const outerLink = node("x-outer-link", "a", "", { href: "/alice/status/999999999" });
    const quotedTargetLink = node("x-quoted-target-link", "a", "", { href: `/quoted/status/${requestedId}` });
    const quoteRoot = node("x-target-only-in-quote", "div", "", {}, [node("x-quote-body", "#text", "引用目标"), quotedTargetLink]);
    const outerRoot = node("x-outer-root", "article", "", {}, [node("x-outer-body", "#text", "外层不是目标"), outerLink, quoteRoot]);
    const quoteReader = new FixturePageReader(`https://x.com/alice/status/${requestedId}`, "quoted target only")
      .add("article[data-testid='tweet']", [outerRoot])
      .add("a[href*='/status/']", [outerLink, quotedTargetLink], outerRoot)
      .add("a[href*='/status/']", [quotedTargetLink], quoteRoot)
      .add("[data-testid='quoted-tweet']", [quoteRoot], outerRoot);
    expect(() => adapter("x").extract(quoteReader)).toThrowError(AdapterExtractionError);
  });

  it("keeps bounded X relations separate and requires an explicit same-author parent chain", () => {
    const targetId = "100000001";
    const targetAuthor = node("x-target-author", "span", "Alice");
    const targetBody = node("x-target-body", "#text", "目标帖子正文");
    const targetImage = node("x-target-image", "img", "", { src: "https://pbs.twimg.com/media/target.jpg" });
    const targetLink = node("x-target-link", "a", "", { href: `/alice/status/${targetId}` });
    const quoteAuthor = node("x-quote-author", "span", "Quoted Bob");
    const quoteBody = node("x-quote-body", "#text", "引用帖正文不能混入目标");
    const quoteImage = node("x-quote-image", "img", "", { src: "https://pbs.twimg.com/media/quote.jpg" });
    const quoteLink = node("x-quote-link", "a", "", { href: "/quoted/status/400000001" });
    const quoteRoot = node("x-quote-root", "div", "", {}, [quoteAuthor, quoteBody, quoteImage, quoteLink]);
    const repostAuthor = node("x-repost-author", "span", "Repost Carol");
    const repostBody = node("x-repost-body", "#text", "转发来源正文不能混入目标");
    const repostImage = node("x-repost-image", "img", "", { src: "https://pbs.twimg.com/media/repost.jpg" });
    const repostLink = node("x-repost-link", "a", "", { href: "/repost/status/500000001" });
    const repostRoot = node("x-repost-root", "div", "", {}, [repostAuthor, repostBody, repostImage, repostLink]);
    const targetRoot = node("x-target-root", "article", "", {}, [targetAuthor, targetBody, targetImage, targetLink, quoteRoot, repostRoot]);

    const firstAuthor = node("x-first-author", "span", "Alice");
    const firstBody = node("x-first-body", "#text", "作者明确续帖一");
    const firstImage = node("x-first-image", "img", "", { src: "https://pbs.twimg.com/media/first.jpg" });
    const firstParent = node("x-first-parent", "a", "", { href: `/alice/status/${targetId}` });
    const firstLink = node("x-first-link", "a", "", { href: "/alice/status/100000002" });
    const hiddenControlAuthor = node("x-first-hidden-control-author", "span", "Control Mallory");
    const hiddenControlImage = node("x-first-hidden-control-image", "img", "", { src: "https://pbs.twimg.com/media/control.jpg" });
    const hiddenControlLink = node("x-first-hidden-control-link", "a", "", { href: "/mallory/status/999999999" });
    const hiddenControl = new FixtureNode("x-first-hidden-control", "div", "hidden control", { "data-testid": "reply" }, [
      hiddenControlAuthor,
      hiddenControlImage,
      hiddenControlLink,
    ], false);
    const firstRoot = node("x-first-root", "article", "", {}, [firstAuthor, firstBody, firstImage, firstParent, firstLink, hiddenControl]);

    const secondAuthor = node("x-second-author", "span", "Alice");
    const secondBody = node("x-second-body", "#text", "作者明确续帖二");
    const secondParent = node("x-second-parent", "a", "", { href: "/alice/status/100000002" });
    const secondLink = node("x-second-link", "a", "", { href: "/alice/status/100000003" });
    const secondRoot = node("x-second-root", "article", "", {}, [secondAuthor, secondBody, secondParent, secondLink]);

    const thirdAuthor = node("x-third-author", "span", "Alice");
    const thirdBody = node("x-third-body", "#text", "作者明确续帖三");
    const thirdParent = node("x-third-parent", "a", "", { href: "/alice/status/100000003" });
    const thirdLink = node("x-third-link", "a", "", { href: "/alice/status/100000004" });
    const thirdRoot = node("x-third-root", "article", "", {}, [thirdAuthor, thirdBody, thirdParent, thirdLink]);

    const otherAuthor = node("x-other-author", "span", "Mallory");
    const otherBody = node("x-other-body", "#text", "他人回复不能被收进作者串");
    const otherParent = node("x-other-parent", "a", "", { href: `/alice/status/${targetId}` });
    const otherLink = node("x-other-link", "a", "", { href: "/mallory/status/200000001" });
    const otherRoot = node("x-other-root", "article", "", {}, [otherAuthor, otherBody, otherParent, otherLink]);

    const nearbyAuthor = node("x-nearby-author", "span", "Alice");
    const nearbyBody = node("x-nearby-body", "#text", "同作者但未证明父链接的邻帖");
    const nearbyLink = node("x-nearby-link", "a", "", { href: "/alice/status/300000001" });
    const nearbyRoot = node("x-nearby-root", "article", "", {}, [nearbyAuthor, nearbyBody, nearbyLink]);

    const reader = new FixturePageReader(`https://x.com/alice/status/${targetId}`, "X bounded relation fixture")
      .add("article[data-testid='tweet']", [targetRoot, firstRoot, otherRoot, nearbyRoot, secondRoot, thirdRoot])
      .add("a[href*='/status/']", [targetLink], targetRoot)
      .add("a[href*='/status/']", [quoteLink], quoteRoot)
      .add("a[href*='/status/']", [repostLink], repostRoot)
      .add("a[href*='/status/']", [firstParent, firstLink, hiddenControlLink], firstRoot)
      .add("a[href*='/status/']", [secondParent, secondLink], secondRoot)
      .add("a[href*='/status/']", [thirdParent, thirdLink], thirdRoot)
      .add("a[href*='/status/']", [otherParent, otherLink], otherRoot)
      .add("a[href*='/status/']", [nearbyLink], nearbyRoot)
      .add("a[data-testid='reply-parent-link'][href*='/status/']", [firstParent], firstRoot)
      .add("a[data-testid='reply-parent-link'][href*='/status/']", [secondParent], secondRoot)
      .add("a[data-testid='reply-parent-link'][href*='/status/']", [thirdParent], thirdRoot)
      .add("a[data-testid='reply-parent-link'][href*='/status/']", [otherParent], otherRoot)
      .add("[data-testid='quoted-tweet']", [quoteRoot], targetRoot)
      .add("[data-testid='repost-tweet']", [repostRoot], targetRoot)
      .add("article[data-testid='tweet'] [data-testid='User-Name']", [targetAuthor], targetRoot)
      .add("article[data-testid='tweet'] [data-testid='User-Name']", [quoteAuthor], quoteRoot)
      .add("article[data-testid='tweet'] [data-testid='User-Name']", [repostAuthor], repostRoot)
      .add("article[data-testid='tweet'] [data-testid='User-Name']", [firstAuthor, hiddenControlAuthor], firstRoot)
      .add("article[data-testid='tweet'] [data-testid='User-Name']", [secondAuthor], secondRoot)
      .add("article[data-testid='tweet'] [data-testid='User-Name']", [thirdAuthor], thirdRoot)
      .add("article[data-testid='tweet'] [data-testid='User-Name']", [otherAuthor], otherRoot)
      .add("article[data-testid='tweet'] [data-testid='User-Name']", [nearbyAuthor], nearbyRoot)
      .add("article[data-testid='tweet'] [data-testid='tweetText']", [targetBody], targetRoot)
      .add("article[data-testid='tweet'] [data-testid='tweetPhoto'] img", [targetImage, quoteImage, repostImage], targetRoot)
      .add("article[data-testid='tweet'] [data-testid='tweetPhoto'] img", [quoteImage], quoteRoot)
      .add("article[data-testid='tweet'] [data-testid='tweetPhoto'] img", [repostImage], repostRoot)
      .add("article[data-testid='tweet'] [data-testid='tweetPhoto'] img", [firstImage, hiddenControlImage], firstRoot)
      .add("article[data-testid='tweet'] [data-testid='reply']", [hiddenControl], firstRoot);

    const defaultSnapshot = adapter("x").extract(reader);
    expect(defaultSnapshot.relations).toBeUndefined();
    expect(defaultSnapshot.authors).toEqual(["Alice"]);
    expect(defaultSnapshot.assets.map(asset => asset.url)).toEqual(["https://pbs.twimg.com/media/target.jpg"]);
    expect(defaultSnapshot.blocks.some(block => "text" in block && block.text.includes("引用帖正文"))).toBe(false);
    expect(defaultSnapshot.blocks.some(block => "text" in block && block.text.includes("转发来源正文"))).toBe(false);

    const capped = adapter("x").extract(reader, { max_related_items: 2 });
    expect(capped.relations?.map(relation => relation.to_content_id)).toEqual(["100000002", "100000003"]);
    expect(capped.relations?.every(relation => relation.type === "author_continuation")).toBe(true);
    expect(capped.warnings).toEqual(expect.arrayContaining([
      "RELATED_REPLY_AUTHOR_MISMATCH_EXCLUDED",
      "RELATED_SAME_AUTHOR_WITHOUT_PARENT_EXCLUDED",
      "RELATED_ITEM_LIMIT_REACHED",
    ]));
    expect(capped.completeness).toBe("unknown");

    const related = adapter("x").extract(reader, { max_related_items: 5 });
    expect(related.relations?.map(relation => relation.type)).toEqual([
      "author_continuation",
      "author_continuation",
      "author_continuation",
      "quote",
      "repost",
    ]);
    expect(related.relations?.find(relation => relation.type === "quote")).toMatchObject({
      from_content_id: targetId,
      to_content_id: "400000001",
      authors: ["Quoted Bob"],
    });
    expect(related.relations?.find(relation => relation.type === "repost")).toMatchObject({
      from_content_id: targetId,
      to_content_id: "500000001",
      authors: ["Repost Carol"],
    });
    expect(related.relations?.find(relation => relation.to_content_id === "100000002")).toMatchObject({
      authors: ["Alice"],
      assets: [expect.objectContaining({ url: "https://pbs.twimg.com/media/first.jpg" })],
    });
    expect(related.relations?.some(relation => relation.assets.some(asset => asset.url.includes("control.jpg")))).toBe(false);
    expect(related.warnings).toContain("RELATED_CONTINUATION_NOT_PROVEN_IN_MOUNTED_DOM");
    const allAssetIds = [...related.assets, ...(related.relations ?? []).flatMap(relation => relation.assets)].map(asset => asset.id);
    expect(new Set(allAssetIds).size).toBe(allAssetIds.length);
    expect(related.relations?.flatMap(relation => relation.assets).every(asset => asset.id.startsWith("x:relation:"))).toBe(true);
  });

  it("keeps automatic and requested text expansion inside the requested X post root", () => {
    const targetLink = node("x-target-link", "a", "", { href: "/alice/status/123456789" });
    const replyLink = node("x-reply-link", "a", "", { href: "/bob/status/987654321" });
    const targetExpand = node("x-target-expand", "button", "Show more");
    const replyExpand = node("x-reply-expand", "button", "Show more");
    const targetRoot = node("x-target-root", "article", "目标截断正文", {}, [targetLink, targetExpand]);
    const replyRoot = node("x-reply-root", "article", "回复截断正文", {}, [replyLink, replyExpand]);
    const xReader = new FixturePageReader("https://x.com/alice/status/123456789", "目标 X 帖子")
      .add("article[data-testid='tweet']", [targetRoot, replyRoot])
      .add("a[href*='/status/']", [targetLink], targetRoot)
      .add("a[href*='/status/']", [replyLink], replyRoot)
      .add("[data-testid='tweet-text-show-more-link']", [targetExpand], targetRoot)
      .add("[data-testid='tweet-text-show-more-link']", [replyExpand], replyRoot);

    expect(actionTargets(xReader, adapter("x"))).toEqual([{ id: "x:expand:0", type: "expand", label: "Expand approved content" }]);
    expect(automaticExpandTarget(xReader, adapter("x"))).toBe(targetExpand);
    expect(nodeForAdapterAction(xReader, adapter("x"), { type: "expand", target_id: "x:expand:0" })).toBe(targetExpand);

    const noTargetExpandReader = new FixturePageReader("https://x.com/alice/status/123456789", "目标 X 帖子")
      .add("article[data-testid='tweet']", [targetRoot, replyRoot])
      .add("a[href*='/status/']", [targetLink], targetRoot)
      .add("a[href*='/status/']", [replyLink], replyRoot)
      .add("[data-testid='tweet-text-show-more-link']", [replyExpand], replyRoot);
    expect(automaticExpandTarget(noTargetExpandReader, adapter("x"))).toBeUndefined();
    expect(nodeForAdapterAction(noTargetExpandReader, adapter("x"), { type: "expand", target_id: "x:expand:0" })).toBeUndefined();

    const paywall = node("x-paywall", "div", "Subscribe to continue");
    const gatedReader = new FixturePageReader("https://x.com/alice/status/123456789", "目标 X 帖子")
      .add("article[data-testid='tweet']", [targetRoot])
      .add("a[href*='/status/']", [targetLink], targetRoot)
      .add("[data-testid='tweet-text-show-more-link']", [targetExpand], targetRoot)
      .add("[data-testid='paywall']", [paywall]);
    expect(automaticExpandTarget(gatedReader, adapter("x"))).toBeUndefined();

  });

  it("keeps social div/span prose and rejects a title-only shell or paywall", () => {
    const prose = node("prose", "span", "正文保留", {}, [node("prose-text", "#text", "正文保留")]);
    const root = node("root", "div", "", {}, [prose]);
    const title = node("title", "h1", "标题");
    const reader = new FixturePageReader("https://www.xiaohongshu.com/explore/divbody1", "标题")
      .add("#noteContainer", [root])
      .add("#detail-title", [title], root);
    expect(adapter("xiaohongshu").extract(reader).blocks.some(block => block.type === "paragraph" && block.text === "正文保留")).toBe(true);

    const titleOnlyRoot = node("title-only-root", "div", "", {}, [title]);
    const titleOnly = new FixturePageReader("https://www.xiaohongshu.com/explore/titleonly", "标题")
      .add("#noteContainer", [titleOnlyRoot])
      .add("#detail-title", [title], titleOnlyRoot);
    expect(() => adapter("xiaohongshu").extract(titleOnly)).toThrowError(AdapterExtractionError);

    const paywall = node("paywall", "div", "订阅后查看");
    const gated = new FixturePageReader("https://www.xiaohongshu.com/explore/paidbody1", "标题")
      .add("#noteContainer", [root])
      .add("#detail-title", [title], root)
      .add("[data-testid='paywall']", [paywall]);
    try {
      adapter("xiaohongshu").extract(gated);
      throw new Error("expected paid-content error");
    } catch (error) {
      expect(error).toMatchObject({ code: "PAID_CONTENT_EXCLUDED" });
    }
  });
});
