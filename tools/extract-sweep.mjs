/**
 * Run the extraction over several documents and report what a verdict could rest on.
 *
 * NOT A TEST. It spends real model calls - one per checklist item per document, so
 * roughly two minutes each - and its output is a table to read rather than an assertion
 * to pass. It exists because the thing being tuned (does an extraction leave the
 * consequence half empty?) cannot be seen from one document: the failure is a
 * distribution, and a prompt change that fixes tucatinib can break lorlatinib.
 *
 *   node tools/extract-sweep.mjs [n]     n documents, default 6
 *
 * Needs `npm run dev` up.
 */
import { readFileSync, existsSync } from "node:fs";
import { request } from "node:http";

/**
 * `fetch` rather than `node:http` was the obvious choice and the wrong one. Undici caps
 * the wait for response HEADERS at 300 seconds and that ceiling is not reachable through
 * the fetch options - it is a dispatcher setting, and undici is not a dependency here. An
 * extraction is one model call per checklist item and the sweep saw it pass five minutes,
 * so the harness aborted a request the server went on to answer. This posts the same JSON
 * with no timeout of its own.
 */
function post(path, token, body, contentType = "application/json") {
  return new Promise((resolve, reject) => {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
    const req = request({
      host: "127.0.0.1", port: 8787, path, method: "POST",
      headers: { "content-type": contentType, "content-length": payload.length,
        ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
      timeout: 0,
    }, (res) => {
      let out = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { out += d; });
      res.on("end", () => {
        let parsed = out;
        try { parsed = JSON.parse(out); } catch { /* leave as text */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

const A = process.env["ARBITER_API"] ?? "http://127.0.0.1:8787";
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

/* FDA reviews only - the question is whether an FDA import works. */
const DOCS = [
  "tucatinib-213411-multidiscipline.pdf",
  "lorlatinib-210868-multidiscipline.pdf",
  "alpelisib-212526-multidiscipline.pdf",
  "gilteritinib-211349-multidiscipline.pdf",
  "ponatinib-203469-pharmreview.pdf",
  "regorafenib-203085-pharmreview.pdf",
  "erdafitinib-212018-multidiscipline.pdf",
  "lumakras-214665-multidiscipline.pdf",
];

const limit = Number(process.argv[2] ?? 6);
const me = "r.okafor@arbiter.demo";
const tok = (await post("/api/auth/login", null,
  JSON.stringify({ email: me, password: "arbiter-demo-2026" }))).body.token;
const H = { authorization: `Bearer ${tok}`, "content-type": "application/json" };

const rows = [];
for (const name of DOCS.slice(0, limit)) {
  const path = `data/raw/approval-packages/${name}`;
  if (!existsSync(path)) { console.log(`skip ${name}: not in this checkout`); continue; }

  /* NO PARTICIPANTS BUT THE OWNER. A recognised document seeds prepared POSITIONS on
     upload, a position freezes the evidence, and frozen evidence refuses every finding
     an extraction proposes - the sweep saw 409 evidence_frozen on tucatinib and recorded
     it as an empty inventory. What is under test here is the extraction, so the case is
     opened with nobody who can answer before it runs. */
  const c = (await post("/api/cases", tok, JSON.stringify({
    compoundLabel: `SWEEP — ${name}`, context: "Extraction sweep.",
    modality: "small_molecule", participantEmails: [me],
  }))).body;
  const id = c.case?.caseId;
  if (id === undefined) { console.log(`skip ${name}: ${JSON.stringify(c).slice(0, 120)}`); continue; }

  const up = await post(`/api/cases/${id}/documents`, tok, readFileSync(path), "application/pdf");
  if (up.status !== 201) { console.log(`skip ${name}: upload ${up.status}`); continue; }

  const t0 = Date.now();
  let out;
  try {
    out = (await post(`/api/cases/${id}/extract`, tok, "{}")).body;
  } catch (e) {
    console.log(`${name}: extract FAILED - ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (!Array.isArray(out.proposals)) { console.log(`skip ${name}: ${JSON.stringify(out).slice(0, 140)}`); continue; }

  const findings = out.proposals.map((p) => ({
    id: `ext-${p.itemId.toLowerCase()}`, label: p.label, assertion: p.assertion, detail: p.detail,
    covers: [p.itemId], sourceDocumentId: p.documentId, sourcePage: p.page, sourceQuote: p.quote,
  }));
  let inv = null;
  if (findings.length > 0) {
    const acc = await post(`/api/cases/${id}/findings`, tok, JSON.stringify(findings));
    /* REPORTED, not swallowed. The first sweep recorded a refused accept as an inventory
       of zeros, which reads as "the extraction found nothing" - the opposite of what had
       happened. */
    if (acc.status !== 201) console.log(`   accept REFUSED ${acc.status}: ${JSON.stringify(acc.body).slice(0, 160)}`);
    inv = acc.body?.inventory ?? null;
  }
  const n = (s) => inv === null ? 0 : inv.entries.filter((e) => e.state === s).length;
  const conseq = inv === null ? [] : inv.entries.filter((e) => e.half === "consequence" && e.state === "present");
  const amb = out.proposals.filter((p) => p.assertion === "ambiguous").length;

  rows.push({
    doc: name.split("-")[0], secs,
    prop: out.proposals.length, amb, disc: out.discarded.length,
    present: n("present"), inconc: n("inconclusive"), absent: n("absent"),
    basis: conseq.length, items: conseq.map((e) => e.itemId).join("/") || "-",
  });
  const r = rows[rows.length - 1];
  console.log(`${r.doc.padEnd(13)} ${r.secs.padStart(3)}s  proposals ${String(r.prop).padStart(2)} (amb ${r.amb}, discarded ${r.disc})  present ${String(r.present).padStart(2)} inconc ${String(r.inconc)} absent ${String(r.absent).padStart(2)}  VERDICT BASIS ${r.basis} [${r.items}]`);
}

console.log("\n=== summary ===");
const dead = rows.filter((r) => r.basis === 0);
console.log(`documents: ${rows.length}`);
console.log(`mean proposals: ${(rows.reduce((s, r) => s + r.prop, 0) / Math.max(1, rows.length)).toFixed(1)}`);
console.log(`mean ambiguous: ${(rows.reduce((s, r) => s + r.amb, 0) / Math.max(1, rows.length)).toFixed(1)}`);
console.log(`mean verdict basis: ${(rows.reduce((s, r) => s + r.basis, 0) / Math.max(1, rows.length)).toFixed(1)}`);
console.log(`FORCED cannot_conclude (basis 0): ${dead.length} -> ${dead.map((r) => r.doc).join(", ") || "none"}`);
