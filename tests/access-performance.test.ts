import { describe, expect, it } from "vitest";
import { classifyAccess } from "../adapters/shared-extractors/access.js";
import { plan, rule } from "../adapters/platforms/spec.js";
import type { AccessSignals, PageNode, PageReader, PlatformRule, TargetRootPlan } from "../adapters/types.js";

interface TestNode extends PageNode {
  id: string;
  value: string;
  visible: boolean;
  parent?: TestNode;
}

class CountingReader implements PageReader {
  readonly location = new URL("https://example.test/items/one");
  readonly documentTitle = "Example";
  readonly selections = new Map<string, TestNode[]>();
  readonly selectionReads = new Map<string, number>();
  readonly textReads = new Map<TestNode, number>();
  readonly visibilityReads = new Map<TestNode, number>();

  select(selectors: readonly string[]): PageNode[] {
    return selectors.flatMap(selector => {
      this.selectionReads.set(selector, (this.selectionReads.get(selector) ?? 0) + 1);
      return this.selections.get(selector) ?? [];
    });
  }

  text(node: PageNode): string {
    const testNode = node as TestNode;
    this.textReads.set(testNode, (this.textReads.get(testNode) ?? 0) + 1);
    return testNode.value;
  }

  visible(node: PageNode): boolean {
    const testNode = node as TestNode;
    this.visibilityReads.set(testNode, (this.visibilityReads.get(testNode) ?? 0) + 1);
    return testNode.visible;
  }

  contains(ancestor: PageNode, node: PageNode): boolean {
    let current: TestNode | undefined = node as TestNode;
    while (current) {
      if (current === ancestor) return true;
      current = current.parent;
    }
    return false;
  }

  attribute(): string | null { return null; }
  tagName(): string { return "div"; }
  isText(): boolean { return false; }
  children(): PageNode[] { return []; }
}

const EMPTY_ACCESS: AccessSignals = {
  private_gates: [],
  paid_gates: [],
  login_gates: [],
};

function testRule(access: AccessSignals, targetRootPlans?: readonly TargetRootPlan[]): PlatformRule {
  return rule({
    id: "access_test",
    hosts: ["example.test"],
    patterns: ["https://example.test/items/*"],
    contentTypes: ["article"],
    defaultType: "article",
    selectors: plan({ roots: ["article"] }),
    access,
    ...(targetRootPlans ? { targetRootPlans } : {}),
    contentId: url => url.pathname.split("/").at(-1) ?? null,
  });
}

function testNode(id: string, value: string, parent?: TestNode): TestNode {
  return { id, value, visible: true, ...(parent ? { parent } : {}) };
}

describe("classifyAccess call-local reads", () => {
  it("reads each visible root text once across phrase gates and the final root proof", () => {
    const reader = new CountingReader();
    const root = testNode("root", "Public source body");
    const secondRoot = testNode("second-root", "Second public body");
    const hiddenRoot = { ...testNode("hidden-root", "Hidden body"), visible: false };
    reader.selections.set("article", [root, secondRoot, hiddenRoot]);
    const access: AccessSignals = {
      ...EMPTY_ACCESS,
      private_text: ["private"],
      paid_text: ["paid"],
      login_text: ["login"],
    };

    expect(classifyAccess(reader, testRule(access))).toEqual({
      accessClass: "public_free",
      evidence: ["access:visible-supported-content-root"],
    });
    expect(reader.textReads.get(root)).toBe(1);
    expect(reader.textReads.get(secondRoot)).toBe(1);
    expect(reader.textReads.get(hiddenRoot)).toBeUndefined();
    expect(reader.selectionReads.get("article")).toBe(1);
    expect(reader.visibilityReads.get(root)).toBe(1);
    expect(reader.visibilityReads.get(secondRoot)).toBe(1);
    expect(reader.visibilityReads.get(hiddenRoot)).toBe(1);
  });

  it("keeps the final root proof short-circuited when no phrase gate needs all roots", () => {
    const reader = new CountingReader();
    const firstRoot = testNode("first-root", "Public source body");
    const laterRoot = testNode("later-root", "Later body");
    reader.selections.set("article", [firstRoot, laterRoot]);

    expect(classifyAccess(reader, testRule(EMPTY_ACCESS)).accessClass).toBe("public_free");
    expect(reader.textReads.get(firstRoot)).toBe(1);
    expect(reader.textReads.get(laterRoot)).toBeUndefined();
    expect(reader.visibilityReads.get(laterRoot)).toBeUndefined();
    expect(reader.selectionReads.get("article")).toBe(1);
  });

  it("does not carry cached root text across classifications", () => {
    const reader = new CountingReader();
    const root = testNode("root", "Public source body");
    reader.selections.set("article", [root]);
    const access: AccessSignals = { ...EMPTY_ACCESS, login_text: ["Log in to continue"] };
    const platformRule = testRule(access);

    expect(classifyAccess(reader, platformRule).accessClass).toBe("public_free");
    root.value = "Log in to continue";
    expect(classifyAccess(reader, platformRule)).toEqual({
      accessClass: "login_public_free",
      evidence: ["login:text:Log in to continue"],
    });
    expect(reader.textReads.get(root)).toBe(2);
  });

  it("does not read body roots when the public metadata check fails first", () => {
    const reader = new CountingReader();
    const root = testNode("root", "Body that is not needed");
    reader.selections.set("article", [root]);
    const access: AccessSignals = { ...EMPTY_ACCESS, public_check: () => false };

    expect(classifyAccess(reader, testRule(access))).toEqual({
      accessClass: "unknown",
      evidence: ["access:public-metadata-not-confirmed"],
    });
    expect(reader.textReads.get(root)).toBeUndefined();
    expect(reader.selectionReads.get("article")).toBeUndefined();
  });

  it("preserves gate priority and ignores only the bounded non-blocking login gate", () => {
    const priorityReader = new CountingReader();
    const priorityRoot = testNode("root", "private paid login");
    priorityReader.selections.set("article", [priorityRoot]);
    const access: AccessSignals = {
      ...EMPTY_ACCESS,
      private_text: ["private"],
      paid_text: ["paid"],
      login_text: ["login"],
    };
    expect(classifyAccess(priorityReader, testRule(access))).toEqual({
      accessClass: "private",
      evidence: ["private:text:private"],
    });

    const paidReader = new CountingReader();
    const paidRoot = testNode("root", "paid login");
    paidReader.selections.set("article", [paidRoot]);
    expect(classifyAccess(paidReader, testRule(access))).toEqual({
      accessClass: "paid",
      evidence: ["paid:text:paid"],
    });

    const reader = new CountingReader();
    const trustedRoot = testNode("root", "Public source body");
    const loginArea = testNode("login-area", "Sign in");
    const loginButton = testNode("login-button", "Sign in", loginArea);
    reader.selections.set("article", [trustedRoot]);
    reader.selections.set(".login-area", [loginArea]);
    reader.selections.set(".login-button", [loginButton]);
    const targetPlan: TargetRootPlan = {
      applies: () => true,
      roots: ["article"],
      non_blocking_login_gate: { selector: ".login-button", ancestor_selector: ".login-area" },
    };
    const loginAccess: AccessSignals = { ...EMPTY_ACCESS, login_gates: [".login-button"] };

    expect(classifyAccess(reader, testRule(loginAccess, [targetPlan]), trustedRoot)).toEqual({
      accessClass: "public_free",
      evidence: ["access:visible-supported-content-root"],
    });
  });
});
