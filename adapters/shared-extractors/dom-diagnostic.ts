import type {
  BoundedDomDiagnostic,
  BoundedDomDiagnosticInputType,
  BoundedDomDiagnosticNode,
} from "../../shared/bridge-protocol.js";
import type { DomDiagnosticPlan, PageNode, PageReader, PlatformAdapter } from "../types.js";

// These limits bound only the diagnostic response and its local structural
// walk. They do not change extraction, completion, navigation, or media work.
const MAX_ROOT_MATCHES = 48;
const MAX_OUTLINE_NODES = 48;
const MAX_CHAIN_NODES = 6;
const MAX_CLASS_TOKENS = 12;
const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const SAFE_TAG = /^[a-z][a-z0-9-]{0,63}$/;
const INPUT_TYPES = new Set<BoundedDomDiagnosticInputType>(["text", "email", "search", "checkbox", "radio"]);

interface LimitedNodes {
  nodes: PageNode[];
  truncated: boolean;
}

function safelyVisible(reader: PageReader, node: PageNode): boolean {
  try { return reader.visible(node); } catch { return false; }
}

function selectVisible(reader: PageReader, selector: string, limit: number, scope?: PageNode): LimitedNodes {
  const seen = new Set<PageNode>();
  const nodes: PageNode[] = [];
  for (const node of reader.select([selector], scope)) {
    if (seen.has(node) || !safelyVisible(reader, node) || (scope && !reader.contains(scope, node))) continue;
    seen.add(node);
    if (nodes.length >= limit) return { nodes, truncated: true };
    nodes.push(node);
  }
  return { nodes, truncated: false };
}

function safeIdentifier(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized && SAFE_IDENTIFIER.test(normalized) ? normalized : undefined;
}

function safeClassTokens(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const tokens: string[] = [];
  for (const token of value.trim().split(/\s+/)) {
    if (!SAFE_IDENTIFIER.test(token) || tokens.includes(token)) continue;
    tokens.push(token);
    if (tokens.length === MAX_CLASS_TOKENS) break;
  }
  return tokens.length ? tokens : undefined;
}

function safeTag(reader: PageReader, node: PageNode): string {
  const tag = reader.tagName(node).toLowerCase();
  return SAFE_TAG.test(tag) ? tag : "unknown";
}

function inputType(reader: PageReader, node: PageNode, tag: string): BoundedDomDiagnosticInputType | undefined {
  if (tag !== "input") return undefined;
  const value = reader.attribute(node, "type")?.toLowerCase() ?? "text";
  return INPUT_TYPES.has(value as BoundedDomDiagnosticInputType) ? value as BoundedDomDiagnosticInputType : "other";
}

function chainToRoot(reader: PageReader, root: PageNode, seed: PageNode): { nodes: PageNode[]; truncated: boolean } {
  const reverse = [seed];
  let current = seed;
  while (current !== root) {
    // Preserve the six closest visible nodes even when the root is farther
    // away. The first retained node is deliberately parentless in that case:
    // it must never pretend that a skipped ancestor was the article root.
    if (reverse.length >= MAX_CHAIN_NODES) return { nodes: reverse.reverse(), truncated: true };
    const parent = reader.parent?.(current);
    if (!parent || !reader.contains(root, parent) || !safelyVisible(reader, parent)) return { nodes: reverse.reverse(), truncated: true };
    reverse.push(parent);
    current = parent;
  }
  return { nodes: reverse.reverse(), truncated: false };
}

function planFor(reader: PageReader, adapter: PlatformAdapter): { plan: DomDiagnosticPlan; contentId: string } | undefined {
  const plan = adapter.rule.dom_diagnostic;
  const contentId = adapter.rule.contentId(reader.location);
  return plan && contentId && adapter.match(reader.location) && plan.applies(reader.location) ? { plan, contentId } : undefined;
}

/**
 * Emits only a compiled-plan structural summary. There is no dynamic selector,
 * page text, URL, HTML, form value, hidden state, or layout measurement in the
 * result. `sameTarget` in the extension has already bound this reader to the
 * requested URL/content id before adapter observation reaches this function.
 */
export function boundedDomDiagnostic(
  reader: PageReader,
  adapter: PlatformAdapter,
  accessClass: "public_free" | "login_public_free" | "paid" | "private" | "unknown",
): BoundedDomDiagnostic | undefined {
  const bound = planFor(reader, adapter);
  if (!bound) return undefined;
  const { plan, contentId } = bound;
  const visibleRoots = new Map<PageNode, Set<string>>();
  let rootCountTruncated = false;
  const roots = plan.roots.map((entry) => {
    const matches = selectVisible(reader, entry.selector, MAX_ROOT_MATCHES);
    if (matches.truncated) rootCountTruncated = true;
    for (const node of matches.nodes) {
      if (visibleRoots.has(node)) {
        visibleRoots.get(node)!.add(entry.id);
      } else if (visibleRoots.size < MAX_ROOT_MATCHES) {
        visibleRoots.set(node, new Set([entry.id]));
      } else {
        rootCountTruncated = true;
      }
    }
    return { id: entry.id, visible_match_count: matches.nodes.length, count_truncated: matches.truncated, selected: false };
  });

  const selectedRoot = !rootCountTruncated && visibleRoots.size === 1
    ? visibleRoots.keys().next().value as PageNode
    : undefined;
  if (selectedRoot) {
    for (const root of roots) root.selected = visibleRoots.get(selectedRoot)?.has(root.id) === true;
  }

  let outline: BoundedDomDiagnostic["outline"];
  let truncated = rootCountTruncated;
  if (selectedRoot && plan.include_outline && accessClass === "public_free") {
    const nodes: BoundedDomDiagnosticNode[] = [];
    let outlineTruncated = false;

    const addNode = (
      node: PageNode,
      kinds: BoundedDomDiagnosticNode["kinds"],
      parentIndex: number | undefined,
      depth: number,
      chainTruncated = false,
    ): number | undefined => {
      if (nodes.length >= MAX_OUTLINE_NODES) {
        outlineTruncated = true;
        return undefined;
      }
      const tag = safeTag(reader, node);
      const id = safeIdentifier(reader.attribute(node, "id"));
      const classTokens = safeClassTokens(reader.attribute(node, "class"));
      const testId = safeIdentifier(reader.attribute(node, "data-testid"));
      const role = safeIdentifier(reader.attribute(node, "role"));
      const nodeInputType = inputType(reader, node, tag);
      const summary: BoundedDomDiagnosticNode = {
        node_index: nodes.length,
        ...(parentIndex === undefined ? {} : { parent_node_index: parentIndex }),
        depth,
        kinds: [...kinds],
        tag,
        ...(id ? { id } : {}),
        ...(classTokens ? { class_tokens: classTokens } : {}),
        ...(testId ? { test_id: testId } : {}),
        ...(role ? { role } : {}),
        ...(nodeInputType ? { input_type: nodeInputType } : {}),
        ...(chainTruncated ? { chain_truncated: true as const } : {}),
      };
      nodes.push(summary);
      return summary.node_index;
    };

    const rootIndex = addNode(selectedRoot, ["root"], undefined, 0);
    if (rootIndex === undefined) outlineTruncated = true;
    for (const probe of plan.probes ?? []) {
      const matches = selectVisible(reader, probe.selector, probe.max_nodes, selectedRoot);
      if (matches.truncated) outlineTruncated = true;
      for (const seed of matches.nodes) {
        const chain = chainToRoot(reader, selectedRoot, seed);
        if (rootIndex === undefined) {
          outlineTruncated = true;
          continue;
        }
        if (chain.truncated) outlineTruncated = true;
        const startsAtRoot = chain.nodes[0] === selectedRoot;
        let parentIndex: number | undefined = startsAtRoot ? rootIndex : undefined;
        // Do not merge shared DOM ancestors across probe chains. Independent
        // bounded segments preserve their own parent/depth relationship when
        // two deep seeds share only part of a longer path. The only reused
        // node is the real selected root; Medium's 4+2 probe caps keep this
        // at 37 nodes before the global 48-node guard applies.
        for (let index = startsAtRoot ? 1 : 0; index < chain.nodes.length; index += 1) {
          const isSeed = index === chain.nodes.length - 1;
          const next = addNode(chain.nodes[index]!, [isSeed ? probe.id : "ancestor"], parentIndex, index, isSeed && chain.truncated);
          if (next === undefined) break;
          parentIndex = next;
        }
      }
    }
    outline = { nodes, truncated: outlineTruncated };
    truncated ||= outlineTruncated;
  }

  return {
    version: 1,
    plan_id: plan.id,
    platform_content_id: contentId,
    roots,
    unique_visible_root_count: visibleRoots.size,
    root_count_truncated: rootCountTruncated,
    ...(outline ? { outline } : {}),
    truncated,
  };
}
