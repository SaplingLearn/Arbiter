/**
 * Record what the model actually answers to the six suggested questions, per document.
 *
 * WHY RECORD RATHER THAN WRITE. A deployment with no key answers every question with
 * 503 `no_key`, so Ask - the surface whose whole point is a cited answer - is dead on the
 * hosted demo. The fix is not to invent answers: an invented answer is indistinguishable
 * on screen from a generated one, and this codebase refuses that shape everywhere else
 * (`source: "stub"` on an adjudication exists for exactly this reason). So the fixture is
 * a TRANSCRIPT. Every answer below was produced by the real model against the real
 * document, through the real retrieval, and is replayed verbatim - including the ones
 * where it declined to answer, which are the most honest thing in the file.
 *
 * WHAT IT COSTS TO REFRESH. One model call per question per document, run serially
 * because the budget in spend.ts counts calls per account per ten minutes and a parallel
 * sweep trips it. Six questions across four documents is twenty-four calls at roughly
 * fifteen seconds each.
 *
 *   npm run dev                     (with a key configured)
 *   node tools/record-ask.mjs       writes data/ask-fixture.json
 *
 * The recording is keyed by document NAME and by the exact question text, because that
 * is what the client sends. A question edited in `SUGGESTED` stops matching and falls
 * through to the live model - which is the correct failure: a stale recording answering a
 * question nobody asked would be worse than no recording at all.
 */
import { writeFileSync } from "node:fs";
import { request } from "node:http";

const PORT = Number(process.env["PORT"] ?? 8787);
const OUT = "data/ask-fixture.json";

/** Kept in step with `SUGGESTED` in apps/deliberation/src/pages.tsx by hand. A mismatch
 *  costs a fall-through to the model, not a wrong answer. */
const QUESTIONS = [
  "What exposure margin does the report give, and on what basis?",
  "What NOAEL was set, and in which study?",
  "What liver findings are reported, and at what doses?",
  "Which studies included a recovery or reversibility phase?",
  "What histopathology is described in the repeat-dose studies?",
  "What does the report say was not investigated?",
];

function call(path, token, body) {
  return new Promise((resolve, reject) => {
    const p = Buffer.from(body ?? "");
    const req = request({
      host: "127.0.0.1", port: PORT, path, method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json", "content-length": p.length }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
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

const token = (await call("/api/auth/login", null, JSON.stringify({
  email: "r.okafor@arbiter.demo", password: "arbiter-demo-2026",
}))).b.token;
if (token === undefined) { console.error("Could not sign in. Is `npm run dev` up?"); process.exit(1); }

/* The documents the LIBRARY offers, not every file in data/raw: those are the only ones
   the Ask page can be pointed at, and the only ones a deployment ships. */
const library = (await call("/api/library", token)).b;
const rows = (Array.isArray(library) ? library : library.sources ?? []).filter((s) => s.askable);
console.log(`recording ${QUESTIONS.length} questions against ${rows.length} askable documents`);

const fixture = {
  _note: "Transcripts, not compositions. Every answer here was produced by the model named below, against the real document, through the real retrieval. Replayed verbatim when no model is configured; see services/api/ask-fixture.ts.",
  recordedAt: new Date().toISOString(),
  answers: {},
};

for (const s of rows) {
  fixture.answers[s.name] = {};
  for (const question of QUESTIONS) {
    const t0 = Date.now();
    const r = await call(`/api/library/${encodeURIComponent(s.name)}/ask`, token,
      JSON.stringify({ question, history: [] }));
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (r.s !== 200) { console.log(`  ${s.name} :: ${r.s} - skipped`); continue; }
    fixture.answers[s.name][question] = {
      answerable: r.b.answerable,
      answer: r.b.answer,
      citedPassages: r.b.citedPassages ?? [],
      citations: r.b.citations ?? [],
      historyTurnsUsed: 0,
    };
    console.log(`  ${s.name.padEnd(18)} ${secs.padStart(3)}s  answerable=${String(r.b.answerable).padEnd(5)} citations=${(r.b.citations ?? []).length}  ${question.slice(0, 44)}`);
  }
}

writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
const n = Object.values(fixture.answers).reduce((a, m) => a + Object.keys(m).length, 0);
console.log(`\nwrote ${OUT}: ${n} recorded answers across ${Object.keys(fixture.answers).length} documents`);
