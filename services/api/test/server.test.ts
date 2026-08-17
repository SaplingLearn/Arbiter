import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { makeHandler, type ServerDeps } from "../server.js";
import { DeliberationService } from "../deliberation-service.js";
import { MemoryStore } from "../store.js";
import { AuthStore } from "../auth.js";
import { DocumentStore } from "../documents.js";
import { LibraryStore } from "../library.js";
import { InviteStore } from "../invites.js";
import { LoginThrottle } from "../throttle.js";
import { ModelBudget } from "../spend.js";
import { seedDemoTeam, DEMO_PASSWORD } from "../seed-demo.js";
import type { EvidenceChecklist, CoveringFinding } from "../inventory.js";
import { ADJUDICATOR_PROMPT_PATH, type AdjudicateRequest } from "../adjudicate.js";

const CHECKLIST = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
const PROMPT = JSON.parse(readFileSync(ADJUDICATOR_PROMPT_PATH, "utf8")) as { system: string[]; userTemplate: string[] };
const RULES: AdjudicateRequest["rules"] = [
  { id: "R1", name: "Human relevance", statement: "Human-cell evidence defeats animal in vivo.", enabled: true, strength: 0.9 },
];

const FINDINGS: CoveringFinding[] = [
  { id: "f-hep", label: "Human hepatocyte", assertion: "toxic", detail: "Signal at 10uM.", covers: ["M1"] },
  { id: "f-rat", label: "Rat 28-day", assertion: "safe", detail: "Clean at 3x.", covers: ["M5"] },
];

let server: Server;
let base: string;
/** Module-scoped so a test can stand a second handler on the same auth and service
 *  with one dependency swapped, rather than rebuilding the whole fixture. */
let deps: ServerDeps;
/** Bearer tokens and user ids, one per persona, keyed by a short handle. */
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};

const EMAIL: Record<string, string> = {
  owner: "r.okafor@arbiter.demo",
  ann: "a.silva@arbiter.demo",
  bea: "b.mehta@arbiter.demo",
  cal: "c.lindqvist@arbiter.demo",
};

beforeAll(async () => {
  const auth = new AuthStore(null);
  seedDemoTeam(auth, Date.now());
  const outsider = auth.register({ email: "outsider@elsewhere.test", displayName: "Outsider", password: "outsider-password", now: Date.now() });
  if (!outsider.ok) throw new Error("fixture");

  for (const [handle, email] of Object.entries({ ...EMAIL, outsider: "outsider@elsewhere.test" })) {
    const password = handle === "outsider" ? "outsider-password" : DEMO_PASSWORD;
    const r = auth.login({ email, password, now: Date.now() });
    if (!r.ok) throw new Error(`fixture login failed for ${handle}`);
    tok[handle] = r.value.token;
    uid[handle] = r.value.user.id;
  }

  deps = {
    service: new DeliberationService(new MemoryStore(), CHECKLIST),
    auth,
    documents: new DocumentStore(mkdtempSync(join(tmpdir(), "arb-docs-"))),
    library: new LibraryStore({ cacheRoot: mkdtempSync(join(tmpdir(), "arb-lib-")) }),
    invites: new InviteStore(null),
    throttle: new LoginThrottle(),
    // Deliberately generous: this suite drives many model-calling routes in one run and
    // the cap is not what any of these cases are measuring. `spend.test.ts` measures it.
    budget: new ModelBudget(10_000),
    rules: RULES,
    prompt: PROMPT,
  };
  const handler = makeHandler(deps);
  server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const call = async (
  method: string, path: string, who: string | null, body?: unknown,
): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(who === null ? {} : { authorization: `Bearer ${tok[who]}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

const position = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  call: "advance", reasoning: "Because.", citedFindingIds: ["f-hep"],
  external: [], submittedAt: "2026-08-09T10:00:00Z", ...over,
});

describe("authentication", () => {
  it("refuses every non-auth route without a token", async () => {
    for (const p of ["/api/cases", "/api/cases/c1/view", "/api/people", "/api/cases-catalogue"]) {
      const r = await call("GET", p, null);
      expect(r.status, p).toBe(401);
    }
  });

  it("refuses an invented token", async () => {
    const res = await fetch(`${base}/api/people`, { headers: { authorization: "Bearer deadbeef" } });
    expect(res.status).toBe(401);
  });

  it("logs in through the API and returns a usable token", async () => {
    const r = await call("POST", "/api/auth/login", null, { email: EMAIL["ann"], password: DEMO_PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.token).toMatch(/^[0-9a-f]{64}$/);
    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${r.body.token}` } });
    expect(me.status).toBe(200);
  });

  it("returns 401 for a wrong password, with no hint about which half was wrong", async () => {
    const r = await call("POST", "/api/auth/login", null, { email: EMAIL["ann"], password: "wrong-but-long-enough" });
    expect(r.status).toBe(401);
    expect(r.body.detail).toBe("Email or password is not right.");
  });

  it("logs out with 204 whether or not the token was real", async () => {
    const good = await call("POST", "/api/auth/logout", "cal");
    expect(good.status).toBe(204);
    const res = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { authorization: "Bearer nonsense" } });
    expect(res.status).toBe(204);
  });
});

describe("the askable library", () => {
  it("is readable by anyone signed in, and by nobody who is not", async () => {
    // These are public regulatory reviews that ship with the product, not case
    // material - the access boundary that guards a case would be borrowed authority
    // here. A session is still required: the list describes what this deployment holds.
    expect((await call("GET", "/api/library", null)).status).toBe(401);
    const r = await call("GET", "/api/library", "outsider");
    expect(r.status).toBe(200);
    expect(r.body.map((s: any) => s.name)).toContain("turalio");
  });

  it("answers nothing for a document that is not a library document", async () => {
    const r = await call("POST", "/api/library/enalapril/ask", "ann", { question: "Anything?" });
    expect(r.status).toBe(404);
  });

  it("refuses a refused document with the splitter's reason, before any model runs", async () => {
    // 422 and not 200-with-no-answer: the document was rejected at ingestion and the
    // reader is owed that fact, not an empty search over a file nobody could read.
    const r = await call("POST", "/api/library/tolcapone/ask", "ann", { question: "What liver findings are reported?" });
    expect(r.status).toBe(422);
    expect(r.body.detail).toContain("scanned document");
  });

  it("refuses a case that has no source document, and says which fact that is", async () => {
    const r = await call("POST", "/api/library/tak994/ask", "ann", { question: "What NOAEL was set?" });
    expect(r.status).toBe(422);
    expect(r.body.detail).toMatch(/no source document/i);
  });
});

describe("cases, with access control", () => {
  it("opens a case owned by the caller", async () => {
    const r = await call("POST", "/api/cases", "owner", {
      caseId: "c1", compoundLabel: "TAK-994", context: "Chronic dosing.",
      participantIds: [uid["ann"], uid["bea"]], findings: FINDINGS, at: "2026-08-09T09:00:00Z",
    });
    expect(r.status).toBe(201);
    expect(r.body.case.ownerId).toBe(uid["owner"]);
  });

  it("hides the case from an account not named on it, as a 404", async () => {
    // 404 rather than 403: a 403 would confirm the case exists, which is the one
    // fact an unauthorised caller is asking for.
    for (const p of ["view", "inventory", "audit", "unanimity"]) {
      const r = await call("GET", `/api/cases/c1/${p}`, "outsider");
      expect(r.status, p).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain("TAK-994");
    }
  });

  it("lists only the cases an account is named on", async () => {
    expect((await call("GET", "/api/cases", "ann")).body.map((c: any) => c.caseId)).toEqual(["c1"]);
    expect((await call("GET", "/api/cases", "outsider")).body).toEqual([]);
  });

  it("reports how many documents each case holds", async () => {
    // The Ask page picks a case from this list and can ask nothing of a case with an
    // empty folder. Without the count it cannot tell the two apart, so it opens on
    // whichever case happens to be first and answers "the documents do not say" to
    // everything - which reads as the model failing rather than as nothing uploaded.
    const list = (await call("GET", "/api/cases", "ann")).body[0];
    expect(list.documents).toBe(0);
  });

  it("counts the documents of the case they belong to, not of every case", async () => {
    // A second handler over the same auth and service, with only the document store
    // swapped: a real upload would put PyMuPDF behind an assertion about arithmetic.
    const stub = {
      forCase: (caseId: string) => (caseId === "c1" ? [{ id: "doc_1" }, { id: "doc_2" }] : []),
    } as unknown as ServerDeps["documents"];
    const handler = makeHandler({ ...deps, documents: stub });
    const alt = createServer((req, res) => { void handler(req, res); });
    await new Promise<void>((r) => alt.listen(0, "127.0.0.1", r));
    try {
      const res = await fetch(`http://127.0.0.1:${(alt.address() as AddressInfo).port}/api/cases`, {
        headers: { authorization: `Bearer ${tok["ann"]}` },
      });
      const body = await res.json() as { caseId: string; documents: number }[];
      expect(body.map((c) => [c.caseId, c.documents])).toEqual([["c1", 2]]);
    } finally {
      await new Promise<void>((r) => alt.close(() => r()));
    }
  });

  it("reports who has answered but never what they said", async () => {
    const list = (await call("GET", "/api/cases", "ann")).body[0];
    expect(list).toHaveProperty("submitted");
    expect(list).toHaveProperty("of");
    expect(JSON.stringify(list)).not.toContain("advance");
  });

  it("attributes a submission to the token, not to the body", async () => {
    const r = await call("POST", "/api/cases/c1/positions", "ann", position({ participantId: uid["bea"] }));
    expect(r.status).toBe(201);
    const view = await call("GET", "/api/cases/c1/view", "ann");
    expect(view.body.own.participantId).toBe(uid["ann"]);
  });

  it("returns no trace of another position over the wire before reveal", async () => {
    const r = await call("GET", "/api/cases/c1/view", "bea");
    expect(r.body.revealed).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain("Because.");
  });

  it("rejects a duplicate submission with 409", async () => {
    const r = await call("POST", "/api/cases/c1/positions", "ann", position());
    expect(r.status).toBe(409);
    expect(r.body.kind).toBe("already_submitted");
  });

  it("stops a participant revealing, adjudicating or signing", async () => {
    const attempts: [string, unknown][] = [
      ["reveal", { mode: "all_in", at: "t" }],
      ["adjudicate", { at: "t" }],
      ["sign", { at: "t", agreesWithAdjudication: true, reason: "" }],
    ];
    for (const [p, b] of attempts) {
      const r = await call("POST", `/api/cases/c1/${p}`, "ann", b);
      expect(r.status, p).toBe(403);
      expect(r.body.detail).toContain("decision owner");
    }
  });

  it("stops the owner submitting a position", async () => {
    // An owner who is not also a participant convenes and signs; they do not hold an
    // opinion on the record.
    const r = await call("POST", "/api/cases/c1/positions", "owner", position());
    expect(r.status).toBe(403);
  });

  it("runs the rest of the flow for the owner", async () => {
    expect((await call("POST", "/api/cases/c1/positions", "bea", position({ citedFindingIds: ["f-rat"] }))).status).toBe(201);
    expect((await call("POST", "/api/cases/c1/reveal", "owner", { mode: "all_in", at: "t" })).status).toBe(200);

    const u = await call("GET", "/api/cases/c1/unanimity", "owner");
    expect(u.body.unanimous).toBe(true);
    expect(u.body.concerns.join(" ")).toContain("nobody tested");

    const adj = await call("POST", "/api/cases/c1/adjudicate", "owner", { at: "t" });
    expect(adj.status).toBe(200);
    expect(["stub", "live"]).toContain(adj.body.source);

    const bad = await call("POST", "/api/cases/c1/sign", "owner", { at: "t", agreesWithAdjudication: false, reason: " " });
    expect(bad.status).toBe(400);
    const ok = await call("POST", "/api/cases/c1/sign", "owner", { at: "t", agreesWithAdjudication: false, reason: "Holding for a margin." });
    expect(ok.status).toBe(200);

    const audit = await call("GET", "/api/cases/c1/audit", "owner");
    expect(audit.body.chain).toEqual([]);
    expect(audit.body.seals).toEqual([]);
  });
});

describe("the case catalogue and demo seeding", () => {
  it("serves the catalogue to a signed-in caller", async () => {
    const r = await call("GET", "/api/cases-catalogue", "owner");
    expect(r.status).toBe(200);
    expect(r.body.filter((c: any) => !c.usable).map((c: any) => c.name)).toEqual(["tolcapone", "troglitazone"]);
  });

  it("returns 422 and the splitter's reason for a document it cannot process", async () => {
    const r = await call("POST", "/api/demo", "owner", { case: "tolcapone", participantIds: [uid["ann"]], at: "t" });
    expect(r.status).toBe(422);
    expect(r.body.splitterReason).toContain("needs OCR");
  });

  it("rejects a case name that is not in the catalogue", async () => {
    const r = await call("POST", "/api/demo", "owner", { case: "aspirin", participantIds: [uid["ann"]], at: "t" });
    expect(r.status).toBe(400);
  });

  it("seeds a usable case and returns its document scope", async () => {
    const r = await call("POST", "/api/demo", "owner", { case: "slynd", participantIds: [uid["ann"]], at: "t" });
    expect(r.status).toBe(201);
    expect(r.body.documentScope).toContain("THE SAFETY STUDIES FOR THIS DRUG WERE NEVER RUN");
  });

  /**
   * OPENING A PREPARED CASE BRINGS ITS DOCUMENT WITH IT.
   *
   * The case files carry findings transcribed out of a regulatory review, each with the
   * page it came from, and the library manifest knows which file that review is. Until
   * now those two facts never met: opening a case copied the findings and nothing else,
   * so Read & mark said "No documents on this case yet" on every case anybody opened,
   * and the reader - which joins a finding to a page THROUGH a document id - had
   * nothing to join to. Every case had to be assembled by hand to be usable at all.
   *
   * The source goes through the same measured upload path a person's own file does, so
   * a scanned or irrelevant source is refused here exactly as it would be there.
   *
   * The manifest is injected rather than read from disk: `data/raw/approval-packages/`
   * is deliberately untracked - 100MB of retrievable regulatory PDFs - so a test that
   * needed the real file would pass on a developer's machine and fail in CI.
   */
  it("attaches the source document and joins the findings to it", async () => {
    const root = mkdtempSync(join(tmpdir(), "arb-src-"));
    const path = join(root, "imaavy-assessment.pdf");
    writeFileSync(path, readablePdfBytes("nipocalimab-source"));

    const withSource = makeHandler({
      ...deps,
      documents: new DocumentStore(mkdtempSync(join(tmpdir(), "arb-docs2-"))),
      library: new LibraryStore({
        cacheRoot: mkdtempSync(join(tmpdir(), "arb-lib2-")),
        sources: [{ name: "nipocalimab", label: "Imaavy - assessment report", path }],
      }),
    });
    const srv = createServer((req, res) => { void withSource(req, res); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const at = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

    const ask = async (method: string, p: string, body?: unknown) => {
      const res = await fetch(`${at}${p}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${tok["bea"]}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, body: (await res.json()) as any };
    };

    try {
      const opened = await ask("POST", "/api/demo", { case: "nipocalimab", at: "t" });
      expect(opened.status).toBe(201);
      const caseId = opened.body.caseId;

      const docs = await ask("GET", `/api/cases/${caseId}/documents`);
      expect(docs.status).toBe(200);
      expect(docs.body, "the case should open holding its source review").toHaveLength(1);

      const req = await ask("GET", `/api/cases/${caseId}/adjudication-request`);
      const withPage = req.body.findings.filter((f: any) => f.sourcePage !== undefined);
      expect(withPage.length).toBeGreaterThan(0);
      // Every finding that names a page now names the document that page is in - which
      // is the whole join the reading surface makes.
      for (const f of withPage) {
        expect(f.sourceDocumentId, `${f.id} should point at the attached document`)
          .toBe(docs.body[0].id);
      }
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  /**
   * A source that cannot be read must not stop the case opening. The findings were
   * transcribed by hand and stand on their own; the document is what a reader would
   * LIKE to have beside them. Refusing the open would lose the case over the file.
   */
  it("still opens the case when the source document cannot be attached", async () => {
    const root = mkdtempSync(join(tmpdir(), "arb-src-bad-"));
    const path = join(root, "not-really.pdf");
    writeFileSync(path, Buffer.from("this is not a pdf at all"));

    const withBadSource = makeHandler({
      ...deps,
      documents: new DocumentStore(mkdtempSync(join(tmpdir(), "arb-docs3-"))),
      library: new LibraryStore({
        cacheRoot: mkdtempSync(join(tmpdir(), "arb-lib3-")),
        sources: [{ name: "slynd", label: "Slynd - review", path }],
      }),
    });
    const srv = createServer((req, res) => { void withBadSource(req, res); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const at = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

    try {
      const res = await fetch(`${at}/api/demo`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tok["bea"]}` },
        body: JSON.stringify({ case: "slynd", at: "t" }),
      });
      expect(res.status, "an unreadable source must not lose the case").toBe(201);
      const body = (await res.json()) as any;
      expect(body.inventory.entries.length).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it("gives each opener their own copy of a library case", async () => {
    // Regression. A fixed identifier meant the second person to open a library case
    // was told it already existed, sent to it, and met a 404 - because they were not
    // named on the copy the first person opened.
    const mine = await call("POST", "/api/demo", "owner", { case: "turalio", at: "t" });
    const theirs = await call("POST", "/api/demo", "ann", { case: "turalio", at: "t" });
    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect(mine.body.caseId).not.toBe(theirs.body.caseId);

    // And each one can actually read the copy they were handed.
    expect((await call("GET", `/api/cases/${mine.body.caseId}/view`, "owner")).status).toBe(200);
    expect((await call("GET", `/api/cases/${theirs.body.caseId}/view`, "ann")).status).toBe(200);
    // But not each other's.
    expect((await call("GET", `/api/cases/${mine.body.caseId}/view`, "outsider")).status).toBe(404);
  });

  it("re-opening a library case returns the copy you already have", async () => {
    const first = await call("POST", "/api/demo", "bea", { case: "slynd", at: "t" });
    const again = await call("POST", "/api/demo", "bea", { case: "slynd", at: "t" });
    expect(again.status).toBe(200);
    expect(again.body.alreadyOpen).toBe(true);
    expect(again.body.caseId).toBe(first.body.caseId);
  });
});

describe("the roster is on the record", () => {
  it("logs who was added and removed, and by whom", async () => {
    // The defect this covers: roster changes updated the case and left the chain
    // untouched, so a convener quietly dropping the person most likely to dissent
    // was invisible in the record the product exists to produce. Choosing who
    // answers is the strongest lever anybody has on the outcome.
    const open = await call("POST", "/api/cases", "owner", {
      caseId: "roster-1", compoundLabel: "Roster test", context: "",
      participantIds: [uid["ann"]], findings: FINDINGS, at: "t",
    });
    expect(open.status).toBe(201);

    expect((await call("POST", "/api/cases/roster-1/participants", "owner", { email: EMAIL["bea"] })).status).toBe(200);
    expect((await call("DELETE", `/api/cases/roster-1/participants/${uid["bea"]}`, "owner")).status).toBe(200);

    const audit = await call("GET", "/api/cases/roster-1/audit", "owner");
    const kinds = audit.body.entries.map((e: any) => e.kind);
    expect(kinds).toContain("participant_added");
    expect(kinds).toContain("participant_removed");

    const removal = audit.body.entries.find((e: any) => e.kind === "participant_removed");
    expect(removal.actorId).toBe(uid["owner"]);
    expect(removal.payload.participantId).toBe(uid["bea"]);
    // And the chain still verifies with the new entry kinds in it.
    expect(audit.body.chain).toEqual([]);

    /**
     * THE SEAT IS IN THE ENTRY. Spec §3.1 promises "the colours are recoverable from
     * the audit chain alone, without needing the database" - which was false: the
     * payload carried only a participant id, so the chain said somebody joined and
     * only the JSON projection said what colour they wear. store.ts is explicit that
     * the projection is a convenience and the LOG is the record.
     */
    const opened = audit.body.entries.find((e: any) => e.kind === "case_opened");
    expect(opened.payload.seats).toEqual({ [uid["ann"]!]: 0 });

    const added = audit.body.entries.find((e: any) => e.kind === "participant_added");
    expect(added.payload).toMatchObject({ participantId: uid["bea"], seat: 1 });
  });

  /**
   * Seats leave the server, and this is the only route that carries them. Without it
   * `DeliberationCase.seats` was allocated, stored, logged and never read - and every
   * badge on the client was uncoloured.
   *
   * Safe before the reveal: §3.4, a seat is identity, not position. It says which
   * colour somebody wears, not whether they have answered.
   */
  it("returns the seat allocation on the roster, and nothing progress-shaped", async () => {
    const r = await call("GET", "/api/cases/roster-1/participants", "ann");
    expect(r.status).toBe(200);
    // A removed participant KEEPS their seat so it is never reissued (seats.ts) -
    // bea was added and removed in the test above, and the map still holds her.
    expect(r.body.seats).toEqual({ [uid["ann"]!]: 0, [uid["bea"]!]: 1 });
    expect(Object.keys(r.body.seats)).not.toContain(uid["cal"]);
    // Nothing else came with it. Mark counts or per-person activity here would leak
    // progress through a route that is open for the whole blind phase.
    expect(Object.keys(r.body).sort()).toEqual(["members", "ownerId", "pending", "seats"]);
  });

  it("refuses roster changes from anybody but the convener", async () => {
    const r = await call("POST", "/api/cases/roster-1/participants", "ann", { email: EMAIL["bea"] });
    expect(r.status).toBe(403);
    expect(r.body.detail).toContain("decision owner");
  });

  it("freezes the roster once somebody has answered", async () => {
    expect((await call("POST", "/api/cases/roster-1/positions", "ann", position())).status).toBe(201);
    const r = await call("POST", "/api/cases/roster-1/participants", "owner", { email: EMAIL["bea"] });
    expect(r.status).toBe(409);
    expect(r.body.kind).toBe("has_answered");
  });
});

// TIMEOUT RAISED, and only here. Every other block in this file is an HTTP round trip
// against an in-process server and comfortably fits the 5s default. Upload does not:
// the server runs data/prep/measure_pdf.py in a child process on every PDF, so each of
// these tests pays a Python interpreter start plus a PyMuPDF import.
//
// In isolation that costs ~360ms. Under `npm test`, which runs 89 files in parallel,
// the same call has been measured past 5s purely from CPU contention - and because the
// measurement is a SYNCHRONOUS execFileSync, a starved child also blocks the server's
// event loop, which is why the timeout used to take the following test down with it as
// an ECONNRESET rather than failing alone.
//
// 20s is not a guess about how long the work takes; it is enough headroom that the
// figure being measured is the upload path rather than the machine's load average.
describe("document upload", { timeout: 20_000 }, () => {
  const upload = async (who: string, filename: string, bytes: Buffer): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}/api/cases/c1/documents`, {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-filename": filename, authorization: `Bearer ${tok[who]}` },
      body: bytes,
    });
    return { status: res.status, body: await res.json() };
  };

  it("refuses a file that is not a PDF, whatever it is named", async () => {
    // Checked on the bytes. An extension is a claim by the uploader; the header is a
    // property of the file.
    const r = await upload("ann", "study.pdf", Buffer.from("this is not a pdf"));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("not_a_pdf");
  });

  it("refuses an unreadable PDF with 422 and the measurement attached", async () => {
    const r = await upload("ann", "empty.pdf", Buffer.from("%PDF-1.4\n%%EOF\n"));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("unreadable");
    expect(typeof r.body.measurement?.reason).toBe("string");
  });

  it("refuses an upload from an account not on the case", async () => {
    const res = await fetch(`${base}/api/cases/c1/documents`, {
      method: "POST",
      headers: { "x-filename": "x.pdf", authorization: `Bearer ${tok["outsider"]}` },
      body: Buffer.from("%PDF-1.4\n"),
    });
    expect(res.status).toBe(404);
  });

  it("lists documents for a case", async () => {
    const r = await call("GET", "/api/cases/c1/documents", "ann");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });
});

/**
 * A minimal, hand-built PDF that PyMuPDF can actually read: one page, a content
 * stream carrying real text, a correct xref table. measure_pdf.py rejects anything
 * with no extractable toxicology vocabulary, so the raw-bytes tests below need a
 * document that clears that gate rather than a bare "%PDF-" header - the existing
 * "document upload" tests only exercise the refusal paths and never produce one.
 *
 * `variant` changes the embedded text, and therefore the content hash. DocumentStore
 * deduplicates uploads by sha256 across the WHOLE store, not per case - so two calls
 * uploaded to two different cases with identical bytes would collapse to the same
 * stored document (still attributed to whichever case uploaded it first), which would
 * make it impossible to get a real document id that genuinely belongs to a second case.
 */
/*
 * TUNED TO THE REAL GATE, which this branch tightened. The single-page, single-line
 * version this started as was refused with 422 `not_a_review`, and the refusal was
 * correct - it was not a review. measure_pdf.py wants, and these values come from
 * reading it rather than from guessing:
 *
 *   MIN_CHARS_PER_PAGE  40    a page under it counts as sparse
 *   REVIEW_TERMS        toxicolog >= 10, OR nonclinical + non-clinical >= 5
 *   MIN_TOX_DENSITY     0.25  toxicolog hits per page, when the nonclinical span
 *                             is shorter than MIN_CHAPTER_PAGES (12)
 *   liver terms         at least one
 *
 * Four pages of dense vocabulary clear all four with room to spare, and clearing them
 * honestly is the point: these tests now go through the same door a real upload does.
 */
const PAGE_LINES = [
  "Nonclinical toxicology review: toxicology summary of hepatic findings.",
  "Toxicology assessment, toxicology endpoints, and nonclinical toxicology data.",
  "Liver: ALT and AST elevations, transaminase changes, hepatic necrosis noted.",
  "Non-clinical toxicology NOAEL derivation; toxicology margins are stated.",
];
const PAGES = 4;

function readablePdfBytes(variant = ""): Buffer {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "", // Pages, filled once the kid ids are known
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  const kids: string[] = [];
  for (let p = 0; p < PAGES; p++) {
    const lines = [...PAGE_LINES, `Page ${p + 1} of the nonclinical toxicology review. ${variant}`.trim()];
    const content = `BT /F1 11 Tf 50 720 Td 14 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${PAGES} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

describe("raw document bytes", () => {
  // The case-scoping enforcement point. A mark means "this reviewer, reading the
  // evidence for THIS case, stopped here" - so a document that is not on the case
  // must not be reachable here, whatever its id. Resolving by bare id would admit
  // a library PDF nobody on this case was asked to read.
  const raw = (caseId: string, docId: string, who: string) =>
    fetch(`${base}/api/cases/${caseId}/documents/${docId}/raw`, {
      headers: { authorization: `Bearer ${tok[who]}` },
    });

  let docId: string;

  beforeAll(async () => {
    const res = await fetch(`${base}/api/cases/c1/documents`, {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-filename": "raw-test.pdf", authorization: `Bearer ${tok["owner"]}` },
      body: readablePdfBytes(),
    });
    const body = await res.json() as { document?: { id: string } };
    if (res.status !== 201 || body.document === undefined) {
      throw new Error(`fixture upload failed: ${res.status} ${JSON.stringify(body)}`);
    }
    docId = body.document.id;
  });

  it("serves a PDF that belongs to the case", async () => {
    const res = await raw("c1", docId, "owner");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  /**
   * THE SAME PUBLIC REVIEW CAN SIT ON TWO CASES, and it has to.
   *
   * Dedup by content hash is right WITHIN a case - re-sending a file you already sent
   * must not become a second document a second position can cite. Across cases it is
   * wrong: two people opening the same prepared case are each holding their own copy
   * of the same FDA review, and collapsing them hands the second person a document
   * that belongs to the first person's case. `forCase` then returns nothing, and a
   * finding pointing at it names a document that is not on the case it is filed under.
   *
   * That is the same defect the caseId suffix already fixed one level up: a prepared
   * case is a starting point, not a shared room.
   */
  it("keeps the same bytes on each case that uploads them", async () => {
    const send = (caseId: string, who: string) =>
      fetch(`${base}/api/cases/${caseId}/documents`, {
        method: "POST",
        headers: {
          "content-type": "application/pdf", "x-filename": "shared-review.pdf",
          authorization: `Bearer ${tok[who]}`,
        },
        body: readablePdfBytes("shared-across-cases"),
      });

    const made = await call("POST", "/api/cases", "owner", {
      caseId: "c-second-holder", compoundLabel: "Another compound", context: "",
      participantIds: [uid["ann"]], findings: FINDINGS, at: "2026-08-09T09:00:00Z",
    });
    expect(made.status).toBe(201);

    const first = await send("c1", "owner");
    expect(first.status).toBe(201);
    const second = await send("c-second-holder", "owner");
    expect(second.status).toBe(201);

    const idOf = async (r: Response) => ((await r.json()) as { document: { id: string } }).document.id;
    const a = await idOf(first);
    const b = await idOf(second);
    expect(a, "each case gets its own document record").not.toBe(b);

    // And each is reachable only through the case that holds it.
    expect((await raw("c1", a, "owner")).status).toBe(200);
    expect((await raw("c-second-holder", b, "owner")).status).toBe(200);
    expect((await raw("c-second-holder", a, "owner")).status).toBe(404);
  });

  // Within one case, the original behaviour stands: the same bytes twice is one
  // document, not two things a position could cite separately.
  it("still collapses a re-upload of the same file to one document", async () => {
    const send = () => fetch(`${base}/api/cases/c1/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/pdf", "x-filename": "again.pdf",
        authorization: `Bearer ${tok["owner"]}`,
      },
      body: readablePdfBytes("same-case-twice"),
    });
    const one = (await (await send()).json()) as { document: { id: string } };
    const two = (await (await send()).json()) as { document: { id: string }; duplicateOf?: string };
    expect(two.document.id).toBe(one.document.id);
    expect(two.duplicateOf).toBe(one.document.id);
  });

  // THE ENDPOINT'S ACTUAL USERS. The owner convenes and does not answer; it is the
  // reviewers who read the document. Every other test here drives it as the owner,
  // which would have passed just as happily against an owner-only route.
  it("serves the same bytes to a reviewer who is not the owner", async () => {
    const res = await raw("c1", docId, "ann");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  // Revalidatable, so paging through a 264-page review does not re-download it.
  // `private` because this is unpublished safety data and a shared cache must not
  // hold it.
  it("carries a validator and a private cache directive", async () => {
    const first = await raw("c1", docId, "owner");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(first.headers.get("cache-control")).toContain("private");
    await first.arrayBuffer();

    const again = await fetch(`${base}/api/cases/c1/documents/${docId}/raw`, {
      headers: { authorization: `Bearer ${tok["owner"]}`, "if-none-match": etag ?? "" },
    });
    expect(again.status).toBe(304);
  });

  it("refuses a document id that does not exist anywhere", async () => {
    const res = await raw("c1", "doc_not_on_this_case", "owner");
    expect(res.status).toBe(404);
  });

  // THE test that actually exercises case-scoping. A nonexistent id (above) cannot
  // distinguish a correct forCase() resolution from a regression to get(id): both
  // return nothing for an id that is in neither case. This one uses a REAL document
  // id that genuinely exists in the store - just on a different case - so it can
  // only pass if the lookup is actually scoped to c1.
  it("refuses a document id that is real, but belongs to a different case", async () => {
    const other = await call("POST", "/api/cases", "owner", {
      caseId: "c-other-case", compoundLabel: "Unrelated compound", context: "",
      participantIds: [uid["ann"]], findings: FINDINGS, at: "t",
    });
    expect(other.status).toBe(201);

    const upload = await fetch(`${base}/api/cases/c-other-case/documents`, {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-filename": "other-case.pdf", authorization: `Bearer ${tok["owner"]}` },
      body: readablePdfBytes("case-c-other-case"),
    });
    const uploadBody = await upload.json() as { document?: { id: string } };
    if (upload.status !== 201 || uploadBody.document === undefined) {
      throw new Error(`fixture upload failed: ${upload.status} ${JSON.stringify(uploadBody)}`);
    }
    const otherCaseDocId = uploadBody.document.id;

    // Sanity check: this id is real and reachable on the case it actually belongs to.
    const onItsOwnCase = await raw("c-other-case", otherCaseDocId, "owner");
    expect(onItsOwnCase.status).toBe(200);

    const res = await raw("c1", otherCaseDocId, "owner");
    expect(res.status).toBe(404);
  });

  // Matches the existing access boundary (server.ts, "the access boundary"): a case
  // you may not read answers 404, not 403, because a 403 would confirm the case
  // exists - the one fact an unauthorised caller is asking for. That check runs
  // before any tail is dispatched, so an outsider never reaches the raw route at all.
  it("still refuses somebody who is not on the case at all", async () => {
    const res = await raw("c1", docId, "outsider");
    expect(res.status).toBe(404);
  });

  it("returns a clean error, and stays up, when the stored file is missing from disk", async () => {
    const upload = await fetch(`${base}/api/cases/c1/documents`, {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-filename": "vanishing.pdf", authorization: `Bearer ${tok["owner"]}` },
      body: readablePdfBytes("vanishing-fixture"),
    });
    const uploadBody = await upload.json() as { document?: { id: string } };
    if (upload.status !== 201 || uploadBody.document === undefined) {
      throw new Error(`fixture upload failed: ${upload.status} ${JSON.stringify(uploadBody)}`);
    }
    const vanishingId = uploadBody.document.id;

    // Simulate the index and the file on disk drifting apart: the document record
    // still exists, but its bytes do not - deleted externally, a migration gap, a
    // disk issue.
    unlinkSync(deps.documents.pathFor(vanishingId));

    // The handler documents exactly this answer - 500 with `document_missing` - so
    // the test asserts it. "Any status in [400, 600)" passed for a 404, a 403 and a
    // crash-shaped 502 alike, which is to say it did not check the contract at all.
    const res = await raw("c1", vanishingId, "owner");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "document_missing" });

    // And the server itself is still up: an ordinary request right after still works,
    // which it would not if the missing file had thrown an unhandled stream error and
    // crashed the process.
    const still = await call("GET", "/api/cases/c1/documents", "owner");
    expect(still.status).toBe(200);
  });
});

/**
 * The document a finding was written against has to survive the round trip to the
 * client, because it is the only EXACT join between a finding and a page of a PDF.
 *
 * `sourceDocument` cannot do it: on every case in `data/cases/` it holds a dossier
 * identifier ("FDA NDA 211810"), not a filename, so string-matching it against an
 * upload never succeeds. The id was validated against the case on the way in and
 * then dropped on the way out, which left the reader's viewer with no highlights at
 * all on any real case.
 */
describe("a finding keeps its document", () => {
  let linkedDocId: string;

  beforeAll(async () => {
    const open = await call("POST", "/api/cases", "owner", {
      caseId: "c-linked", compoundLabel: "Linked findings", context: "",
      participantIds: [uid["ann"]], findings: FINDINGS, at: "t",
    });
    if (open.status !== 201) throw new Error(`fixture: ${open.status}`);

    const up = await fetch(`${base}/api/cases/c-linked/documents`, {
      method: "POST",
      headers: { "content-type": "application/pdf", "x-filename": "linked-review.pdf", authorization: `Bearer ${tok["owner"]}` },
      body: readablePdfBytes("linked-review"),
    });
    const body = await up.json() as { document?: { id: string } };
    if (up.status !== 201 || body.document === undefined) throw new Error(`fixture: ${up.status}`);
    linkedDocId = body.document.id;
  });

  it("carries sourceDocumentId back out on the route the client reads", async () => {
    const add = await call("POST", "/api/cases/c-linked/findings", "owner", {
      id: "f-linked", label: "ALT elevation", assertion: "toxic", detail: "3x ULN at week 4.",
      sourceDocumentId: linkedDocId, sourcePage: 88, covers: ["M1"],
    });
    expect(add.status).toBe(201);

    const req = await call("GET", "/api/cases/c-linked/adjudication-request", "ann");
    expect(req.status).toBe(200);
    const f = req.body.findings.find((x: any) => x.id === "f-linked");
    expect(f).toMatchObject({ sourceDocumentId: linkedDocId, sourcePage: 88 });
  });

  it("still refuses a document that is not on the case", async () => {
    const r = await call("POST", "/api/cases/c-linked/findings", "owner", {
      id: "f-foreign", label: "Elsewhere", assertion: "toxic", detail: "d",
      sourceDocumentId: "doc_not_here", covers: [],
    });
    expect(r.status).toBe(400);
    expect(r.body.detail).toContain("not on this case");
  });
});

describe("routing", () => {
  it("404s an unknown route and an unknown case rather than guessing", async () => {
    expect((await call("GET", "/api/nope", "owner")).status).toBe(404);
    expect((await call("GET", "/api/cases/ghost/inventory", "owner")).status).toBe(404);
  });

  it("405s a method the route does not implement", async () => {
    expect((await call("DELETE", "/api/cases/c1/positions", "owner")).status).toBe(405);
  });

  it("rejects a malformed JSON body rather than crashing", async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});
