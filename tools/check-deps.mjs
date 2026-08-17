/**
 * Is what the manifests declare actually on disk?
 *
 * WHY THIS EXISTS. `apps/deliberation` gained `pdfjs-dist` when the Read & mark tab
 * landed. A checkout whose `node_modules` predated that merge started fine, served
 * fine, and then threw this the moment anybody opened a document:
 *
 *     [plugin:vite:import-analysis] Failed to resolve import "pdfjs-dist"
 *     from "src/read.tsx". Does the file exist?
 *
 * Every word of that points at application source. It names a file that is correct, a
 * line that is correct, and an import that is correct, and it asks whether a file the
 * author never wrote exists. The one fact it does not carry is the only one that
 * mattered - that the package was never installed - so it sends you reading `read.tsx`.
 * It cost a round trip, and it will cost one again on the next machine and the next
 * dependency, because the trigger is not this package: it is any `npm install` older
 * than the last dependency added on any branch. That is every collaborator, every
 * pull, forever.
 *
 * This is the same trade `dev-all.mjs` makes with `--strictPort`: fail loudly at
 * startup rather than proceed into a state whose symptom names the wrong cause.
 *
 * NOT A SUBSTITUTE FOR `npm ci`. It answers "can this tree start", not "is this tree
 * exactly the lockfile". Deliberately: it has to run in the second before a dev server
 * boots, so it stats directories rather than resolving a full tree.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

/**
 * Workspace directories, from the root manifest's own globs rather than a second list
 * here. The globs in this repo are all the trailing-`*` kind; anything fancier is not
 * supported and would be quietly wrong, so it throws instead.
 */
function workspaceDirs(root) {
  const { workspaces = [] } = read(join(root, "package.json"));
  const dirs = [root];
  for (const pattern of workspaces) {
    if (!pattern.endsWith("/*")) {
      throw new Error(`check-deps: unsupported workspace pattern ${pattern}`);
    }
    const parent = join(root, pattern.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(parent, entry.name, "package.json"))) {
        dirs.push(join(parent, entry.name));
      }
    }
  }
  return dirs;
}

/**
 * npm hoists to the root and only nests on conflict, so a package satisfying a
 * workspace can sit in either place. Both are checked; neither is preferred.
 */
function installedAt(root, pkgDir, name) {
  for (const base of [join(pkgDir, "node_modules", name), join(root, "node_modules", name)]) {
    if (existsSync(join(base, "package.json"))) return base;
  }
  return null;
}

/**
 * EXACT PINS ARE CHECKED FOR VERSION, RANGES ARE NOT.
 *
 * A range is satisfied by whatever npm chose and comparing it would mean a semver
 * implementation for no gain. A pin is a different statement: somebody wrote a bare
 * version because a specific one is required. `pdfjs-dist` is pinned at 4.10.38
 * because 5.x and 6.x need Node >= 22.13 and crash on 20, and a stale hoisted 5.x
 * would satisfy a directory check while failing at runtime with a message about
 * something else entirely - which is the exact failure mode this file exists to end.
 */
const isExactPin = (range) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(range);

/**
 * `root` is a parameter rather than the module's own ROOT so this can be aimed at a
 * fixture tree. A guard's own failure mode is to pass while checking nothing, and the
 * only way to prove it does not is to hand it a tree that is definitely broken and
 * watch it complain - which needs a tree that is not this repo.
 */
export function checkDeps(root = ROOT) {
  const problems = [];
  for (const dir of workspaceDirs(root)) {
    const pkg = read(join(dir, "package.json"));
    const label = pkg.name ?? dir;
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, range] of Object.entries(declared)) {
      const at = installedAt(root, dir, name);
      if (at === null) {
        problems.push(`${name} (${range}) declared by ${label} — not installed`);
        continue;
      }
      if (isExactPin(range)) {
        const found = read(join(at, "package.json")).version;
        if (found !== range) {
          problems.push(`${name} pinned to ${range} by ${label} — found ${found}`);
        }
      }
    }
  }
  return problems;
}

/**
 * Called for its exit code by the `dev` scripts, and imported by `dev-all.mjs` so the
 * check happens in-process before a single server is spawned.
 */
export function assertDeps() {
  const problems = checkDeps();
  if (problems.length === 0) return;
  console.error("");
  console.error("Dependencies on disk do not match the manifests:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("");
  console.error("  Fix:  npm install");
  console.error("");
  process.exit(1);
}

// Run standalone: `node tools/check-deps.mjs`.
//
// `pathToFileURL` rather than interpolating argv[1] into a file:// string: on Windows
// argv[1] is `C:\...`, and hand-building the URL from it drops a slash and gets the
// separators wrong, so the comparison silently never matches and the script exits 0
// having checked nothing. That is the same class of quiet no-op this file was written
// to prevent, and it is a real one - `npm run check:deps` is a `node` invocation.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertDeps();
  console.log("dependencies ok");
}
