/**
 * Put a deployment into the demonstration state, over HTTP, as many times as you like.
 *
 * WHY THIS EXISTS BESIDE `demo-reset.mjs` AND `seed-cases.ts`, which both already seed.
 * Those two write into a store they can open: `demo-reset.mjs` copies files on the same
 * machine, and `seedDemoCases` needs the service object, so both require being INSIDE
 * the deployment. A hosted container is neither - there is no shell, no volume to
 * snapshot, and the only surface it offers is the API. This drives that API exactly as a
 * person would: it registers, signs in as each panellist, submits positions, reveals,
 * adjudicates and signs. Nothing is written behind the product's back, so the hash chain
 * and the blind-submission guarantee mean the same thing afterwards as before.
 *
 * IDEMPOTENT BY STATE, NOT BY MEMORY. Every step asks what the case's status already is
 * and does only the work still missing, so re-running is safe and cheap, and a case
 * somebody has moved on by hand is left where they moved it. It cannot un-advance a
 * case: the record is append-only by design, and a tool that could rewind one would be a
 * tool that could rewrite a safety record.
 *
 * SO THE RESET IS A RESTART. On a container with no database the store dies with the
 * process, which makes "restart the service, then run this" a complete and honest reset
 * loop - and on a persistent store it is the same tool, just additive.
 *
 *   node tools/demo-stage.mjs                      against http://localhost:8787
 *   node tools/demo-stage.mjs https://host         against a deployment
 *
 * Practising the live demo:
 *   1. Restart the service (or `npm run demo:restore` locally).
 *   2. Run this.
 *   3. Sign in as r.okafor@arbiter.demo and rehearse.
 */
const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/+$/, "");
const PW = "arbiter-demo-2026";

const TEAM = [
  ["r.okafor@arbiter.demo", "R. Okafor (programme lead)"],
  ["a.silva@arbiter.demo", "A. Silva (toxicology)"],
  ["b.mehta@arbiter.demo", "B. Mehta (DMPK)"],
  ["c.lindqvist@arbiter.demo", "C. Lindqvist (clinical)"],
  ["d.abara@arbiter.demo", "D. Abara (project)"],
];
/** The panel, in roster order. The convener is TEAM[0] and answers nothing. */
const PANEL = TEAM.slice(1).map(([email]) => email);

/**
 * FOUR DIFFERENT CALLS, because a reveal where everyone agrees demonstrates nothing.
 * The split is the thing the product exists to record.
 */
const CALLS = ["do_not_advance", "advance", "cannot_conclude", "advance"];
const WHY = [
  "The animal signal sits at or below the exposure a patient receives, and I will not read a reversible finding in a healthy animal as reassurance for a patient who cannot stop dosing.",
  "The mechanism evidence is an assay artefact at a concentration hepatocytes never see, the histopathology is adaptive, and everything reversed on withdrawal. Monitorable with liver function tests.",
  "The two readings in front of me turn on a question this package does not answer, and I would rather record that than manufacture a call.",
  "Exposure margin and reversibility both point the same way, and the population has few alternatives. Advance with monitoring.",
];

/**
 * One case per stage the dashboard can show, against REAL compounds rather than the
 * `ARB-118` placeholders in `seed-cases.ts`. The stages are the point; using the library's
 * own cases means each card also carries findings a reader can open.
 */
const PLAN = [
  { name: "turalio", stage: "open", answers: 0 },
  { name: "slynd", stage: "open", answers: 2 },
  { name: "tak994", stage: "locked", answers: 4 },
  { name: "nipocalimab", stage: "adjudicated", answers: 4 },
  { name: "deucravacitinib", stage: "signed", answers: 4 },
];
/** How far along each status is, so "already past this" is a comparison and not a guess. */
const ORDER = { open: 0, locked: 1, adjudicated: 2, signed: 3 };

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

/**
 * The findings a position actually rests on, chosen by what they SAY.
 *
 * This used to take a slice of the list by index, which produced positions citing
 * evidence that had nothing to do with their call - a reviewer arguing do_not_advance
 * while pointing at the two findings that say the compound is safe. The citation check
 * passed, because it only asks whether a cited id exists; what it cannot ask is whether
 * the citation means anything, and that is exactly the thing a demonstration is showing
 * off. A reader who opens a position and finds its evidence unrelated learns the wrong
 * lesson about the product.
 *
 * So: a case AGAINST cites the toxic findings, a case FOR cites the safe ones, and an
 * abstention cites one of each - because "the evidence points both ways" is precisely
 * what cannot_conclude claims, and citing the conflict is how it is shown rather than
 * asserted. Falls back to whatever exists when a document has none of a given kind,
 * since a position must cite something.
 */
function cite(findings, call) {
  const of = (a) => findings.filter((f) => f.assertion === a).map((f) => f.id);
  const toxic = of("toxic"), safe = of("safe");
  const picked = call === "do_not_advance" ? toxic.slice(0, 3)
    : call === "advance" ? safe.slice(0, 3)
      : [...toxic.slice(0, 2), ...safe.slice(0, 2)];
  return picked.length > 0 ? picked : findings.slice(0, 2).map((f) => f.id);
}
const call = async (path, token, method = "GET", body) => {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await j(r) };
};
const login = async (email) => (await call("/api/auth/login", null, "POST", { email, password: PW })).body.token;
const now = () => new Date().toISOString();

console.log(`ARBITER demonstration state -> ${BASE}`);

/* ---- accounts ---------------------------------------------------------------
   Registered through the public route rather than seeded, because that is the only
   one a deployment exposes. A duplicate answers 409 and is reported as already there;
   the tool does not treat that as a failure, since "the account exists" is the goal. */
let made = 0, had = 0;
for (const [email, displayName] of TEAM) {
  const r = await call("/api/auth/register", null, "POST", { email, displayName, password: PW });
  if (r.status === 201) made++;
  else if (r.status === 409) had++;
  else console.log(`  account ${email}: ${r.status} ${JSON.stringify(r.body).slice(0, 90)}`);
}
console.log(`accounts: ${made} created, ${had} already there`);

const owner = await login(TEAM[0][0]);
if (owner === undefined) {
  console.error("Could not sign in as the convener. Is this the right host, and is the store reachable?");
  process.exit(1);
}

/* ---- cases ------------------------------------------------------------------ */
for (const p of PLAN) {
  process.stdout.write(`${p.name.padEnd(16)} ${p.stage.padEnd(12)} `);

  // Open it if it is not already on the dashboard. `/api/demo` mints one copy per
  // opener, so this is the same call the library page makes.
  const opened = await call("/api/demo", owner, "POST", { case: p.name, at: now() });
  if (opened.status >= 300) { console.log(`open failed ${opened.status}`); continue; }

  const mine = (await call("/api/cases", owner)).body;
  const kase = mine.find((c) => c.caseId.startsWith(p.name));
  if (kase === undefined) { console.log("not on the dashboard after opening"); continue; }

  if ((ORDER[kase.status] ?? 0) >= ORDER[p.stage] && kase.submitted >= p.answers) {
    console.log(`already ${kase.status}`);
    continue;
  }

  // Positions, by the first `answers` panellists, each citing findings that exist.
  if (p.answers > kase.submitted) {
    const ar = (await call(`/api/cases/${kase.caseId}/adjudication-request`, owner)).body;
    const findings = ar.findings ?? [];
    for (let i = kase.submitted; i < p.answers; i++) {
      const t = await login(PANEL[i]);
      const r = await call(`/api/cases/${kase.caseId}/positions`, t, "POST", {
        call: CALLS[i], reasoning: WHY[i],
        citedFindingIds: cite(findings, CALLS[i]), external: [], at: now(),
      });
      if (r.status !== 201) process.stdout.write(`pos${i}=${r.status} `);
    }
  }

  if (ORDER[p.stage] >= ORDER.locked) {
    const r = await call(`/api/cases/${kase.caseId}/reveal`, owner, "POST", { at: now(), mode: "all_in" });
    if (r.status !== 200) process.stdout.write(`reveal=${r.status} `);
  }
  if (ORDER[p.stage] >= ORDER.adjudicated) {
    // Runs against the stub on a deployment with no key, which is the point: a rehearsal
    // tool that spent three billed model calls per run is one people stop running.
    const r = await call(`/api/cases/${kase.caseId}/adjudicate`, owner, "POST", { at: now() });
    if (r.status !== 200) process.stdout.write(`adjudicate=${r.status} `);
  }
  if (ORDER[p.stage] >= ORDER.signed) {
    const r = await call(`/api/cases/${kase.caseId}/sign`, owner, "POST", {
      at: now(), agreesWithAdjudication: false,
      reason: "Holding for an exposure margin before this advances, whatever the split says.",
    });
    if (r.status !== 200) process.stdout.write(`sign=${r.status} `);
  }
  console.log("done");
}

const after = (await call("/api/cases", owner)).body;
console.log("\ndashboard");
for (const c of after) console.log(`  ${c.status.padEnd(12)} ${c.submitted}/${c.of}  ${c.compoundLabel}`);
console.log(`\nSign in as ${TEAM[0][0]} / ${PW}`);
