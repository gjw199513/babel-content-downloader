import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface VersionFile { version?: unknown }

function readVersion(path: string): string | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as VersionFile;
    return typeof value.version === "string" && value.version.length > 0 ? value.version : undefined;
  } catch {
    return undefined;
  }
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(moduleDirectory, "../build-info.json"),
  join(moduleDirectory, "../dist/build-info.json"),
  join(moduleDirectory, "../package.json"),
  join(moduleDirectory, "../../package.json"),
];

/** One release identity shared by the extension, runtime and MCP server. */
export const PRODUCT_VERSION = candidates.filter(existsSync).map(readVersion).find((value): value is string => value !== undefined) ?? "0.1.26";
export const VERSION_CONTROL_SCHEMA = "babel.content-downloader.version.v1" as const;
