import type { AccessClassification, AccessSignals, PageNode, PageReader, PlatformRule, TargetRootPlan } from "../types.js";

export function targetRootPlanFor(rule: PlatformRule, url: URL): TargetRootPlan | undefined {
  return rule.target_root_plans?.find(plan => plan.applies(url));
}

function firstMatchingSelector(
  reader: PageReader,
  selectors: readonly string[],
  visible: (node: PageNode) => boolean,
  ignoredNodes: ReadonlySet<PageNode> = new Set(),
): string | null {
  for (const selector of selectors) {
    if (reader.select([selector]).some(node => visible(node) && !ignoredNodes.has(node))) return selector;
  }
  return null;
}

function matchingPhrase(sources: () => readonly string[], phrases: readonly string[] | undefined): string | null {
  if (!phrases?.length) return null;
  for (const phrase of phrases) {
    if (sources().some(text => text.includes(phrase))) return phrase;
  }
  return null;
}

function marker(
  reader: PageReader,
  selectors: readonly string[],
  phrases: readonly string[] | undefined,
  label: string,
  visible: (node: PageNode) => boolean,
  rootTextSources: () => readonly string[],
  ignoredNodes?: ReadonlySet<PageNode>,
): string | null {
  const selector = firstMatchingSelector(reader, selectors, visible, ignoredNodes);
  if (selector) return `${label}:selector:${selector}`;
  const phrase = matchingPhrase(rootTextSources, phrases);
  return phrase ? `${label}:text:${phrase}` : null;
}

function ignoredNonBlockingLoginNodes(
  reader: PageReader,
  plan: TargetRootPlan | undefined,
  trustedRoot: PageNode | undefined,
  visible: (node: PageNode) => boolean,
): ReadonlySet<PageNode> {
  const gate = plan?.non_blocking_login_gate;
  if (!gate || !trustedRoot) return new Set();
  const visibleAncestors = reader.select([gate.ancestor_selector]).filter(visible);
  return new Set(
    reader.select([gate.selector]).filter(node => visible(node)
      && visibleAncestors.some(ancestor => reader.contains(ancestor, node))),
  );
}

/** Conservative classification: an uncertain page is never treated as paid-free by a text hint alone. */
export function classifyAccess(reader: PageReader, rule: PlatformRule, trustedRoot?: PageNode): AccessClassification {
  const targetPlan = targetRootPlanFor(rule, reader.location);
  const roots = targetPlan?.roots ?? rule.selectors.roots;
  // These caches belong to one classification only. A later observe sample
  // receives fresh DOM state while repeated gates avoid rereading this one.
  const visibility = new Map<PageNode, boolean>();
  const text = new Map<PageNode, string>();
  let selectedRoots: readonly PageNode[] | undefined;
  let visibleRoots: readonly PageNode[] | undefined;
  let textSources: readonly string[] | undefined;
  const isVisible = (node: PageNode): boolean => {
    if (!visibility.has(node)) visibility.set(node, reader.visible(node));
    return visibility.get(node)!;
  };
  const nodeText = (node: PageNode): string => {
    if (!text.has(node)) text.set(node, reader.text(node));
    return text.get(node)!;
  };
  const rootNodes = (): readonly PageNode[] => selectedRoots ??= reader.select(roots);
  const visibleRootNodes = (): readonly PageNode[] => visibleRoots ??= rootNodes().filter(isVisible);
  const rootTextSources = (): readonly string[] => textSources ??= [reader.documentTitle, ...visibleRootNodes().map(nodeText)];

  const privateMarker = marker(reader, rule.access.private_gates, rule.access.private_text, "private", isVisible, rootTextSources);
  if (privateMarker) return { accessClass: "private", evidence: [privateMarker] };

  const paidMarker = marker(reader, rule.access.paid_gates, rule.access.paid_text, "paid", isVisible, rootTextSources);
  if (paidMarker) return { accessClass: "paid", evidence: [paidMarker] };

  const ignoredLoginNodes = ignoredNonBlockingLoginNodes(reader, targetPlan, trustedRoot, isVisible);
  const loginMarker = marker(reader, rule.access.login_gates, rule.access.login_text, "login", isVisible, rootTextSources, ignoredLoginNodes);
  if (loginMarker) return { accessClass: "login_public_free", evidence: [loginMarker] };

  const publicMarker = rule.access.public_marker;
  if (publicMarker) {
    const nodes = [...new Set(reader.select(publicMarker.selectors))].filter(isVisible);
    if (nodes.length !== 1 || nodeText(nodes[0]!).replace(/\s+/g, ' ').trim() !== publicMarker.text) {
      return { accessClass: "unknown", evidence: ["access:public-visibility-not-confirmed"] };
    }
  }
  if (rule.access.public_check) {
    try {
      if (!rule.access.public_check(reader)) return { accessClass: "unknown", evidence: ["access:public-metadata-not-confirmed"] };
    } catch {
      return { accessClass: "unknown", evidence: ["access:public-metadata-unreadable"] };
    }
  }

  // A route-specific plan must prove its own ID-bound root before public
  // access is reported. Its generic CSS candidate is not enough on its own.
  const hasVisibleRoot = trustedRoot
    ? isVisible(trustedRoot) && nodeText(trustedRoot).length > 0
    : targetPlan ? false : rootNodes().some(node => isVisible(node) && nodeText(node).length > 0);
  return hasVisibleRoot
    ? { accessClass: "public_free", evidence: ["access:visible-supported-content-root"] }
    : { accessClass: "unknown", evidence: ["access:content-root-not-confirmed"] };
}

export function accessError(access: AccessClassification): { code: "LOGIN_REQUIRED" | "PAID_CONTENT_EXCLUDED" | "PRIVATE_CONTENT_EXCLUDED" | "ACCESS_UNCONFIRMED"; message: string } | null {
  switch (access.accessClass) {
    case "login_public_free":
      return { code: "LOGIN_REQUIRED", message: "The requested platform page is showing a login gate." };
    case "paid":
      return { code: "PAID_CONTENT_EXCLUDED", message: "The requested content is marked as paid or subscription-only." };
    case "private":
      return { code: "PRIVATE_CONTENT_EXCLUDED", message: "The requested content is private or otherwise not in the allowed scope." };
    case "unknown":
      return access.evidence.some(value => value.startsWith("access:public-"))
        ? { code: "ACCESS_UNCONFIRMED", message: "This source has not supplied the required public visibility evidence." }
        : null;
    default:
      return null;
  }
}
