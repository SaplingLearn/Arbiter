/**
 * Verify a committed deliberation record against the product's own chain rules.
 *
 * WHY THIS EXISTS. A JSONL file sitting in `results/cases/` is inert: it looks exactly
 * like a record whether or not it is one. The claim a committed record makes - that
 * these ten entries are the ten that were written, in this order, and that the answers
 * revealed are the answers submitted - is only worth anything if a reader can check it
 * without running the service or trusting whoever committed the file.
 *
 * IT IMPORTS THE PRODUCT'S VERIFIER, deliberately, rather than re-implementing the
 * hashing here. A second implementation that agreed with itself would prove nothing;
 * this fails if `store.ts` and the committed record ever disagree, which is the only
 * failure worth reporting.
 *
 *   npx tsx tools/verify-case-record.ts results/cases/case_1303693510/deliberation-log.jsonl
 *
 * Exits non-zero on any chain failure or broken seal, so CI can run it.
 */
import { readFileSync } from "node:fs";
import { verifyChain, commitmentFor, type LogEntry } from "../services/api/store.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx tools/verify-case-record.ts <deliberation-log.jsonl>");
  process.exit(2);
}

const entries: LogEntry[] = readFileSync(path, "utf8")
  .trim()
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l));

console.log(`${path}`);
console.log(`  ${entries.length} entries, case ${entries[0]?.caseId ?? "(none)"}`);

const failures = verifyChain(entries);
for (const f of failures) console.log(`  CHAIN  seq ${f.seq}  ${f.kind}: ${f.detail}`);
console.log(`  chain: ${failures.length === 0 ? "verifies" : `${failures.length} failure(s)`}`);

/* The blindness audit. Every revealed position must hash to the commitment that was
   written while the case was still open - which is the part of "sealed" that can be
   demonstrated rather than promised. */
const sealed = new Map<string, string>();
for (const e of entries) {
  if (e.kind === "position_sealed") {
    const p = e.payload as { participantId: string; commitment: string };
    sealed.set(p.participantId, p.commitment);
  }
}
const revealed = entries.find((e) => e.kind === "revealed");
const broken: string[] = [];
if (revealed) {
  const positions = (revealed.payload as { positions: Array<{ participantId: string; call: string }> }).positions;
  for (const p of positions) {
    const want = sealed.get(p.participantId);
    const got = commitmentFor(p as never);
    const ok = want !== undefined && want === got;
    if (!ok) broken.push(p.participantId);
    console.log(`  SEAL   ${p.participantId}  ${p.call.padEnd(15)} ${ok ? "matches its commitment" : "DOES NOT MATCH"}`);
  }
}
console.log(`  seals: ${sealed.size} sealed, ${broken.length === 0 ? "all intact" : `${broken.length} broken`}`);

process.exit(failures.length === 0 && broken.length === 0 ? 0 : 1);
