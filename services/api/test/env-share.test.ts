import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ENV_FILES, envFileInUse, loadEnv } from "../env.js";

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
