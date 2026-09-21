import { describe, expect, it } from "vitest";
import { createAdapterRegistry, DEVELOPMENT_FIXTURE_ORIGIN } from "../adapters/registry.js";
import { extract, finalizeStableCompletion } from "../adapters/shared-extractors/extractor.js";
import type { PlatformAdapter, RelationPlan } from "../adapters/types.js";
import { FixtureNode, FixturePageReader, node } from "./platforms/fixture-reader.js";

const ROOT_SELECTOR = "[data-babel-fixture='content']";
const EXCLUDED_SELECTOR = "[data-proof-excluded]";
const RELATION_SELECTOR = "[data-proof-relation]";
const MEDIA_TAGS = ["img", "video", "audio", "iframe"] as const;
type MediaTag = typeof MEDIA_TAGS[number];

const selectedSelector: Record<MediaTag, string> = {
  img: "img[data-proof-selected='image']",
  video: "video[data-proof-selected='video']",
  audio: "audio[data-proof-selected='audio']",
  iframe: "iframe[data-proof-selected='video']",
};

function controlledAdapter(relations?: RelationPlan): PlatformAdapter {
  const fixture = createAdapterRegistry({ fixture_origins: [DEVELOPMENT_FIXTURE_ORIGIN] }).get("development_fixture");
  if (!fixture) throw new Error("Expected the controlled development fixture adapter.");
  const originalPlan = fixture.rule.completion?.[0];
  if (!originalPlan) throw new Error("Expected the controlled completion plan.");
  const completion = { ...originalPlan, stability: { sample_count: 2, minimum_window_ms: 700 } };
  let adapter: PlatformAdapter;
  adapter = {
    ...fixture,
    rule: {
      ...fixture.rule,
      selectors: {
        ...fixture.rule.selectors,
        images: [selectedSelector.img],
        videos: [selectedSelector.video, selectedSelector.iframe],
        audio: [selectedSelector.audio],
        subtitles: [],
        files: [],
        cover: [],
        excluded: [EXCLUDED_SELECTOR],
      },
      completion: [completion],
      ...(relations ? { relations } : {}),
    },
    extract: (reader, options) => extract(reader, adapter, options),
  };
  return adapter;
}

function mediaNode(tag: MediaTag, id: string, selected = false, visible = true): FixtureNode {
  const extension = tag === "img" ? "png" : tag === "iframe" ? "html" : tag === "audio" ? "m4a" : "mp4";
  return new FixtureNode(id, tag, "", {
    src: `/fixture/assets/${id}.${extension}`,
    ...(selected ? { "data-proof-selected": tag === "img" ? "image" : tag === "audio" ? "audio" : "video" } : {}),
  }, [], visible);
}

function contentRoot(id: string, extras: FixtureNode[]): FixtureNode {
  const paragraph = node(`${id}-paragraph`, "p", "正文", {}, [node(`${id}-text`, "#text", "正文")]);
  return node(`${id}-root`, "article", "正文", {}, [paragraph, ...extras]);
}

function readerFor(root: FixtureNode, options: {
  media?: Partial<Record<MediaTag, FixtureNode[]>>;
  selected?: Partial<Record<MediaTag, FixtureNode[]>>;
  excluded?: FixtureNode[];
  skipped?: Partial<Record<"aside" | "script", FixtureNode[]>>;
  relations?: FixtureNode[];
} = {}): FixturePageReader {
  const reader = new FixturePageReader(`${DEVELOPMENT_FIXTURE_ORIGIN}/fixture/content/unmapped-media`, "受控正文媒体完整性")
    .add(ROOT_SELECTOR, [root]);
  for (const tag of MEDIA_TAGS) {
    if (options.media?.[tag]?.length) reader.add(tag, options.media[tag]!, root);
    if (options.selected?.[tag]?.length) reader.add(selectedSelector[tag], options.selected[tag]!, root);
  }
  if (options.excluded?.length) reader.add(EXCLUDED_SELECTOR, options.excluded, root);
  if (options.skipped?.aside?.length) reader.add("aside", options.skipped.aside, root);
  if (options.skipped?.script?.length) reader.add("script", options.skipped.script, root);
  if (options.relations?.length) reader.add(RELATION_SELECTOR, options.relations, root);
  return reader;
}

function finalize(snapshot: ReturnType<PlatformAdapter["extract"]>, adapter: PlatformAdapter) {
  return finalizeStableCompletion(snapshot, adapter, {
    sample_count: 2,
    window_ms: 700,
    fingerprint: "d".repeat(64),
  });
}

describe("bounded completion rejects unmapped standard body media", () => {
  it.each(MEDIA_TAGS)("keeps completion unknown for an unselected visible %s in the chosen body root", tag => {
    const adapter = controlledAdapter();
    const media = mediaNode(tag, `unmapped-${tag}`);
    const root = contentRoot(`unmapped-${tag}`, [media]);
    const snapshot = adapter.extract(readerFor(root, { media: { [tag]: [media] } }));

    expect(snapshot.assets).toEqual([]);
    expect(finalize(snapshot, adapter).completeness).toBe("unknown");
  });

  it.each(MEDIA_TAGS)("allows proof when the visible %s is mapped by an adapter-owned selector", tag => {
    const adapter = controlledAdapter();
    const media = mediaNode(tag, `selected-${tag}`, true);
    const root = contentRoot(`selected-${tag}`, [media]);
    const snapshot = adapter.extract(readerFor(root, {
      media: { [tag]: [media] },
      selected: { [tag]: [media] },
    }));

    expect(snapshot.assets).toHaveLength(1);
    expect(finalize(snapshot, adapter).completeness).toBe("complete");
  });

  it("treats a selected video with an internal source as one covered media occurrence", () => {
    const adapter = controlledAdapter();
    const source = node("video-source", "source", "", { src: "/fixture/assets/source-video.mp4" });
    const video = new FixtureNode("selected-video-source", "video", "", { "data-proof-selected": "video" }, [source]);
    const root = contentRoot("video-source", [video]);
    const reader = readerFor(root, {
      media: { video: [video] },
      selected: { video: [video] },
    }).add("source", [source], video);
    const snapshot = adapter.extract(reader);

    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.blocks.filter(block => block.type === "video")).toHaveLength(1);
    expect(finalize(snapshot, adapter).completeness).toBe("complete");
  });

  it("uses the selected img as the media occurrence inside a picture/source wrapper", () => {
    const adapter = controlledAdapter();
    const source = node("picture-source", "source", "", { srcset: "/fixture/assets/picture-large.png 2x" });
    const image = mediaNode("img", "picture-image", true);
    const picture = node("picture", "picture", "", {}, [source, image]);
    const root = contentRoot("picture-image", [picture]);
    const snapshot = adapter.extract(readerFor(root, {
      media: { img: [image] },
      selected: { img: [image] },
    }));

    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.blocks.filter(block => block.type === "image")).toHaveLength(1);
    expect(finalize(snapshot, adapter).completeness).toBe("complete");
  });

  it("ignores hidden media and media inside explicitly excluded or skipped UI subtrees", () => {
    const adapter = controlledAdapter();
    const hidden = mediaNode("img", "hidden-image", false, false);
    const excludedVideo = mediaNode("video", "excluded-video");
    const excluded = node("excluded", "div", "", { "data-proof-excluded": "true" }, [excludedVideo]);
    const asideAudio = mediaNode("audio", "aside-audio");
    const aside = node("aside", "aside", "", {}, [asideAudio]);
    const scriptFrame = mediaNode("iframe", "script-frame");
    const script = node("script", "script", "", {}, [scriptFrame]);
    const root = contentRoot("excluded-media", [hidden, excluded, aside, script]);
    const snapshot = adapter.extract(readerFor(root, {
      media: { img: [hidden], video: [excludedVideo], audio: [asideAudio], iframe: [scriptFrame] },
      excluded: [excluded],
      skipped: { aside: [aside], script: [script] },
    }));

    expect(snapshot.assets).toEqual([]);
    expect(finalize(snapshot, adapter).completeness).toBe("complete");
  });

  it("does not treat media in an embedded related-content subtree as target-body media", () => {
    const relations: RelationPlan = {
      item_roots: [],
      permalink_links: [],
      continuation_parent_links: [],
      quote_roots: [RELATION_SELECTOR],
      repost_roots: [],
    };
    const adapter = controlledAdapter(relations);
    const relatedImage = mediaNode("img", "related-image");
    const relation = node("relation", "blockquote", "引用内容", { "data-proof-relation": "true" }, [relatedImage]);
    const root = contentRoot("relation-media", [relation]);
    const snapshot = adapter.extract(readerFor(root, {
      media: { img: [relatedImage] },
      relations: [relation],
    }));

    expect(snapshot.assets).toEqual([]);
    expect(finalize(snapshot, adapter).completeness).toBe("complete");
  });

  it("retains the existing missing-source and blocked-host completion gates", () => {
    const adapter = controlledAdapter();
    const missing = new FixtureNode("missing-source", "video", "", { "data-proof-selected": "video" });
    const blocked = new FixtureNode("blocked-host", "img", "", {
      src: "https://unapproved.example/body.png",
      "data-proof-selected": "image",
    });
    const root = contentRoot("invalid-selected-media", [missing, blocked]);
    const snapshot = adapter.extract(readerFor(root, {
      media: { img: [blocked], video: [missing] },
      selected: { img: [blocked], video: [missing] },
    }));

    expect(snapshot.assets).toMatchObject([{ role: "image", availability: "blocked" }]);
    expect(snapshot.warnings).toEqual(expect.arrayContaining([
      "asset:video:non_http_or_missing_source",
      "ASSET_HOST_RESTRICTED",
    ]));
    expect(finalize(snapshot, adapter).completeness).not.toBe("complete");
  });
});
