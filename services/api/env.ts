/**
 * Load `.env` into `process.env`, if there is one.
 *
 * NO DEPENDENCY, for the same reason `apps/deliberation/src/router.ts` hand-rolls
 * routing and `auth.ts` adds no crypto library: this is thirty lines, the whole surface
 * fits on one screen, and a project that will hold unpublished safety data does not need
 * another transitive tree to read a file of key=value pairs.
 *
 * CALLED FROM THE ENTRY POINT, never at import time, and that is deliberate. `server.ts`
 * is imported by its own test suite, and those tests drive the ask and adjudicate routes;
 * loading a developer's `.env` on import would hand a real credential to a test run and
 * turn `npm test` into live, billed model calls. Configuration is read when the process
 * is started as a server, not when its handler is imported as a module.
 *
 * NOT `node --env-file`, which would be the zero-code answer and cannot be used here.
 * On Node 20 that flag is a hard error when the file is missing, so putting it in the
 * npm scripts would mean nobody could start the service without first creating a `.env`
 * - including everyone running it stubbed, who needs no configuration at all. Node 22's
 * `--env-file-if-exists` is the flag this wants and this project is on 20.12.
 *
 * VITE ALREADY DOES THIS FOR THE TWO WEB APPS, and only for `VITE_`-prefixed names. So
 * without this file a `.env` was half-loaded in a way nobody could see: the frontends
 * picked their variables up and the API silently ignored `ARBITER_GCP_PROJECT`, which is
 * the one that decides whether there is a model at all.
 *
 * THE REAL ENVIRONMENT ALWAYS WINS. A value already set is never overwritten, so a
 * shell `export`, a CI secret, or a host's injected configuration beats a file that
 * happened to be checked out. The file is a convenience for local runs, never the
 * authority in a deployment.
 */
import { readFileSync, existsSync } from "node:fs";

/**
 * The files this looks for, in order, when no path is given.
 *
 * `.env.share` is second because a file HANDED to someone should not need renaming
 * before it works. That rename was the whole failure mode: `.env.share` sitting in the
 * root does nothing, the service comes up on the stub, and "no credentials" and "the
 * credentials are in a file I did not read" look identical from the banner. Reading it
 * directly removes a step that had no purpose except to be forgotten.
 *
 * `.env` still wins when both exist, so a developer's own configuration is never
 * silently replaced by a shared one that happens to be checked out beside it.
 */
export const ENV_FILES = [".env", ".env.share"] as const;

/** Which of ENV_FILES is actually present, or null. The banner prints it. */
export function envFileInUse(): string | null {
  return ENV_FILES.find((f) => existsSync(f)) ?? null;
}

/** @returns how many variables were newly set. */
export function loadEnv(path?: string): number {
  const resolved = path ?? envFileInUse();
  if (resolved === null || resolved === undefined) return 0;
  return loadEnvFile(resolved);
}

function loadEnvFile(path: string): number {
  if (!existsSync(path)) return 0;

  let applied = 0;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    /* Quotes are stripped, and only a MATCHING pair. Values here include JSON service
       account blobs and prompts with apostrophes in them; taking the quotes off one end
       would corrupt exactly those. */
    const quoted = value.length >= 2 && (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    );
    if (quoted) value = value.slice(1, -1);

    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
    applied++;
  }
  return applied;
}
