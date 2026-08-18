import { readFileSync } from "node:fs";
import { describe, expect, it, beforeAll } from "vitest";
import { DeliberationService } from "../deliberation-service.js";
import { MemoryStore } from "../store.js";
import { AuthStore } from "../auth.js";
import { seedDemoTeam, DEMO_TEAM } from "../seed-demo.js";
import { seedDemoCases, STAGE_FIXTURES } from "../seed-cases.js";
import type { EvidenceChecklist } from "../inventory.js";

const CHECKLIST = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;

/** The roster, in the order the seeder reads it: first convenes, the rest answer. */
const EMAILS = DEMO_TEAM.map((p) => p.email);

/**
 * CASES PARKED AT EACH STAGE, so the dashboard has something to show.
 *
 * `seed:demo` created five accounts and no cases, which meant a fresh store gave a
 * dashboard reading "No cases yet" and no way to see the stage tags, the buckets or the
 * report without driving a whole deliberation by hand first. Anyone demonstrating the
 * product did that by hand, every time, and a stage they did not bother to build was a
 * stage nobody ever looked at.
 *
 * NOTHING HERE SPENDS A MODEL CALL. The adjudication is a fixed object written in
 * `seed-cases.ts` and labelled `source: "stub"`, exactly as the free offline path does -
 * a seeder that billed three calls per stage would be a seeder nobody dared run.
 */
describe("seeding cases at each stage", () => {
  let svc: DeliberationService;
  let ids: Record<string, string>;

  beforeAll(async () => {
    const auth = await AuthStore.open(null);
    await seedDemoTeam(auth, Date.parse("2026-08-17T09:00:00Z"));
    const people = await auth.list();
    ids = Object.fromEntries(people.map((p: { email: string; id: string }) => [p.email, p.id]));
    svc = new DeliberationService(new MemoryStore(), CHECKLIST);
    await seedDemoCases(svc, auth, Date.parse("2026-08-17T09:00:00Z"), EMAILS);
  });

  it("creates one case per declared stage, and declares more than one", async () => {
    expect(STAGE_FIXTURES.length).toBeGreaterThan(3);
    const owner = ids[DEMO_TEAM[0].email]!;
    const mine = await svc.casesFor(owner);
    expect(mine.length).toBe(STAGE_FIXTURES.length);
  });

  /**
   * THE POINT OF THE WHOLE FIXTURE. Each case has to actually BE at its stage, not merely
   * be named after one - a seeder whose "adjudicated" case is still open produces a
   * dashboard that looks populated and demonstrates nothing.
   */
  it("leaves each case at the status its fixture names", async () => {
    for (const f of STAGE_FIXTURES) {
      const kase = await svc.getCase(f.caseId);
      expect(kase, f.caseId).not.toBeNull();
      expect(kase!.status, f.caseId).toBe(f.status);
    }
  });

  /** One case where the reader has answered and the room has not, because that is the
   *  distinction the old dashboard got wrong and the one a demo most needs to show. */
  it("includes a case a participant has answered while others have not", async () => {
    const answered = ids[DEMO_TEAM[1].email]!;
    const seen = await svc.casesFor(answered);
    const partial = seen.find((c) => c.youSubmitted && c.submitted < c.of);
    expect(partial, "no case where the viewer has answered and the room is still out").toBeDefined();
  });

  /** And one nobody has answered, so the "needs your position" pile is not empty either. */
  it("includes a case the reader has not answered", async () => {
    const someone = ids[DEMO_TEAM[1].email]!;
    const seen = await svc.casesFor(someone);
    expect(seen.some((c) => !c.youSubmitted && c.status === "open")).toBe(true);
  });

  it("labels every adjudication it writes as a stub, never as a model's answer", async () => {
    for (const f of STAGE_FIXTURES) {
      if (f.status !== "adjudicated" && f.status !== "signed") continue;
      const adj = await svc.adjudication(f.caseId);
      expect(adj, f.caseId).not.toBeNull();
      expect(adj!.source, f.caseId).toBe("stub");
    }
  });

  /**
   * THE SHAPE THE REPORT ACTUALLY READS, not merely a non-null object.
   *
   * `DeliberationService.adjudicate` takes the adjudication as `unknown` and stores it
   * whole, so nothing between this fixture and the screen checks what is in it. The test
   * above passed with `missing` written as `string[]` while `report.tsx` renders each
   * entry's `.field` and `.whyItMatters` - which is a row of empty cells on the Record and
   * the Report, in a fixture whose entire purpose is giving those two screens something to
   * draw. Green suite, broken page, and nothing in between to say so.
   *
   * Asserted against the client's `Adjudication` type rather than by eye: these are the
   * properties `report.tsx` indexes, so a future change to either side has to move both.
   */
  it("writes an adjudication the report can actually render", async () => {
    const adj = await svc.adjudication("demo-adjudicated");
    const body = adj!.adjudication as {
      consequence: { verdict: string; reasoning: string };
      missing: { field: string; whyItMatters: string }[];
      ruleDisclosure: { ruleId: string; position: string }[];
    };

    expect(body.consequence.verdict).toBe("cannot_conclude");
    expect(body.ruleDisclosure.length).toBeGreaterThan(0);

    // The one that was wrong. Each entry is an OBJECT with the two properties the table
    // prints - a string here renders as a blank row rather than failing.
    expect(body.missing.length).toBeGreaterThan(0);
    for (const m of body.missing) {
      expect(typeof m, "each `missing` entry is an object, not a bare string").toBe("object");
      expect(typeof m.field).toBe("string");
      expect(m.field.length).toBeGreaterThan(0);
      expect(typeof m.whyItMatters).toBe("string");
      expect(m.whyItMatters.length).toBeGreaterThan(0);
    }
  });

  /**
   * IDEMPOTENT, like the account seeding beside it. `seed:demo` is documented as safe to
   * re-run, and a cases half of it that threw on the second run - or worse, silently
   * appended a second copy of every case - would make that claim false for the command as
   * a whole.
   */
  it("is safe to run twice, and adds nothing the second time", async () => {
    const auth = await AuthStore.open(null);
    await seedDemoTeam(auth, Date.parse("2026-08-17T09:00:00Z"));
    const once = new DeliberationService(new MemoryStore(), CHECKLIST);

    const first = await seedDemoCases(once, auth, Date.parse("2026-08-17T09:00:00Z"), EMAILS);
    const second = await seedDemoCases(once, auth, Date.parse("2026-08-17T09:00:00Z"), EMAILS);

    expect(first.created.length).toBe(STAGE_FIXTURES.length);
    expect(second.created).toEqual([]);
    expect(second.alreadyPresent.length).toBe(STAGE_FIXTURES.length);

    const owner = (await auth.list()).find((p: { email: string }) => p.email === DEMO_TEAM[0]!.email)!;
    expect((await once.casesFor(owner.id)).length).toBe(STAGE_FIXTURES.length);
  });

  /**
   * WITH NO DEMONSTRATION TEAM IT DOES NOTHING, and says so rather than throwing. A case
   * needs somebody to answer it: `openCase` would refuse an empty panel, and the useful
   * report is "run seed:demo first", not a stack trace from inside a fixture.
   */
  it("declines to seed cases when there is nobody to put on them", async () => {
    const empty = await AuthStore.open(null);
    const svcEmpty = new DeliberationService(new MemoryStore(), CHECKLIST);
    const report = await seedDemoCases(svcEmpty, empty, Date.now(), EMAILS);
    expect(report.created).toEqual([]);
    expect(report.skipped).toMatch(/seed:demo/);
  });

  /**
   * A SHORT PANEL IS REFUSED, and this is the case that produced a store which looked
   * right rather than one that failed.
   *
   * Each fixture submits `panel.slice(0, f.answers)`, so with fewer panellists than a
   * fixture declares it simply submits fewer - and `lock` still succeeds, because "all_in"
   * asks whether every PARTICIPANT has answered and on a short panel they all have. Every
   * status matches its fixture and nothing throws.
   *
   * The casualty is `demo-part-answered`, whose entire purpose is a room still out. On a
   * two-person panel its two submissions ARE the panel, so it lands fully answered and the
   * dashboard shows "Awaiting the panel, 2 of 2" - the answered-by-you-not-by-them
   * distinction the fixtures exist to demonstrate, gone, on a screen that still looks full.
   */
  it("refuses a roster too short to mean what the fixtures declare", async () => {
    const auth = await AuthStore.open(null);
    await seedDemoTeam(auth, Date.parse("2026-08-17T09:00:00Z"));
    const svcShort = new DeliberationService(new MemoryStore(), CHECKLIST);

    // Owner plus two panellists, where the fixtures need four.
    const report = await seedDemoCases(svcShort, auth, Date.now(), EMAILS.slice(0, 3));

    expect(report.created).toEqual([]);
    expect(report.skipped).toMatch(/panellists/);
    // And nothing was half-written on the way to deciding that.
    expect(await svcShort.getCase("demo-awaiting-everyone")).toBeNull();
  });

  /**
   * A LONGER ROSTER IS REFUSED TOO, which is not what I expected and is why this test
   * exists rather than a comment asserting the opposite.
   *
   * "The extra people simply do not answer" sounds harmless and is not. `demo-panel-done`
   * and the two fixtures after it have to REVEAL, `lock` requires every PARTICIPANT to
   * have answered, and a fifth panellist the fixture never asks is one the reveal waits
   * for forever. Written as `panel.length < needed` this got as far as throwing
   * `Still waiting on u_...` from inside the loop, three cases already written to the
   * store - a half-seeded store from a guard meant to prevent exactly that.
   *
   * So the largest `answers` is the panel size these fixtures are written against, not a
   * floor, and refusing up front is the difference between a message and a mess.
   */
  it("refuses a roster longer than the fixtures were written against", async () => {
    const auth = await AuthStore.open(null);
    await seedDemoTeam(auth, Date.parse("2026-08-17T09:00:00Z"));
    const extra = await auth.register({
      email: "e.fifth@arbiter.demo", displayName: "E. Fifth (extra)",
      password: "arbiter-demo-2026", now: Date.parse("2026-08-17T09:00:00Z"),
    });
    expect(extra.ok).toBe(true);

    const svcLong = new DeliberationService(new MemoryStore(), CHECKLIST);
    const report = await seedDemoCases(
      svcLong, auth, Date.parse("2026-08-17T09:00:00Z"), [...EMAILS, "e.fifth@arbiter.demo"],
    );

    expect(report.created).toEqual([]);
    expect(report.skipped).toMatch(/exactly/);
    // Refused BEFORE anything was written, which is the half-seeded store this prevents.
    expect(await svcLong.getCase("demo-awaiting-everyone")).toBeNull();
  });

  /** A repeated address would seat one person twice and make `of` count them twice, so the
   *  count on every card would be wrong in a way no status check would notice. */
  it("refuses a roster that names the same person twice", async () => {
    const auth = await AuthStore.open(null);
    await seedDemoTeam(auth, Date.parse("2026-08-17T09:00:00Z"));
    const svcDup = new DeliberationService(new MemoryStore(), CHECKLIST);

    const doubled = [EMAILS[0]!, EMAILS[1]!, EMAILS[1]!, EMAILS[2]!, EMAILS[3]!, EMAILS[4]!];
    const report = await seedDemoCases(svcDup, auth, Date.now(), doubled);

    expect(report.created).toEqual([]);
    expect(report.skipped).toMatch(/distinct/);
  });

  /**
   * The hash chain has to survive being written by a seeder exactly as it does when
   * written by a person - a fixture producing cases that fail their own audit would be
   * worse than no fixture, because the audit screen is one of the things it exists to let
   * somebody look at.
   *
   * Both verifiers return a list of FAILURES, so empty is the passing answer. Asserting
   * `toEqual([])` rather than a length keeps the failure message useful: it prints the
   * broken link or the seal mismatch rather than "expected 1 to be 0".
   */
  it("writes a record that verifies, not one that merely exists", async () => {
    for (const f of STAGE_FIXTURES) {
      const audit = await svc.audit(f.caseId);
      expect(audit.chain, `${f.caseId} chain`).toEqual([]);
      expect(audit.seals, `${f.caseId} seals`).toEqual([]);
    }
  });
});
