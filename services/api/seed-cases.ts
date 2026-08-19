import type { AuthStoreApi } from "./postgres-auth.js";
import type { DeliberationService } from "./deliberation-service.js";
import type { CoveringFinding } from "./inventory.js";
import type { CaseStatus, Position } from "./deliberation.js";

/**
 * Cases parked at each stage, so a fresh store has a product in it.
 *
 * `seedDemoTeam` creates five accounts and nothing else, which left a fresh deployment
 * showing "No cases yet" — a correct dashboard with nothing to demonstrate. Every stage
 * the product has (a case waiting on you, a case waiting on the room, a panel finished
 * and waiting on its convener, an adjudicated record, a signed one) had to be built by
 * hand before it could be looked at, and a stage nobody bothered to build was a stage
 * nobody ever saw.
 *
 * NOT A TEST FIXTURE, and the distinction matters for what may be taken as read. The
 * suites construct cases through the same service and assert on the result; this writes
 * into whatever store the deployment is configured with, so it has to be idempotent, it
 * has to refuse rather than half-finish, and every case it leaves behind has to pass the
 * audit a reader can open.
 *
 * NO MODEL CALL, EVER. The adjudication below is a fixed object recorded with
 * `source: "stub"`, which is the same label the free offline path applies. A seeder that
 * spent three billed calls per adjudicated stage is a seeder people would stop running,
 * and the fixture would rot. The cost of that choice is stated on the case itself: the
 * record carries the STUB banner, so nobody can mistake the words for a judgment about a
 * compound.
 */

/** The two findings every seeded case is built from: one human signal, one clean animal
 *  study, which is the disagreement the product exists to reconcile. Enough for a
 *  position to cite and for the inventory to have something to map. */
const FINDINGS: CoveringFinding[] = [
  {
    id: "f-hep", label: "Human hepatocyte panel", assertion: "toxic",
    detail: "Cytotoxicity at 10uM in primary human hepatocytes, three donors.", covers: ["M1"],
  },
  {
    id: "f-rat", label: "Rat 28-day oral", assertion: "safe",
    detail: "No adverse findings at 3x the projected clinical exposure.", covers: ["M5"],
  },
];

/**
 * A fixed adjudication, written here rather than generated.
 *
 * Shaped to match what `adjudicate.ts` returns so the record renders every block a real
 * one does — mechanism, consequence, one disclosure per rule, and the gaps. "Cannot
 * conclude" is the honest verdict for two findings that disagree with no exposure margin
 * between them, and it is also the least misleading thing for a fixture to say: a seeded
 * case asserting `do_not_advance` about a real compound name would be a sentence somebody
 * could screenshot.
 */
const STUB_ADJUDICATION = {
  mechanism: {
    present: true,
    pathway: "Hepatocellular injury, consistent with the 10uM human signal.",
    citedFindingIds: ["f-hep"],
  },
  consequence: {
    verdict: "cannot_conclude",
    reasoning:
      "The human and animal readings disagree and no exposure margin has been established "
      + "between them, so neither defeats the other on this evidence.",
    citedFindingIds: ["f-hep", "f-rat"],
  },
  ruleDisclosure: [
    {
      ruleId: "R1", position: "applies",
      reasoning: "Human-cell evidence is present, so the human-relevance rule is engaged.",
      citedFindingIds: ["f-hep"],
    },
  ],
  /* `{ field, whyItMatters }`, NOT a bare string, because that is what the report renders:
     `report.tsx` builds the "what is missing" table out of `m.field` and `m.whyItMatters`.
     This was written as `string[]` and nothing caught it - `adjudicate()` takes the
     adjudication as `unknown`, so the compiler had no shape to check it against, and this
     fixture's own test asserted only that the source was `stub`. The cost was invisible in
     every test and visible on the one screen the fixture exists to populate: a row of empty
     cells in the Record and the Report. */
  missing: [{
    field: "Exposure margin",
    whyItMatters:
      "Nothing relates the 10uM human signal to projected clinical exposure, so the two "
      + "readings cannot be placed on the same scale.",
  }],
  nextExperiment: null,
} as const;

/**
 * One position, cited so the reveal and the audit have something real to show.
 *
 * NO `as Position` HERE, deliberately. The first draft of this function cast its return
 * value, and the cast immediately earned its reputation: it carried `call: "hold"`, which
 * is not one of the three calls `Call` permits (`advance`, `do_not_advance`,
 * `cannot_conclude`). Nothing at runtime rejected it and every test passed — a seeded
 * store would simply have held positions whose call no screen knows how to render.
 * Returning the plain type is what makes the compiler read this literal.
 */
function positionFor(participantId: string, at: string, over: Partial<Position> = {}): Position {
  return {
    participantId,
    call: "do_not_advance",
    reasoning: "The human signal has no exposure margin behind it, so I am not ready to advance.",
    citedFindingIds: ["f-hep"],
    external: [],
    submittedAt: at,
    ...over,
  };
}

/**
 * WHAT EACH SEEDED CASE IS FOR, declared rather than implied by a sequence of calls.
 *
 * `answers` is how many of the four panellists have submitted, and `status` is where the
 * case is left. The test asserts the second against the store, so a fixture that stops
 * short of its declared stage fails rather than quietly producing a duller dashboard.
 *
 * ORDER IS THE DASHBOARD'S, roughly: the ones needing a reader come first. Nothing
 * depends on it, but a seeded store reads better when its cases are not shuffled.
 */
export interface StageFixture {
  caseId: string;
  compoundLabel: string;
  context: string;
  /** How many panellists have answered. The FIRST `answers` of the four, so which
   *  accounts have and have not answered is predictable from this number alone. */
  answers: number;
  status: CaseStatus;
  /** Whether the convener has signed, and whether they agreed. Only read when the
   *  fixture's status is `signed`. */
  sign?: { agrees: boolean; reason: string };
}

export const STAGE_FIXTURES: StageFixture[] = [
  {
    caseId: "demo-awaiting-everyone",
    compoundLabel: "ARB-118",
    context: "Opened this morning. Nobody has answered yet.",
    answers: 0,
    status: "open",
  },
  {
    caseId: "demo-part-answered",
    compoundLabel: "ARB-204",
    context: "Two of the four panel have answered. The reveal is not open until all are in.",
    answers: 2,
    status: "open",
  },
  {
    caseId: "demo-panel-done",
    compoundLabel: "ARB-311",
    context: "Everyone has answered and the positions are revealed. The verdict has not been run.",
    answers: 4,
    status: "locked",
  },
  {
    caseId: "demo-adjudicated",
    compoundLabel: "ARB-427",
    context: "Adjudicated and unsigned. The record says so, and says it is not a decision.",
    answers: 4,
    status: "adjudicated",
  },
  {
    caseId: "demo-signed",
    compoundLabel: "ARB-509",
    context: "Signed, with the convener holding against the adjudication and saying why.",
    answers: 4,
    status: "signed",
    sign: {
      agrees: false,
      reason: "Holding for an exposure margin before this advances, whatever the split says.",
    },
  },
];

export interface CaseSeedReport {
  created: string[];
  alreadyPresent: string[];
  /** Set, and human-readable, when nothing was done and the caller needs to know why. */
  skipped: string | null;
}

/**
 * Seed the fixtures above into whichever store this service is backed by.
 *
 * IDEMPOTENT BY EXISTENCE CHECK, one case at a time, because the alternative is worse in
 * both directions: throwing on the second run breaks the "safe to re-run" promise
 * `seed:demo` already makes, and appending regardless would put a second copy of every
 * case in the dashboard on every invocation. A case that is already there is reported and
 * left exactly as it is — including any state a person has since moved it to, which a
 * "seed harder" version would silently roll back.
 */
export async function seedDemoCases(
  svc: DeliberationService,
  auth: AuthStoreApi,
  now: number,
  /**
   * The roster, IN ORDER: the first address convenes and the rest answer.
   *
   * Passed in rather than imported from `seed-demo.ts`, and that is about module shape
   * rather than flexibility. `seed-demo.ts` calls this function, so importing its
   * `DEMO_TEAM` back here made a cycle - benign today, because the constant is only read
   * inside a function body, and exactly the kind of thing that stops being benign the
   * first time either module grows work at import time. Taking the roster as an argument
   * also makes this file say what it actually needs: a list of addresses, not a
   * particular fixture.
   */
  emails: readonly string[],
): Promise<CaseSeedReport> {
  const created: string[] = [];
  const alreadyPresent: string[] = [];

  const team = await Promise.all(emails.map((email) => auth.findByEmail(email)));
  // `?? null` rather than a non-null assertion: DEMO_TEAM is a literal with five entries
  // so `team[0]` is populated in practice, but under noUncheckedIndexedAccess the index
  // is `T | undefined`, and collapsing that into the same `null` the lookup already
  // returns means one guard below covers both "no such account" and "no such entry".
  const owner = team[0] ?? null;
  const panel = team.slice(1).flatMap((p) => (p === null || p === undefined ? [] : [p.id]));

  /**
   * ENOUGH PANEL TO MEAN WHAT THE FIXTURES SAY, reported rather than thrown.
   *
   * `panel.length === 0` was the whole check, and it was too weak in a way that produces
   * a seeded store which LOOKS right. Each fixture submits `panel.slice(0, f.answers)`, so
   * a short panel silently submits fewer positions than the fixture declares - and then
   * `lock` succeeds anyway, because "all_in" requires every PARTICIPANT to have answered
   * and on a short panel they all have. Nothing fails, and every status still matches its
   * fixture.
   *
   * What breaks is the meaning. `demo-part-answered` exists to be a case with the room
   * still out; on a two-person panel its two submissions are the whole panel, so it lands
   * fully answered and the dashboard files it under "Awaiting the panel" at 2 of 2. The
   * one distinction the fixtures were built to show - answered by you, not yet by the
   * others - quietly disappears, on a screen that still looks populated.
   *
   * EXACTLY the largest `answers`, not "at least" it, and the difference was worth
   * measuring rather than reasoning about. A longer roster looks harmless - the extra
   * people simply do not answer - and it is not: `demo-panel-done` and the two after it
   * have to REVEAL, "all_in" requires every participant to have answered, and a fifth
   * panellist who was never asked is one the reveal waits for forever. The seeder throws
   * mid-run with `Still waiting on u_...`, having already written three cases. So the
   * largest `answers` is not a minimum, it is the panel size these fixtures are written
   * against, and saying so up front is the difference between a refusal and a half-seeded
   * store.
   *
   * A duplicate address is refused because it would seat one person twice and make `of`
   * count them twice - every card's tally wrong, and no status check anywhere would
   * notice. The owner appearing on their own panel is refused because a convener holds no
   * position at all, which is the distinction `bucketOf` reads `isOwner` to make.
   */
  const needed = Math.max(...STAGE_FIXTURES.map((f) => f.answers));
  if (
    owner === null
    || panel.length !== needed
    || new Set(panel).size !== panel.length
    || panel.includes(owner.id)
  ) {
    return {
      created, alreadyPresent,
      skipped: `Seeding cases needs one convener and exactly ${String(needed)} distinct panellists, none of them the convener. Run \`npm run seed:demo\` first.`,
    };
  }

  // ISO strings, derived from one instant, so a seeded record reads as one morning's work
  // rather than as five cases that all happened in the same millisecond. The chain hashes
  // `at` as the string it arrives as (see the Supabase contract), so these are written
  // once and never reformatted.
  const stamp = (offsetMinutes: number): string => new Date(now + offsetMinutes * 60_000).toISOString();

  for (const [index, f] of STAGE_FIXTURES.entries()) {
    if (await svc.getCase(f.caseId) !== null) {
      alreadyPresent.push(f.caseId);
      continue;
    }

    const base = index * 30;
    await svc.open({
      caseId: f.caseId,
      compoundLabel: f.compoundLabel,
      context: f.context,
      ownerId: owner.id,
      participantIds: panel,
      findings: FINDINGS,
      at: stamp(base),
    });

    // The FIRST `f.answers` panellists, so which accounts have answered is predictable
    // from the fixture rather than from iteration order somewhere else.
    for (const [i, participantId] of panel.slice(0, f.answers).entries()) {
      const r = await svc.submit(f.caseId, positionFor(participantId, stamp(base + 1 + i)));
      // A refusal here is a bug in this file - a finding id that does not exist, a case
      // in the wrong state - not a condition to carry on through. Carrying on would
      // produce a case whose declared stage and real one disagree, which is the one
      // failure this fixture must not have.
      if (!r.ok) throw new Error(`seed-cases: ${f.caseId} rejected a position: ${r.error.detail}`);
    }

    if (f.status !== "open") {
      const revealed = await svc.reveal(f.caseId, owner.id, stamp(base + 10), "all_in");
      if (!revealed.ok) throw new Error(`seed-cases: ${f.caseId} would not reveal: ${revealed.error.detail}`);
    }

    if (f.status === "adjudicated" || f.status === "signed") {
      // `"stub"` as the actor, which is what `sourceOf` reads to label the adjudication -
      // so the record carries the STUB banner and nothing here can be mistaken for a
      // model's answer about a compound.
      const adj = await svc.adjudicate(f.caseId, STUB_ADJUDICATION, stamp(base + 15), "stub");
      if (!adj.ok) throw new Error(`seed-cases: ${f.caseId} would not adjudicate: ${adj.error.detail}`);
    }

    if (f.status === "signed") {
      const s = f.sign ?? { agrees: true, reason: "" };
      const signed = await svc.signOff(f.caseId, {
        by: owner.id,
        at: stamp(base + 20),
        agreesWithAdjudication: s.agrees,
        reason: s.reason,
      });
      if (!signed.ok) throw new Error(`seed-cases: ${f.caseId} would not sign: ${signed.error.detail}`);
    }

    created.push(f.caseId);
  }

  return { created, alreadyPresent, skipped: null };
}
