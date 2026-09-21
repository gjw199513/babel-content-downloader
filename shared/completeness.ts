import type { AdapterDefinition, ContentSnapshot } from "./contracts.js";

const BLOCKABLE_ROLES = new Set(["image", "video", "audio", "file"]);

export type CompletenessIssueCode =
  | "PROOF_REQUIRED"
  | "PROOF_WITHOUT_COMPLETE"
  | "PROOF_VERSION_UNSUPPORTED"
  | "PROOF_SCOPE_UNSUPPORTED"
  | "PROOF_METHOD_UNSUPPORTED"
  | "PROOF_RULE_ID_INVALID"
  | "PROOF_CONTENT_ID_INVALID"
  | "PROOF_BOUNDARY_INVALID"
  | "PENDING_MARKERS_PRESENT"
  | "ORDERED_ASSET_COUNT_INVALID"
  | "UNPLACED_ASSETS_PRESENT"
  | "EXTERNAL_FILE_ASSET_ID_INVALID"
  | "EXTERNAL_FILE_ASSET_MISSING"
  | "EXTERNAL_FILE_ASSET_ROLE_INVALID"
  | "EXTERNAL_FILE_ASSET_IN_BODY"
  | "EXTERNAL_FILE_ASSET_REQUIRED"
  | "EXTERNAL_FILE_ASSET_UNDECLARED"
  | "STABILITY_PROOF_INVALID"
  | "CONTENT_ID_REQUIRED"
  | "CONTENT_ID_MISMATCH"
  | "SINGLE_ITEM_RELATIONS_PRESENT"
  | "ACCESS_NOT_PUBLIC"
  | "SOURCE_ASSET_UNAVAILABLE"
  | "SOURCE_ASSET_ID_DUPLICATE"
  | "BLOCK_ASSET_REF_DUPLICATE"
  | "BLOCK_ASSET_SET_MISMATCH"
  | "ORDERED_ASSET_COUNT_MISMATCH"
  | "ADAPTER_ID_MISMATCH"
  | "ADAPTER_VERSION_MISMATCH"
  | "COMPLETION_RULE_UNKNOWN"
  | "COMPLETION_BOUNDARY_MISMATCH"
  | "STABILITY_RULE_INVALID"
  | "STABILITY_PROOF_REQUIRED"
  | "STABILITY_PROOF_UNDECLARED"
  | "STABILITY_SAMPLE_COUNT_INSUFFICIENT"
  | "STABILITY_WINDOW_INSUFFICIENT"
  | "CONTENT_TYPE_NOT_ALLOWED"
  | "COMPLETION_ROUTE_MISMATCH";

export interface CompletenessIssue {
  code: CompletenessIssueCode;
  path: (string | number)[];
}

export type CompletenessEvaluation =
  | { valid: true; complete: boolean }
  | { valid: false; complete: false; issue: CompletenessIssue };

export interface CompletenessBinding {
  adapter: AdapterDefinition;
  /** Every URL used to identify the capture must remain on the same adapter rule. */
  urls: readonly URL[];
}

function invalid(code: CompletenessIssueCode, path: (string | number)[]): CompletenessEvaluation {
  return { valid: false, complete: false, issue: { code, path } };
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every(value => right.has(value));
}

/**
 * One gate for bridge validation, persistence resume, and final job status.
 * Partial/unknown legacy snapshots remain usable; a complete claim requires a
 * current adapter proof and, when supplied, an exact route binding.
 */
export function evaluateContentCompleteness(snapshot: ContentSnapshot, binding?: CompletenessBinding): CompletenessEvaluation {
  const proof = snapshot.completeness_proof;
  if (snapshot.completeness !== "complete") {
    return proof ? invalid("PROOF_WITHOUT_COMPLETE", ["completeness_proof"]) : { valid: true, complete: false };
  }
  if (!proof) return invalid("PROOF_REQUIRED", ["completeness_proof"]);
  if (proof.version !== 1) return invalid("PROOF_VERSION_UNSUPPORTED", ["completeness_proof", "version"]);
  if (proof.scope !== "single_item") return invalid("PROOF_SCOPE_UNSUPPORTED", ["completeness_proof", "scope"]);
  const httpPage = proof.method === "http_page_capture";
  const browserPage = proof.method === "browser_page_capture";
  const genericPage = httpPage || browserPage;
  if (proof.method !== "adapter_bounded_dom" && !genericPage) return invalid("PROOF_METHOD_UNSUPPORTED", ["completeness_proof", "method"]);
  // Generic receipts certify only the current fetched response or browser DOM.
  // Neither can replace a specialized platform proof or claim pagination.
  const expectedPageRule = httpPage ? "web_page.http-response.v1" : "web_page.browser-document.v1";
  if (genericPage && (snapshot.platform !== "web_page" || proof.rule_id !== expectedPageRule
    || snapshot.content_type !== "article" || (snapshot.access_class !== "public_free" && !(browserPage && snapshot.access_class === "login_public_free"))
    || proof.stability !== undefined || proof.external_file_asset_id !== undefined)) {
    return invalid("PROOF_METHOD_UNSUPPORTED", ["completeness_proof", "method"]);
  }
  if (genericPage && snapshot.assets.some(asset => asset.role !== "image" && asset.role !== "cover")) {
    return invalid("CONTENT_TYPE_NOT_ALLOWED", ["assets"]);
  }
  if (typeof proof.rule_id !== "string" || proof.rule_id.length < 1 || proof.rule_id.length > 160) return invalid("PROOF_RULE_ID_INVALID", ["completeness_proof", "rule_id"]);
  if (typeof proof.platform_content_id !== "string" || proof.platform_content_id.length < 1 || proof.platform_content_id.length > 200) return invalid("PROOF_CONTENT_ID_INVALID", ["completeness_proof", "platform_content_id"]);
  if (httpPage ? proof.boundary !== "response_received" : browserPage ? proof.boundary !== "dom_read" : (proof.boundary !== "root_exhausted" && proof.boundary !== "terminal_observed")) return invalid("PROOF_BOUNDARY_INVALID", ["completeness_proof", "boundary"]);
  if (proof.pending_marker_count !== 0) return invalid("PENDING_MARKERS_PRESENT", ["completeness_proof", "pending_marker_count"]);
  if (!Number.isInteger(proof.ordered_asset_count) || proof.ordered_asset_count < 0 || proof.ordered_asset_count > 2000) return invalid("ORDERED_ASSET_COUNT_INVALID", ["completeness_proof", "ordered_asset_count"]);
  if (proof.unplaced_asset_count !== 0) return invalid("UNPLACED_ASSETS_PRESENT", ["completeness_proof", "unplaced_asset_count"]);
  const externalFileAssetId = (proof as ContentSnapshot["completeness_proof"] & { external_file_asset_id?: unknown }).external_file_asset_id;
  if (externalFileAssetId !== undefined && (typeof externalFileAssetId !== "string" || externalFileAssetId.length < 1 || externalFileAssetId.length > 160)) {
    return invalid("EXTERNAL_FILE_ASSET_ID_INVALID", ["completeness_proof", "external_file_asset_id"]);
  }
  const stability = proof.stability as typeof proof.stability | null;
  if (stability !== undefined) {
    if (!stability || typeof stability !== "object"
      || !Number.isInteger(stability.sample_count) || stability.sample_count < 2 || stability.sample_count > 8
      || !Number.isInteger(stability.window_ms) || stability.window_ms < 1 || stability.window_ms > 60_000
      || typeof stability.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(stability.fingerprint)) {
      return invalid("STABILITY_PROOF_INVALID", ["completeness_proof", "stability"]);
    }
  }
  if (!snapshot.platform_content_id) return invalid("CONTENT_ID_REQUIRED", ["platform_content_id"]);
  if (proof.platform_content_id !== snapshot.platform_content_id) return invalid("CONTENT_ID_MISMATCH", ["completeness_proof", "platform_content_id"]);
  if (snapshot.relations?.length) return invalid("SINGLE_ITEM_RELATIONS_PRESENT", ["relations"]);
  if (snapshot.access_class !== "public_free" && snapshot.access_class !== "login_public_free") return invalid("ACCESS_NOT_PUBLIC", ["access_class"]);

  const blockableAssets = snapshot.assets.filter(asset => BLOCKABLE_ROLES.has(asset.role));
  if (snapshot.assets.some(asset => asset.role !== "cover" && asset.availability !== "available")) {
    return invalid("SOURCE_ASSET_UNAVAILABLE", ["assets"]);
  }
  const assetIds = blockableAssets.map(asset => asset.id);
  const assetSet = new Set(assetIds);
  if (assetSet.size !== assetIds.length) return invalid("SOURCE_ASSET_ID_DUPLICATE", ["assets"]);

  const externalFileAsset = externalFileAssetId === undefined
    ? undefined
    : snapshot.assets.find(asset => asset.id === externalFileAssetId);
  if (externalFileAssetId !== undefined && !externalFileAsset) {
    return invalid("EXTERNAL_FILE_ASSET_MISSING", ["completeness_proof", "external_file_asset_id"]);
  }
  if (externalFileAsset && externalFileAsset.role !== "file") {
    return invalid("EXTERNAL_FILE_ASSET_ROLE_INVALID", ["completeness_proof", "external_file_asset_id"]);
  }

  const blockRefs = snapshot.blocks.flatMap(block =>
    block.type === "image" || block.type === "video" || block.type === "audio" || block.type === "file" ? [block.asset_id] : [],
  );
  const blockRefSet = new Set(blockRefs);
  if (blockRefSet.size !== blockRefs.length) return invalid("BLOCK_ASSET_REF_DUPLICATE", ["blocks"]);
  if (externalFileAssetId !== undefined && blockRefSet.has(externalFileAssetId)) {
    return invalid("EXTERNAL_FILE_ASSET_IN_BODY", ["blocks"]);
  }
  const orderedAssetSet = new Set(assetIds.filter(id => id !== externalFileAssetId));
  if (!sameSet(orderedAssetSet, blockRefSet)) return invalid("BLOCK_ASSET_SET_MISMATCH", ["blocks"]);
  if (proof.ordered_asset_count !== blockRefSet.size) return invalid("ORDERED_ASSET_COUNT_MISMATCH", ["completeness_proof", "ordered_asset_count"]);

  if (binding) {
    if (binding.adapter.id !== snapshot.platform) return invalid("ADAPTER_ID_MISMATCH", ["platform"]);
    if (binding.adapter.version !== snapshot.adapter_version) return invalid("ADAPTER_VERSION_MISMATCH", ["adapter_version"]);
    const rule = binding.adapter.completion_rules?.find(candidate => candidate.id === proof.rule_id);
    if (!rule) return invalid("COMPLETION_RULE_UNKNOWN", ["completeness_proof", "rule_id"]);
    if (rule.boundary !== proof.boundary) return invalid("COMPLETION_BOUNDARY_MISMATCH", ["completeness_proof", "boundary"]);
    if (rule.external_file_attachment && externalFileAssetId === undefined) return invalid("EXTERNAL_FILE_ASSET_REQUIRED", ["completeness_proof", "external_file_asset_id"]);
    if (!rule.external_file_attachment && externalFileAssetId !== undefined) return invalid("EXTERNAL_FILE_ASSET_UNDECLARED", ["completeness_proof", "external_file_asset_id"]);
    if (rule.stability && (!Number.isInteger(rule.stability.sample_count) || rule.stability.sample_count < 2 || rule.stability.sample_count > 8
      || !Number.isInteger(rule.stability.minimum_window_ms) || rule.stability.minimum_window_ms < 1 || rule.stability.minimum_window_ms > 60_000)) {
      return invalid("STABILITY_RULE_INVALID", ["completeness_proof", "rule_id"]);
    }
    if (rule.stability && !stability) return invalid("STABILITY_PROOF_REQUIRED", ["completeness_proof", "stability"]);
    if (!rule.stability && stability) return invalid("STABILITY_PROOF_UNDECLARED", ["completeness_proof", "stability"]);
    if (rule.stability && stability && stability.sample_count < rule.stability.sample_count) return invalid("STABILITY_SAMPLE_COUNT_INSUFFICIENT", ["completeness_proof", "stability", "sample_count"]);
    if (rule.stability && stability && stability.window_ms < rule.stability.minimum_window_ms) return invalid("STABILITY_WINDOW_INSUFFICIENT", ["completeness_proof", "stability", "window_ms"]);
    if (!rule.content_types.includes(snapshot.content_type)) return invalid("CONTENT_TYPE_NOT_ALLOWED", ["content_type"]);
    if (!binding.urls.length || binding.urls.some(url => {
      try {
        return !binding.adapter.match(url) || !rule.matches(url, proof.platform_content_id);
      } catch {
        return true;
      }
    })) return invalid("COMPLETION_ROUTE_MISMATCH", ["completeness_proof", "rule_id"]);
  }

  return { valid: true, complete: true };
}

export function contentSnapshotIsComplete(snapshot: ContentSnapshot): boolean {
  const evaluation = evaluateContentCompleteness(snapshot);
  return evaluation.valid && evaluation.complete;
}
