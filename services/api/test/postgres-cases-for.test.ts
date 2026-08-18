import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresStore } from "../postgres-store.js";
import { PostgresAuthStore } from "../postgres-auth.js";
import { databaseUrl } from "../db.js";
import { freshDatabase, dropDatabase } from "./postgres-fixture.js";
import { DeliberationService } from "../deliberation-service.js";
import { seedDemoTeam, DEMO_TEAM } from "../seed-demo.js";
import { seedDemoCases, STAGE_FIXTURES } from "../seed-cases.js";
import type { EvidenceChecklist } from "../inventory.js";

const CHECKLIST = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
const EMAILS = DEMO_TEAM.map((p) => p.email);
const BASE = "cases_for";

/**
 * `casesFor` AGAINST A REAL DATABASE, because every other test of it runs on MemoryStore.
 *
 * The dashboard's whole vocabulary now rests on this one method: `youSubmitted` decides
 * which pile a case goes in and which stage its card names, and it is computed from
 * `c.positions` on whatever `allCases()` hands back. `MemoryStore` hands back the object
 * it was given, so a test there cannot tell the difference between "the field is computed
 * correctly" and "the store happens to keep positions in memory".
 *
 * `PostgresStore` round-trips the case through a `jsonb` column, so this is where the
 * question is real. If `toCase` ever projected a lighter row - or the column stopped
 * carrying positions - `youSubmitted` would be FALSE for everybody, on every case, and
 * nothing would throw: every participant would simply be told forever that their answered
 * cases still needed answering. A silent wrong answer on the screen built to say what is
 * waiting on you.
 *
 * SKIPPED WHOLE WITHOUT A DATABASE, on the same condition as the other Postgres suites -
 * `databaseUrl()` rather than a fresh read, so an empty `DATABASE_URL` counts as absent
 * here exactly as it does in production.
 */
describe.skipIf((databaseUrl() ?? "") === "")("casesFor, on Postgres", () => {
  let svc: DeliberationService;
  let ids: Record<string, string>;

  beforeAll(async () => {
    const pool = await freshDatabase(BASE);
    const auth = await PostgresAuthStore.open(pool);
    await seedDemoTeam(auth, Date.parse("2026-08-17T09:00:00Z"));
    ids = Object.fromEntries((await auth.list()).map((p: { email: string; id: string }) => [p.email, p.id]));

    svc = new DeliberationService(new PostgresStore(pool), CHECKLIST);
    const report = await seedDemoCases(svc, auth, Date.parse("2026-08-17T09:00:00Z"), EMAILS);
    expect(report.skipped, "the seeder found no team on Postgres").toBeNull();
    expect(report.created.length).toBe(STAGE_FIXTURES.length);
  }, 60_000);

  afterAll(async () => { await dropDatabase(BASE); });

  /** The positions survived the jsonb round trip at all. Without this the assertions
   *  below would all be about an empty array and would still read as passing. */
  it("brings the positions back out of the database", async () => {
    const kase = await svc.getCase("demo-part-answered");
    expect(kase).not.toBeNull();
    expect(kase!.positions.length).toBe(2);
  });

  /**
   * THE ONE THAT MATTERS. Two participants, the same case, the same counts - and opposite
   * answers. `demo-part-answered` has the first two panellists in, so the third has not
   * answered and sees the identical `2 of 4`.
   */
  it("tells two participants apart on a case where the count cannot", async () => {
    const answered = ids[DEMO_TEAM[1]!.email]!;
    const notYet = ids[DEMO_TEAM[3]!.email]!;

    const mine = (await svc.casesFor(answered)).find((c) => c.caseId === "demo-part-answered")!;
    const theirs = (await svc.casesFor(notYet)).find((c) => c.caseId === "demo-part-answered")!;

    expect(mine.submitted).toBe(theirs.submitted);
    expect(mine.of).toBe(theirs.of);
    expect(mine.youSubmitted).toBe(true);
    expect(theirs.youSubmitted).toBe(false);
  });

  it("reports the convener as holding no position", async () => {
    const owner = ids[DEMO_TEAM[0]!.email]!;
    const seen = (await svc.casesFor(owner)).find((c) => c.caseId === "demo-part-answered")!;
    expect(seen.isOwner).toBe(true);
    expect(seen.youSubmitted).toBe(false);
  });

  /** Each seeded case landed at its declared stage through a real database, not only
   *  through an in-memory map that never serialises anything. */
  it("leaves every seeded case at the status its fixture names", async () => {
    for (const f of STAGE_FIXTURES) {
      const kase = await svc.getCase(f.caseId);
      expect(kase!.status, f.caseId).toBe(f.status);
    }
  });

  /** And the chain the seeder wrote verifies after a round trip through `text` and
   *  `jsonb` - which is the property the migration's own note is about. */
  it("writes a record that still verifies once it has been through Postgres", async () => {
    for (const f of STAGE_FIXTURES) {
      const audit = await svc.audit(f.caseId);
      expect(audit.chain, `${f.caseId} chain`).toEqual([]);
      expect(audit.seals, `${f.caseId} seals`).toEqual([]);
    }
  });
});
