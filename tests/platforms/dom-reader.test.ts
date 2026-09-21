import { describe, expect, it } from "vitest";
import { createAdapterRegistry } from "../../adapters/registry.js";
import { DomPageReader } from "../../adapters/shared-extractors/dom-reader.js";
import type { PageNode } from "../../adapters/types.js";

class TestText {
  readonly nodeType = 3;
  parentElement: TestElement | null = null;
  constructor(readonly textContent: string) {}
}

class TestComment {
  readonly nodeType = 8;
  parentElement: TestElement | null = null;
  constructor(readonly textContent: string) {}
}

type TestChild = TestText | TestComment | TestElement;

class TestElement {
  readonly nodeType = 1;
  readonly childNodes: TestChild[];
  readonly selections = new Map<string, TestElement[]>();
  parentElement: TestElement | null = null;
  hidden = false;

  constructor(
    readonly tagName: string,
    children: TestChild[] = [],
    private readonly attributes: Record<string, string> = {},
    readonly currentSrc = "",
  ) {
    this.childNodes = children;
    for (const child of children) child.parentElement = this;
  }

  get textContent(): string {
    return this.childNodes.map(child => child instanceof TestText ? child.textContent : child instanceof TestElement ? child.textContent : "").join("");
  }

  get innerText(): string { return this.textContent; }

  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }

  querySelectorAll(selector: string): TestElement[] { return this.selections.get(selector) ?? []; }

  add(selector: string, nodes: TestElement[]): this {
    this.selections.set(selector, nodes);
    return this;
  }

  contains(node: Node): boolean {
    let current: TestChild | TestElement | null = node as unknown as TestChild;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }
}

class TestDocument {
  readonly selections = new Map<string, TestElement[]>();
  readonly location: { href: string };

  constructor(href: string, readonly title: string) {
    this.location = { href };
  }

  querySelectorAll(selector: string): TestElement[] { return this.selections.get(selector) ?? []; }

  add(selector: string, nodes: TestElement[]): this {
    this.selections.set(selector, nodes);
    return this;
  }
}

function bilibiliAdapter() {
  const adapter = createAdapterRegistry().get("bilibili");
  if (!adapter) throw new Error("Expected Bilibili adapter");
  return adapter;
}

describe("browser DOM page reader", () => {
  it("reads only a standard media element's resolved currentSrc", () => {
    const video = new TestElement("VIDEO", [], {}, "https://upos-sz-mirrorcos.bilivideo.com/example.m4s?token=runtime");
    const image = new TestElement("IMG", [], { src: "https://i0.hdslb.com/not-media.jpg" });
    const documentLike = new TestDocument("https://www.bilibili.com/video/BV1GJ411x7h7/", "哔哩哔哩");
    const reader = new DomPageReader(documentLike as unknown as Document);

    expect(reader.mediaSource(video as unknown as PageNode)).toBe("https://upos-sz-mirrorcos.bilivideo.com/example.m4s?token=runtime");
    expect(reader.mediaSource(image as unknown as PageNode)).toBeNull();
  });

  it("treats a descendant of a hidden ancestor as invisible without rejecting off-screen source", () => {
    const marker = new TestElement("SPAN", [new TestText("Public")]);
    const hiddenTemplate = new TestElement("DIV", [marker]);
    hiddenTemplate.hidden = true;
    const ariaHiddenMarker = new TestElement("SPAN", [new TestText("Public")]);
    const ariaHiddenTemplate = new TestElement("DIV", [ariaHiddenMarker], { "aria-hidden": "true" });
    const displayHiddenMarker = new TestElement("SPAN", [new TestText("Public")]);
    const displayHiddenTemplate = new TestElement("DIV", [displayHiddenMarker]);
    const visibleMarker = new TestElement("SPAN", [new TestText("Public")]);
    const documentLike = new TestDocument("https://github.com/openai/openai-python", "openai-python");
    const reader = new DomPageReader(documentLike as unknown as Document);
    const priorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: (element: Element) => ({
        display: (element as unknown) === displayHiddenTemplate ? "none" : "block",
        visibility: "visible",
      }) as CSSStyleDeclaration,
    });

    try {
      expect(reader.visible(marker as unknown as PageNode)).toBe(false);
      expect(reader.visible(ariaHiddenMarker as unknown as PageNode)).toBe(false);
      expect(reader.visible(displayHiddenMarker as unknown as PageNode)).toBe(false);
      expect(reader.visible(visibleMarker as unknown as PageNode)).toBe(true);
    } finally {
      if (priorDescriptor) Object.defineProperty(globalThis, "getComputedStyle", priorDescriptor);
      else delete (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
    }
  });

  it("drops comment nodes before the Bilibili body walk", () => {
    const title = new TestElement("H1", [new TestText("目标视频")]);
    const comment = new TestComment("vue-anchor");
    const body = new TestElement("P", [new TestText("目标视频简介")]);
    const root = new TestElement("DIV", [title, comment, body])
      .add("#mirror-vdcon h1", [title]);
    const documentLike = new TestDocument("https://www.bilibili.com/video/BV1GJ411x7h7/", "目标视频")
      .add("#mirror-vdcon", [root]);
    const reader = new DomPageReader(documentLike as unknown as Document);

    // A Vue-style comment is a DOM child but cannot be an extractor block.
    expect(reader.children(root as unknown as PageNode)).toEqual([title, body]);
    expect(reader.tagName(comment as unknown as PageNode)).toBe("#unsupported");
    expect(reader.text(comment as unknown as PageNode)).toBe("");

    const snapshot = bilibiliAdapter().extract(reader);
    expect(snapshot.blocks).toEqual([
      { type: "heading", level: 1, text: "目标视频" },
      { type: "paragraph", text: "目标视频简介" },
    ]);
  });
});
