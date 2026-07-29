import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ANCHORS, CONDITIONAL_ANCHORS, evidenceClaim, isKnownAnchor, parseAnchor,
  recordPosition, ruleAnchor, traceStep, type AnchorId,
} from "../src/ai/anchors.js";
import { StoreProvider } from "../src/state/store.js";
import { loadData } from "../src/data/load.js";
import { CaseTab } from "../src/tabs/Case/index.js";
import { CompoundsTab } from "../src/tabs/Compounds.js";
import { RulesetTab } from "../src/tabs/Ruleset.js";
import { ValidationTab } from "../src/tabs/Validation.js";
import { RecordTab } from "../src/tabs/Record.js";

const data = loadData();
const conditional = new Set<string>(CONDITIONAL_ANCHORS);
const at = (id: string) => document.querySelectorAll(`[data-anchor="${id}"]`);

const TABS = {
  case: <CaseTab />,
  compounds: <CompoundsTab />,
  ruleset: <RulesetTab />,
  validation: <ValidationTab />,
  record: <RecordTab />,
} as const;

/**
 * Unmounts whatever was rendered before. Several cases below render two tabs in
 * one test, and without this the querySelectorAll counts would silently span both
 * - which is how a per-tab uniqueness assertion turns into a no-op.
 */
const renderTab = (tab: keyof typeof TABS) => {
  cleanup();
  return render(<StoreProvider data={data}>{TABS[tab]}</StoreProvider>);
};

describe("the anchor registry (spec section 8)", () => {
  it("gives every entry a non-empty label, and no two entries the same one", () => {
    // The navigator's rung 4 matches keywords over these labels (spec section 7.1),
    // so a duplicate would make that rung ambiguous by construction.
    const labels = Object.values(ANCHORS).map((a) => a.label);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("declares a region for exactly the anchors inside the collapsing Case grid", () => {
    // `region` is load-bearing: a collapsed Case region UNMOUNTS its content, so
    // the navigator dispatches setFocus before it scrolls. The four header anchors
    // sit OUTSIDE that grid and are never collapsed - giving them a region would
    // make the navigator collapse two panels to reach something already on screen.
    const withRegion = Object.entries(ANCHORS).filter(([, a]) => a.region !== null).map(([id]) => id);
    expect(withRegion.sort()).toEqual([
      "evidence.citationStatus",
      "trace.beliefTrack",
      "trace.counterfactual",
      "trace.mass",
      "trace.nextExperiment",
      "trace.verdictReason",
    ]);
    for (const id of withRegion) expect(ANCHORS[id as AnchorId].tab, id).toBe("case");
  });

  it("builds every dynamic id through a constructor, so no prefix is hand-typed", () => {
    expect(traceStep("TAK-994:qsar")).toBe("trace.step:TAK-994:qsar");
    expect(evidenceClaim("TAK-994:qsar")).toBe("evidence.claim:TAK-994:qsar");
    expect(ruleAnchor("R3")).toBe("rule.R3");
    expect(recordPosition(0)).toBe("record.position:0");
  });

  it("PARSES BY PREFIX-SLICE, so a claim id keeps both of its colons", () => {
    // The trap spec section 8 names. Claim ids contain ":" and baseline names do too, so
    // split(":")[1] on this id yields "TAK-994" - a different, real-looking claim
    // prefix - and the navigator scrolls to the wrong row or to nothing.
    const claimId = "TAK-994:invivo_rodent";
    const parsed = parseAnchor(evidenceClaim(claimId));
    expect(parsed).not.toBeNull();
    expect(parsed!.payload).toBe(claimId);
    expect(parsed!.family).toBe("evidence.claim");
    expect(parsed!.anchor.region).toBe("evidence");
    // Written out so the trap is visible rather than described: this is what the
    // naive parse would have handed back.
    expect(evidenceClaim(claimId).split(":")[1]).toBe("TAK-994");
  });

  it("resolves the six rule anchors statically, because RuleId is a closed union", () => {
    for (const id of ["R1", "R2", "R3", "R4", "R5", "R6"] as const) {
      expect(isKnownAnchor(ruleAnchor(id)), id).toBe(true);
    }
  });

  it("rejects an id that is not in the registry, and a bare prefix carrying no target", () => {
    // Spec section 7.2: an id not in the registry is filtered. Spec section 7.2 also
    // forbids pointing at nothing, which a bare prefix does.
    expect(isKnownAnchor("trace.invented")).toBe(false);
    expect(isKnownAnchor("evidence.claim:")).toBe(false);
    expect(isKnownAnchor("rule.R7")).toBe(false);
    expect(isKnownAnchor("")).toBe(false);
  });

  it("declares every conditional anchor, so 'absent' is distinguishable from 'unknown'", () => {
    // The distinction spec section 7.2 rests on: an unknown id is dropped, a declared
    // one means switch tab, un-collapse, re-check.
    for (const id of CONDITIONAL_ANCHORS) {
      expect(isKnownAnchor(id), id).toBe(true);
      expect(Object.keys(ANCHORS), id).toContain(id);
    }
  });
});

describe("every declared anchor resolves in the DOM", () => {
  for (const tab of Object.keys(TABS) as (keyof typeof TABS)[]) {
    it(`${tab}: every unconditional anchor is present exactly once`, () => {
      // This is what catches a registry entry whose element was renamed - the
      // failure spec section 12 says the cheap content tests exist for.
      renderTab(tab);
      const declared = (Object.keys(ANCHORS) as AnchorId[])
        .filter((id) => ANCHORS[id].tab === tab && !conditional.has(id));
      expect(declared.length).toBeGreaterThan(0);
      for (const id of declared) expect(at(id).length, id).toBe(1);
    });
  }

  it("mounts the four conditional anchors that TAK-994 does satisfy", () => {
    // Conditional does not mean untested. On the registered ruleset with the whole
    // fixture visible the counterfactual, the planner's next experiment and the
    // citation status all render, so a rename of any of them fails here.
    renderTab("case");
    expect(at("trace.counterfactual").length).toBe(1);
    expect(at("trace.nextExperiment").length).toBe(1);
    expect(at("evidence.citationStatus").length).toBe(1);
    renderTab("validation");
    expect(at("validation.singleClassWarning").length).toBe(1);
  });

  it("mounts ruleset.modifiedBadge only once the ruleset diverges, and it is a known id while absent", () => {
    // The one anchor genuinely absent in the default state. Asserting only its
    // absence would pass on a deleted element, so the badge is made to appear.
    renderTab("ruleset");
    expect(at("ruleset.modifiedBadge").length).toBe(0);
    expect(isKnownAnchor("ruleset.modifiedBadge")).toBe(true);

    fireEvent.change(screen.getByTestId("strength-R3"), { target: { value: "0.05" } });
    expect(at("ruleset.modifiedBadge").length).toBe(1);
  });

  it("gives every evidence claim and every trace step its own anchor", () => {
    renderTab("case");
    for (const c of data.fixture.claims) expect(at(evidenceClaim(c.id)).length, c.id).toBe(1);
    // The fixture's ids carry a colon, so these are the prefix-slice cases in the DOM.
    expect(at(traceStep("TAK-994:toxicogenomics-murine")).length).toBe(1);
    expect(at(traceStep("TAK-994:qsar")).length).toBe(1);
  });

  it("anchors a recorded position once it exists", async () => {
    renderTab("record");
    expect(at(recordPosition(0)).length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /sign/i }));
    await waitFor(() => expect(at(recordPosition(0)).length).toBe(1));
  });
});

describe("data-anchor is a new attribute, not a reshaped testid", () => {
  it("leaves all ten Playwright-frozen testids in place", () => {
    // Frozen by apps/web/e2e/demo.spec.ts and static-file.spec.ts. Renaming any of
    // them breaks a spec this phase is forbidden to touch.
    renderTab("case");
    for (const id of ["verdict", "belief-fill", "citation-status"]) {
      expect(screen.getAllByTestId(id).length, id).toBeGreaterThan(0);
    }
    renderTab("ruleset");
    for (const id of ["live-belief", "strength-R1"]) {
      expect(screen.getAllByTestId(id).length, id).toBeGreaterThan(0);
    }
    fireEvent.change(screen.getByTestId("strength-R3"), { target: { value: "0.05" } });
    expect(screen.getAllByTestId("modified-badge").length).toBeGreaterThan(0);
    renderTab("validation");
    expect(screen.getAllByTestId("single-class-warning").length).toBeGreaterThan(0);
  });

  it("keeps the two different `provenance` testids apart under their own anchor", () => {
    // The collision that is the reason anchors get their own namespace: the
    // evidence provenance line and the Validation provenance line share one testid.
    renderTab("validation");
    expect(screen.getAllByTestId("provenance").length).toBe(1);
    expect(at("validation.provenance").length).toBe(1);

    renderTab("case");
    // Many evidence rows carry `provenance`; none of them answers to the
    // Validation tab's anchor, which is now unmounted.
    expect(screen.getAllByTestId("provenance").length).toBeGreaterThan(1);
    expect(at("validation.provenance").length).toBe(0);
  });
});
