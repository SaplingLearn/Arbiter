import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ENV_FILES, envFileInUse, envFilesShadowed, loadEnv } from "../env.js";
import { billingNote, billingAdvice } from "../gemini.js";

/**
 * `.env.share` as a first-class configuration file.
 *
 * A file HANDED to someone should not need renaming before it works. That rename was a
 * silent failure: the share file sits in the root doing nothing, the service comes up
 * on the stub, and "no credentials" and "credentials in a file I did not read" look
 * identical from outside.
 *
 * These tests run in a temporary directory and restore the original cwd, because
 * loadEnv resolves relative to it.
 */
describe("configuration handed to someone else", () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "arbiter-envshare-"));
    process.chdir(dir);
    delete process.env["ARBITER_TEST_MARKER"];
    delete process.env["ARBITER_TEST_WHICH"];
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    delete process.env["ARBITER_TEST_MARKER"];
    delete process.env["ARBITER_TEST_WHICH"];
  });

  it("reads .env.share when there is no .env, so nobody has to rename it", () => {
    writeFileSync(".env.share", "ARBITER_TEST_MARKER=from-share\n", "utf8");
    expect(loadEnv()).toBe(1);
    expect(process.env["ARBITER_TEST_MARKER"]).toBe("from-share");
    expect(envFileInUse()).toBe(".env.share");
  });

  it("lets a developer's own .env win when both exist", () => {
    // A shared file checked out beside a personal one must never replace it - the
    // person who wrote .env chose those values on purpose.
    writeFileSync(".env", "ARBITER_TEST_WHICH=mine\n", "utf8");
    writeFileSync(".env.share", "ARBITER_TEST_WHICH=shared\n", "utf8");
    loadEnv();
    expect(process.env["ARBITER_TEST_WHICH"]).toBe("mine");
    expect(envFileInUse()).toBe(".env");
  });

  it("is still a no-op when neither file exists", () => {
    // Every value has a working default; a missing file is a valid configuration and
    // must not be an error.
    expect(loadEnv()).toBe(0);
    expect(envFileInUse()).toBeNull();
  });

  it("still honours an explicit path, which the eval scripts rely on", () => {
    writeFileSync("custom.env", "ARBITER_TEST_MARKER=explicit\n", "utf8");
    expect(loadEnv("custom.env")).toBe(1);
    expect(process.env["ARBITER_TEST_MARKER"]).toBe("explicit");
  });

  it("prefers .env over .env.share in the declared order, not by accident", () => {
    expect([...ENV_FILES]).toEqual([".env", ".env.share"]);
  });

  it("still lets the real environment beat the file", () => {
    // A shell export, a CI secret or a host's injected config outranks a file that
    // happened to be checked out. Unchanged by the fallback.
    process.env["ARBITER_TEST_MARKER"] = "from-shell";
    writeFileSync(".env.share", "ARBITER_TEST_MARKER=from-share\n", "utf8");
    expect(loadEnv()).toBe(0);
    expect(process.env["ARBITER_TEST_MARKER"]).toBe("from-shell");
  });
});

/**
 * THE OTHER HALF OF THE PRECEDENCE, and the half that actually cost somebody money.
 *
 * `.env` beating `.env.share` is deliberate: a file handed to you must never silently
 * replace configuration you set up yourself. But the reverse is equally silent - a
 * contributor drops the team's share file in beside a `.env` from weeks ago, sees the
 * service come up LIVE, and never learns the shared credential was ignored.
 */
describe("a shared file that was handed over and never read", () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "arbiter-shadow-"));
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("names a share file that lost to a personal .env", () => {
    writeFileSync(".env", "A=1", "utf8");
    writeFileSync(".env.share", "A=2", "utf8");
    expect(envFileInUse()).toBe(".env");
    expect(envFilesShadowed()).toEqual([".env.share"]);
  });

  it("says nothing when there is nothing being shadowed", () => {
    writeFileSync(".env.share", "A=2", "utf8");
    expect(envFileInUse()).toBe(".env.share");
    expect(envFilesShadowed()).toEqual([]);
  });

  it("says nothing when there is no configuration at all", () => {
    expect(envFileInUse()).toBeNull();
    expect(envFilesShadowed()).toEqual([]);
  });

  /* The list is derived from ENV_FILES rather than written out again, so a third name
     added there cannot be silently left out of the warning. */
  it("considers every configuration name the loader does", () => {
    for (const f of ENV_FILES) writeFileSync(f, "A=1", "utf8");
    expect(envFilesShadowed().length).toBe(ENV_FILES.length - 1);
  });
});

/**
 * "LIVE" reports that a model answers. It never reported WHOSE project is charged, and
 * a contributor on their own ADC login saw a banner identical to one on the team's key.
 */
describe("saying whose credential is paying", () => {
  it("calls a key the shared credential", () => {
    const env = { GEMINI_API_KEY: "AQ.test" } as unknown as NodeJS.ProcessEnv;
    expect(billingNote(env)).toMatch(/shared credential/);
    expect(billingAdvice(env)).toBeNull();
  });

  it("says plainly that ADC bills the developer, and how to stop it", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    expect(billingNote(env)).toMatch(/YOUR OWN Google account/);
    expect(billingAdvice(env)).toMatch(/cannot be shared/);
    expect(billingAdvice(env)).toContain(".env.share");
  });

  it("attributes a service account to its own project rather than to a person", () => {
    const env = { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/sa.json" } as unknown as NodeJS.ProcessEnv;
    expect(billingNote(env)).toMatch(/service account/);
    expect(billingAdvice(env)).toBeNull();
  });
});
