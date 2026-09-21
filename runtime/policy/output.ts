import { randomBytes } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

function contained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export async function assertAuthorizedDirectory(directory: string, allowedRoots: string[]): Promise<string> {
  if (!isAbsolute(directory)) throw new Error("OUTPUT_ABSOLUTE_REQUIRED");
  const target = resolve(directory);
  const roots = await Promise.all(allowedRoots.map(async (root) => realpath(root)));
  // Existing ancestors are resolved before write, so a symlink cannot escape an allowed root.
  let ancestor = target;
  while (true) {
    try { await lstat(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = resolve(ancestor, "..");
      if (next === ancestor) throw new Error("OUTPUT_PATH_INVALID");
      ancestor = next;
    }
  }
  const actualAncestor = await realpath(ancestor);
  const suffix = relative(ancestor, target);
  const actualTarget = resolve(actualAncestor, suffix);
  if (!roots.some((root) => contained(root, actualTarget))) throw new Error("OUTPUT_NOT_AUTHORIZED");
  return actualTarget;
}

export async function createJobWorkspace(directory: string, allowedRoots: string[], jobId: string): Promise<string> {
  if (!/^job_[a-f0-9-]{36}$/.test(jobId)) throw new Error("Invalid job ID");
  const parent = await assertAuthorizedDirectory(directory, allowedRoots);
  const roots = await Promise.all(allowedRoots.map((root) => realpath(root)));
  const root = roots.find((allowed) => contained(allowed, parent));
  if (!root) throw new Error("OUTPUT_NOT_AUTHORIZED");
  let current = root;
  const segments = [...relative(root, parent).split(sep).filter(Boolean), ".babel-content", jobId];
  for (const segment of segments) {
    const next = join(current, segment);
    try { await mkdir(next, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const info = await lstat(next);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("OUTPUT_NOT_AUTHORIZED");
    current = await realpath(next);
    if (!contained(root, current)) throw new Error("OUTPUT_NOT_AUTHORIZED");
  }
  return current;
}

export function safeJoin(root: string, name: string): string {
  if (!name || name !== basename(name) || name === "." || name === ".." || name.includes("\0")) throw new Error("UNSAFE_FILENAME");
  const candidate = resolve(root, name);
  if (!contained(resolve(root), candidate)) throw new Error("UNSAFE_FILENAME");
  return candidate;
}

export function safeFileStem(value: string, fallback = "content"): string {
  const stem = value.normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/^\.+|\.+$/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  return stem && !reserved.test(stem) ? stem : `${fallback}-${randomBytes(3).toString("hex")}`;
}
