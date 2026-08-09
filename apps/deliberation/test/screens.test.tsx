import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InventoryPanel, Reveal, Verdict, Waiting, basisOf } from "../src/screens.js";
import type { Adjudication, BlindView, Inventory, Position } from "../src/api.js";

const inv: Inventory = {
  checklistVersion: "1.0",
  unmappedFindingIds: [],
  entries: [
    { itemId: "C2", half: "consequence", field: "Exposure margin", whatItBlocks: "R3 cannot be applied.", state: "absent", findingIds: [] },
    { itemId: "M1", half: "mechanism", field: "Human-cell result", whatItBlocks: "R1 cannot be applied.", state: "present", findingIds: ["f1"] },
    { itemId: "M6", half: "mechanism", field: "Structural alert", whatItBlocks: "R4 cannot be applied.", state: "inconclusive", findingIds: ["f2"] },
  ],
};

const pos = (id: string, over: Partial<Position> = {}): Position => ({
  participantId: id, call: "advance", reasoning: "Because.",
  citedFindingIds: [], external: [], submittedAt: "t", ...over,
});

describe("InventoryPanel", () => {
  it("renders every checklist item with its state as a WORD, not only a colour", () => {
    // Read over a compressed screen-share, colour is the first thing to go.
    render(<InventoryPanel inv={inv} />);
    expect(screen.getByText("absent")).toBeInTheDocument();
    expect(screen.getByText("present")).toBeInTheDocument();
    expect(screen.getByText("inconclusive")).toBeInTheDocument();
  });

  it("renders in the order it was given, which is checklist order and not severity", () => {
    const { container } = render(<InventoryPanel inv={inv} />);
    const fields = [...container.querySelectorAll(".inv-row strong")].map((n) => n.textContent);
    expect(fields).toEqual(["Exposure margin", "Human-cell result", "Structural alert"]);
  });

  it("says what each gap blocks, so a gap is a consequence and not a scold", () => {
    render(<InventoryPanel inv={inv} />);
    expect(screen.getByText(/R3 cannot be applied/)).toBeInTheDocument();
  });
});

describe("Waiting", () => {
  const view: BlindView = {
    status: "open",
    own: pos("ann", { reasoning: "MY-OWN-REASONING" }),
    others: [{ participantId: "bea", submitted: true }, { participantId: "cal", submitted: false }],
    revealed: null,
  };

  it("shows one bit per person and never another position's content", () => {
    const { container } = render(<Waiting view={view} isOwner={false} onReveal={() => {}} />);
    expect(screen.getByText("bea")).toBeInTheDocument();
    expect(screen.getByText("in")).toBeInTheDocument();
    expect(screen.getByText("waiting")).toBeInTheDocument();
    // The server never sends it, and the screen never asks for it either.
    expect(container.textContent).not.toContain("advance");
  });

  it("offers reveal to the owner only", () => {
    const { rerender } = render(<Waiting view={view} isOwner={false} onReveal={() => {}} />);
    expect(screen.queryByRole("button", { name: /Reveal all positions/ })).toBeNull();
    rerender(<Waiting view={view} isOwner onReveal={() => {}} />);
    expect(screen.getByRole("button", { name: /Reveal all positions/ })).toBeInTheDocument();
  });

  it("disables reveal while somebody is outstanding, and offers closing early instead", () => {
    render(<Waiting view={view} isOwner onReveal={() => {}} />);
    expect(screen.getByRole("button", { name: /Reveal all positions/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Close without them/ })).toBeInTheDocument();
    expect(screen.getByText(/absence is written into the record/)).toBeInTheDocument();
  });

  it("enables reveal once everyone is in", () => {
    const all: BlindView = { ...view, others: view.others.map((o) => ({ ...o, submitted: true })) };
    render(<Waiting view={all} isOwner onReveal={() => {}} />);
    expect(screen.getByRole("button", { name: /Reveal all positions/ })).toBeEnabled();
  });
});

describe("basisOf", () => {
  it("matches the server's derivation", () => {
    expect(basisOf(pos("a", { citedFindingIds: ["f1"] }))).toBe("cited");
    expect(basisOf(pos("a", { external: [{ claim: "x" }] }))).toBe("external");
    expect(basisOf(pos("a"))).toBe("unsupported");
    expect(basisOf(pos("a", { citedFindingIds: ["f1"], external: [{ claim: "x" }] }))).toBe("cited");
  });
});

describe("Reveal", () => {
  const view: BlindView = {
    status: "locked", own: null, others: [],
    revealed: [
      pos("ann", { citedFindingIds: ["f1"] }),
      pos("bea", { external: [{ claim: "Class effect.", source: "Smith 2019" }] }),
      pos("cal"),
    ],
  };

  it("labels each position with what it rests on", () => {
    render(<Reveal view={view} unanimity={null} />);
    expect(screen.getByText("cited")).toBeInTheDocument();
    expect(screen.getByText("external")).toBeInTheDocument();
    expect(screen.getByText("unsupported")).toBeInTheDocument();
  });

  it("shows an unsupported position rather than hiding it", () => {
    // Dissent is preserved permanently - that is the record's purpose. What changes
    // is that its basis is visible.
    render(<Reveal view={view} unanimity={null} />);
    expect(screen.getByText("cal")).toBeInTheDocument();
  });

  it("renders the unanimity concerns and says no model produced them", () => {
    render(<Reveal view={view} unanimity={{ unanimous: true, call: "advance", concerns: ["nobody tested the exposure margin"] }} />);
    expect(screen.getByText(/nobody tested the exposure margin/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing below came from a model/)).toBeInTheDocument();
  });

  it("says nothing about unanimity when the room disagreed", () => {
    const { container } = render(<Reveal view={view} unanimity={{ unanimous: false, call: null, concerns: [] }} />);
    expect(container.textContent).not.toContain("Everyone agreed");
  });
});

describe("Verdict", () => {
  const adj: Adjudication = {
    mechanism: { present: true, pathway: "BSEP inhibition", citedFindingIds: [] },
    consequence: { verdict: "cannot_conclude", reasoning: "No margin was established.", citedFindingIds: [] },
    ruleDisclosure: [{ ruleId: "R1", position: "applies", reasoning: "Human evidence is present.", citedFindingIds: [] }],
    missing: [{ field: "Exposure margin", whyItMatters: "R3 cannot be applied." }],
    nextExperiment: "Measure Cmax against the tested concentration.",
  };

  it("marks a stub result as a stub, in the place a reader cannot miss", () => {
    render(<Verdict adjudication={adj} source="stub" onSign={() => {}} />);
    expect(screen.getByText(/STUB — no model was called/)).toBeInTheDocument();
  });

  it("carries no stub banner on a live result", () => {
    const { container } = render(<Verdict adjudication={adj} source="live" onSign={() => {}} />);
    expect(container.textContent).not.toContain("STUB");
  });

  it("answers mechanism and consequence as two separate questions", () => {
    render(<Verdict adjudication={adj} source="live" onSign={() => {}} />);
    expect(screen.getByText(/is there a route to liver injury/)).toBeInTheDocument();
    expect(screen.getByText(/is it severe enough to stop/)).toBeInTheDocument();
  });

  it("discloses every rule, including one that does not apply", () => {
    render(<Verdict adjudication={adj} source="live" onSign={() => {}} />);
    expect(screen.getByText(/Human evidence is present/)).toBeInTheDocument();
  });

  it("blocks an override with no reason, and allows agreement without one", () => {
    // An override is always available - forbidding it would make the model the
    // decider - but it is the one moment the record exists for, so it must be argued.
    const onSign = vi.fn();
    render(<Verdict adjudication={adj} source="live" onSign={onSign} />);

    expect(screen.getByRole("button", { name: /Sign the record/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Override" }));
    expect(screen.getByRole("button", { name: /Sign the record/ })).toBeDisabled();
    expect(screen.getByText(/Why you are overriding — required/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Why you are overriding/), { target: { value: "Margin is 40x." } });
    fireEvent.click(screen.getByRole("button", { name: /Sign the record/ }));
    expect(onSign).toHaveBeenCalledWith(false, "Margin is 40x.");
  });
});
