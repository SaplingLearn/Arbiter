import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Spec §4: `apps/web` never imports from `services/api`.
 *
 * This is not style. The submitted ZIP is one self-contained index.html, and
 * vite.config.ts's inlineEverything plugin THROWS if any asset survives uninlined -
 * so a single import reaching into services/ pulls @anthropic-ai/sdk into the
 * browser bundle, and with it the shape of a request that is supposed to have no
 * client-side existence. The failure would be a build error rather than a silent
 * one, but a build error the day before submission is not a good place to learn it.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("module boundaries", () => {
  const sources = walk("apps/web/src").filter((f) => /\.(ts|tsx)$/.test(f));

  it("finds source files to check, so an empty glob cannot pass this suite", () => {
    // Without this, a bad path makes every assertion below vacuously true.
    expect(sources.length).toBeGreaterThan(20);
  });

  it("nothing under apps/web/src references services/api", () => {
    const offenders = sources.filter((f) => readFileSync(f, "utf8").includes("services/api"));
    expect(offenders).toEqual([]);
  });

  it("nothing under apps/web/src imports the Anthropic SDK", () => {
    // The stronger form of the same rule: the key's client must not be reachable
    // from the bundle by ANY route, not only by the services/api path.
    const offenders = sources.filter((f) => readFileSync(f, "utf8").includes("@anthropic-ai/sdk"));
    expect(offenders).toEqual([]);
  });

  it("only client.ts issues a request", () => {
    // The Phase 2 invariant, relaxed exactly once and in exactly one file (spec §4).
    const offenders = sources
      .filter((f) => !f.endsWith(join("ai", "client.ts")))
      .filter((f) => /\bfetch\s*\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
