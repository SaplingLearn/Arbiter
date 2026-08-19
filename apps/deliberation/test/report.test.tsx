import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReportPage, reportTitle } from "../src/report.js";
import { report } from "./fixtures/report.js";

/**
 * The document that leaves the building.
 *
 * Every case here is a sentence that has to be ON the page for somebody who was never
 * in the room: a stub labelled as a stub, a dissenting position printed whole, a person
 * who never answered named rather than absent, and the signer's decision outranking the
 * model's. These are not layout tests - they are the honesty of the artefact.
 */

describe("the printable record", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("prints every position in full, including the one that disagreed", () => {
    // The whole reason this exists. A summary would be a document choosing which
    // dissent to carry, on the artefact most likely to be the only thing anybody reads.
    render(<ReportPage report={report()} />);
    expect(screen.getByText("The transporter signal is real and nothing measures the margin.")).toBeInTheDocument();
    expect(screen.getByText("This assay overcalls for the class.")).toBeInTheDocument();
    expect(screen.getAllByText("A. Silva").length).toBeGreaterThan(0);
    expect(screen.getAllByText("B. Mehta").length).toBeGreaterThan(0);
  });

  it("names an unsourced external claim as untested rather than as evidence", () => {
    render(<ReportPage report={report()} />);
    expect(screen.getByText(/The assay overcalls for phenothiazines/)).toBeInTheDocument();
    expect(screen.getByText(/no source given/)).toBeInTheDocument();
  });

  it("says whose decision it was, and that the model did not make it", () => {
    render(<ReportPage report={report()} />);
    // Named twice on purpose - as the signer, and as the convener in the header - so
    // this asserts the decision line rather than any mention of them.
    expect(screen.getByText(/^by/)).toHaveTextContent("by R. Okafor on 2026-08-16 11:00 UTC");
    expect(screen.getByText(/It decided nothing/)).toBeInTheDocument();
  });

  it("prints an override as the decision, naming the call it overrode", () => {
    render(<ReportPage report={report({
      signature: { by: "u-own", at: "2026-08-16T11:00:00.000Z", agreesWithAdjudication: false, reason: "The margin is 40x." },
    })} />);
    expect(screen.getByText("Overridden")).toBeInTheDocument();
    expect(screen.getByText("The margin is 40x.")).toBeInTheDocument();
    // The overridden call is still named: a record that hid it would report the
    // adjudication's answer as the outcome.
    expect(screen.getAllByText("Cannot conclude").length).toBeGreaterThan(0);
  });

  it("refuses to look decided when nobody has signed", () => {
    render(<ReportPage report={report({ signature: null, status: "adjudicated" })} />);
    expect(screen.getByText(/Nobody has signed this/)).toBeInTheDocument();
    expect(screen.getByText(/deliberation in progress and not a decision/)).toBeInTheDocument();
  });

  it("labels a stub in the loudest warning the document has", () => {
    // An unlabelled stub is the most dangerous artefact this repo can emit: it looks
    // exactly like a judgment about a compound.
    render(<ReportPage report={report({ adjudicationSource: "stub" })} />);
    expect(screen.getByText(/STUB - NO MODEL WAS CALLED/)).toBeInTheDocument();
    expect(screen.getByText(/not a judgment about this compound/)).toBeInTheDocument();
    // And again in the metadata, so a reader skimming the header sees it too.
    expect(screen.getByText(/STUB - no model/)).toBeInTheDocument();
  });

  it("carries no stub warning on a live adjudication", () => {
    const { container } = render(<ReportPage report={report()} />);
    expect(container.textContent).not.toContain("STUB");
  });

  it("names the people who never answered instead of leaving a hole", () => {
    // Silence is not agreement, and a panel of two printing as a panel of one would
    // report a unanimity that never happened.
    render(<ReportPage report={report({
      positions: [report().positions[0]!],
      closedEarly: { by: "u-own", at: "2026-08-16T09:45:00.000Z", nonResponders: ["u-b"] },
    })} />);
    expect(screen.getByText(/never answered/)).toBeInTheDocument();
    expect(screen.getByText(/Their silence is not agreement/)).toBeInTheDocument();
    expect(screen.getByText("no answer")).toBeInTheDocument();
  });

  it("keeps a rule nobody could answer distinct from a rule answered no", () => {
    render(<ReportPage report={report()} />);
    expect(screen.getByText("cannot be determined from this package")).toBeInTheDocument();
  });

  it("says the chain is intact, and what that does not prove", () => {
    render(<ReportPage report={report()} />);
    expect(screen.getByText(/Chain intact/)).toBeInTheDocument();
    expect(screen.getByText(/What it does not prove/)).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  });

  it("does not hide tampering behind a clean-looking document", () => {
    render(<ReportPage report={report({
      audit: { chainFailures: 2, sealFailures: 1, entries: 9, headHash: null },
    })} />);
    expect(screen.getByText(/TAMPERING DETECTED/)).toBeInTheDocument();
    expect(screen.getByText(/Do not rely on this document/)).toBeInTheDocument();
  });

  it("states that a printed copy carries no chain", () => {
    render(<ReportPage report={report()} />);
    expect(screen.getByText(/carries no chain/)).toBeInTheDocument();
  });

  it("prints the reader's own browser dialog rather than downloading anything", () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<ReportPage report={report()} />);
    fireEvent.click(screen.getByRole("button", { name: /Print or save as PDF/ }));
    expect(print).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("keeps the controls off the printed page", () => {
    // A button reading "Print or save as PDF" printed onto page one is the tell of a
    // page that never had a print stylesheet.
    const { container } = render(<ReportPage report={report()} />);
    const bar = container.querySelector(".rep-bar");
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain("no-print");
    // And the sheets are not inside the bar, so hiding one never hides the other.
    expect(container.querySelector(".rep-bar .rep-page")).toBeNull();
    expect(container.querySelector(".report-doc .rep-page")).not.toBeNull();
  });

  it("lays the document onto numbered sheets", () => {
    // The preview was one continuous sheet that the browser cut up only at print time,
    // which is a preview that cannot be trusted: the reader could not see what landed
    // where, or even how many sheets there were.
    const { container } = render(<ReportPage report={report()} />);
    const pages = container.querySelectorAll(".rep-page");
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]).toHaveAttribute("aria-label", `Sheet 1 of ${pages.length}`);
    expect(container.querySelector(".rep-page-foot")?.textContent).toContain(`1 of ${pages.length}`);
  });

  /**
   * One sheet at a time, turned with a control - the reading room's arrangement,
   * because it is the same act. Under jsdom nothing has a height, so the document
   * lands on a single sheet and the pager correctly does not appear; these cases pin
   * the parts that hold either way.
   */
  describe("the pager", () => {
    it("keeps every sheet in the document, showing one", () => {
      // Unmounting the rest would print a one-page PDF of whatever was on screen.
      const { container } = render(<ReportPage report={report()} page={1} />);
      const shown = [...container.querySelectorAll(".rep-page")]
        .filter((p) => !p.className.includes("rep-page--off"));
      expect(shown).toHaveLength(1);
    });

    it("marks the sheets it is not showing as hidden from assistive tech", () => {
      const { container } = render(<ReportPage report={report()} page={1} />);
      for (const off of container.querySelectorAll(".rep-page--off")) {
        expect(off).toHaveAttribute("aria-hidden", "true");
      }
    });

    it("keeps the pager off the printed page", () => {
      const { container } = render(<ReportPage report={report()} />);
      const pager = container.querySelector(".pager");
      if (pager !== null) expect(pager.className).toContain("no-print");
    });

    it("lands on the last sheet rather than nothing when the link is stale", () => {
      // A bookmark to sheet 9 of a record that is now shorter should still open it.
      const { container } = render(<ReportPage report={report()} page={99} />);
      const shown = [...container.querySelectorAll(".rep-page")]
        .filter((p) => !p.className.includes("rep-page--off"));
      expect(shown).toHaveLength(1);
      expect(shown[0]).toHaveAttribute("aria-label", expect.stringContaining("Sheet"));
    });
  });

  it("renders the document exactly once", () => {
    // The measuring pass lays every block out to read its height; leaving it in the
    // document would double every sentence for a screen reader and for find-on-page.
    const { container } = render(<ReportPage report={report()} />);
    expect(container.querySelector(".rep-measuring")).toBeNull();
    expect(screen.getAllByText("The transporter signal is real and nothing measures the margin.")).toHaveLength(1);
  });

  it("names the tab after the compound, which is what the save dialog proposes", () => {
    // Chrome takes its default filename from document.title, and that is the only
    // influence a page has over it.
    render(<ReportPage report={report()} />);
    expect(document.title).toBe("arbiter-arb-114-2026-08-16");
  });

  it("gives the convener a way back to the case", () => {
    // `share` present, even with no link published yet, is what marks this as the
    // convener's own render of the page rather than a stranger's - see the "public
    // page" tests below for the other half of this.
    const { container } = render(
      <ReportPage report={report()} share={{ url: null, onPublish: () => {}, onRevoke: () => {} }} />,
    );
    expect(container.querySelector('a[href="#/case/case_1/reveal"]')).not.toBeNull();
  });

  it("falls back to the case id when a label slugs to nothing", () => {
    // A folder of case_1174288393.pdf is a folder nobody can search - but a label of
    // punctuation is worse than the id.
    expect(reportTitle({ compoundLabel: "///", caseId: "case_1", generatedAt: "2026-08-16T12:00:00.000Z" }))
      .toBe("arbiter-case-1-2026-08-16");
  });
});

describe("publishing from the report", () => {
  it("prints no QR and no URL when the record was never published", () => {
    const { container } = render(
      <ReportPage report={report()} share={{ url: null, onPublish: () => {}, onRevoke: () => {} }} />,
    );
    expect(container.querySelector(".rep-qr")).toBeNull();
    // A printed link that never worked is worse than no link at all.
    expect(container.textContent).not.toContain("/r/");
  });

  it("prints the QR and the URL beside it once published", () => {
    const { container } = render(
      <ReportPage report={report()}
        share={{ url: "https://arbiter.test/r/c1/tok", onPublish: () => {}, onRevoke: () => {} }} />,
    );
    expect(container.querySelector(".rep-qr")).not.toBeNull();
    // Readable beside the code, for anyone who cannot scan it.
    expect(container.textContent).toContain("https://arbiter.test/r/c1/tok");
  });

  it("keeps the QR whole, so the paginator can never split it across a sheet", () => {
    const { container } = render(
      <ReportPage report={report()}
        share={{ url: "https://arbiter.test/r/c1/tok", onPublish: () => {}, onRevoke: () => {} }} />,
    );
    const qr = container.querySelector(".rep-qr")!;
    expect(qr.closest(".rep-block")).not.toBeNull();
  });

  it("keeps the controls off the paper", () => {
    const { container } = render(
      <ReportPage report={report()} share={{ url: null, onPublish: () => {}, onRevoke: () => {} }} />,
    );
    expect(container.querySelector(".rep-share")?.classList.contains("no-print")).toBe(true);
  });

  it("shows no controls at all with no share prop, which is how the public page renders", () => {
    const { container } = render(<ReportPage report={report()} />);
    expect(container.querySelector(".rep-share")).toBeNull();
  });

  it("still prints the QR on the public page, where there is a URL but no controls", () => {
    const { container } = render(
      <ReportPage report={report()} publishedUrl="https://arbiter.test/r/c1/tok" />,
    );
    expect(container.querySelector(".rep-qr")).not.toBeNull();
    expect(container.querySelector(".rep-share")).toBeNull();
  });

  it("carries no link into the signed-in app on the public page", () => {
    // Fix round 1: the top bar used to render unconditionally, so a stranger reading a
    // share link saw "The record, ready to print" - written for the convener - and a
    // "Back to the verdict" link into the app that owns AUTO_EMAIL. Gated on the same
    // `share !== undefined` signal that already decides whether the publish/revoke
    // section shows, so there is one rule, not two, for "is this the convener's page".
    const { container } = render(
      <ReportPage report={report()} publishedUrl="https://arbiter.test/r/c1/tok" />,
    );
    expect(screen.queryByText("The record, ready to print")).toBeNull();
    expect(screen.queryByText("Back to the verdict")).toBeNull();
    expect(container.querySelector('a[href="#/case/case_1/reveal"]')).toBeNull();
    // Printing still works without an account - that button is not convener-specific.
    expect(screen.getByRole("button", { name: /Print or save as PDF/ })).toBeInTheDocument();
  });

  it("says plainly that revoking cannot reach a page already printed", () => {
    const { container } = render(
      <ReportPage report={report()}
        share={{ url: "https://arbiter.test/r/c1/tok", onPublish: () => {}, onRevoke: () => {} }} />,
    );
    expect(container.textContent).toMatch(/already printed|already saved/i);
  });
});
