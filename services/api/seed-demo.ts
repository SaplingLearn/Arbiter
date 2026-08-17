import type { AuthStoreApi } from "./postgres-auth.js";
import { buildStores } from "./stores.js";

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

// `AuthStoreApi`, not `AuthStore`: seeding is the same five `register` calls whichever
// store is behind them, and naming the concrete class here made the demonstration team
// creatable only on the file store - which is precisely backwards, since the deployment
// that most needs seeding on boot (ARBITER_DEMO_SEED, a fresh container) is the one
// running on Postgres.
export async function seedDemoTeam(auth: AuthStoreApi, now: number): Promise<SeedReport> {
  const created: string[] = [];
  const alreadyPresent: string[] = [];

  // Sequential, deliberately. `AuthStore.register` writes the whole store on every
  // call, so five registrations issued at once would each serialise a map that is
  // missing the other four - and the last write would land holding one account.
  for (const person of DEMO_TEAM) {
    if (await auth.findByEmail(person.email) !== null) {
      alreadyPresent.push(person.email);
      continue;
    }
    const r = await auth.register({
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
  // THROUGH buildStores, so this seeds whichever store the server will actually read.
  // It opened the users file directly, which meant that on a Postgres deployment
  // `npm run seed:demo` reported five accounts created into a file nothing loads, and
  // the product still booted with nobody able to sign in - a success message and an
  // empty product, which is the hardest pair of symptoms to connect.
  const { auth } = await buildStores("results/deliberation-log.jsonl");
  const report = await seedDemoTeam(auth, Date.now());

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
