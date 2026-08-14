import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EvidenceClaim } from "@arbiter/engine";
import { StoreProvider, initialState } from "../src/state/store.js";
import { EvidencePanel } from "../src/tabs/Case/EvidencePanel.js";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE, BOOT_CASE } from "../src/data/heroCases.js";

const data = loadData();

const renderAt = (compoundId: string) =>
  render(
    <StoreProvider data={data} initialState={{ ...initialState(data), selectedCompoundId: compoundId }}>
      <EvidencePanel collapsed={false} onExpand={() => {}} />
    </StoreProvider>,
  );

describe("the applicability-domain badge", () => {
  it("marks the row R4 downweighted, so the discount is visible without reading the trace", () => {
    renderAt(CYCLOSPORINE);
    const badges = screen.getAllByTestId("domain-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent(/OUT OF DOMAIN/i);
  });

  it("says the warning in words, never in colour alone", () => {
    renderAt(CYCLOSPORINE);
    expect(screen.getByTestId("domain-badge").textContent!.trim().length).toBeGreaterThan(0);
  });

  it("does not badge a claim that is in domain or not assessable", () => {
    // Every TAK-994 claim is inApplicabilityDomain: true. R4 tests `=== false`,
    // so `null` (not assessable) is benign and must not be badged either - a badge
    // on every row would carry no information.
    renderAt(BOOT_CASE);
    expect(screen.queryByTestId("domain-badge")).toBeNull();
  });

  it("does not badge a claim whose domain was never assessed", () => {
    // PINS THE `=== false` TEST, which the corpus cannot. Every one of the 1356
    // bundled claims is true or false, so the case above passes under either
    // `=== false` or `!== true` and a regression between them would go unseen.
    // `null` is reachable in the running app - the Intake tab's "not applicable"
    // maps to it - and it must stay benign, because R4 itself declines to fire on
    // it (rules.ts:181). Seeded through customCompounds, the same session-local
    // path Intake writes to.
    const claim: EvidenceClaim = {
      id: "NULL-DOMAIN-001:qsar",
      compoundId: "NULL-DOMAIN-001",
      stream: "qsar",
      assertion: "toxic",
      strength: 0.6,
      system: "in_silico",
      measuresKeyEvent: null,
      exposureRelevant: null,
      inApplicabilityDomain: null,
      klimisch: 2,
      availableFrom: "2020-01-01",
      provenance: { kind: "database", source: "test fixture", retrieved: "2020-01-01" },
    };
    render(
      <StoreProvider
        data={data}
        initialState={{
          ...initialState(data),
          selectedCompoundId: "NULL-DOMAIN-001",
          customCompounds: { "NULL-DOMAIN-001": [claim] },
        }}
      >
        <EvidencePanel collapsed={false} onExpand={() => {}} />
      </StoreProvider>,
    );
    expect(screen.getAllByTestId("evidence-row")).toHaveLength(1);
    expect(screen.queryByTestId("domain-badge")).toBeNull();
  });
});
