import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AuthStore } from "../auth.js";
import { DeliberationService } from "../deliberation-service.js";
import { MemoryStore } from "../store.js";
import { seedDemoCases } from "../seed-cases.js";
import { seedDemoTeam, DEMO_TEAM } from "../seed-demo.js";
import { CATALOGUE } from "../cases.js";
import type { EvidenceChecklist } from "../inventory.js";

/**
 * Opening the library cases on boot.
 *
 * The gap this closes is narrow and worth stating exactly: the case CONTENT was always
 * in git, so every clone had the same evidence. Nothing had ever OPENED it, so a
 * developer who pulled the repository and ran it saw an empty product and concluded the
 * data had not been shared. These tests hold the two guards that keep the fix from
 * becoming a way to write into somebody's real deployment, and hold the refusals shut.
 */
const CHECKLIST = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;

const NOW = Date.parse("2026-08-16T12:00:00Z");

const seeded = (): { service: DeliberationService; auth: AuthStore } => {
  const auth = new AuthStore(null);
  seedDemoTeam(auth, NOW);
  return { service: new DeliberationService(new MemoryStore(), CHECKLIST), auth };
};

describe("opening the library cases for a fresh clone", () => {
  it("opens every usable catalogue case and no others", () => {
    const { service, auth } = seeded();
    const report = seedDemoCases(service, auth, NOW);

    const usable = CATALOGUE.filter((c) => c.usable);
    expect(report.opened).toHaveLength(usable.length);
    expect(service.count()).toBe(usable.length);
    expect(report.skipped).toEqual([]);
  });

  it("never opens a refused case, so split_review.py's refusal is not decorative", () => {
    // Tolcapone is a scanned document and troglitazone is a labelling supplement. They
    // are in the catalogue BECAUSE they cannot become cases. If the seed could open one,
    // the refusal would be a label rather than a rule.
    const { service, auth } = seeded();
    seedDemoCases(service, auth, NOW);

    const mine = service.casesFor(auth.findByEmail(DEMO_TEAM[0].email)?.id ?? "");
    expect(CATALOGUE.filter((c) => !c.usable)).not.toHaveLength(0);
    for (const refused of CATALOGUE.filter((c) => !c.usable)) {
      expect(mine.some((c) => c.caseId.startsWith(refused.name))).toBe(false);
    }
  });

  it("names the demonstration owner as owner and the rest as the panel", () => {
    const { service, auth } = seeded();
    seedDemoCases(service, auth, NOW);

    const owner = auth.findByEmail(DEMO_TEAM[0].email);
    expect(owner).not.toBeNull();
    const mine = service.casesFor(owner?.id ?? "");
    expect(mine.length).toBe(CATALOGUE.filter((c) => c.usable).length);
    expect(mine.every((c) => c.isOwner)).toBe(true);

    // And every other member of the team can see them, which is the part that makes it a
    // deliberation rather than four private notes.
    for (const person of DEMO_TEAM.slice(1)) {
      const id = auth.findByEmail(person.email)?.id ?? "";
      expect(service.casesFor(id).length).toBe(mine.length);
    }
  });

  it("carries the evidence, not just the title", () => {
    // An opened case with no inventory would look right in the list and be empty when
    // clicked - the failure mode that is worse than no case at all, because it reads as
    // "the evidence was lost" rather than "nothing was opened".
    const { service, auth } = seeded();
    seedDemoCases(service, auth, NOW);

    const owner = auth.findByEmail(DEMO_TEAM[0].email);
    for (const c of service.casesFor(owner?.id ?? "")) {
      const inventory = service.inventory(c.caseId);
      expect(inventory).not.toBeNull();
    }
  });

  it("refuses to touch a store that already has a case in it", () => {
    // THE GUARD. A restart must not add a second copy of anything, and a deployment with
    // real cases in it must never have demonstration cases appear beside them.
    const { service, auth } = seeded();
    service.open({
      caseId: "real-case", compoundLabel: "Somebody's actual compound", context: "",
      ownerId: "u_real", participantIds: ["u_other"], findings: [], at: "2026-08-16T09:00:00Z",
    });

    const report = seedDemoCases(service, auth, NOW);
    expect(report.opened).toEqual([]);
    expect(service.count()).toBe(1);
  });

  it("is idempotent across restarts", () => {
    const { service, auth } = seeded();
    const first = seedDemoCases(service, auth, NOW);
    const second = seedDemoCases(service, auth, NOW + 1000);

    expect(first.opened.length).toBeGreaterThan(0);
    expect(second.opened).toEqual([]);
    expect(service.count()).toBe(first.opened.length);
  });

  it("opens nothing, and says why, when there is no demonstration team", () => {
    // Reachable legitimately: the account seed is guarded on an EMPTY account store, so a
    // deployment with real users and no demo team gets here. Opening the demonstration
    // cases under a real person's account would be worse than opening none.
    const service = new DeliberationService(new MemoryStore(), CHECKLIST);
    const report = seedDemoCases(service, new AuthStore(null), NOW);

    expect(report.opened).toEqual([]);
    expect(service.count()).toBe(0);
    expect(report.skipped[0]?.reason).toContain(DEMO_TEAM[0].email);
  });
});
