import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDeps } from "./check-deps.mjs";

/**
 * A GUARD IS TESTED BY BREAKING THE TREE, not by running it on a healthy one.
 *
 * `checkDeps()` against this repo returns [] and would keep returning [] if the body
 * were `return []`. Every case here builds a tree that is definitely wrong and asserts
 * the specific complaint, so the suite fails if the check is ever gutted.
 */

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** Builds a throwaway workspace tree: `{ "path/package.json": {...} }`. */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "arbiter-deps-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, JSON.stringify(content));
  }
  return root;
}

const WORKSPACE_ROOT = { name: "root", workspaces: ["apps/*"] };

describe("checkDeps", () => {
  it("passes when every declared dependency is installed at the hoisted root", () => {
    const root = tree({
      "package.json": WORKSPACE_ROOT,
      "apps/web/package.json": { name: "@a/web", dependencies: { pdfjs: "4.10.38" } },
      "node_modules/pdfjs/package.json": { name: "pdfjs", version: "4.10.38" },
    });
    expect(checkDeps(root)).toEqual([]);
  });

  it("reports a dependency that is declared but never installed", () => {
    // The reported failure: apps/deliberation declared pdfjs-dist, node_modules
    // predated it, and vite blamed src/read.tsx.
    const root = tree({
      "package.json": WORKSPACE_ROOT,
      "apps/web/package.json": { name: "@a/web", dependencies: { pdfjs: "4.10.38" } },
    });
    const problems = checkDeps(root);
    expect(problems).toHaveLength(1);
    // Names the package, the version wanted, and WHICH workspace wants it — the three
    // facts the vite overlay left out.
    expect(problems[0]).toContain("pdfjs");
    expect(problems[0]).toContain("4.10.38");
    expect(problems[0]).toContain("@a/web");
    expect(problems[0]).toContain("not installed");
  });

  it("reports an exact pin satisfied by the wrong version", () => {
    // A stale hoisted 5.x satisfies a directory check and then crashes at runtime on
    // node 20 with a message about something else. This is why the pin is checked.
    const root = tree({
      "package.json": WORKSPACE_ROOT,
      "apps/web/package.json": { name: "@a/web", dependencies: { pdfjs: "4.10.38" } },
      "node_modules/pdfjs/package.json": { name: "pdfjs", version: "5.0.0" },
    });
    const problems = checkDeps(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("pinned to 4.10.38");
    expect(problems[0]).toContain("found 5.0.0");
  });

  it("does not version-check a range, at any distance", () => {
    // 1.5.0 satisfies ^1.0.0 and 9.9.9 does not, but neither is this file's business —
    // npm resolved the range and comparing it would mean implementing semver.
    const root = tree({
      "package.json": WORKSPACE_ROOT,
      "apps/web/package.json": { name: "@a/web", dependencies: { a: "^1.0.0", b: "~2.0.0" } },
      "node_modules/a/package.json": { name: "a", version: "1.5.0" },
      "node_modules/b/package.json": { name: "b", version: "9.9.9" },
    });
    expect(checkDeps(root)).toEqual([]);
  });

  it("accepts a package nested in the workspace rather than hoisted", () => {
    // npm hoists to the root and nests only on version conflict; a check that looked
    // only at the root would fail every tree that had one.
    const root = tree({
      "package.json": WORKSPACE_ROOT,
      "apps/web/package.json": { name: "@a/web", dependencies: { pdfjs: "4.10.38" } },
      "apps/web/node_modules/pdfjs/package.json": { name: "pdfjs", version: "4.10.38" },
    });
    expect(checkDeps(root)).toEqual([]);
  });

  it("checks devDependencies and the root manifest too, not just workspace deps", () => {
    const root = tree({
      "package.json": { ...WORKSPACE_ROOT, devDependencies: { vitest: "^2.1.0" } },
      "apps/web/package.json": { name: "@a/web", devDependencies: { tailwindcss: "^4.3.3" } },
    });
    const problems = checkDeps(root);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain("vitest");
    expect(problems.join("\n")).toContain("tailwindcss");
  });

  it("does not police an exact pin on a WORKSPACE, whose version is not an install fact", () => {
    // apps/harness pins @arbiter/engine to 1.0.0 and npm links it to packages/engine
    // regardless. Bumping the engine and not the pin would have failed `npm run dev`
    // for everybody, with a message about a stale install - which is the one diagnosis
    // that cannot be right, because a symlink cannot be out of date with itself.
    const root = tree({
      "package.json": { name: "root", workspaces: ["apps/*", "packages/*"] },
      "apps/harness/package.json": { name: "@a/harness", dependencies: { "@a/engine": "1.0.0" } },
      "packages/engine/package.json": { name: "@a/engine", version: "1.1.0" },
    });
    mkdirSync(join(root, "node_modules/@a"), { recursive: true });
    symlinkSync(join(root, "packages/engine"), join(root, "node_modules/@a/engine"), "dir");
    expect(checkDeps(root)).toEqual([]);
  });

  it("still polices an exact pin on a package that was really installed", () => {
    // The guard above must not have turned the pin check off in general - a hoisted
    // copy at the wrong version is the pdfjs-dist failure the pin exists to catch.
    const root = tree({
      "package.json": WORKSPACE_ROOT,
      "apps/web/package.json": { name: "@a/web", dependencies: { pdfjs: "4.10.38" } },
      "node_modules/pdfjs/package.json": { name: "pdfjs", version: "5.0.0" },
    });
    const problems = checkDeps(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("4.10.38");
    expect(problems[0]).toContain("5.0.0");
  });

  it("refuses a workspace pattern it cannot expand rather than silently skipping it", () => {
    // Returning [] for a pattern this cannot read would mean a whole workspace goes
    // unchecked and the tool still says "dependencies ok".
    const root = tree({ "package.json": { name: "root", workspaces: ["packages/**/deep"] } });
    expect(() => checkDeps(root)).toThrow(/unsupported workspace pattern/);
  });

  it("passes on this repo, which is installed", () => {
    // Weak on its own — every case above exists because this one proves nothing by
    // itself. It is here to catch a check that starts reporting false problems.
    expect(checkDeps()).toEqual([]);
  });
});
