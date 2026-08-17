/**
 * Snapshot and restore the deliberation store, so a demo can be run more than once.
 *
 * WHY THIS EXISTS AND `--reset` DOES NOT COVER IT. `tools/seed-demo-documents.mjs
 * --reset` discards the store and rebuilds it, which is the right tool when the
 * seeded cases themselves need to change. It is the wrong tool between takes of a
 * recording: it re-fetches every source, re-runs the PDF gate and re-verifies every
 * seeded quote before it will touch anything, which is a minute of work to undo
 * thirty seconds of clicking. This restores a byte-identical store from a snapshot
 * instead, and does nothing else.
 *
 * WHY NOT DELETE ONE CASE. The hash chain in `results/deliberation-log.jsonl` is
 * GLOBAL across cases, deliberately - `store.ts` records that a per-case chain would
 * let a whole case be deleted without leaving a hole, and "this case never existed"
 * is a more useful tamper to detect than "this position was edited". So removing one
 * case's entries breaks every link after it and the Record stage reports TAMPERING
 * DETECTED, which is the chain working, not a bug to route around. The honest way to
 * get a clean case back is to restore a snapshot of the whole store.
 *
 * The same reasoning applies to re-submitting a position. `deliberation.ts` seals a
 * position on submit and offers no path to amend one, because a position that can be
 * revised after the fact is not a blind commitment. There is no flag here to allow
 * it; run the case again from a snapshot.
 *
 *   node tools/demo-reset.mjs snapshot     capture the store as it is now
 *   node tools/demo-reset.mjs restore      put that snapshot back
 *   node tools/demo-reset.mjs status       what exists, and how big
 *
 * ACCOUNTS ARE NEVER TOUCHED. `results/deliberation-log.jsonl.users.json` holds
 * password hashes and is not part of what a demo run dirties - wiping it would mean
 * re-seeding five accounts to undo one case.
 *
 * BOTH DESTRUCTIVE PATHS REQUIRE THE API TO BE DOWN. The server holds the log in
 * memory and rewrites it on the next write, so restoring a file under a running
 * server is a race the server wins - the old state comes straight back and the
 * restore looks like it silently failed. Checked rather than documented, because a
 * documented precondition is one nobody reads at 2am before a presentation.
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const API = process.env["ARBITER_API"] ?? "http://127.0.0.1:8787";

/** Everything a demo run dirties, and nothing else. Accounts are deliberately absent. */
const STORE = [
  "results/deliberation-log.jsonl",
  "results/deliberation-log.jsonl.cases.json",
  "results/documents",
];

const SNAP = process.env["ARBITER_SNAPSHOT"] ?? "results/.demo-snapshot";

const command = process.argv[2] ?? "status";

/** The server rewrites the log from memory, so it must be stopped first. */
async function apiIsUp() {
  try {
    await fetch(`${API}/api/cases`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

function sizeOf(path) {
  if (!existsSync(path)) return null;
  const s = statSync(path);
  if (!s.isDirectory()) return s.size;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? (sizeOf(child) ?? 0) : statSync(child).size;
  }
  return total;
}

const human = (n) => (n === null ? "absent" : n < 1024 ? `${n} B` : n < 1e6 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1e6).toFixed(1)} MB`);

function status() {
  console.log("store:");
  for (const p of STORE) console.log(`  ${human(sizeOf(p)).padStart(9)}  ${p}`);
  console.log(`\nsnapshot (${SNAP}):`);
  if (!existsSync(SNAP)) {
    console.log("  none - run `node tools/demo-reset.mjs snapshot` before your first case.");
    return;
  }
  for (const p of STORE) {
    console.log(`  ${human(sizeOf(join(SNAP, p.replace("results/", "")))).padStart(9)}  ${p}`);
  }
}

if (command === "status") {
  status();
  process.exit(0);
}

if (command === "snapshot") {
  // Non-destructive to the store, so this one may run against a live server.
  rmSync(SNAP, { recursive: true, force: true });
  mkdirSync(SNAP, { recursive: true });
  let taken = 0;
  for (const p of STORE) {
    if (!existsSync(p)) continue;
    cpSync(p, join(SNAP, p.replace("results/", "")), { recursive: true });
    console.log(`captured  ${p}`);
    taken++;
  }
  if (taken === 0) {
    console.log("Nothing to capture - the store is empty. That is itself a valid snapshot to restore to.");
  }
  console.log(`\nSnapshot written to ${SNAP}. Restore it with \`node tools/demo-reset.mjs restore\`.`);
  process.exit(0);
}

if (command === "restore") {
  if (!existsSync(SNAP)) {
    console.log(`No snapshot at ${SNAP}. Run \`node tools/demo-reset.mjs snapshot\` first.`);
    process.exit(1);
  }
  if (await apiIsUp()) {
    console.log("The API is up. Stop `npm run dev` first, or the server will rewrite");
    console.log("the log from memory and the restore will silently come undone.");
    process.exit(1);
  }
  for (const p of STORE) rmSync(p, { recursive: true, force: true });
  for (const p of STORE) {
    const from = join(SNAP, p.replace("results/", ""));
    if (!existsSync(from)) continue;
    cpSync(from, p, { recursive: true });
    console.log(`restored  ${p}`);
  }
  console.log("\nStore restored. Start `npm run dev` and open the case again.");
  process.exit(0);
}

console.log(`Unknown command "${command}". Use: snapshot | restore | status`);
process.exit(1);
