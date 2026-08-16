import type { AuthStore } from "./auth.js";
import type { DeliberationService } from "./deliberation-service.js";
import { CATALOGUE, loadCase } from "./cases.js";
import { DEMO_TEAM } from "./seed-demo.js";

/**
 * Opens the four usable library cases on boot, for the demonstration team.
 *
 * WHAT THIS IS FOR. The case CONTENT has always been in git - `data/cases/*.json`,
 * `data/out/tak994.json`, `data/probe-case.json` - so every clone already had the same
 * evidence. What a clone did not have was any case OPEN: the store starts empty, cases
 * are created by a person clicking through the library picker, and so a developer who
 * pulled the repository and ran it saw a product with nothing in it and reasonably
 * concluded the data had not been shared. It had; nothing had opened it.
 *
 * This closes that gap and only that gap. It adds no evidence, invents no case, and
 * reads exactly what the picker reads.
 *
 * THE SAME PATH THE PICKER TAKES, deliberately, including the `--{ownerId}` suffix on
 * the case id (server.ts handleDemo). A second way to open a library case is a second
 * place for the screen and the seed to drift apart, and the first person to notice
 * would be someone comparing their copy against a colleague's.
 *
 * TWO GUARDS, mirroring the account seed. It runs only when ARBITER_DEMO_SEED is set,
 * and only into an EMPTY case store - so it can never appear beside real cases and
 * never resurrects a set somebody deleted on purpose. A case store with one real case
 * in it is left completely alone.
 *
 * THE REFUSALS ARE NOT SEEDED, and that is not an oversight. Tolcapone and troglitazone
 * exist in the catalogue precisely because they CANNOT become cases - a scanned document
 * and a labelling supplement - and `data/prep/split_review.py` refuses them rather than
 * trimming by hand. Opening them here would be the one thing that makes that refusal
 * decorative. They stay visible in the picker, which is where their reason is shown.
 */

export interface CaseSeedReport {
  /** Compound labels of the cases opened, in catalogue order. */
  opened: string[];
  /** Catalogue names that could not be opened, with the reason. */
  skipped: { name: string; reason: string }[];
}

export function seedDemoCases(
  service: DeliberationService,
  auth: AuthStore,
  now: number,
): CaseSeedReport {
  const report: CaseSeedReport = { opened: [], skipped: [] };

  // Cases only into an empty store. Checked FIRST, before any lookup, so the common
  // case - a developer restarting a server that already has their work in it - does no
  // work and cannot fail.
  if (service.count() > 0) return report;

  const owner = auth.findByEmail(DEMO_TEAM[0].email);
  if (owner === null) {
    // Not an error and not a throw. The account seed runs first and is guarded on an
    // empty ACCOUNT store, so a deployment with real users and no demo team reaches
    // here legitimately - and opening the demonstration cases under a real person's
    // account would be worse than opening nothing.
    return { opened: [], skipped: [{ name: "all", reason: `no account for ${DEMO_TEAM[0].email}; run \`npm run seed:demo\`` }] };
  }

  const panel = DEMO_TEAM
    .map((p) => auth.findByEmail(p.email)?.id)
    .filter((id): id is string => id !== undefined && id !== owner.id);

  if (panel.length === 0) {
    // A case needs somebody to answer it. One person deciding alone does not need this
    // product, and the service rejects it anyway.
    return { opened: [], skipped: [{ name: "all", reason: "the demonstration team has no panellists besides the owner" }] };
  }

  const at = new Date(now).toISOString();

  for (const entry of CATALOGUE) {
    if (!entry.usable) continue;

    let loaded;
    try {
      loaded = loadCase(entry.name);
    } catch (e) {
      // A missing or unreadable case file must not stop the server coming up. The three
      // that can be read are still worth having, and the banner names the one that could
      // not - a boot crash here would turn a data problem into "the product is broken".
      report.skipped.push({ name: entry.name, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }

    const caseId = `${loaded.caseId}--${owner.id}`;
    service.open({
      caseId,
      compoundLabel: loaded.compoundLabel,
      context: loaded.context,
      ownerId: owner.id,
      participantIds: panel,
      findings: loaded.findings,
      modality: loaded.modality,
      at,
    });
    report.opened.push(loaded.compoundLabel);
  }

  return report;
}
