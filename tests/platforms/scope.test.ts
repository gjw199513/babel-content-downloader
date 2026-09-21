import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface ExtensionManifest {
  host_permissions: string[];
  content_scripts: Array<{ matches: string[] }>;
}

const REMOVED_PAGE_DOMAIN_SUFFIXES = [
  "douyin.com",
  "kuaishou.com",
  "channels.weixin.qq.com",
  "weibo.com",
  "toutiao.com",
  "ixigua.com",
  "baijiahao.baidu.com",
  "163.com",
  "sohu.com",
  "page.om.qq.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "threads.com",
  "pinterest.com",
  "linkedin.com",
  "jianshu.com",
  "csdn.net",
  "juejin.cn",
  "cnblogs.com",
  "douban.com",
  "bsky.app",
  "tumblr.com",
  "quora.com",
  "wordpress.com",
  "vimeo.com",
  "dailymotion.com",
  "twitch.tv",
  "acfun.cn",
] as const;

describe("extension platform scope", () => {
  it("does not grant page access to any removed platform domain", async () => {
    const manifest = JSON.parse(await readFile(new URL("../../extension/manifest.json", import.meta.url), "utf8")) as ExtensionManifest;
    const contentMatches = manifest.content_scripts.flatMap(entry => entry.matches);
    const pagePermissions = manifest.host_permissions.filter(pattern => !pattern.startsWith("http://127.0.0.1:"));

    expect(new Set(pagePermissions)).toEqual(new Set(contentMatches));
    for (const pattern of [...manifest.host_permissions, ...contentMatches]) {
      for (const domain of REMOVED_PAGE_DOMAIN_SUFFIXES) {
        expect(pattern, `${pattern} must not retain access to ${domain}`).not.toContain(domain);
      }
    }
  });
});
