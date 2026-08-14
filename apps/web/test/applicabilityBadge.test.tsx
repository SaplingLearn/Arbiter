import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider, initialState } from "../src/state/store.js";
import { EvidencePanel } from "../src/tabs/Case/EvidencePanel.js";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE } from "../src/data/heroCases.js";

const data = loadData();

const renderEvidenceFor = (compoundId?: string) => {
  const state = compoundId === undefined
    ? initialState(data)
    : { ...initialState(data), selectedCompoundId: compoundId };
  return render(
    <StoreProvider data={data} initialState={state}>
      <EvidencePanel collapsed={false} onExpand={() => {}} />
    </StoreProvider>,
  );
};

describe("applicability domain badge", () => {
  it("marks the claim whose model was predicting outside its training set", () => {
    // Cyclosporine's qsar claim carries inApplicabilityDomain: false, and R4
    // discounts it for exactly that. Until now the discount was visible only if
    // the trace step's prose rationale happened to mention it, so a reader looking
    // at the evidence list could not see that one row was a prediction about a
    // compound unlike anything the model was fitted on.
    renderEvidenceFor(CYCLOSPORINE);
    const badges = screen.getAllByTestId("out-of-domain");
    expect(badges.length).toBe(1);
    expect(badges[0]!.textContent).toMatch(/outside/i);
  });

  it("leaves in-domain claims unmarked", () => {
    // Cyclosporine's cytotox and transporter claims are both in domain. Badging a
    // measured assay would tell the reader it was an out-of-domain prediction.
    renderEvidenceFor(CYCLOSPORINE);
    expect(screen.getAllByTestId("evidence-row").length).toBeGreaterThan(1);
    expect(screen.getAllByTestId("out-of-domain").length).toBe(1);
  });

  it("says once what the badge means, and names the standard behind it", () => {
    renderEvidenceFor(CYCLOSPORINE);
    const note = screen.getByTestId("domain-note").textContent ?? "";
    expect(note).toMatch(/R4/);
    expect(note).toMatch(/OECD/);
    // Reduced weight, NOT excluded. R4 as registered admits the claim.
    expect(note).toMatch(/reduced weight/i);
  });

  it("says nothing about applicability domain when no claim is out of it", () => {
    // TAK-994's claims are all in domain, so the explanation must not appear and
    // leave a reader hunting for a badge that is not there.
    renderEvidenceFor();
    expect(screen.queryAllByTestId("out-of-domain").length).toBe(0);
    expect(screen.queryByTestId("domain-note")).toBeNull();
  });
});
