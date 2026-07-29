import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { reasonVerdictOnly } from "@arbiter/engine";
import {
  StoreProvider, initialState, reducer, useAppState, useDispatch, workingClaims,
  type Action,
} from "../src/state/store.js";
import { useLibraryVerdicts } from "../src/engine/useLibraryVerdicts.js";
import { CaseHeader } from "../src/tabs/Case/CaseHeader.js";
import { EvidencePanel } from "../src/tabs/Case/EvidencePanel.js";
import { RulesetTab } from "../src/tabs/Ruleset.js";
import { Preflight } from "../src/ui/Preflight.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const base = initialState(data);

/** The fixture claim whose system flips the Case verdict: measured directly
 *  against the engine - rodent -> human takes TAK-994 from abstain, belief 0.090,
 *  to do_not_advance, belief 0.900, because R1 stops discounting it. */
const MURINE = "TAK-994:toxicogenomics-murine";

/** data.testSplit[0], and the cytotox claim on it whose exposureRelevant flips
 *  that row's library verdict from abstain to advance. Chosen by measurement, so
 *  the isolation case below cannot pass merely because the edit is inert. */
const LIBRARY_COMPOUND = "AAOVKJBEBIDNHE-UHFFFAOYSA-N";
const LIBRARY_CLAIM = "AAOVKJBEBIDNHE-UHFFFAOYSA-N:cytotox";

/** Test-only: turns a dispatch into a click, so every case drives the REAL reducer
 *  through the REAL provider rather than calling the reducer beside the render. */
function Fire({ id, action }: { id: string; action: Action }) {
  const dispatch = useDispatch();
  return <button type="button" data-testid={id} onClick={() => dispatch(action)}>{id}</button>;
}

/** Proves a dispatch actually landed. Without it, an isolation assertion that
 *  "the row did not move" would also pass when nothing was dispatched at all. */
function EditCount() {
  const { evidenceEdits } = useAppState();
  return <span data-testid="edit-count">{Object.keys(evidenceEdits).length}</span>;
}

function LibraryRow({ compoundId }: { compoundId: string }) {
  const rows = useLibraryVerdicts();
  return <span data-testid="row-verdict">{rows.get(compoundId)?.verdict}</span>;
}

describe("the evidence working copy stays off the library table (§9.1)", () => {
  it("is POTENT on the compound it names", () => {
    // Stated first and separately, because the isolation case below is only worth
    // anything if the edit it applies would otherwise have moved the number.
    const edited = reducer(base, {
      type: "reclassifyClaim", claimId: LIBRARY_CLAIM, edit: { exposureRelevant: true },
    });
    expect(reasonVerdictOnly(workingClaims(base, LIBRARY_COMPOUND), data.ruleset).verdict)
      .toBe("abstain");
    expect(reasonVerdictOnly(workingClaims(edited, LIBRARY_COMPOUND), data.ruleset).verdict)
      .toBe("advance");
  });

  it("does NOT reach the 267-row library table", () => {
    // Evidence edits are per-claim on one compound. A corpus statistic recomputed
    // over edited evidence is a number computed after seeing a result, so the
    // polarity is inverted relative to the ruleset: registered is the default and
    // working is the opt-in, and useLibraryVerdicts does not opt in.
    render(
      <StoreProvider data={data}>
        <LibraryRow compoundId={LIBRARY_COMPOUND} />
        <EditCount />
        <Fire id="edit-library-claim"
              action={{ type: "reclassifyClaim", claimId: LIBRARY_CLAIM, edit: { exposureRelevant: true } }} />
      </StoreProvider>,
    );

    expect(screen.getByTestId("row-verdict").textContent).toBe("abstain");
    fireEvent.click(screen.getByTestId("edit-library-claim"));
    expect(screen.getByTestId("edit-count").textContent).toBe("1");
    expect(screen.getByTestId("row-verdict").textContent).toBe("abstain");
  });
});

describe("the verdict and the evidence beside it (§9)", () => {
  it("moves the verdict AND the row it was computed from, together", () => {
    // The defect the refactor exists to make impossible: wired into three of the
    // four call sites, the header would read do_not_advance while the panel below
    // still showed a rodent study.
    render(
      <StoreProvider data={data}>
        <CaseHeader />
        <EvidencePanel collapsed={false} onExpand={() => {}} />
        <Fire id="reclassify-murine"
              action={{ type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } }} />
      </StoreProvider>,
    );

    expect(screen.getByTestId("verdict").textContent).toMatch(/Abstain/);
    expect(screen.getByTestId("belief-range").textContent).toContain("0.090");

    fireEvent.click(screen.getByTestId("reclassify-murine"));

    expect(screen.getByTestId("verdict").textContent).toMatch(/Do not advance/);
    expect(screen.getByTestId("belief-range").textContent).toContain("0.900");

    const row = screen.getAllByTestId("evidence-row")
      .find((r) => /toxicogenomics/.test(r.textContent ?? ""))!;
    expect(row.textContent).toContain("human");
    expect(within(row).getByTestId("claim-modified-badge").textContent)
      .toMatch(/MODIFIED/);
  });

  it("badges only the claim that was reclassified", () => {
    render(
      <StoreProvider data={data}>
        <EvidencePanel collapsed={false} onExpand={() => {}} />
        <Fire id="reclassify-murine"
              action={{ type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } }} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId("reclassify-murine"));
    expect(screen.getAllByTestId("claim-modified-badge")).toHaveLength(1);
  });

  it("clears the badge when the field is reclassified back to its registered value", () => {
    // §9.3 at the evidence copy, and the reason reclassifyClaim prunes: a claim
    // set to human and back to rodent is the registered claim, and saying MODIFIED
    // over it is the same false alarm the ruleset badge already avoids.
    render(
      <StoreProvider data={data}>
        <EvidencePanel collapsed={false} onExpand={() => {}} />
        <Fire id="to-human" action={{ type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } }} />
        <Fire id="to-rodent" action={{ type: "reclassifyClaim", claimId: MURINE, edit: { system: "rodent" } }} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId("to-human"));
    expect(screen.getAllByTestId("claim-modified-badge")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("to-rodent"));
    expect(screen.queryByTestId("claim-modified-badge")).toBeNull();
  });

  it("drops every overlay on resetEvidence", () => {
    render(
      <StoreProvider data={data}>
        <CaseHeader />
        <EvidencePanel collapsed={false} onExpand={() => {}} />
        <Fire id="to-human" action={{ type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } }} />
        <Fire id="reset-evidence" action={{ type: "resetEvidence" }} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId("to-human"));
    expect(screen.getByTestId("verdict").textContent).toMatch(/Do not advance/);
    fireEvent.click(screen.getByTestId("reset-evidence"));
    expect(screen.getByTestId("verdict").textContent).toMatch(/Abstain/);
    expect(screen.queryByTestId("claim-modified-badge")).toBeNull();
  });
});

describe("one edited predicate, both surfaces (§9.3)", () => {
  it("clears the MODIFIED badge and the pre-flight warning TOGETHER", async () => {
    // Before this task the badge cleared and the panel did not, because one tested
    // by reference and the other by deep compare. The failure is only visible when
    // both are on screen at once, which is why they are rendered together here.
    //
    // check-edits is now a digest comparison (Task 10, §9.3 superseded again) and
    // so is asynchronous - it goes through the same "pending" state check-ruleset
    // does before the recomputed hash lands, which is why the two assertions below
    // are each behind a waitFor rather than read on the next line.
    render(
      <StoreProvider data={data}>
        <RulesetTab />
        <Preflight />
      </StoreProvider>,
    );

    fireEvent.change(screen.getByTestId("strength-R1"), { target: { value: "0.05" } });
    expect(screen.getByTestId("modified-badge")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("check-edits").getAttribute("data-ok")).toBe("false"));

    fireEvent.change(screen.getByTestId("strength-R1"), { target: { value: "0.9" } });
    expect(screen.queryByTestId("modified-badge")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("check-edits").getAttribute("data-ok")).toBe("true"));
  });

  it("still warns while a real edit is on screen", async () => {
    render(
      <StoreProvider data={data}>
        <RulesetTab />
        <Preflight />
      </StoreProvider>,
    );
    fireEvent.change(screen.getByTestId("strength-R1"), { target: { value: "0.05" } });
    await waitFor(() =>
      expect(screen.getByTestId("check-edits").textContent).toMatch(/press Reset on the Ruleset tab/));
  });
});
