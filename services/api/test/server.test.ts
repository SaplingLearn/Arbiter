import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
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
