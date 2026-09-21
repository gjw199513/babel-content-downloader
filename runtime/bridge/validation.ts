import * as z from "zod/v4";
import type { BridgeResponse } from "../../shared/bridge-protocol.js";
import type { ContentSnapshot } from "../../shared/contracts.js";
import { evaluateContentCompleteness } from "../../shared/completeness.js";

const text = z.string().max(100_000);
const asset = z.object({
  id: z.string().min(1).max(160),
  role: z.enum(["image", "video", "audio", "subtitle", "cover", "file"]),
  url: z.url(),
  order: z.number().int().min(0).max(100_000),
  media_type: z.string().max(160).optional(),
  title: z.string().max(2000).optional(),
  language: z.string().max(80).optional(),
  // An already-installed 0.1.2 extension can report absent HTML dimensions as
  // zero. Treat exactly zero as unknown; negative/non-numeric values remain bad.
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  duration_seconds: z.number().nonnegative().optional(),
  quality: z.string().max(100).optional(),
  source_url: z.url().optional(),
  availability: z.enum(["available", "not_present", "unknown", "blocked", "unsupported"]),
  note: z.string().max(2000).optional(),
}).transform(({ width, height, ...rest }) => ({
  ...rest,
  ...(width === undefined || width === 0 ? {} : { width }),
  ...(height === undefined || height === 0 ? {} : { height }),
}));
const block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), level: z.number().int().min(1).max(6), text }),
  z.object({ type: z.enum(["paragraph", "quote"]), text }),
  z.object({ type: z.literal("code"), text, language: z.string().regex(/^[A-Za-z0-9_+.-]{1,40}$/).optional() }),
  z.object({ type: z.literal("math"), text, format: z.enum(["latex", "text"]) }),
  z.object({ type: z.literal("table"), caption: text.optional(), rows: z.array(z.array(z.object({ text, header: z.boolean(), colspan: z.number().int().min(1).max(1000).optional(), rowspan: z.number().int().min(1).max(1000).optional() })).max(100)).max(1000) }),
  z.object({ type: z.enum(["image", "video", "audio", "file"]), asset_id: z.string().min(1).max(160), caption: text.optional() }),
  z.object({ type: z.literal("list"), ordered: z.boolean(), items: z.array(text).max(1000) }),
]);
const relation = z.object({
  type: z.enum(["author_continuation", "quote", "repost"]),
  from_content_id: z.string().min(1).max(200),
  to_content_id: z.string().min(1).max(200),
  order: z.number().int().min(1).max(100_000),
  source_url: z.url(),
  authors: z.array(z.string().max(400)).max(100),
  published_at: z.string().max(80).nullable(),
  content_type: z.enum(["article", "post", "thread", "image_note", "video", "audio", "mixed"]),
  blocks: z.array(block).max(20_000),
  assets: z.array(asset).max(2000),
  completeness: z.enum(["partial", "unknown"]),
  evidence: z.array(z.string().max(2000)).max(1000),
});
const completenessProof = z.object({
  version: z.literal(1),
  scope: z.literal("single_item"),
  method: z.enum(["adapter_bounded_dom", "browser_page_capture"]),
  rule_id: z.string().min(1).max(160),
  platform_content_id: z.string().min(1).max(200),
  boundary: z.enum(["root_exhausted", "terminal_observed", "dom_read"]),
  pending_marker_count: z.literal(0),
  ordered_asset_count: z.number().int().min(0).max(2000),
  unplaced_asset_count: z.literal(0),
  external_file_asset_id: z.string().min(1).max(160).optional(),
  stability: z.object({
    sample_count: z.number().int().min(2).max(8),
    window_ms: z.number().int().min(1).max(60_000),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
}).strict();
export const contentSnapshotSchema = z.object({
  schema_version: z.literal("1"),
  platform: z.string().min(1).max(100),
  adapter_version: z.string().min(1).max(100),
  source_url: z.url(),
  canonical_url: z.url(),
  platform_content_id: z.string().max(200).optional(),
  content_type: z.enum(["article", "post", "thread", "image_note", "video", "audio", "mixed"]),
  title: z.string().max(2000).optional(),
  authors: z.array(z.string().max(400)).max(100),
  published_at: z.string().max(80).nullable(),
  language: z.string().max(80).optional(),
  blocks: z.array(block).max(20_000),
  assets: z.array(asset).max(2000),
  relations: z.array(relation).max(100).optional(),
  access_class: z.enum(["public_free", "login_public_free", "paid", "private", "unknown"]),
  completeness: z.enum(["complete", "partial", "unknown"]),
  completeness_proof: completenessProof.optional(),
  warnings: z.array(z.string().max(2000)).max(1000),
  evidence: z.array(z.string().max(2000)).max(1000).optional(),
}).superRefine((snapshot, context) => {
  const evaluation = evaluateContentCompleteness(snapshot as ContentSnapshot);
  if (!evaluation.valid) context.addIssue({
    code: "custom",
    path: evaluation.issue.path,
    message: evaluation.issue.code,
  });
});
const diagnosticIdentifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const diagnosticPlanId = z.string().regex(/^[a-z][a-z0-9._-]{0,159}$/);
const diagnosticNode = z.strictObject({
  node_index: z.number().int().min(0).max(47),
  parent_node_index: z.number().int().min(0).max(47).optional(),
  depth: z.number().int().min(0).max(5),
  kinds: z.array(z.enum(["root", "ancestor", "input", "figure"])).min(1).max(4),
  tag: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  id: diagnosticIdentifier.optional(),
  class_tokens: z.array(diagnosticIdentifier).min(1).max(12).optional(),
  test_id: diagnosticIdentifier.optional(),
  role: diagnosticIdentifier.optional(),
  input_type: z.enum(["text", "email", "search", "checkbox", "radio", "other"]).optional(),
  chain_truncated: z.literal(true).optional(),
});
const domDiagnostic = z.strictObject({
  version: z.literal(1),
  plan_id: diagnosticPlanId,
  platform_content_id: z.string().min(1).max(200),
  roots: z.array(z.strictObject({
    id: diagnosticIdentifier,
    visible_match_count: z.number().int().min(0).max(48),
    count_truncated: z.boolean(),
    selected: z.boolean(),
  })).min(1).max(4),
  unique_visible_root_count: z.number().int().min(0).max(48),
  root_count_truncated: z.boolean(),
  outline: z.strictObject({ nodes: z.array(diagnosticNode).max(48), truncated: z.boolean() }).optional(),
  truncated: z.boolean(),
});
const observation = z.strictObject({
  instance_id: z.string().min(1).max(128),
  tab_id: z.number().int().nonnegative(),
  url: z.url(),
  title: z.string().max(2000),
  origin: z.url(),
  adapter_id: z.string().max(100).optional(),
  access_class: z.enum(["public_free", "login_public_free", "paid", "private", "unknown"]).optional(),
  action_targets: z.array(z.strictObject({ id: z.string().min(1).max(120), type: z.enum(["expand", "play"]), label: z.string().max(240) })).max(100).optional(),
  diagnostic: domDiagnostic.optional(),
  evidence: z.array(z.string().max(2000)).max(1000),
}).superRefine((value, context) => {
  const diagnostic = value.diagnostic;
  if (!diagnostic) return;
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  if (diagnostic.outline && value.access_class !== "public_free") {
    issue(["diagnostic", "outline"], "DIAGNOSTIC_OUTLINE_ACCESS");
  }
  const selectedCount = diagnostic.roots.filter(root => root.selected).length;
  if (!diagnostic.root_count_truncated && diagnostic.unique_visible_root_count === 1 && selectedCount === 0) {
    issue(["diagnostic", "roots"], "DIAGNOSTIC_SELECTED_ROOT_MISSING");
  }
  if ((diagnostic.root_count_truncated || diagnostic.unique_visible_root_count !== 1) && selectedCount !== 0) {
    issue(["diagnostic", "roots"], "DIAGNOSTIC_SELECTED_ROOT_AMBIGUOUS");
  }
  if (diagnostic.root_count_truncated && !diagnostic.truncated) {
    issue(["diagnostic", "truncated"], "DIAGNOSTIC_TRUNCATION_INCONSISTENT");
  }
  const outline = diagnostic.outline;
  if (!outline) return;
  if (diagnostic.root_count_truncated || diagnostic.unique_visible_root_count !== 1) {
    issue(["diagnostic", "outline"], "DIAGNOSTIC_OUTLINE_ROOT_AMBIGUOUS");
  }
  if (outline.truncated && !diagnostic.truncated) {
    issue(["diagnostic", "truncated"], "DIAGNOSTIC_TRUNCATION_INCONSISTENT");
  }
  const roots = outline.nodes.filter(node => node.kinds.includes("root"));
  if (roots.length !== 1 || outline.nodes[0]?.node_index !== 0 || !outline.nodes[0]?.kinds.includes("root")) {
    issue(["diagnostic", "outline", "nodes"], "DIAGNOSTIC_ROOT_CHAIN_INVALID");
  }
  for (const [index, node] of outline.nodes.entries()) {
    if (node.node_index !== index) issue(["diagnostic", "outline", "nodes", index, "node_index"], "DIAGNOSTIC_NODE_INDEX_INVALID");
    if (node.parent_node_index === undefined) continue;
    if (node.parent_node_index >= index) {
      issue(["diagnostic", "outline", "nodes", index, "parent_node_index"], "DIAGNOSTIC_PARENT_INDEX_INVALID");
      continue;
    }
    const parent = outline.nodes[node.parent_node_index];
    if (!parent || parent.depth + 1 !== node.depth) {
      issue(["diagnostic", "outline", "nodes", index, "depth"], "DIAGNOSTIC_PARENT_DEPTH_INVALID");
    }
  }
});
const response = z.object({
  version: z.literal(1),
  request_id: z.uuid(),
  nonce: z.string().min(16).max(100),
  session_id: z.uuid(),
  ok: z.boolean(),
  result: z.object({ snapshot: contentSnapshotSchema.optional(), observation: observation.optional(), action_applied: z.boolean().optional() }).optional(),
  error: z.object({ code: z.string().min(1).max(100), message: z.string().max(2000), retryable: z.boolean() }).optional(),
}).refine((value) => value.ok ? !!value.result : !!value.error);

export type BridgeResponseValidation =
  | { ok: true; response: BridgeResponse }
  | { ok: false; code: "INVALID_RESPONSE" | "SNAPSHOT_INVALID"; field: string; issue: string };

function safeFieldPath(path: PropertyKey[]): string {
  let result = "response";
  for (const segment of path) {
    if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) result += `[${segment}]`;
    else if (typeof segment === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(segment)) result += `.${segment}`;
    else result += ".[field]";
  }
  return result.slice(0, 200);
}

/** The diagnostic includes schema-controlled paths/codes only, never page data. */
export function validateBridgeResponse(value: unknown): BridgeResponseValidation {
  const parsed = response.safeParse(value);
  if (parsed.success) return { ok: true, response: parsed.data as BridgeResponse };
  const issue = parsed.error.issues[0];
  const path = issue?.path ?? [];
  return {
    ok: false,
    code: path[0] === "result" && path[1] === "snapshot" ? "SNAPSHOT_INVALID" : "INVALID_RESPONSE",
    field: safeFieldPath(path),
    issue: issue?.code === "custom" && /^[A-Z_]+$/.test(issue.message) ? issue.message : issue?.code ?? "invalid_value",
  };
}

export function parseBridgeResponse(value: unknown): BridgeResponse | undefined {
  const validation = validateBridgeResponse(value);
  return validation.ok ? validation.response : undefined;
}
