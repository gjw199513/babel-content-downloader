import type { PageNode, PageReader } from "../../adapters/types.js";

export class FixtureNode {
  readonly childrenNodes: FixtureNode[];
  parentNode: FixtureNode | undefined;
  constructor(
    readonly id: string,
    readonly tag: string,
    readonly value = "",
    readonly attrs: Record<string, string> = {},
    children: FixtureNode[] = [],
    readonly isVisible = true,
  ) {
    this.childrenNodes = children;
    for (const child of children) child.parentNode = this;
  }
}

export class FixturePageReader implements PageReader {
  private readonly selections = new Map<string, FixtureNode[]>();
  readonly location: URL;
  constructor(url: string, readonly documentTitle: string) {
    this.location = new URL(url);
  }

  add(selector: string, nodes: FixtureNode[], scope?: FixtureNode): this {
    this.selections.set(this.key(selector, scope), nodes);
    return this;
  }

  select(selectors: readonly string[], scope?: PageNode): PageNode[] {
    const result: FixtureNode[] = [];
    const seen = new Set<FixtureNode>();
    for (const selector of selectors) {
      for (const node of this.selections.get(this.key(selector, scope as FixtureNode | undefined)) ?? []) {
        if (!seen.has(node)) {
          seen.add(node);
          result.push(node);
        }
      }
    }
    return result;
  }

  text(node: PageNode): string { return (node as FixtureNode).value; }
  attribute(node: PageNode, name: string): string | null { return (node as FixtureNode).attrs[name] ?? null; }
  tagName(node: PageNode): string { return (node as FixtureNode).tag; }
  isText(node: PageNode): boolean { return (node as FixtureNode).tag === "#text"; }
  children(node: PageNode): PageNode[] { return (node as FixtureNode).childrenNodes; }
  parent(node: PageNode): PageNode | undefined { return (node as FixtureNode).parentNode; }
  mediaSource(node: PageNode): string | null { return (node as FixtureNode).attrs.currentSrc ?? null; }
  contains(ancestor: PageNode, node: PageNode): boolean {
    const root = ancestor as FixtureNode;
    let current: FixtureNode | undefined = node as FixtureNode;
    while (current) {
      if (current === root) return true;
      current = current.parentNode;
    }
    return false;
  }
  visible(node: PageNode): boolean { return (node as FixtureNode).isVisible; }

  private key(selector: string, scope?: FixtureNode): string {
    return `${scope?.id ?? "document"}\u0000${selector}`;
  }
}

export function node(
  id: string,
  tag: string,
  value = "",
  attrs: Record<string, string> = {},
  children: FixtureNode[] = [],
): FixtureNode {
  return new FixtureNode(id, tag, value, attrs, children);
}
