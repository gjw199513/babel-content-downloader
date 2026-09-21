import { describe, expect, it } from "vitest";
import { createAdapterRegistry } from "../../adapters/registry.js";
import { boundedDomDiagnostic } from "../../adapters/shared-extractors/dom-diagnostic.js";
import type { PageReader, PlatformAdapter } from "../../adapters/types.js";
import { validateBridgeResponse } from "../../runtime/bridge/validation.js";
import type { AccessClass } from "../../shared/contracts.js";
import type { BoundedDomDiagnostic } from "../../shared/bridge-protocol.js";
import { FixtureNode, FixturePageReader, node } from "./fixture-reader.js";

const registry = createAdapterRegistry();

function adapter(id: "medium" | "youtube"): PlatformAdapter {
  const found = registry.get(id);
  if (!found) throw new Error(`Missing adapter ${id}`);
  return found;
}

function diagnostic(
  reader: PageReader,
  platform: PlatformAdapter,
  access: AccessClass = "public_free",
): BoundedDomDiagnostic | undefined {
  return boundedDomDiagnostic(reader, platform, access);
}

function expectBridgeValid(
  reader: FixturePageReader,
  platform: PlatformAdapter,
  access: AccessClass,
  value: BoundedDomDiagnostic,
): void {
  const validation = validateBridgeResponse({
    version: 1,
    request_id: "11111111-1111-4111-8111-111111111111",
    nonce: "0123456789abcdef",
    session_id: "22222222-2222-4222-8222-222222222222",
    ok: true,
    result: {
      observation: {
        instance_id: "fixture-instance",
        tab_id: 7,
        url: reader.location.href,
        title: reader.documentTitle,
        origin: reader.location.origin,
        adapter_id: platform.id,
        access_class: access,
        diagnostic: value,
        evidence: [],
      },
    },
  });
  expect(validation, JSON.stringify(validation)).toMatchObject({ ok: true });
}

function mediumReader(root: FixtureNode): FixturePageReader {
  return new FixturePageReader("https://medium.com/@teacher/learning-systems-abcdef12", "Learning systems")
    .add("article", [root])
    .add("main article", [root]);
}

describe("bounded DOM diagnostics", () => {
  it("binds diagnostics to the exact adapter host and route and de-duplicates YouTube roots", () => {
    const youtube = adapter("youtube");
    const root = node("youtube-root", "ytd-watch-metadata", "SECRET PAGE TEXT", {
      href: "https://secret.invalid/watch",
      "data-secret": "SECRET DATA ATTRIBUTE",
    });
    const hidden = new FixtureNode("youtube-hidden", "ytd-watch-metadata", "HIDDEN SECRET", {}, [], false);
    const reader = new FixturePageReader("https://www.youtube.com/watch?v=abcDEF12345", "Video title")
      .add("ytd-watch-metadata", [root, hidden])
      .add("#above-the-fold ytd-watch-metadata", [root]);

    const result = diagnostic(reader, youtube);
    expect(result).toEqual({
      version: 1,
      plan_id: "youtube.watch.static-root.v1",
      platform_content_id: "abcDEF12345",
      roots: [
        { id: "watch_metadata", visible_match_count: 1, count_truncated: false, selected: true },
        { id: "above_watch_metadata", visible_match_count: 1, count_truncated: false, selected: true },
      ],
      unique_visible_root_count: 1,
      root_count_truncated: false,
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expectBridgeValid(reader, youtube, "public_free", result!);

    const wrongHost = new FixturePageReader("https://example.com/watch?v=abcDEF12345", "Wrong host")
      .add("ytd-watch-metadata", [root]);
    const wrongRoute = new FixturePageReader("https://www.youtube.com/shorts/abcDEF12345", "Wrong route")
      .add("ytd-watch-metadata", [root]);
    expect(diagnostic(wrongHost, youtube)).toBeUndefined();
    expect(diagnostic(wrongRoute, youtube)).toBeUndefined();
  });

  it("emits only the bounded Medium input and figure ancestry for one public root", () => {
    const input = node("fixture-input", "input", "SENSITIVE INPUT TEXT", {
      id: "newsletterEmail",
      class: "newsletter-field invalid/token newsletter-field",
      "data-testid": "newsletterInput",
      role: "textbox",
      type: "email",
      value: "SENSITIVE FORM VALUE",
      name: "SENSITIVE FORM NAME",
      href: "https://secret.invalid/form",
      src: "https://secret.invalid/input",
      "data-secret": "SENSITIVE DATA ATTRIBUTE",
    });
    const form = node("fixture-form", "form", "SENSITIVE FORM TEXT", { class: "newsletter-form" }, [input]);
    const section = node("fixture-section", "section", "SENSITIVE SECTION TEXT", { role: "region" }, [form]);
    const figure = node("fixture-figure", "figure", "SENSITIVE FIGURE TEXT", { class: "story-figure" });
    const root = node("fixture-root", "article", "SENSITIVE ROOT TEXT", { id: "storyRoot" }, [section, figure]);
    const reader = mediumReader(root)
      .add("input", [input], root)
      .add("figure", [figure], root);

    const result = diagnostic(reader, adapter("medium"));
    expect(result?.roots).toEqual([
      { id: "article", visible_match_count: 1, count_truncated: false, selected: true },
      { id: "main_article", visible_match_count: 1, count_truncated: false, selected: true },
    ]);
    expect(result?.unique_visible_root_count).toBe(1);
    expect(result?.outline?.nodes.map(item => ({
      tag: item.tag,
      kinds: item.kinds,
      parent: item.parent_node_index,
      depth: item.depth,
    }))).toEqual([
      { tag: "article", kinds: ["root"], parent: undefined, depth: 0 },
      { tag: "section", kinds: ["ancestor"], parent: 0, depth: 1 },
      { tag: "form", kinds: ["ancestor"], parent: 1, depth: 2 },
      { tag: "input", kinds: ["input"], parent: 2, depth: 3 },
      { tag: "figure", kinds: ["figure"], parent: 0, depth: 1 },
    ]);
    expect(result?.outline?.nodes[3]).toMatchObject({
      id: "newsletterEmail",
      class_tokens: ["newsletter-field"],
      test_id: "newsletterInput",
      role: "textbox",
      input_type: "email",
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of ["SENSITIVE", "secret.invalid", "value", "name", "href", "src", "data-secret"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expectBridgeValid(reader, adapter("medium"), "public_free", result!);
  });

  it("never emits an outline for unknown, paid, private, login, or ambiguous roots", () => {
    const root = node("root", "article", "Body");
    const reader = mediumReader(root);
    const medium = adapter("medium");
    for (const access of ["unknown", "paid", "private", "login_public_free"] as const) {
      const result = diagnostic(reader, medium, access);
      expect(result?.outline).toBeUndefined();
      expectBridgeValid(reader, medium, access, result!);
    }

    const second = node("second-root", "article", "Second body");
    const ambiguous = new FixturePageReader(reader.location.href, "Ambiguous")
      .add("article", [root, second])
      .add("main article", []);
    const result = diagnostic(ambiguous, medium);
    expect(result).toMatchObject({ unique_visible_root_count: 2, root_count_truncated: false });
    expect(result?.roots.every(item => !item.selected)).toBe(true);
    expect(result?.outline).toBeUndefined();
    expectBridgeValid(ambiguous, medium, "public_free", result!);
  });

  it("retains only the six nearest nodes for deep probes and keeps shared-chain schema valid", () => {
    const inputOne = node("input-one", "input", "", { id: "inputOne", type: "email" });
    const branchOne = node("branch-one", "div", "", { id: "branchOne" }, [inputOne]);
    const inputTwo = node("input-two", "input", "", { id: "inputTwo", type: "text" });
    const branchTwo = node("branch-two", "div", "", { id: "branchTwo" }, [inputTwo]);
    const extra = node("extra", "div", "", { id: "extra" }, [branchTwo]);
    const shared = node("shared", "div", "", { id: "shared" }, [branchOne, extra]);
    const f = node("f", "div", "", { id: "levelF" }, [shared]);
    const e = node("e", "div", "", { id: "levelE" }, [f]);
    const d = node("d", "div", "", { id: "levelD" }, [e]);
    const c = node("c", "div", "", { id: "levelC" }, [d]);
    const b = node("b", "div", "", { id: "levelB" }, [c]);
    const a = node("a", "div", "", { id: "levelA" }, [b]);
    const root = node("root", "article", "", { id: "storyRoot" }, [a]);
    const reader = mediumReader(root).add("input", [inputOne, inputTwo], root);

    const result = diagnostic(reader, adapter("medium"));
    const outline = result?.outline;
    expect(outline?.truncated).toBe(true);
    expect(result?.truncated).toBe(true);
    expect(outline?.nodes.filter(item => item.kinds.includes("input"))).toHaveLength(2);
    expect(outline?.nodes.filter(item => item.chain_truncated)).toHaveLength(2);
    expect(outline?.nodes.every(item => item.depth <= 5)).toBe(true);
    expectBridgeValid(reader, adapter("medium"), "public_free", result!);
  });

  it("caps root and probe counts and excludes hidden nodes and their attributes", () => {
    const medium = adapter("medium");
    const manyRoots = Array.from({ length: 49 }, (_, index) => node(`root-${index}`, "article", "", { id: `root${index}` }));
    const rootReader = new FixturePageReader("https://medium.com/@teacher/learning-systems-abcdef12", "Many roots")
      .add("article", manyRoots)
      .add("main article", []);
    const rootResult = diagnostic(rootReader, medium);
    expect(rootResult).toMatchObject({
      unique_visible_root_count: 48,
      root_count_truncated: true,
      truncated: true,
    });
    expect(rootResult?.roots[0]).toMatchObject({ visible_match_count: 48, count_truncated: true, selected: false });
    expect(rootResult?.outline).toBeUndefined();
    expectBridgeValid(rootReader, medium, "public_free", rootResult!);

    const inputs = Array.from({ length: 5 }, (_, index) => node(`input-${index}`, "input", "", { id: `input${index}` }));
    const figures = Array.from({ length: 3 }, (_, index) => node(`figure-${index}`, "figure", "", { id: `figure${index}` }));
    const hiddenInput = new FixtureNode("hidden-input", "input", "HIDDEN TEXT", {
      id: "hiddenInput",
      value: "HIDDEN FORM VALUE",
      "data-secret": "HIDDEN DATA ATTRIBUTE",
    }, [], false);
    const root = node("bounded-root", "article", "", {}, [...inputs, ...figures, hiddenInput]);
    const probeReader = mediumReader(root)
      .add("input", [...inputs, hiddenInput], root)
      .add("figure", figures, root);
    const probeResult = diagnostic(probeReader, medium);
    const outline = probeResult?.outline;
    expect(outline?.nodes.filter(item => item.kinds.includes("input"))).toHaveLength(4);
    expect(outline?.nodes.filter(item => item.kinds.includes("figure"))).toHaveLength(2);
    expect(outline?.nodes.length).toBeLessThanOrEqual(48);
    expect(outline?.truncated).toBe(true);
    expect(probeResult?.truncated).toBe(true);
    expect(JSON.stringify(probeResult)).not.toContain("HIDDEN");
    expectBridgeValid(probeReader, medium, "public_free", probeResult!);
  });
});
