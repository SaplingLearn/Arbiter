import { AuthStore } from "./auth.js";

/**
 * Creates the demonstration team.
 *
 * THESE ARE REAL ACCOUNTS WITH A SHARED, PUBLISHED PASSWORD. That is a deliberate
 * and clearly-labelled fixture, not a back door: the authentication path is the same
 * one a real account uses - scrypt, timing-safe comparison, bearer tokens, expiry.
 * What is fake is the secrecy of the password, and it is printed here so nobody has
 * to wonder.
 *
 * DELETE THEM BEFORE ANY REAL DATA. `results/deliberation-log.jsonl.users.json` is
 * the file; removing it removes every account. The server prints the account count
 * on boot so a forgotten demo team is visible rather than silent.
 *
 * The four panellists and one owner match the personas in the terminal demo, so the
 * screen and `npm run deliberate:demo` describe the same room.
 */

export const DEMO_PASSWORD = "arbiter-demo-2026";

export const DEMO_TEAM = [
  { email: "r.okafor@arbiter.demo", displayName: "R. Okafor (programme lead)", role: "owner" },
  { email: "a.silva@arbiter.demo", displayName: "A. Silva (toxicology)", role: "panel" },
  { email: "b.mehta@arbiter.demo", displayName: "B. Mehta (DMPK)", role: "panel" },
  { email: "c.lindqvist@arbiter.demo", displayName: "C. Lindqvist (clinical)", role: "panel" },
  { email: "d.abara@arbiter.demo", displayName: "D. Abara (project)", role: "panel" },
] as const;

export interface SeedReport {
  created: string[];
  alreadyPresent: string[];
}

export function seedDemoTeam(auth: AuthStore, now: number): SeedReport {
  const created: string[] = [];
  const alreadyPresent: string[] = [];

  for (const person of DEMO_TEAM) {
    if (auth.findByEmail(person.email) !== null) {
      alreadyPresent.push(person.email);
      continue;
    }
    const r = auth.register({
      email: person.email,
      displayName: person.displayName,
      password: DEMO_PASSWORD,
      now,
    });
    // Registration can only fail here for reasons that are bugs in this file - a
    // malformed fixture address or a password below the floor - so it throws rather
    // than being swallowed into a half-seeded team.
    if (!r.ok) throw new Error(`seed failed for ${person.email}: ${r.error.detail}`);
    created.push(person.email);
  }

  return { created, alreadyPresent };
}

if (process.argv[1] !== undefined && process.argv[1].includes("seed-demo")) {
  const auth = new AuthStore("results/deliberation-log.jsonl.users.json");
  const report = seedDemoTeam(auth, Date.now());

  console.log("ARBITER demonstration team");
  console.log("=".repeat(60));
  for (const e of report.created) console.log(`  created   ${e}`);
  for (const e of report.alreadyPresent) console.log(`  existed   ${e}`);
  console.log("");
  console.log(`  Password (shared, for all five): ${DEMO_PASSWORD}`);
  console.log("");
  console.log("  Real accounts on the real authentication path. What is fake is the");
  console.log("  secrecy of the password. Delete results/deliberation-log.jsonl.users.json");
  console.log("  before this holds anything that matters.");
}
