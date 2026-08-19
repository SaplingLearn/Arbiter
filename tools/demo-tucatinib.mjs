/**
 * Open the Tukysa case, ready to be driven by hand. Run it again for a clean one.
 *
 * WHAT IT LEAVES YOU, by default: a case one keystroke from done. Evidence in, all four
 * positions sealed and revealed, the adjudication run against the live model - and the
 * signature, which is the one act the product insists a named person performs, left for
 * you. `--hands-on` stops earlier, after the seeding, if you would rather drive the whole
 * sequence on camera.
 *
 * THE SIGNATURE IS NEVER AUTOMATED HERE, in either mode. Everything above it is
 * reproducible setup; a signature is a person taking responsibility for a decision, and a
 * tool that forged one would make the record say something untrue about who decided.
 *
 * WHY IT DOES NOT CLEAN UP AFTER ITSELF. The record is append-only; there is no route
 * that deletes a case, deliberately, because a product that can quietly remove a
 * deliberation is not a record. So each run opens a NEW case and leaves the previous one
 * where it is. That is also what makes it safe mid-rehearsal: if something goes wrong
 * halfway through, run it again and start on a fresh one rather than trying to unwind
 * the old. `npm run demo:restore` is the way to clear the accumulation, between takes.
 *
 * THE PANEL IS FOUR AND YOU ARE ON IT. Seeding holds the uploader's seat when the
 * uploader is a participant, which is what lets one sign-in drive the whole thing - see
 * `seedFromFixture`. The other three arrive already answered, and they disagree three
 * ways, which is the thing the reveal exists to show.
 *
 *   node tools/demo-tucatinib.mjs              ready to SIGN: your position is filed,
 *                                              the panel is revealed, the verdict is in
 *   node tools/demo-tucatinib.mjs --hands-on   stops after seeding, so you drive every
 *                                              step yourself from Read & mark onwards
 */
import { readFileSync } from "node:fs";
import { request } from "node:http";

/* THROUGH THE VITE PROXY, NOT THE API PORT, and that is not incidental. `shareUrl` reads
   the request's Host header, so a case published against 127.0.0.1:8787 encodes a QR
   pointing at the API - which serves no site under `npm run dev` and answers 404. Going
   the way the browser goes produces the URL the browser would produce. */
const HOST = "localhost";
const PORT = 5173;
const PDF = "data/raw/approval-packages/tucatinib-213411-multidiscipline.pdf";
const FILENAME = "tucatinib-213411-multidiscipline.pdf";
const OWNER = "r.okafor@arbiter.demo";
const PANEL = ["a.silva@arbiter.demo", "b.mehta@arbiter.demo", "c.lindqvist@arbiter.demo"];
const PW = "arbiter-demo-2026";

function call(path, token, method = "GET", body, ct = "application/json") {
  return new Promise((resolve, reject) => {
    const p = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
    const req = request({
      host: HOST, port: PORT, path, method,
      headers: {
        ...(body === undefined ? {} : { "content-type": ct, "content-length": p.length }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(ct === "application/pdf" ? { "x-filename": FILENAME } : {}),
      },
      timeout: 0,
    }, (res) => {
      let out = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { out += d; });
      res.on("end", () => { let b = out; try { b = JSON.parse(out); } catch { /* text */ } resolve({ s: res.statusCode, b }); });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : p);
  });
}

const token = (await call("/api/auth/login", null, "POST", JSON.stringify({ email: OWNER, password: PW }))).b.token;
if (token === undefined) { console.error("Could not sign in. Is `npm run dev` up?"); process.exit(1); }

/* The context is the review's own words - the FDA's recommended indication and the dosing
   regimen table - because C5 and C6 turn on the exposed population and the treatment
   duration, and the adjudicator reads this field. */
const created = (await call("/api/cases", token, "POST", JSON.stringify({
  compoundLabel: "Tucatinib (TUKYSA, ONT-380)",
  context: "TUKYSA is indicated in combination with trastuzumab and capecitabine for adult patients with advanced unresectable or metastatic HER2-positive breast cancer, including patients with brain metastases, who have received one or more prior anti-HER2-based regimens. Dosing regimen: 300 mg orally twice daily; patients continued treatment until disease progression or unacceptable toxicity. Deciding whether the liver signal blocks advancement.",
  modality: "small_molecule",
  participantEmails: [OWNER, ...PANEL],
}))).b;
const id = created.case?.caseId;
if (id === undefined) { console.error("Could not open the case:", JSON.stringify(created).slice(0, 200)); process.exit(1); }
console.log(`case      ${id}`);

const up = await call(`/api/cases/${id}/documents`, token, "POST", readFileSync(PDF), "application/pdf");
if (up.s !== 201) { console.error(`upload failed ${up.s}: ${JSON.stringify(up.b).slice(0, 200)}`); process.exit(1); }
const seeded = up.b.seeded ?? {};
console.log(`document  ${FILENAME}`);
console.log(`seeded    ${seeded.findingsAdded} findings, ${seeded.positionsSealed} positions, your seat held open`);

const inv = (await call(`/api/cases/${id}/inventory`, token)).b;
const n = (state) => inv.entries.filter((e) => e.state === state).length;
console.log(`evidence  present=${n("present")} inconclusive=${n("inconclusive")} absent=${n("absent")}`);

const ar = (await call(`/api/cases/${id}/adjudication-request`, token)).b;
const anchored = (ar.findings ?? []).filter((f) => f.sourceDocumentId !== undefined && f.sourcePage !== undefined);
console.log(`citations ${anchored.length}/${(ar.findings ?? []).length} anchored to a page of the document`);

const handsOn = process.argv.includes("--hands-on");

if (!handsOn) {
  /* ONE SENTENCE, because a position is read aloud in a room and the panel already has
     three long ones. It cites the toxic findings, which is what a case against rests on. */
  const toxic = (ar.findings ?? []).filter((f) => f.assertion === "toxic").map((f) => f.id);
  const pos = await call(`/api/cases/${id}/positions`, token, "POST", JSON.stringify({
    call: "do_not_advance",
    reasoning: "The rat liver findings begin at roughly the exposure a patient receives at 300 mg twice daily, and three months of animal dosing does not cover a drug taken until progression.",
    citedFindingIds: toxic.slice(0, 3), external: [], at: new Date().toISOString(),
  }));
  console.log(`position  ${pos.s === 201 ? "filed - do_not_advance" : `failed ${pos.s}`}`);

  const rv = await call(`/api/cases/${id}/reveal`, token, "POST",
    JSON.stringify({ at: new Date().toISOString(), mode: "all_in" }));
  console.log(`reveal    ${rv.s === 200 ? (rv.b.revealed ?? []).map((p) => p.call).join(", ") : `failed ${rv.s}`}`);

  const t0 = Date.now();
  const ad = await call(`/api/cases/${id}/adjudicate`, token, "POST",
    JSON.stringify({ at: new Date().toISOString() }));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(ad.s === 200
    ? `verdict   ${ad.b.adjudication?.consequence?.verdict} (${ad.b.source}, ${secs}s), agreement ${ad.b.consensus?.votes}/${ad.b.consensus?.runs}`
    : `verdict   failed ${ad.s}`);

  console.log(`
Everything is done except the one thing that is yours:
  Sign it        http://localhost:5173/deliberation/#/case/${id}/reveal
  Then publish for the QR, and print from
                 http://localhost:5173/deliberation/#/case/${id}/report

Sign in as ${OWNER} / ${PW}`);
  process.exit(0);
}

console.log(`
Yours to drive, in this order:
  1. Read & mark    http://localhost:5173/deliberation/#/case/${id}/read
  2. Your position  http://localhost:5173/deliberation/#/case/${id}/position
  3. Reveal         http://localhost:5173/deliberation/#/case/${id}/reveal
  4. Adjudicate     on the reveal page - three runs, about two minutes
  5. Sign, then publish for the QR
  6. Report         http://localhost:5173/deliberation/#/case/${id}/report

Sign in as ${OWNER} / ${PW}`);
