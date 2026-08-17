import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ENV_FILES, envFileInUse, envFilesInUse, loadEnv } from "../env.js";

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

  it("prefers .env over .env.share over .env.defaults in the declared order, not by accident", () => {
    expect([...ENV_FILES]).toEqual([".env", ".env.share", ".env.defaults"]);
  });

  it("is still a no-op when neither file exists, and reports no files", () => {
    expect(envFilesInUse()).toEqual([]);
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
 * `.env.defaults`: the tracked layer, and the reason precedence is per-NAME.
 *
 * Whole-file precedence was correct while both files were ignored and each was somebody's
 * complete configuration. It stops being correct the moment one of them is checked in and
 * carries the settings a team has agreed on: a developer whose `.env` holds nothing but
 * their own API key would silently have lost the shared model names, and the symptom -
 * two people getting different answers from what they both believe is one configuration -
 * is precisely what the tracked file exists to prevent.
 */
describe("shared defaults that live in git", () => {
  let dir: string;
  let cwd: string;
  const NAMES = ["ARBITER_TEST_MODEL", "ARBITER_TEST_HOST", "ARBITER_TEST_KEY"];

  const clear = (): void => { for (const n of NAMES) delete process.env[n]; };

  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "arbiter-envdefaults-"));
    process.chdir(dir);
    clear();
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    clear();
  });

  it("reads .env.defaults when it is the only file, so a bare clone is configured", () => {
    writeFileSync(".env.defaults", "ARBITER_TEST_MODEL=shared-model\n", "utf8");
    expect(loadEnv()).toBe(1);
    expect(process.env["ARBITER_TEST_MODEL"]).toBe("shared-model");
    expect(envFilesInUse()).toEqual([".env.defaults"]);
  });

  it("keeps the shared names a personal .env did not mention", () => {
    // THE WHOLE POINT. `.env` names only the key; the model and host still come from the
    // tracked file. Under file-level precedence this developer would have been running
    // different models from everybody else with nothing on screen to say so.
    writeFileSync(".env", "ARBITER_TEST_KEY=my-own-key\n", "utf8");
    writeFileSync(".env.defaults", "ARBITER_TEST_MODEL=shared-model\nARBITER_TEST_HOST=shared-host\n", "utf8");
    loadEnv();
    expect(process.env["ARBITER_TEST_KEY"]).toBe("my-own-key");
    expect(process.env["ARBITER_TEST_MODEL"]).toBe("shared-model");
    expect(process.env["ARBITER_TEST_HOST"]).toBe("shared-host");
  });

  it("lets a personal .env override one shared name and inherit the rest", () => {
    writeFileSync(".env", "ARBITER_TEST_MODEL=mine\n", "utf8");
    writeFileSync(".env.defaults", "ARBITER_TEST_MODEL=shared-model\nARBITER_TEST_HOST=shared-host\n", "utf8");
    loadEnv();
    expect(process.env["ARBITER_TEST_MODEL"]).toBe("mine");
    expect(process.env["ARBITER_TEST_HOST"]).toBe("shared-host");
  });

  it("puts .env.share between the two, so a handed-out key beats the tracked default", () => {
    writeFileSync(".env.share", "ARBITER_TEST_HOST=from-share\n", "utf8");
    writeFileSync(".env.defaults", "ARBITER_TEST_HOST=shared-host\nARBITER_TEST_MODEL=shared-model\n", "utf8");
    loadEnv();
    expect(process.env["ARBITER_TEST_HOST"]).toBe("from-share");
    expect(process.env["ARBITER_TEST_MODEL"]).toBe("shared-model");
    expect(envFilesInUse()).toEqual([".env.share", ".env.defaults"]);
  });

  it("reports every present file, because the banner names all of them", () => {
    writeFileSync(".env", "ARBITER_TEST_KEY=k\n", "utf8");
    writeFileSync(".env.share", "ARBITER_TEST_HOST=h\n", "utf8");
    writeFileSync(".env.defaults", "ARBITER_TEST_MODEL=m\n", "utf8");
    loadEnv();
    expect(envFilesInUse()).toEqual([".env", ".env.share", ".env.defaults"]);
    // Still the highest-precedence one, which is what answers "where did a contested
    // value come from".
    expect(envFileInUse()).toBe(".env");
  });

  it("still reads only the named file when given an explicit path", () => {
    // The eval scripts pass a path to PIN a configuration. Layering repo files underneath
    // would unpin it, and a pinned run that quietly picked up the repo's current defaults
    // would be a different experiment reported under the same name.
    writeFileSync("custom.env", "ARBITER_TEST_MODEL=explicit\n", "utf8");
    writeFileSync(".env.defaults", "ARBITER_TEST_HOST=shared-host\n", "utf8");
    expect(loadEnv("custom.env")).toBe(1);
    expect(process.env["ARBITER_TEST_MODEL"]).toBe("explicit");
    expect(process.env["ARBITER_TEST_HOST"]).toBeUndefined();
  });
});
