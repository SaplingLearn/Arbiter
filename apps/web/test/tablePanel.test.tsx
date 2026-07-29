import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider, useAppState, workingClaims } from "../src/state/store.js";
import { TablePanel, claimLabel } from "../src/tabs/Case/TablePanel.js";
import { interpret } from "../src/ai/interpret.js";
import { loadData } from "../src/data/load.js";

// A real spy over the REAL interpreter. Stubbing it out would test a fake ladder;
// wrapping it lets the request body be inspected while the rungs still run.
vi.mock("../src/ai/interpret.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ai/interpret.js")>();
  return { ...actual, interpret: vi.fn(actual.interpret) };
});
const interpretSpy = vi.mocked(interpret);

const data = loadData();

/**
 * Reads the working copies back out of the store. Apply must dispatch the SAME
 * actions a user could dispatch by hand, so the test observes the state those
 * actions produce rather than the calls that produced it.
 */
function Probe() {
  const state = useAppState();
  const claims = workingClaims(state, state.selectedCompoundId);
  return (
    <div>
      <span data-testid="probe-r1">{state.ruleset.rules.find((r) => r.id === "R1")?.strength.toFixed(2)}</span>
      <span data-testid="probe-r3-enabled">{String(state.ruleset.rules.find((r) => r.id === "R3")?.enabled)}</span>
      <span data-testid="probe-r5">{state.ruleset.rules.find((r) => r.id === "R5")?.strength.toFixed(2)}</span>
      <span data-testid="probe-cytotox">
        {String(claims.find((c) => c.id === "TAK-994:cytotox")?.exposureRelevant)}
      </span>
    </div>
  );
}

const renderPanel = () =>
  render(
    <StoreProvider data={data}>
      <TablePanel collapsed={false} onExpand={() => {}} />
      <Probe />
    </StoreProvider>,
  );

async function challenge(text: string) {
  fireEvent.change(screen.getByTestId("challenge-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("challenge-submit"));
  await screen.findByTestId("proposal-rung");
}

const R1_LOWER = "the rat data shouldn't be discounted that hard";
const R3_DISABLE = "why does R3 only apply to negative findings? that looks convenient";
const R3_LOWER = "isn't the discounting just a fudge factor to get the answer you wanted";
const R5_LOWER = "klimisch 3 gets hammered too hard here. plenty of non-GLP work is perfectly sound";
const CYTOTOX =
  "the in-vitro panel was run against clinical Cmax — a hundred-fold margin IS an exposure margin. stop calling it untested";

describe("TablePanel - the request", () => {
  it("sends claim ids and labels ONLY, never a raw evidence value", async () => {
    // Design section 5. The model is never shown what the evidence SAYS, which is
    // why the old->new delta has to be resolved in the browser. A whitelist, not a
    // blacklist: `stream` travels inside the id by construction of the fixture's
    // ids, so the guarantee worth enforcing is that NOTHING beyond the id and its
    // derived label leaves here.
    interpretSpy.mockClear();
    renderPanel();
    await challenge(R1_LOWER);

    const input = interpretSpy.mock.calls[0]?.[0];
    expect(input).toBeDefined();
    expect(Object.keys(input!).sort()).toEqual(["challenge", "claims", "rules"]);

    for (const c of input!.claims) {
      expect(Object.keys(c).sort()).toEqual(["id", "label"]);
      expect(c.label).toBe(claimLabel(c.id));
    }
    for (const r of input!.rules) {
      expect(Object.keys(r).sort()).toEqual(["enabled", "id", "strength"]);
    }

    const claimsBody = JSON.stringify(input!.claims);
    for (const key of [
      "assertion", "strength", "provenance", "availableFrom", "compoundId",
      "measuresKeyEvent", "exposureRelevant", "inApplicabilityDomain", "klimisch", "system", "stream",
    ]) {
      expect(claimsBody, `evidence key ${key} reached the request`).not.toContain(`"${key}"`);
    }

    const whole = JSON.stringify(input);
    for (const c of data.fixture.claims) {
      expect(whole).not.toContain(c.provenance.source);
    }
    expect(whole).not.toContain("UNVERIFIED");
  });
});

describe("TablePanel - the change is displayed before it is applied", () => {
  it("renders the proposal and touches nothing until Apply", async () => {
    renderPanel();
    await challenge(R1_LOWER);

    expect(screen.getByTestId("proposal-rung").dataset.rung).toBe("2");
    expect(screen.getByTestId("proposal-delta").textContent).toBe("R1 strength: 0.90 → 0.45");
    // Not applied: the store still holds the registered strength and no delta panel
    // exists yet. A silent application is exactly the failure section 5.2 forbids.
    expect(screen.getByTestId("probe-r1").textContent).toBe("0.90");
    expect(screen.queryByTestId("applied-delta")).toBeNull();
  });

  it("resolves the old->new evidence delta LOCALLY for a reclassify", async () => {
    // The interpreter proposed `exposureRelevant -> true` without ever being told
    // what the current value is. `null -> true` can therefore only have been
    // computed here.
    renderPanel();
    await challenge(CYTOTOX);
    expect(screen.getByTestId("proposal-delta").textContent).toBe("cytotox · exposureRelevant: null → true");
    expect(screen.getByTestId("probe-cytotox").textContent).toBe("null");
  });

  it("applies nothing on Reject", async () => {
    renderPanel();
    await challenge(R1_LOWER);
    fireEvent.click(screen.getByTestId("proposal-reject"));
    expect(screen.queryByTestId("proposal")).toBeNull();
    expect(screen.getByTestId("probe-r1").textContent).toBe("0.90");
    expect(screen.queryByTestId("applied-delta")).toBeNull();
  });

  it("offers the rule picker rather than a guess when the ladder is exhausted", async () => {
    renderPanel();
    await challenge("what is the weather like in Groton");
    expect(screen.getByTestId("proposal-rung").dataset.rung).toBe("5");
    expect(screen.queryByTestId("proposal")).toBeNull();
    expect(screen.getByTestId("rule-picker")).toBeTruthy();
  });
});

describe("TablePanel - confidence and action are legible before Apply", () => {
  it("arms Apply on a high-confidence reading and NOT on a low-confidence one", async () => {
    // Design section 5.2: `confidence: "low"` never arrives pre-armed, and its
    // paraphrase is shown at raised weight.
    renderPanel();
    await challenge(R1_LOWER);
    expect(screen.getByTestId("proposal-apply").dataset.armed).toBe("true");
    expect(screen.getByTestId("proposal-paraphrase").dataset.emphasis).toBe("normal");

    fireEvent.click(screen.getByTestId("proposal-reject"));
    await challenge(R3_LOWER);
    expect(screen.getByTestId("proposal-apply").dataset.armed).toBe("false");
    expect(screen.getByTestId("proposal-apply")).toBeDisabled();
    expect(screen.getByTestId("proposal-paraphrase").dataset.emphasis).toBe("raised");
  });

  it("renders disable distinctly from a strength change at the SAME confidence", async () => {
    // Both authored R3 challenges are low-confidence and object to the same rule.
    // Measured: disabling R3 takes TAK-994 from abstain to advance; lowering it
    // moves nothing, because R3 acts here as a defeat rule and a defeat reads
    // `enabled`, not `strength`. Two readings of one objection, one whole verdict
    // apart - so confidence cannot be what distinguishes them on screen.
    renderPanel();
    await challenge(R3_DISABLE);
    expect(screen.getByTestId("proposal").dataset.confidence).toBe("low");
    expect(screen.getByTestId("proposal").dataset.actionKind).toBe("disable");

    fireEvent.click(screen.getByTestId("proposal-reject"));
    await challenge(R3_LOWER);
    expect(screen.getByTestId("proposal").dataset.confidence).toBe("low");
    expect(screen.getByTestId("proposal").dataset.actionKind).toBe("strength");
  });
});

describe("TablePanel - Apply and the delta", () => {
  it("dispatches the same rule action a user could dispatch by hand", async () => {
    renderPanel();
    await challenge(R1_LOWER);
    fireEvent.click(screen.getByTestId("proposal-apply"));
    expect(screen.getByTestId("probe-r1").textContent).toBe("0.45");
  });

  it("dispatches the same evidence action a user could dispatch by hand", async () => {
    renderPanel();
    await challenge(CYTOTOX);
    fireEvent.click(screen.getByTestId("proposal-apply"));
    expect(screen.getByTestId("probe-cytotox").textContent).toBe("true");
  });

  it("reports belief, plausibility and the gap - NOT the verdict label alone", async () => {
    // The hero case. Belief nearly quintuples and the label does not move, so a
    // verdict-only delta would read "nothing happened" on the hero case.
    renderPanel();
    await challenge(R1_LOWER);
    fireEvent.click(screen.getByTestId("proposal-apply"));

    const delta = screen.getByTestId("applied-delta");
    expect(delta.dataset.moved).toBe("true");
    expect(screen.getByTestId("delta-belief").textContent).toBe("Belief 0.090 → 0.495");
    expect(screen.getByTestId("delta-plausibility").textContent).toBe("Plausibility 1.000 → 1.000");
    expect(screen.getByTestId("delta-gap").textContent).toBe("Gap 0.910 → 0.505");
    expect(screen.getByTestId("delta-verdict").textContent).toBe("Verdict abstain → abstain");
  });

  it("treats 'applied - the position did not move' as a first-class state, with a computed reason", async () => {
    // Measured in Step 2: R5 cannot move TAK-994. `relevanceDiscount` cites R5 only
    // on TAK-994:qsar, which asserts ambiguous at strength 0.00 and commits no mass
    // to either side. The panel must say that, computed from the claims in front of
    // it, rather than look broken in front of a judge.
    renderPanel();
    await challenge(R5_LOWER);
    fireEvent.click(screen.getByTestId("proposal-apply"));

    expect(screen.getByTestId("probe-r5").textContent).toBe("0.30");
    const delta = screen.getByTestId("applied-delta");
    expect(delta.dataset.moved).toBe("false");
    expect(delta.textContent).toMatch(/did not move/);
    expect(screen.getByTestId("delta-belief").textContent).toBe("Belief 0.090 → 0.090");
    expect(screen.getByTestId("delta-gap").textContent).toBe("Gap 0.910 → 0.910");

    const why = screen.getByTestId("delta-why").textContent ?? "";
    expect(why).toContain("TAK-994:qsar");
    expect(why).toContain("ambiguous");
    expect(why).toContain("commits no mass");
  });

  it("explains a no-move on a DEFEAT rule differently, because the reason is different", async () => {
    // Lowering R3 moves nothing for a reason that has nothing to do with committed
    // mass: R3 defeated four claims outright, and a defeat is licensed by whether
    // the rule is enabled. A single canned "nothing moved" string would be wrong
    // here while being right in the previous test.
    renderPanel();
    await challenge(R3_LOWER);
    // R3_LOWER is low-confidence, so Apply arrives genuinely disabled (proved by
    // the "arms Apply" test above) - a disabled button does not dispatch a click
    // in this DOM, so the reading is armed explicitly, exactly as a reviewer
    // confirming a low-confidence guess would.
    fireEvent.click(screen.getByTestId("proposal-arm"));
    fireEvent.click(screen.getByTestId("proposal-apply"));

    expect(screen.getByTestId("applied-delta").dataset.moved).toBe("false");
    const why = screen.getByTestId("delta-why").textContent ?? "";
    expect(why).toContain("defeat rule");
    expect(why).toContain("ENABLED");
    expect(why).not.toContain("commits no mass");
  });
});
