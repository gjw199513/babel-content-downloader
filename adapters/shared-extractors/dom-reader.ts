import type { PageNode, PageReader } from "../types.js";

// PageReader intentionally exposes only text and element nodes. Browser DOM
// childNodes also contains comments, document types, and processing nodes;
// those have neither element attributes nor a tag name and must not enter the
// platform extractor's structural walk.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function isElement(node: PageNode): node is Element {
  return (node as { nodeType?: unknown }).nodeType === ELEMENT_NODE;
}

function asElement(node: PageNode): Element | undefined {
  return isElement(node) ? node : undefined;
}

function normalize(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

/** Browser-only PageReader. It deliberately exposes reads, never arbitrary page evaluation. */
export class DomPageReader implements PageReader {
  constructor(readonly document: Document = globalThis.document) {}

  get location(): URL {
    return new URL(this.document.location.href);
  }

  get documentTitle(): string {
    return normalize(this.document.title);
  }

  select(selectors: readonly string[], scope?: PageNode): PageNode[] {
    const root = scope ? asElement(scope) : this.document;
    if (!root) return [];
    const seen = new Set<Element>();
    const result: Element[] = [];
    for (const selector of selectors) {
      try {
        for (const element of root.querySelectorAll(selector)) {
          if (!seen.has(element)) {
            seen.add(element);
            result.push(element);
          }
        }
      } catch {
        // Adapter selectors are shipped code. A bad selector must not turn a
        // page into an arbitrary query channel; extraction will report missing content.
      }
    }
    return result;
  }

  text(node: PageNode): string {
    if (this.isText(node)) return normalize((node as Text).textContent ?? "");
    const element = asElement(node) as HTMLElement | undefined;
    if (!element) return "";
    const rendered = typeof element.innerText === "string" ? element.innerText : "";
    return normalize(rendered || element.textContent || "");
  }

  attribute(node: PageNode, name: string): string | null {
    const element = asElement(node);
    if (!element) return null;
    const value = element.getAttribute(name);
    return value?.trim() || null;
  }

  rawText(node: PageNode): string {
    if (this.isText(node)) return (node as Text).textContent ?? "";
    return asElement(node)?.textContent ?? "";
  }

  tagName(node: PageNode): string {
    if (this.isText(node)) return "#text";
    return asElement(node)?.tagName.toLowerCase() ?? "#unsupported";
  }

  isText(node: PageNode): boolean { return (node as { nodeType?: unknown }).nodeType === TEXT_NODE; }

  children(node: PageNode): PageNode[] {
    const element = asElement(node);
    if (!element) return [];
    return Array.from(element.childNodes).filter(child => this.isText(child) || isElement(child));
  }

  parent(node: PageNode): PageNode | undefined {
    if (this.isText(node)) return (node as Text).parentElement ?? undefined;
    return asElement(node)?.parentElement ?? undefined;
  }

  mediaSource(node: PageNode): string | null {
    const element = asElement(node);
    if (!element) return null;
    const tag = element.tagName.toLowerCase();
    if (tag !== "video" && tag !== "audio") return null;
    // `currentSrc` is the standard, resolved DOM media URL. It is a read of
    // the element already selected by a shipped adapter selector; this reader
    // never evaluates page script, opens network requests, or reads a media
    // buffer. The extractor subsequently rejects non-HTTP(S) values and
    // applies the platform asset-host allowlist.
    const current = (element as HTMLMediaElement).currentSrc;
    return typeof current === "string" && current.trim() ? current.trim() : null;
  }

  contains(ancestor: PageNode, node: PageNode): boolean {
    if (this.isText(ancestor)) return ancestor === node;
    return asElement(ancestor)?.contains(node as Node) ?? false;
  }

  visible(node: PageNode): boolean {
    if (this.isText(node)) {
      const parent = (node as Text).parentElement;
      return parent ? this.visible(parent) : false;
    }
    const element = asElement(node) as HTMLElement | undefined;
    if (!element) return false;
    // A visible-looking descendant can still live in an alternate hidden
    // template. GitHub's legacy repository header is one observed example:
    // its child label is ordinary markup while the header ancestor has
    // `hidden`/`display:none`. Read the entire ancestor chain so a positive
    // public marker cannot be supplied by a hidden duplicate. This remains a
    // layout-state check only: off-screen position and zero dimensions do not
    // make otherwise rendered source content invisible.
    for (let current: HTMLElement | null = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
      const style = globalThis.getComputedStyle?.(current);
      if (style?.display === "none" || style?.visibility === "hidden") return false;
    }
    return true;
  }
}
