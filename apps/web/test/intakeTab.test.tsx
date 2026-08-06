import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { reason } from "@arbiter/engine";
import { StoreProvider, initialState, reducer, workingClaims } from "../src/state/store.js";
import { IntakeTab } from "../src/tabs/Intake.js";
import { CaseHeader } from "../src/tabs/Case/CaseHeader.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

afterEach(cleanup);

function renderIntake() {
  return render(<StoreProvider data={data}><IntakeTab /></StoreProvider>);
}

function type(testid: string, value: string): void {
  fireEvent.change(screen.getByTestId(testid), { target: { value } });
}

/** A human-system claim measuring a key event - the shape that can actually decide. */
function enterDecisiveStudy(compoundId = "ACME-001"): void {
  type("intake-compound-id", compoundId);
  type("intake-stream", "transporter");
  type("intake-assertion", "toxic");
  type("intake-strength", "0.9");
  type("intake-system", "human");
  type("intake-key-event", "KE:BSEP-INHIBITION");
  type("intake-exposure", "yes");
  type("intake-klimisch", "1");
  type("intake-prov-source", "internal study 4471");
  fireEvent.click(screen.getByTestId("intake-add-claim"));
}

describe("the intake form", () => {
  it("accepts a study and lists it", () => {
    renderIntake();
    enterDecisiveStudy();
    expect(screen.getByTestId("intake-claims").textContent).toContain("ACME-001:transporter");
    expect(screen.queryByTestId("intake-errors")).toBeNull();
  });

  it("refuses a compound id that is already in the benchmark", () => {
    renderIntake();
    const existing = [...data.claimsByCompound.keys()][0] as string;
    type("intake-compound-id", existing);
    expect(screen.getByTestId("intake-id-error").textContent).toContain("already in the benchmark");
    expect((screen.getByTestId("intake-create") as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses a compound id containing a colon, which would break claim routing", () => {
    renderIntake();
    type("intake-compound-id", "ACME:001");
    expect(screen.getByTestId("intake-id-error").textContent).toContain("colon");
  });

  /** The schema refine, surfaced. A structural prediction cannot have MEASURED a
   *  key event - that would let it escape R2's discount. */
  it("rejects a qsar study claiming to have measured a key event", () => {
    renderIntake();
    type("intake-compound-id", "ACME-001");
    type("intake-stream", "qsar");
    type("intake-system", "in_silico");
    type("intake-key-event", "KE:BSEP-INHIBITION");
    fireEvent.click(screen.getByTestId("intake-add-claim"));
    expect(screen.getByTestId("intake-errors").textContent).toContain("measuresKeyEvent");
    expect(screen.queryByTestId("intake-claims")).toBeNull();
  });

  it("rejects a safe finding at exposure with no cited Cmax", () => {
    renderIntake();
    type("intake-compound-id", "ACME-001");
    type("intake-prov-source", "internal study 4471");
    type("intake-assertion", "safe");
    type("intake-exposure", "yes");
    fireEvent.click(screen.getByTestId("intake-add-claim"));
    expect(screen.getByTestId("intake-errors").textContent).toContain("cited clinical Cmax");
  });

  it("accepts that same safe finding once a Cmax is cited", () => {
    renderIntake();
    type("intake-compound-id", "ACME-001");
    type("intake-prov-source", "internal study 4471");
    type("intake-assertion", "safe");
    type("intake-exposure", "yes");
    type("intake-cmax", "1.2");
    type("intake-cmax-source", "IB section 4.2");
    fireEvent.click(screen.getByTestId("intake-add-claim"));
    expect(screen.queryByTestId("intake-errors")).toBeNull();
    expect(screen.getByTestId("intake-claims")).toBeTruthy();
  });
});

describe("the advisor on screen", () => {
  it("warns before the user is disappointed, on evidence that cannot decide", () => {
    renderIntake();
    type("intake-compound-id", "ACME-001");
    type("intake-prov-source", "internal QSAR run");
    type("intake-stream", "qsar");
    type("intake-system", "in_silico");
    type("intake-key-event", "");
    type("intake-strength", "0.9");
    fireEvent.click(screen.getByTestId("intake-add-claim"));

    const sentence = screen.getByTestId("intake-advisor-sentence").textContent ?? "";
    expect(sentence).toContain("no verdict is reachable at any confidence values");
    expect(sentence).toContain("Cmax");
  });

  it("says the evidence can decide once a decisive study is entered", () => {
    renderIntake();
    enterDecisiveStudy();
    const sentence = screen.getByTestId("intake-advisor-sentence").textContent ?? "";
    expect(sentence).toContain("can reach a committed position");
  });

  it("does not render at all before any evidence is entered", () => {
    renderIntake();
    expect(screen.queryByTestId("intake-advisor")).toBeNull();
  });
});

describe("creating the compound", () => {
  // Spec test 1, end to end: a hand-entered claim set reaches a verdict through
  // the REAL engine, rendered by the real Case header.
  it("puts the compound on the Case tab with a verdict from the real engine", () => {
    renderIntake();
    enterDecisiveStudy();
    fireEvent.click(screen.getByTestId("intake-create"));
    cleanup();

    // The reducer, driven exactly as the component drives it.
    let s = initialState(data);
    const claims = [{
      id: "ACME-001:transporter", compoundId: "ACME-001", stream: "transporter",
      assertion: "toxic", strength: 0.9, system: "human",
      measuresKeyEvent: "KE:BSEP-INHIBITION", exposureRelevant: true,
      inApplicabilityDomain: null, klimisch: 1, availableFrom: "2026-01",
      provenance: { kind: "literature", source: "internal study 4471", retrieved: "2026-08-06" },
    }] as never;
    s = reducer(s, { type: "addCustomCompound", compoundId: "ACME-001", claims });
    s = reducer(s, { type: "selectCompound", compoundId: "ACME-001" });

    expect(workingClaims(s, "ACME-001")).toHaveLength(1);
    expect(reason(workingClaims(s, "ACME-001"), s.ruleset).verdict).toBe("do_not_advance");

    render(<StoreProvider data={data} initialState={s}><CaseHeader /></StoreProvider>);
    expect(screen.getByText("ACME-001")).toBeTruthy();
    expect(screen.getByTestId("verdict").textContent).toMatch(/do not advance/i);
  });
});

describe("the benchmark separation, enforced in the reducer", () => {
  const claim = (compoundId: string) => ([{
    id: `${compoundId}:cytotox`, compoundId, stream: "cytotox", assertion: "toxic",
    strength: 0.7, system: "human", measuresKeyEvent: "KE:X", exposureRelevant: null,
    inApplicabilityDomain: null, klimisch: 2, availableFrom: "2026-01",
    provenance: { kind: "literature", source: "s", retrieved: "2026-08-06" },
  }] as never);

  it("refuses a compound id that collides with the corpus", () => {
    const existing = [...data.claimsByCompound.keys()][0] as string;
    const s = reducer(initialState(data), {
      type: "addCustomCompound", compoundId: existing, claims: claim(existing),
    });
    expect(s.customCompounds).toEqual({});
  });

  it("refuses a compound id that collides with a hero case", () => {
    const hero = [...data.heroCases.keys()][0] as string;
    const s = reducer(initialState(data), {
      type: "addCustomCompound", compoundId: hero, claims: claim(hero),
    });
    expect(s.customCompounds).toEqual({});
  });

  /** A claim filed under a different compound would make the Record tab hash a
   *  position against evidence carrying another id. */
  it("refuses claims that are about a different compound", () => {
    const s = reducer(initialState(data), {
      type: "addCustomCompound", compoundId: "ACME-001", claims: claim("OTHER-9"),
    });
    expect(s.customCompounds).toEqual({});
  });

  it("refuses an empty claim set", () => {
    const s = reducer(initialState(data), { type: "addCustomCompound", compoundId: "ACME-001", claims: [] });
    expect(s.customCompounds).toEqual({});
  });

  /**
   * The polarity §9.1 draws for evidence edits, extended: a custom compound must
   * be invisible to anything corpus-shaped, or a 267-row statistic would be
   * recomputed over evidence a user typed.
   */
  it("never reaches the corpus map the library table reads", () => {
    const s = reducer(initialState(data), {
      type: "addCustomCompound", compoundId: "ACME-001", claims: claim("ACME-001"),
    });
    expect(s.customCompounds["ACME-001"]).toHaveLength(1);
    expect(s.data.claimsByCompound.has("ACME-001")).toBe(false);
    expect(s.data.compounds.has("ACME-001")).toBe(false);
  });
});
