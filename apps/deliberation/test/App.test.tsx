import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * THE SHELL'S ROUTE GATES.
 *
 * Everything else in this app is tested by rendering one page with props. This file
 * renders `App` itself, because the thing under test is not a page - it is the order of
 * the early returns above the route switch, and that order is invisible from inside any
 * one of them.
 *
 * A refusal used to be the first of those gates and nothing cleared it, so viewing one
 * pinned every route in the product to the same screen. It was reachable ONLY from the
 * library, which meant the branch that clears it could never render again either: the
 * app was stuck until a reload.
 */

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return {
    ...actual,
    api: {
      login: vi.fn(async () => ({
        token: "t",
        user: { id: "u1", email: "r.okafor@arbiter.demo", displayName: "R. Okafor", signatureMethod: "typed" },
      })),
      logout: vi.fn(async () => undefined),
      people: vi.fn(async () => []),
      myCases: vi.fn(async () => []),
      library: vi.fn(async () => []),
      catalogue: vi.fn(async () => [
        { name: "turalio", label: "Turalio (giant cell tumour)", shape: "The most complete package here.", usable: true },
        { name: "tolcapone", label: "Tolcapone / Tasmar (1998 review)", shape: "REFUSED - scanned images.", usable: false },
      ]),
      view: vi.fn(async () => SIGNED_VIEW),
      inventory: vi.fn(async () => ({ checklistVersion: "1.0", modality: "small_molecule", entries: [], unmappedFindingIds: [] })),
      adjudicationRequest: vi.fn(async () => ({ findings: [], absent: [] })),
      documents: vi.fn(async () => []),
      roster: vi.fn(async () => ({ participants: [], seats: {} })),
      unanimity: vi.fn(async () => ({ unanimous: true, call: "advance", concerns: [] })),
      audit: vi.fn(async () => ({ chain: [], seals: [], entries: [] })),
    },
  };
});

/** A case that was adjudicated and signed in some other session - which is every
 *  signed case in the corpus, from the point of view of a browser opening it now. */
const SIGNED_VIEW = {
  status: "signed" as const,
  own: null,
  others: [],
  revealed: [],
  adjudication: {
    mechanism: { present: true, pathway: "BSEP inhibition at 10uM.", citedFindingIds: [] },
    consequence: { verdict: "do_not_advance", reasoning: "No exposure margin was established.", citedFindingIds: [] },
    ruleDisclosure: [{ ruleId: "R1", position: "applies", reasoning: "Human evidence is present.", citedFindingIds: [] }],
    missing: [],
    nextExperiment: null,
  },
  adjudicationSource: "live" as const,
  consensus: null,
  signature: { by: "u1", at: "2026-08-14T10:00:00Z", agreesWithAdjudication: true, reason: "" },
};

// The backdrop imports `three` dynamically and draws nothing under jsdom. Stubbed so a
// missing WebGL context is not what this file is measuring.
vi.mock("../src/shell/Backdrop.js", () => ({ Backdrop: () => null }));

const { App } = await import("../src/App.js");

const REFUSAL = {
  error: "refused",
  name: "tolcapone",
  label: "Tolcapone / Tasmar (1998 review)",
  document: "data/raw/approval-packages/tolcapone-medical-review.pdf",
  splitterReason: "48 of 48 pages carry almost no extractable text. REFUSED.",
  measurement: "0 extractable characters across 48 pages.",
};

beforeEach(() => {
  window.location.hash = "#/library";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify(REFUSAL), { status: 422, headers: { "content-type": "application/json" } },
  )));
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

/** Change the hash the way a nav link does, and let React process the event. */
function go(hash: string): void {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

async function openTheRefusedCase(): Promise<void> {
  render(<App />);
  const card = await screen.findByText(/Tolcapone \/ Tasmar/);
  fireEvent.click(card.closest("button") ?? card);
  expect(await screen.findByText(/48 of 48 pages/)).toBeInTheDocument();
}

describe("a refusal does not pin the rest of the product", () => {
  it("shows the splitter's reason when a refused case is opened", async () => {
    await openTheRefusedCase();
  });

  it("leaves the refusal behind when another tab is chosen", async () => {
    await openTheRefusedCase();
    go("#/dashboard");
    await waitFor(() => {
      expect(screen.queryByText(/48 of 48 pages/)).not.toBeInTheDocument();
    });
  });

  it("does the same for every other tab, not just the dashboard", async () => {
    await openTheRefusedCase();
    for (const hash of ["#/new", "#/ask", "#/dashboard"]) {
      go(hash);
      await waitFor(() => {
        expect(screen.queryByText(/48 of 48 pages/)).not.toBeInTheDocument();
      });
    }
  });

  it("comes back to a library that is a library, not the last refusal", async () => {
    await openTheRefusedCase();
    go("#/dashboard");
    await waitFor(() => expect(screen.queryByText(/48 of 48 pages/)).not.toBeInTheDocument());
    go("#/library");
    // The catalogue, not the screen we were last looking at.
    expect(await screen.findByText(/Turalio/)).toBeInTheDocument();
    expect(screen.queryByText(/48 of 48 pages/)).not.toBeInTheDocument();
  });
});

/**
 * THE VERDICT COMES FROM THE RECORD, NOT FROM THIS TAB'S MEMORY.
 *
 * `adjudication` used to be React state written only by the POST that produced it, so
 * `Reveal & verdict` rendered the reveal and then stopped: empty on every signed case
 * in the corpus, empty again for the owner the moment they refreshed, and empty for
 * every participant who was not the person who pressed the button. The record held the
 * adjudication the whole time - nothing served it, and nothing here asked.
 */
describe("the verdict of a case adjudicated in another session", () => {
  it("renders from the stored record without anyone pressing Adjudicate", async () => {
    window.location.hash = "#/case/c1/reveal";
    render(<App />);
    expect(await screen.findByText(/No exposure margin was established/)).toBeInTheDocument();
    expect(screen.getByText(/Human evidence is present/)).toBeInTheDocument();
  });

  it("does not offer to adjudicate a case that already has a verdict", async () => {
    // Three model calls out of a daily twenty, spent to be told the case is signed.
    window.location.hash = "#/case/c1/reveal";
    render(<App />);
    await screen.findByText(/No exposure margin was established/);
    expect(screen.queryByRole("button", { name: /Adjudicate across the positions/ })).not.toBeInTheDocument();
  });
});
