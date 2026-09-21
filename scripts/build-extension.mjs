import { build } from "esbuild";
import { cp, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const fixturePattern = "http://127.0.0.1:4319/*";

/**
 * @param {string} entryPoint
 * @param {string} outfile
 * @param {"esm" | "iife"} format
 * @param {boolean} devFixtures
 * @returns {import("esbuild").BuildOptions}
 */
function browserBuildOptions(entryPoint, outfile, format, devFixtures) {
  return { bundle: true, platform: "browser", target: "chrome120", minifySyntax: true, define: { __BABEL_DEV_FIXTURES__: devFixtures ? "true" : "false" }, entryPoints: [entryPoint], outfile, format };
}

async function buildExtension(out, devFixtures) {
  await rm(out, { recursive: true, force: true });
  await Promise.all(["background", "content", "welcome", "settings", "ui"].map((dir) => mkdir(join(out, dir), { recursive: true })));
  await build(browserBuildOptions("extension/background/service-worker.ts", join(out, "background/service-worker.js"), "esm", devFixtures));
  await build(browserBuildOptions("extension/content/content-script.ts", join(out, "content/content-script.js"), "iife", devFixtures));
  await build(browserBuildOptions("extension/welcome/index.ts", join(out, "welcome/index.js"), "esm", devFixtures));
  await build(browserBuildOptions("extension/settings/index.ts", join(out, "settings/index.js"), "esm", devFixtures));
  await Promise.all([
    copyFile("extension/welcome/index.html", join(out, "welcome/index.html")),
    copyFile("extension/welcome/style.css", join(out, "welcome/style.css")),
    copyFile("extension/settings/index.html", join(out, "settings/index.html")),
    copyFile("extension/settings/style.css", join(out, "settings/style.css")),
    copyFile("extension/ui/base.css", join(out, "ui/base.css")),
  ]);
  await cp("extension/icons", join(out, "icons"), { recursive: true });
  await cp("extension/_locales", join(out, "_locales"), { recursive: true });
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
  if (devFixtures) {
    manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), fixturePattern])];
    for (const script of manifest.content_scripts ?? []) script.matches = [...new Set([...(script.matches ?? []), fixturePattern])];
  } else {
    manifest.host_permissions = (manifest.host_permissions ?? []).filter((value) => value !== fixturePattern);
    manifest.optional_host_permissions = (manifest.optional_host_permissions ?? []).filter((value) => value !== fixturePattern);
    for (const script of manifest.content_scripts ?? []) script.matches = (script.matches ?? []).filter((value) => value !== fixturePattern);
  }
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

await buildExtension("dist/extension", false);
if (process.env.BABEL_DEV_FIXTURES === "1") await buildExtension("dist/extension-dev", true);
