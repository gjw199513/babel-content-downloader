import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContentBlock, ContentSnapshot, JobRecord, SourceAsset } from "../../shared/contracts.js";

const JOB_ID = /^job_[a-f0-9-]{36}$/;

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    const identityParams = new URLSearchParams();
    for (const key of ["p", "v", "id", "vid", "bvid", "aid", "story_fbid", "fbid", "page"]) {
      const value = url.searchParams.get(key);
      if (value && /^[A-Za-z0-9_-]{1,100}$/.test(value)) identityParams.set(key, value);
    }
    if (url.hostname === "mp.weixin.qq.com") {
      const biz = url.searchParams.get("__biz");
      const mid = url.searchParams.get("mid");
      const idx = url.searchParams.get("idx");
      const sn = url.searchParams.get("sn");
      if (biz && /^[A-Za-z0-9+/_=-]{8,128}$/.test(biz)) identityParams.set("__biz", biz);
      if (mid && /^\d{1,20}$/.test(mid)) identityParams.set("mid", mid);
      if (idx && /^\d{1,3}$/.test(idx)) identityParams.set("idx", idx);
      if (sn && /^[a-fA-F0-9]{16,64}$/.test(sn)) identityParams.set("sn", sn);
    }
    url.search = identityParams.toString();
    url.hash = "";
    return url.toString();
  } catch { return "[invalid-url]"; }
}

export function redactSensitiveText(raw: string): string {
  const credentialKey = /^(?:token|signature|sig|auth|key|secret|access_token|xsec_token|expires|session|sessionid|session_id|cookie|api_key|api_token|client_secret)$/i;
  return raw.replace(/https?:\/\/[^\s<>"']+/g, (value) => {
    const suffix = /[),.;!?]+$/.exec(value)?.[0] ?? "";
    const address = suffix ? value.slice(0, -suffix.length) : value;
    try {
      const url = new URL(address);
      const sensitive = Boolean(url.username || url.password || [...url.searchParams.keys()].some((key) => credentialKey.test(key)));
      if (!sensitive) return value;
      url.username = "";
      url.password = "";
      for (const key of [...url.searchParams.keys()]) if (credentialKey.test(key)) url.searchParams.delete(key);
      return url.toString() + suffix;
    } catch { return value; }
  }).replace(/\b(token|signature|sig|auth|key|secret|access_token|xsec_token|expires|session|sessionid|session_id|cookie|api_key|api_token)=([^\s&;]+)/gi, "$1=[redacted]");
}

function sanitizeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => block.type === "table"
    ? { ...block, caption: block.caption ? redactSensitiveText(block.caption) : undefined, rows: block.rows.map(row => row.map(cell => ({ ...cell, text: redactSensitiveText(cell.text) }))) }
    : block.type === "list"
    ? { ...block, items: block.items.map(redactSensitiveText) }
    : "text" in block
      ? { ...block, text: redactSensitiveText(block.text) }
      : { ...block, caption: block.caption ? redactSensitiveText(block.caption) : undefined });
}

function sanitizeAssets(assets: SourceAsset[]): SourceAsset[] {
  return assets.map((asset) => ({ ...asset, url: redactUrl(asset.source_url ?? asset.url), source_url: asset.source_url ? redactUrl(asset.source_url) : undefined, title: asset.title ? redactSensitiveText(asset.title) : undefined, note: asset.note ? redactSensitiveText(asset.note) : undefined }));
}

export function sanitizeSnapshot(snapshot: ContentSnapshot): ContentSnapshot {
  return {
    ...snapshot,
    source_url: redactUrl(snapshot.source_url),
    canonical_url: redactUrl(snapshot.canonical_url),
    title: snapshot.title ? redactSensitiveText(snapshot.title) : undefined,
    authors: snapshot.authors.map(redactSensitiveText),
    blocks: sanitizeBlocks(snapshot.blocks),
    assets: sanitizeAssets(snapshot.assets),
    relations: snapshot.relations?.map(relation => ({ ...relation, source_url: redactUrl(relation.source_url), authors: relation.authors.map(redactSensitiveText), blocks: sanitizeBlocks(relation.blocks), assets: sanitizeAssets(relation.assets), evidence: relation.evidence.map(value => redactSensitiveText(value.slice(0, 200))) })),
    evidence: snapshot.evidence?.map((e) => redactSensitiveText(e.slice(0, 200))),
    warnings: snapshot.warnings.map(redactSensitiveText),
  };
}

export function publicJob(job: JobRecord): JobRecord {
  const result = structuredClone(job);
  if (result.request.target.type === "url") result.request.target.url = redactUrl(result.request.target.url);
  if (result.snapshot) result.snapshot = sanitizeSnapshot(result.snapshot);
  result.warnings = result.warnings.map(redactSensitiveText);
  if (result.error) result.error.message = redactSensitiveText(result.error.message);
  return result;
}

export class JobStore {
  constructor(readonly directory: string) {}

  async init(): Promise<void> { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700); }

  private path(id: string): string {
    if (!JOB_ID.test(id)) throw new Error("Invalid job ID");
    return join(this.directory, `${id}.json`);
  }

  async get(id: string): Promise<JobRecord | undefined> {
    try { return JSON.parse(await readFile(this.path(id), "utf8")) as JobRecord; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async list(): Promise<JobRecord[]> {
    await this.init();
    const names = (await readdir(this.directory)).filter((n) => JOB_ID.test(n.replace(/\.json$/, "")) && n.endsWith(".json"));
    const jobs = await Promise.all(names.map((name) => this.get(name.slice(0, -5))));
    return jobs.filter((job): job is JobRecord => Boolean(job)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async put(job: JobRecord): Promise<void> {
    await this.init();
    const path = this.path(job.id);
    const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    const stored = structuredClone(job);
    if (stored.request.target.type === "url") {
      const clean = redactUrl(stored.request.target.url);
      if (clean !== stored.request.target.url) stored.checkpoint = { ...stored.checkpoint, requires_fresh_url: true };
      stored.request.target.url = clean;
    }
    if (stored.snapshot) stored.snapshot = sanitizeSnapshot(stored.snapshot);
    stored.warnings = stored.warnings.map(redactSensitiveText);
    if (stored.error) stored.error.message = redactSensitiveText(stored.error.message);
    if (stored.checkpoint?.failed_components) stored.checkpoint.failed_components = Object.fromEntries(Object.entries(stored.checkpoint.failed_components).map(([key, message]) => [key, redactSensitiveText(message)]));
    await writeFile(temp, JSON.stringify(stored, null, 2) + "\n", { mode: 0o600 });
    await rename(temp, path);
  }
}
