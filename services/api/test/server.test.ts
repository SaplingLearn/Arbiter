import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { AddressInfo } from "node:net";
import { makeHandler, type ServerDeps } from "../server.js";
import { DeliberationService } from "../deliberation-service.js";
import { MemoryStore } from "../store.js";
import type { EvidenceChecklist, CoveringFinding } from "../inventory.js";
import type { AdjudicateRequest } from "../adjudicate.js";

const CHECKLIST = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
const PROMPT = JSON.parse(readFileSync("prompts/adjudicator-v1.0.json", "utf8")) as { system: string[]; userTemplate: string[] };
const RULES: AdjudicateRequest["rules"] = [
  { id: "R1", name: "Human relevance", statement: "Human-cell evidence defeats animal in vivo.", enabled: true, strength: 0.9 },
];

const FINDINGS: CoveringFinding[] = [
  { id: "f-hep", label: "Human hepatocyte", assertion: "toxic", detail: "Signal at 10uM.", covers: ["M1"] },
  { id: "f-rat", label: "Rat 28-day", assertion: "safe", detail: "Clean at 3x.", covers: ["M5"] },
];

let server: Server;
let base: string;

beforeAll(async () => {
  const deps: ServerDeps = {
    service: new DeliberationService(new MemoryStore(), CHECKLIST),
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
  method: string, path: string, actor: string | null, body?: unknown,
): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(actor === null ? {} : { "x-arbiter-user": actor }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
};

const openCase = (): Promise<{ status: number; body: any }> => call("POST", "/api/cases", "owner", {
  caseId: "c1", compoundLabel: "TAK-994", context: "Chronic dosing.",
  participantIds: ["ann", "bea"], findings: FINDINGS, at: "2026-08-09T09:00:00Z",
});

const position = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  call: "advance", reasoning: "Because.", citedFindingIds: ["f-hep"],
  external: [], submittedAt: "2026-08-09T10:00:00Z", ...over,
});

describe("deliberation API", () => {
  it("refuses any case route without an actor, because a blind view has no default viewer", async () => {
    const r = await call("GET", "/api/cases/c1/view", null);
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("no_actor");
  });

  it("opens a case and returns the published inventory", async () => {
    const r = await openCase();
    expect(r.status).toBe(201);
    expect(r.body.case.ownerId).toBe("owner");
    expect(r.body.inventory.entries).toHaveLength(CHECKLIST.items.length);
    expect(r.body.inventory.entries.find((e: any) => e.itemId === "M1").state).toBe("present");
  });

  it("attributes a submission to the header, not to the body", async () => {
    // A client that could name the author in the body could submit as somebody else.
    const r = await call("POST", "/api/cases/c1/positions", "ann", position({ participantId: "bea" }));
    expect(r.status).toBe(201);
    const view = await call("GET", "/api/cases/c1/view", "ann");
    expect(view.body.own.participantId).toBe("ann");
  });

  it("returns no trace of another participant's position over the wire before reveal", async () => {
    const r = await call("GET", "/api/cases/c1/view", "bea");
    expect(r.status).toBe(200);
    expect(r.body.revealed).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain("Because.");
    expect(r.body.others).toEqual([{ participantId: "ann", submitted: true }]);
  });

  it("rejects a duplicate submission with 409, not 500", async () => {
    const r = await call("POST", "/api/cases/c1/positions", "ann", position());
    expect(r.status).toBe(409);
    expect(r.body.kind).toBe("already_submitted");
  });

  it("rejects a citation naming nothing in the case with 400", async () => {
    const r = await call("POST", "/api/cases/c1/positions", "bea", position({ citedFindingIds: ["ghost"] }));
    expect(r.status).toBe(400);
    expect(r.body.kind).toBe("unknown_finding_id");
  });

  it("rejects a stranger with 403", async () => {
    const r = await call("POST", "/api/cases/c1/positions", "stranger", position());
    expect(r.status).toBe(403);
    expect(r.body.kind).toBe("not_a_participant");
  });

  it("refuses to lock while someone has not answered", async () => {
    const r = await call("POST", "/api/cases/c1/reveal", "owner", { at: "t", mode: "all_in" });
    expect(r.status).toBe(409);
    expect(r.body.kind).toBe("not_all_submitted");
  });

  it("reveals once everyone has answered", async () => {
    expect((await call("POST", "/api/cases/c1/positions", "bea", position({ citedFindingIds: ["f-rat"] }))).status).toBe(201);
    const r = await call("POST", "/api/cases/c1/reveal", "owner", { at: "t", mode: "all_in" });
    expect(r.status).toBe(200);
    expect(r.body.revealed).toHaveLength(2);
  });

  it("reports unanimity concerns without a model", async () => {
    const r = await call("GET", "/api/cases/c1/unanimity", "owner");
    expect(r.status).toBe(200);
    expect(r.body.unanimous).toBe(true);
    expect(r.body.concerns.join(" ")).toContain("nobody tested");
  });

  it("labels a stub adjudication as a stub in the response body", async () => {
    // A stub answer that travelled without its label would eventually be quoted as
    // a result. `source` rides along for the same reason probe.ts records it.
    const r = await call("POST", "/api/cases/c1/adjudicate", "owner", { at: "t" });
    expect(r.status).toBe(200);
    expect(["stub", "live"]).toContain(r.body.source);
    expect(r.body.adjudication.consequence).toBeDefined();
  });

  it("requires a reason to override, and records the signature", async () => {
    const bad = await call("POST", "/api/cases/c1/sign", "owner", { at: "t", agreesWithAdjudication: false, reason: " " });
    expect(bad.status).toBe(400);
    expect(bad.body.kind).toBe("override_needs_reason");

    const ok = await call("POST", "/api/cases/c1/sign", "owner", { at: "t", agreesWithAdjudication: false, reason: "Holding for an exposure margin." });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("signed");
  });

  it("serves an audit whose chain and seals both verify", async () => {
    const r = await call("GET", "/api/cases/c1/audit", "owner");
    expect(r.status).toBe(200);
    expect(r.body.chain).toEqual([]);
    expect(r.body.seals).toEqual([]);
    expect(r.body.entries.map((e: any) => e.kind)).toContain("position_sealed");
  });

  it("keeps position plaintext out of the audit entries served mid-case", async () => {
    const r = await call("GET", "/api/cases/c1/audit", "ann");
    const sealed = r.body.entries.filter((e: any) => e.kind === "position_sealed");
    expect(sealed.length).toBeGreaterThan(0);
    for (const e of sealed) expect(JSON.stringify(e.payload)).not.toContain("Because.");
  });

  it("404s an unknown route and an unknown case rather than guessing", async () => {
    expect((await call("GET", "/api/nope", "owner")).status).toBe(404);
    expect((await call("GET", "/api/cases/ghost/inventory", "owner")).status).toBe(404);
  });

  it("405s a method the route does not implement", async () => {
    expect((await call("DELETE", "/api/cases/c1/positions", "owner")).status).toBe(405);
  });
});
