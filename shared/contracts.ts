/** Data from a source page is untrusted content, never an instruction channel. */
export type SaveAs = "auto" | "document" | "video" | "audio" | "images" | "subtitles" | "files" | "bundle";
export type SaveComponent = "text" | "images" | "video" | "audio" | "subtitles" | "cover" | "files";
export type ContentType = "article" | "post" | "thread" | "image_note" | "video" | "audio" | "mixed";
export type Availability = "available" | "not_present" | "unknown" | "blocked" | "unsupported";
export type JobStatus = "queued" | "resolving" | "collecting" | "downloading" | "finalizing" | "verifying" | "blocked" | "succeeded" | "partial" | "failed" | "cancelled";
export type AccessClass = "public_free" | "login_public_free" | "paid" | "private" | "unknown";

/**
 * Adapter-generated proof that one supported source item was exhausted during
 * this capture. Selectors and page text never cross the bridge in this proof.
 */
export interface ContentCompletenessProof {
  version: 1;
  scope: "single_item";
  /** Generic HTTP/DOM receipts certify the current page, without site-specific terminal rules. */
  method: "adapter_bounded_dom" | "http_page_capture" | "browser_page_capture";
  rule_id: string;
  platform_content_id: string;
  boundary: "root_exhausted" | "terminal_observed" | "response_received" | "dom_read";
  pending_marker_count: 0;
  ordered_asset_count: number;
  unplaced_asset_count: 0;
  /** One adapter-declared file attachment outside ordered body content. */
  external_file_asset_id?: string;
  /** Present only when the named adapter rule requires repeated stable observations. */
  stability?: {
    sample_count: number;
    window_ms: number;
    /** Lowercase SHA-256 emitted by trusted adapter code after equal samples. */
    fingerprint: string;
  };
}

export interface ResultSelection {
  reason: "mixed_content";
  prompt: string;
  options: { save_as: Exclude<SaveAs, "auto">; label: string }[];
}

export type Target =
  | { type: "url"; url: string }
  | { type: "tab"; instance_ref: string; tab_id: number };

/** Optional explicit user choices. Omitted values use daily-playback defaults. */
export interface SavePreferences {
  audio_format?: "m4a" | "mp3" | "wav" | "flac";
  video_format?: "mp4" | "mkv";
  /** Exact source height, without silently upscaling or selecting a lower rendition. */
  video_height?: number;
  subtitle_languages?: string[];
  /** One-based image positions in source order, only when the user selects specific images. */
  image_indices?: number[];
  clip?: { start_seconds: number; end_seconds: number };
}

export interface CollectRequest {
  target: Target;
  save_as?: SaveAs;
  include?: SaveComponent[];
  preferences?: SavePreferences;
  output: { directory: string; collision_policy?: "version" | "fail" };
  browser?: { instance_ref?: string; tab_strategy?: "auto" | "existing" | "new"; allow_focus?: boolean };
  limits?: { max_items?: number; max_related_items?: number; max_bytes?: number };
  idempotency_key?: string;
}

export interface SourceAsset {
  id: string;
  role: "image" | "video" | "audio" | "subtitle" | "cover" | "file";
  /** Fetch URL may be signed; never persist or expose it in MCP results. */
  url: string;
  order: number;
  media_type?: string;
  title?: string;
  language?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  quality?: string;
  /** Public/reference URL safe for metadata and MCP output. */
  source_url?: string;
  availability: Availability;
  note?: string;
}

export type ContentBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph" | "quote"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "math"; text: string; format: "latex" | "text" }
  | { type: "table"; caption?: string; rows: { text: string; header: boolean; colspan?: number; rowspan?: number }[][] }
  | { type: "image" | "video" | "audio" | "file"; asset_id: string; caption?: string }
  | { type: "list"; ordered: boolean; items: string[] };

export interface ContentSnapshot {
  schema_version: "1";
  platform: string;
  adapter_version: string;
  source_url: string;
  canonical_url: string;
  platform_content_id?: string;
  content_type: ContentType;
  title?: string;
  authors: string[];
  published_at: string | null;
  language?: string;
  blocks: ContentBlock[];
  assets: SourceAsset[];
  /**
   * Explicit, bounded source relations. Related content is kept separate from
   * the target's text, author list, and assets so replies or quoted authors
   * cannot silently become part of the requested post.
   */
  relations?: ContentRelation[];
  access_class: AccessClass;
  completeness: "complete" | "partial" | "unknown";
  /** Required when `completeness` is `complete`; absent for legacy partial captures. */
  completeness_proof?: ContentCompletenessProof;
  warnings: string[];
  /** Extension-generated evidence labels only, not page-supplied instructions. */
  evidence?: string[];
}

export interface ContentRelation {
  type: "author_continuation" | "quote" | "repost";
  /** The observed source item that points to `to_content_id`. */
  from_content_id: string;
  /** Stable source-platform identifier, never a guessed title or author. */
  to_content_id: string;
  /** Source order within this bounded relation result. */
  order: number;
  /** Safe, public reference URL for the related content. */
  source_url: string;
  /** Kept separate from the target's authors, including for quotes/reposts. */
  authors: string[];
  published_at: string | null;
  content_type: ContentType;
  blocks: ContentBlock[];
  /** IDs are relation-scoped and must not collide with target asset IDs. */
  assets: SourceAsset[];
  completeness: "partial" | "unknown";
  /** Adapter-generated provenance only; source page text is never evidence. */
  evidence: string[];
}

export interface AdapterDefinition {
  id: string;
  version: string;
  hosts: string[];
  supported_url_patterns?: string[];
  asset_hosts?: string[];
  /** Adapter-owned HTTPS asset ports for observed CDN hosts; never supplied by an MCP request. */
  asset_https_ports?: { host: string; ports: number[] }[];
  engine?: "yt-dlp" | "direct" | "browser";
  validation_status?: "unverified" | "fixture_verified" | "browser_verified";
  content_types: ContentType[];
  /** Shipped source policy, never a claim accepted from a page or MCP caller. */
  required_document_components?: SaveComponent[];
  /** Route-scoped shipped component policy; never supplied by page or MCP data. */
  document_components_for_url?: (url: URL) => readonly SaveComponent[];
  status: "implemented" | "experimental" | "review_required";
  match(url: URL): boolean;
  /** Trusted adapter-owned bindings for per-capture completeness proofs. */
  completion_rules?: CompletionRuleDefinition[];
}

export interface CompletionRuleDefinition {
  id: string;
  content_types: ContentType[];
  boundary: ContentCompletenessProof["boundary"];
  /** Trusted adapter policy; never supplied by a page or MCP request. */
  stability?: { sample_count: number; minimum_window_ms: number };
  /** This rule requires one separately proved, body-external file attachment. */
  external_file_attachment?: true;
  /** Must bind both the supported route and its adapter-derived content id. */
  matches(url: URL, platformContentId: string): boolean;
}

export interface AdapterRegistry {
  match(url: URL): AdapterDefinition | undefined;
  list(): AdapterDefinition[];
}

export interface Artifact {
  role: string;
  path: string;
  media_type: string;
  size: number;
  sha256: string;
  source_asset_id?: string;
  /** SHA-256 of credential-free source identity; used to reject stale bytes after a fresh capture. */
  source_fingerprint?: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
  language?: string;
  /** Executed local media operations, recorded after successful output validation. */
  media_processing?: {
    output_container: "m4a" | "mp3" | "wav" | "flac" | "mp4" | "mkv";
    input_count: number;
    audio?: "copy" | "transcode";
    video?: "copy" | "transcode";
    extracted_audio: boolean;
    merged_tracks: boolean;
    clip?: { start_seconds: number; end_seconds: number };
  };
  media_validation?: {
    full_decode: true;
    expected_duration_seconds: number;
    source_duration_verified: boolean;
    bounded_engine_item: boolean;
  };
}

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
  dependency?: string;
  /** Trusted engine wait signal, in milliseconds. The job policy caps the actual wait. */
  retry_after_ms?: number;
}

export interface JobRecord {
  id: string;
  client_id: string;
  request: CollectRequest;
  status: JobStatus;
  stage: JobStatus;
  created_at: string;
  updated_at: string;
  snapshot?: ContentSnapshot;
  artifacts: Artifact[];
  completeness: { requested_components_complete: boolean; scope: "single_item" | "bounded_related" | "unknown" };
  warnings: string[];
  error?: JobError;
  /** Present only when the main content cannot determine a useful default. */
  selection_required?: ResultSelection;
  artifact_root?: string;
  checkpoint?: {
    workspace?: string;
    completed_components?: SaveComponent[];
    failed_components?: Record<string, string>;
    media_files?: Record<string, string[]>;
    /** Exact runtime-generated temporary files; expiry removes only unchanged entries. */
    temporary_artifacts?: { path: string; size: number; sha256: string }[];
    requires_fresh_url?: boolean;
  };
  attempts: number;
  /** Automatic retries across restarts; manual resume does not reset this budget. */
  automatic_retries?: number;
  /** Durable scheduled retry, cleared when it starts or is cancelled. */
  retry_at?: string;
  checkpoint_saved_at?: string;
  checkpoint_expired_at?: string;
  diagnostics_saved_at?: string;
  /** SHA-256 of the original request, without storing credential-bearing URL parameters. */
  request_fingerprint?: string;
}

/** Implemented by runtime/collection; owned by the collection subsystem. */
export interface CollectionExecutor {
  execute(job: JobRecord, signal: AbortSignal, checkpoint: (patch: Partial<JobRecord>) => Promise<void>): Promise<Partial<JobRecord>>;
}
