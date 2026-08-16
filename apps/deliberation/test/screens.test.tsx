import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Documents, InventoryPanel, Refused, Reveal, RosterPanel, Verdict, Waiting, basisOf } from "../src/screens.js";
import type { Adjudication, BlindView, Inventory, Position, Roster } from "../src/api.js";

const inv: Inventory = {
  checklistVersion: "1.0",
  modality: "small_molecule",
  unmappedFindingIds: [],
  entries: [
    { itemId: "C2", half: "consequence", field: "Exposure margin", whatItBlocks: "R3 cannot be applied.", state: "absent", findingIds: [] },
    { itemId: "M1", half: "mechanism", field: "Human-cell result", whatItBlocks: "R1 cannot be applied.", state: "present", findingIds: ["f1"] },
    { itemId: "M6", half: "mechanism", field: "Structural alert", whatItBlocks: "R4 cannot be applied.", state: "inconclusive", findingIds: ["f2"] },
  ],
};

const biologicInv: Inventory = {
  ...inv,
  modality: "biologic",
  entries: [
    ...inv.entries,
    {
      itemId: "M3", half: "mechanism", field: "Reactive metabolite",
      whatItBlocks: "Idiosyncratic route unexamined.",
      whyNotApplicable: "An antibody is catabolised to amino acids by normal protein turnover, so there is no reactive metabolite to trap.",
      state: "not_applicable", findingIds: [],
    },
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

  it("renders a not-applicable question as n/a, not as a gap", () => {
    // Four of twelve questions do not arise for a monoclonal antibody. Showing them
    // as absent would fill the missing list with items nobody can ever supply.
    render(<InventoryPanel inv={biologicInv} />);
    expect(screen.getByText("n/a")).toBeInTheDocument();
    expect(screen.getByText(/do not arise for a biologic/)).toBeInTheDocument();
  });

  it("shows why a question does not arise INSTEAD OF what a gap would block", () => {
    // The defect this fixes: an n/a row kept rendering "The main route to
    // idiosyncratic injury is unexamined", so four non-issues read as four untested
    // liabilities - exactly the false alarm the state was added to prevent.
    render(<InventoryPanel inv={biologicInv} />);
    expect(screen.getByText(/catabolised to amino acids/)).toBeInTheDocument();
    expect(screen.queryByText(/Idiosyncratic route unexamined/)).toBeNull();
  });

  it("renders a document-scope note when the document limits what can be read", () => {
    render(<InventoryPanel inv={inv} documentScope="THE SAFETY STUDIES FOR THIS DRUG WERE NEVER RUN, and that is not an oversight." />);
    expect(screen.getByText(/THE SAFETY STUDIES FOR THIS DRUG WERE NEVER RUN/)).toBeInTheDocument();
  });

  it("renders no scope note when there is none", () => {
    const { container } = render(<InventoryPanel inv={inv} />);
    expect(container.querySelector(".concern")).toBeNull();
  });

  it("says nothing about modality when every question applies", () => {
    const { container } = render(<InventoryPanel inv={inv} />);
    expect(container.textContent).not.toContain("do not arise");
  });

  it("says what each gap blocks, so a gap is a consequence and not a scold", () => {
    render(<InventoryPanel inv={inv} />);
    expect(screen.getByText(/R3 cannot be applied/)).toBeInTheDocument();
  });
});

describe("Documents", () => {
  const readable = {
    id: "doc_1", filename: "review.pdf", bytes: 1000, uploadedBy: "u_ann", uploadedAt: "t",
    measurement: { ok: true, verdict: "readable", reason: "Readable, and it contains toxicology vocabulary.", pages: 178, characters: 494931, embeddedImages: 65, liverTermHits: 23 },
  };
  const refused = {
    id: "doc_2", filename: "scan.pdf", bytes: 1000, uploadedBy: "u_ann", uploadedAt: "t",
    measurement: { ok: false, verdict: "scanned", reason: "All 48 pages carry almost no extractable text.", pages: 48, characters: 0, embeddedImages: 48, liverTermHits: 0 },
  };

  it("shows a readable document with its measurement", () => {
    render(<Documents docs={[readable]} onUpload={() => {}} busy={false} error={null} />);
    expect(screen.getByText("readable")).toBeInTheDocument();
    expect(screen.getByText(/178 pages/)).toBeInTheDocument();
  });

  it("marks a refused document and gives the reason", () => {
    render(<Documents docs={[refused]} onUpload={() => {}} busy={false} error={null} />);
    expect(screen.getByText("refused")).toBeInTheDocument();
    expect(screen.getByText(/almost no extractable text/)).toBeInTheDocument();
  });

  it("surfaces an upload error where the uploader will see it", () => {
    render(<Documents docs={[]} onUpload={() => {}} busy={false} error="That file does not start with a PDF header." />);
    expect(screen.getByText(/does not start with a PDF header/)).toBeInTheDocument();
  });

  it("explains why an upload is measured before it is accepted", () => {
    render(<Documents docs={[]} onUpload={() => {}} busy={false} error={null} />);
    expect(screen.getByText(/measured before it is accepted/)).toBeInTheDocument();
  });
});

describe("Refused", () => {
  const refusal = {
    name: "tolcapone",
    label: "Tolcapone (Tasmar) - FDA medical review, 1998",
    document: "data/raw/approval-packages/tolcapone-20697-medical-review-p1.pdf",
    splitterReason: "48 of 48 pages carry almost no extractable text - this is a scanned document and needs OCR before anything can read it. REFUSED.",
    measurement: "48 pages, 48 embedded images, 0 extractable characters.",
  };

  it("shows the splitter's own reason and the measurement behind it", () => {
    render(<Refused r={refusal} />);
    expect(screen.getByText(/needs OCR before anything can read it/)).toBeInTheDocument();
    expect(screen.getByText(/0 extractable characters/)).toBeInTheDocument();
  });

  it("says plainly that nothing will build a case anyway", () => {
    render(<Refused r={refusal} />);
    expect(screen.getByText(/nothing here\s+will quietly build one anyway/)).toBeInTheDocument();
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
    const { container } = render(<Waiting nameOf={(id) => id} view={view} isOwner={false} onReveal={() => {}} />);
    expect(screen.getByText("bea")).toBeInTheDocument();
    expect(screen.getByText("in")).toBeInTheDocument();
    expect(screen.getByText("waiting")).toBeInTheDocument();
    // The server never sends it, and the screen never asks for it either.
    expect(container.textContent).not.toContain("advance");
  });

  it("offers reveal to the owner only", () => {
    const { rerender } = render(<Waiting nameOf={(id) => id} view={view} isOwner={false} onReveal={() => {}} />);
    expect(screen.queryByRole("button", { name: /Reveal all positions/ })).toBeNull();
    rerender(<Waiting nameOf={(id) => id} view={view} isOwner onReveal={() => {}} />);
    expect(screen.getByRole("button", { name: /Reveal all positions/ })).toBeInTheDocument();
  });

  it("disables reveal while somebody is outstanding, and offers closing early instead", () => {
    render(<Waiting nameOf={(id) => id} view={view} isOwner onReveal={() => {}} />);
    expect(screen.getByRole("button", { name: /Reveal all positions/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Close without them/ })).toBeInTheDocument();
    expect(screen.getByText(/absence is written into the record/)).toBeInTheDocument();
  });

  it("enables reveal once everyone is in", () => {
    const all: BlindView = { ...view, others: view.others.map((o) => ({ ...o, submitted: true })) };
    render(<Waiting nameOf={(id) => id} view={all} isOwner onReveal={() => {}} />);
    expect(screen.getByRole("button", { name: /Reveal all positions/ })).toBeEnabled();
  });

  // THE STATE EVERY TEST ABOVE MISSES: each gives the viewer a sealed `own` position,
  // which is the single state a convener is never in. access.ts has the owner "convene
  // and sign but not hold an opinion on the record", so an owner's `own` is always null.
  //
  // WHAT THESE TWO DO AND DO NOT GUARD, because the difference is the whole lesson of
  // the defect they were written for. `Waiting` always rendered the close-early button
  // when `isOwner`; the bug was that App.tsx only rendered `Waiting` at all when
  // `own !== null`, so no owner ever reached it. The first test below therefore PASSES
  // AGAINST THE BUG - verified by reverting the fix and re-running - and guards only
  // against a future change that gates the button on `own` inside this component. The
  // second genuinely fails without the fix, because the heading was the half of the
  // defect that lived here.
  //
  // The routing half is still unguarded. App.tsx has no test file and fetches over the
  // network on mount, so covering it means introducing an api mock that does not exist
  // yet. Recorded rather than quietly left: a defect where every part works alone and
  // nothing composes them is exactly what component-level tests cannot see.
  it("gives a convener who has not answered the close-early control", () => {
    const asConvener: BlindView = { ...view, own: null };
    render(<Waiting nameOf={(id) => id} view={asConvener} isOwner onReveal={() => {}} />);
    expect(screen.getByRole("button", { name: /Close without them/ })).toBeInTheDocument();
  });

  it("does not tell a convener they sealed something they did not", () => {
    const asConvener: BlindView = { ...view, own: null };
    render(<Waiting nameOf={(id) => id} view={asConvener} isOwner onReveal={() => {}} />);
    expect(screen.queryByText(/Sealed\. Waiting for the others/)).toBeNull();
    expect(screen.getByText(/Waiting for the panel/)).toBeInTheDocument();
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
  const SEATS: Record<string, number> = { ann: 0, bea: 1, cal: 2 };
  const view: BlindView = {
    status: "locked", own: null, others: [],
    revealed: [
      pos("ann", { citedFindingIds: ["f1"] }),
      pos("bea", { external: [{ claim: "Class effect.", source: "Smith 2019" }] }),
      pos("cal"),
    ],
  };

  it("labels each position with what it rests on", () => {
    render(<Reveal nameOf={(id) => id} seats={SEATS} view={view} unanimity={null} />);
    expect(screen.getByText("cited")).toBeInTheDocument();
    expect(screen.getByText("external")).toBeInTheDocument();
    expect(screen.getByText("unsupported")).toBeInTheDocument();
  });

  it("shows an unsupported position rather than hiding it", () => {
    // Dissent is preserved permanently - that is the record's purpose. What changes
    // is that its basis is visible.
    render(<Reveal nameOf={(id) => id} seats={SEATS} view={view} unanimity={null} />);
    expect(screen.getByText("cal")).toBeInTheDocument();
  });

  it("renders the unanimity concerns and says no model produced them", () => {
    render(<Reveal nameOf={(id) => id} seats={SEATS} view={view} unanimity={{ unanimous: true, call: "advance", concerns: ["nobody tested the exposure margin"] }} />);
    expect(screen.getByText(/nobody tested the exposure margin/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing below came from a model/)).toBeInTheDocument();
  });

  it("says nothing about unanimity when the room disagreed", () => {
    const { container } = render(<Reveal nameOf={(id) => id} seats={SEATS} view={view} unanimity={{ unanimous: false, call: null, concerns: [] }} />);
    expect(container.textContent).not.toContain("Everyone agreed");
  });

  // The seat colour has to be the same object on this screen as on the roster, or it
  // is not learnable. This is also the test that keeps <Reviewer> reachable: before
  // the roster carried seats, nothing in the app rendered the badge at all.
  it("badges every revealed position with its author's seat", () => {
    const { container } = render(
      <Reveal nameOf={(id) => ({ ann: "Andres Lopez", bea: "Bea Nolan", cal: "Cal Ruiz" })[id] ?? id}
        seats={SEATS} view={view} unanimity={null} />,
    );
    expect(container.querySelector(".avatar.seat-0")).not.toBeNull();
    expect(container.querySelector(".avatar.seat-1")).not.toBeNull();
    expect(container.querySelector(".avatar.seat-2")).not.toBeNull();
    expect(screen.getByLabelText("Andres Lopez")).toBeInTheDocument();
  });

  it("falls back to a neutral badge for a participant with no seat", () => {
    const { container } = render(<Reveal nameOf={(id) => id} seats={{ ann: 0 }} view={view} unanimity={null} />);
    expect(container.querySelectorAll(".avatar.seat-none")).toHaveLength(2);
  });
});

describe("RosterPanel seats", () => {
  const roster = (seats: Record<string, number>, names: [string, string][]): Roster => ({
    ownerId: "own",
    members: names.map(([id, displayName]) => ({
      id, displayName, email: `${id}@example.com`, signatureMethod: "typed",
    })),
    pending: [],
    seats,
  });

  const panel = (r: Roster): ReturnType<typeof render> => render(
    <RosterPanel roster={r} canEdit={false} isOwner={false} ownerName="Owner"
      onInvite={() => {}} onRemove={() => {}} notice={null} error={null} />,
  );

  it("gives every member their allocated seat colour", () => {
    const { container } = panel(roster({ u1: 0, u2: 3 }, [["u1", "Andres Lopez"], ["u2", "Jack He"]]));
    expect(container.querySelector(".avatar.seat-0")).not.toBeNull();
    expect(container.querySelector(".avatar.seat-3")).not.toBeNull();
  });

  // Colour is never the only channel, and initials are not unique. Two Js and Hs on
  // one panel get the seat numeral appended so the badges stay tellable apart for a
  // reader who cannot use the colour.
  it("disambiguates two members who share initials", () => {
    panel(roster({ u1: 0, u2: 1 }, [["u1", "Jack He"], ["u2", "Jane Hart"]]));
    expect(screen.getByText("JH·0")).toBeInTheDocument();
    expect(screen.getByText("JH·1")).toBeInTheDocument();
  });

  it("leaves a unique pair of initials alone", () => {
    panel(roster({ u1: 0, u2: 1 }, [["u1", "Jack He"], ["u2", "Andres Lopez"]]));
    expect(screen.getByText("JH")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("renders a neutral badge for a member past the last seat", () => {
    const { container } = panel(roster({ u1: 0 }, [["u1", "Andres Lopez"], ["u2", "Jack He"]]));
    expect(container.querySelectorAll(".avatar.seat-none")).toHaveLength(1);
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
    expect(screen.getByText(/STUB - no model was called/)).toBeInTheDocument();
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
    expect(screen.getByText(/Why you are overriding - required/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Why you are overriding/), { target: { value: "Margin is 40x." } });
    fireEvent.click(screen.getByRole("button", { name: /Sign the record/ }));
    expect(onSign).toHaveBeenCalledWith(false, "Margin is 40x.");
  });
});
