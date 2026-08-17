import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PublicReport, parsePublicPath } from "../src/public.js";
import { report } from "./fixtures/report.js";

describe("the public path", () => {
  it("reads the case and the token out of the URL", () => {
    expect(parsePublicPath("/r/c1/tok123")).toEqual({ caseId: "c1", token: "tok123" });
  });

  it("decodes a case id that needed encoding", () => {
    expect(parsePublicPath("/r/turalio%2Fa/tok")).toEqual({ caseId: "turalio/a", token: "tok" });
  });

  it("is null on a path that is not a share link", () => {
    expect(parsePublicPath("/r/c1")).toBeNull();
    expect(parsePublicPath("/")).toBeNull();
  });
});

describe("the public report", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("draws the record for a good link", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify(report({ compoundLabel: "TAK-994" })),
    });
    render(<PublicReport caseId="c1" token="tok" />);
    // getAllByText, not getByText: the record's compound label is printed more than
    // once - on the sheet itself and in each page's footer - the same reason
    // report.test.tsx asserts panellists' names with getAllByText rather than getByText.
    await waitFor(() => expect(screen.getAllByText(/TAK-994/).length).toBeGreaterThan(0));
  });

  /**
   * Fix round 1's finding: a fragment-only href on this page used to be one click away
   * from a real navigation off `/r/:caseId/:token` and onto whatever answers `/` -
   * which, once a static host exists, is the signed-in shell. `ReportPage`'s top bar and
   * pager are both gated or rewired for exactly this page (see report.tsx and this
   * file's `onNavigate` wiring); this asserts the outcome directly rather than trusting
   * that both fixes stay in sync with each other as the component evolves.
   */
  it("renders no anchor at all, so nothing on the page can navigate away from the link", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify(report()),
    });
    const { container } = render(<PublicReport caseId="c1" token="tok" />);
    await waitFor(() => expect(container.querySelector(".rep-wrap")).not.toBeNull());
    expect(container.querySelectorAll("a").length).toBe(0);
  });

  it("says the link is not valid rather than leaking whether the case exists", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: false, status: 404, text: async () => JSON.stringify({ error: "not_found" }),
    });
    render(<PublicReport caseId="c1" token="bad" />);
    await waitFor(() => expect(screen.getByText(/not valid/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/revoked|exists/i);
  });
});
