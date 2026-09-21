import { shouldCaptureWebPage } from '../web/http-capture.js';
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AdapterRegistry, CollectRequest } from "../../shared/contracts.js";
import { BrowserBridge } from "../bridge/server.js";
import type { BrowserObservation } from "../../shared/bridge-protocol.js";
import { checkDependencies } from "../diagnostics/dependencies.js";
import { JobManager } from "../jobs/manager.js";
import { redactSensitiveText, redactUrl } from "../storage/job-store.js";
import { summarizeJob } from "./presentation.js";
import type { MediaToolPaths } from "../policy/config.js";
import { PRODUCT_VERSION, VERSION_CONTROL_SCHEMA } from "../version.js";
import { ASR_GUIDE, asrGuideMarkdown } from "../asr/guide.js";

const url = z.url().refine((value) => /^https?:\/\//i.test(value), "Only HTTP and HTTPS targets are allowed");
const targetSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("url"), url }),
  z.strictObject({ type: z.literal("tab"), instance_ref: z.string().min(1), tab_id: z.number().int().nonnegative() }),
]);
const componentSchema = z.enum(["text", "images", "video", "audio", "subtitles", "cover", "files"]);
const saveAsSchema = z.enum(["auto", "document", "video", "audio", "images", "subtitles", "files", "bundle"]);
const preferencesSchema = z.strictObject({
  audio_format: z.enum(["m4a", "mp3", "wav", "flac"]).optional(),
  video_format: z.enum(["mp4", "mkv"]).optional(),
  video_height: z.number().int().positive().max(8640).optional(),
  subtitle_languages: z.array(z.string().regex(/^[a-zA-Z]{2,8}(?:[-_][a-zA-Z0-9]{1,8})*$/)).min(1).max(20).optional(),
  image_indices: z.array(z.number().int().positive().max(2000)).min(1).max(100).optional(),
  clip: z.strictObject({ start_seconds: z.number().nonnegative(), end_seconds: z.number().positive() })
    .refine(value => value.end_seconds > value.start_seconds, "Clip end must be after its start").optional(),
});
const collectSchema = z.strictObject({
  target: targetSchema,
  save_as: saveAsSchema.optional(),
  include: z.array(componentSchema).min(1).optional(),
  preferences: preferencesSchema.optional(),
  output: z.strictObject({ directory: z.string().min(1), collision_policy: z.enum(["version", "fail"]).optional() }),
  browser: z.strictObject({ instance_ref: z.string().optional(), tab_strategy: z.enum(["auto", "existing", "new"]).optional(), allow_focus: z.boolean().optional() }).optional(),
  limits: z.strictObject({ max_items: z.number().int().min(1).max(100).optional(), max_related_items: z.number().int().min(0).max(100).optional(), max_bytes: z.number().int().positive().optional() }).optional(),
  idempotency_key: z.string().min(1).max(128).optional(),
}).refine((request) => !(request.save_as && request.include), "Use save_as or include, not both");
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scroll"), delta_y: z.number().int().min(-3000).max(3000) }),
  z.object({ type: z.literal("expand"), target_id: z.string().min(1).max(120) }),
  z.object({ type: z.literal("play"), target_id: z.string().min(1).max(120) }),
  z.object({ type: z.literal("navigate"), url }),
]);

function success(value: unknown, short: string) {
  return { content: [{ type: "text" as const, text: short }], structuredContent: JSON.parse(JSON.stringify(value)) as Record<string, unknown> };
}

function failure(error: unknown) {
  const e = error as { code?: string; message?: string; retryable?: boolean };
  const value = { code: e.code ?? (e.message?.match(/^[A-Z_]+$/) ? e.message : "TOOL_FAILED"), message: redactSensitiveText(e.message ?? String(error)), retryable: e.retryable ?? false };
  return { content: [{ type: "text" as const, text: `${value.code}: ${value.message}` }], structuredContent: value, isError: true };
}

function publicDiagnostic(diagnostic: NonNullable<BrowserObservation["diagnostic"]>): NonNullable<BrowserObservation["diagnostic"]> {
  // Keep the MCP response an explicit whitelist even though bridge validation
  // already rejects unknown diagnostic fields. This prevents a future bridge
  // extension from accidentally turning an observation into a DOM export.
  return {
    version: diagnostic.version,
    plan_id: diagnostic.plan_id,
    platform_content_id: diagnostic.platform_content_id,
    roots: diagnostic.roots.map(root => ({
      id: root.id,
      visible_match_count: root.visible_match_count,
      count_truncated: root.count_truncated,
      selected: root.selected,
    })),
    unique_visible_root_count: diagnostic.unique_visible_root_count,
    root_count_truncated: diagnostic.root_count_truncated,
    ...(diagnostic.outline ? {
      outline: {
        nodes: diagnostic.outline.nodes.map(node => ({
          node_index: node.node_index,
          ...(node.parent_node_index === undefined ? {} : { parent_node_index: node.parent_node_index }),
          depth: node.depth,
          kinds: [...node.kinds],
          tag: node.tag,
          ...(node.id === undefined ? {} : { id: node.id }),
          ...(node.class_tokens === undefined ? {} : { class_tokens: [...node.class_tokens] }),
          ...(node.test_id === undefined ? {} : { test_id: node.test_id }),
          ...(node.role === undefined ? {} : { role: node.role }),
          ...(node.input_type === undefined ? {} : { input_type: node.input_type }),
          ...(node.chain_truncated === true ? { chain_truncated: true as const } : {}),
        })),
        truncated: diagnostic.outline.truncated,
      },
    } : {}),
    truncated: diagnostic.truncated,
  };
}

/** Explicit MCP presentation whitelist for an already schema-validated observation. */
export function publicObservation(observation: BrowserObservation): BrowserObservation {
  return {
    instance_id: observation.instance_id,
    tab_id: observation.tab_id,
    url: redactUrl(observation.url),
    title: redactSensitiveText(observation.title),
    origin: observation.origin,
    ...(observation.adapter_id === undefined ? {} : { adapter_id: observation.adapter_id }),
    ...(observation.access_class === undefined ? {} : { access_class: observation.access_class }),
    action_targets: observation.action_targets?.map((target) => ({ ...target, label: redactSensitiveText(target.label) })),
    ...(observation.diagnostic ? { diagnostic: publicDiagnostic(observation.diagnostic) } : {}),
    evidence: observation.evidence.map(redactSensitiveText),
  };
}

export interface McpServices { jobs: JobManager; bridge: BrowserBridge; registry: AdapterRegistry; mediaTools?: MediaToolPaths }

/** A fresh MCP server is built per HTTP request, with shared jobs and bridge closed over. */
export function makeMcpHandler(services: McpServices) {
  return createMcpHandler(({ authInfo }) => {
    const server = new McpServer({ name: "babel-content-downloader", version: PRODUCT_VERSION });
    const clientId = authInfo?.clientId;
    function requireClient(): string { if (!clientId) throw new Error("CLIENT_UNAUTHORIZED"); return clientId; }

    server.registerTool("update_mcp", {
      description: "Check the extension and local runtime package versions. The stdio MCP wrapper applies a matching runtime update without deleting pairing, jobs or saved files.",
      inputSchema: z.object({}).strict(),
    }, async () => {
      const bridge = services.bridge.status();
      const extensionVersions = bridge.instances.map((instance) => instance.version);
      const compatible = extensionVersions.length === 0 || extensionVersions.every((version) => version === PRODUCT_VERSION);
      const value = {
        updated: false,
        action: compatible ? "already_current" : "runtime_update_required",
        schema_version: VERSION_CONTROL_SCHEMA,
        mcp_version: PRODUCT_VERSION,
        runtime_version: PRODUCT_VERSION,
        extension_versions: extensionVersions,
        compatible,
        update_required: !compatible,
        next_step: compatible
          ? "No runtime update is required."
          : "Call update_mcp again through the stdio MCP wrapper after installing the matching runtime package, then reload the existing extension card.",
      };
      return success(value, JSON.stringify(value));
    });

    server.registerTool("babel_content_get_asr_guide", {
      description: "Read the Agent-side local ASR guide. This tool only returns the fixed model, file, security and output contract; it never downloads media, installs dependencies or runs ASR.",
      inputSchema: z.strictObject({ format: z.enum(["structured", "markdown"]).default("structured") }),
    }, async ({ format }) => {
      const value = format === "markdown" ? { topic: ASR_GUIDE.topic, guide_markdown: asrGuideMarkdown() } : ASR_GUIDE;
      return success(value, "ASR guide returned; processing remains the Agent's local responsibility.");
    });

    server.registerTool("babel_content_check", {
      description: "Check runtime, paired browser, adapter registration and optional media dependencies without starting a download.",
      inputSchema: z.object({ target: targetSchema.optional(), save_as: saveAsSchema.optional() }),
    }, async ({ target, save_as }) => {
      try {
        const client = requireClient();
        const registered = target?.type === "url" ? services.registry.match(new URL(target.url)) : undefined;
        const directWeb = target ? shouldCaptureWebPage({ target, save_as, output: { directory: "" } }, registered) : false;
        const adapter = directWeb ? { id: "web_page", status: "experimental", validation_status: "unverified" } : registered;
        const bridgeStatus = services.bridge.status();
        const extensionVersions = bridgeStatus.instances.map((instance) => instance.version);
        const compatible = extensionVersions.length === 0 || extensionVersions.every((version) => version === PRODUCT_VERSION);
        const result = { client_id: client, connection_state: directWeb ? "ready_http" : bridgeStatus.connected ? "connected" : "waiting_browser", browser_required: !directWeb, bridge: bridgeStatus, version_control: { schema_version: VERSION_CONTROL_SCHEMA, mcp_version: PRODUCT_VERSION, runtime_version: PRODUCT_VERSION, extension_versions: extensionVersions, compatible, update_required: !compatible }, adapter: adapter ? { id: adapter.id, status: adapter.status, validation_status: adapter.validation_status ?? "unverified" } : null, dependencies: await checkDependencies(save_as, services.mediaTools), note: target?.type === "url" && !adapter ? "Target platform is not registered" : undefined };
        return success(result, "Runtime check complete; inspect structured status for browser, platform and dependencies.");
      } catch (error) { return failure(error); }
    });

    server.registerTool("babel_content_collect", {
      description: "Save one explicit content target as a readable, watchable or listenable local result. Returns a persistent job reference immediately.",
      inputSchema: collectSchema,
    }, async (request) => {
      try {
        const job = await services.jobs.submit(requireClient(), request as CollectRequest);
        return success({ job_id: job.id, status: job.status, next_action: job.status === "queued" ? "poll_job" : "inspect_job", poll_after_ms: 2000 }, `Collection job ${job.id}: ${job.status}.`);
      } catch (error) { return failure(error); }
    });

    server.registerTool("babel_content_job_get", { description: "Read one authorized job's status, completeness, recovery details and a page of local file references. Full collected content stays in local files.", inputSchema: z.object({ job_id: z.string(), artifact_offset: z.number().int().min(0).default(0), artifact_limit: z.number().int().min(1).max(50).default(10) }) }, async ({ job_id, artifact_offset, artifact_limit }) => {
      try { const job = await services.jobs.get(requireClient(), job_id); if (!job) throw new Error("JOB_NOT_FOUND"); return success(summarizeJob(job, { artifactOffset: artifact_offset, artifactLimit: artifact_limit }), `Job ${job.id}: ${job.status}.`); }
      catch (error) { return failure(error); }
    });

    server.registerTool("babel_content_job_resume", { description: "Recheck and continue a blocked, failed or partial job. When job_get returns selection_required, pass one of its save_as options to continue the same job. Supply a fresh URL for the same content if an expiring URL was redacted after restart.", inputSchema: z.strictObject({ job_id: z.string(), refreshed_url: url.optional(), save_as: z.enum(["document", "video", "audio", "images", "subtitles", "files", "bundle"]).optional() }) }, async ({ job_id, refreshed_url, save_as }) => {
      try { const job = await services.jobs.resume(requireClient(), job_id, refreshed_url, save_as); return success({ job_id: job.id, status: job.status, next_action: "poll_job", poll_after_ms: 2000 }, `Job ${job.id} resumed.`); }
      catch (error) { return failure(error); }
    });

    server.registerTool("babel_content_job_cancel", { description: "Cancel one authorized job and stop its active work.", inputSchema: z.object({ job_id: z.string() }) }, async ({ job_id }) => {
      try { const job = await services.jobs.cancel(requireClient(), job_id); return success({ job_id: job.id, status: job.status }, `Job ${job.id}: ${job.status}.`); }
      catch (error) { return failure(error); }
    });

    server.registerTool("babel_content_jobs_list", { description: "List only jobs belonging to this client, with pagination.", inputSchema: z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20) }) }, async ({ offset, limit }) => {
      try { const jobs = await services.jobs.list(requireClient(), offset, limit); return success({ jobs: jobs.map(job => summarizeJob(job, { compact: true })), offset, limit }, `${jobs.length} authorized jobs.`); }
      catch (error) { return failure(error); }
    });

    server.registerTool("babel_content_browser_observe", { description: "Observe the exact page of a client-owned collection job without modifying it.", inputSchema: z.object({ job_id: z.string() }) }, async ({ job_id }, context) => {
      try {
        const client = requireClient();
        const job = await services.jobs.get(client, job_id);
        if (!job) throw new Error("JOB_NOT_FOUND");
        const observation = await services.bridge.observe(job.request.target, job.request.browser?.instance_ref ?? (job.request.target.type === "tab" ? job.request.target.instance_ref : undefined), context.mcpReq.signal, job_id);
        return success(publicObservation(observation), `Observed browser tab ${observation.tab_id}.`);
      } catch (error) { return failure(error); }
    });

    server.registerTool("babel_content_browser_act", { description: "Perform a limited read-oriented action on an existing authorized task tab.", inputSchema: z.object({ job_id: z.string(), action: actionSchema }) }, async ({ job_id, action }, context) => {
      try {
        const job = await services.jobs.get(requireClient(), job_id);
        if (!job) throw new Error("JOB_NOT_FOUND");
        const result = await services.bridge.act(job.request.target, job.request.browser?.instance_ref, action, context.mcpReq.signal, job_id);
        const safe = { action_applied: result.action_applied, observation: result.observation ? publicObservation(result.observation) : undefined };
        return success(safe, `Browser action completed for ${job_id}.`);
      } catch (error) { return failure(error); }
    });
    return server;
  }, { responseMode: "json" });
}
