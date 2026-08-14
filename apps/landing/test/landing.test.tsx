import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Landing } from "../src/Landing.js";
import { formatCount } from "../src/motion/useReveals.js";

/**
 * `dither={false}`: the hero canvas is the one thing jsdom cannot do, and it carries
 * no information, so rendering without it tests the same page.
 *
 * `opening={false}`: the opening scene writes a sessionStorage flag on mount, so
 * leaving it on would make the FIRST test in the file see an overlay and every one
 * after it see none - a test that passes or fails depending on the order the runner
 * happens to pick. The scene gets its own block below, which manages the flag itself.
 */
function renderLanding() {
  return render(<Landing dither={false} opening={false} />);
}

describe("fragment nav", () => {
  it("resolves every header link to an element that exists", () => {
    // The regression this exists for: the design source pointed "Case View" at
    // `#product`, an id present nowhere in the document, so the link was inert. A
    // dead in-page link is invisible in review - it scrolls nowhere and throws
    // nothing - which is exactly why it needs a test rather than a careful reader.
    const { container } = renderLanding();
    const targets = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')]
      .map((a) => a.getAttribute("href"))
      .filter((href): href is string => href !== null && href.length > 1);

    expect(targets.length).toBeGreaterThan(0);
    for (const href of new Set(targets)) {
      expect(container.querySelector(href), `${href} has no target`).not.toBeNull();
    }
  });

  it("opens the same links from the hamburger, which the design source left inert", () => {
    // Under 1280px the rail is hidden by CSS, so this control is the only navigation
    // on the page. The design source drew it as a <span> and wired nothing to it,
    // which at those widths is a page with no navigation at all.
    renderLanding();
    const toggle = screen.getByRole("button", { name: /open menu/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const panel = screen.getByRole("navigation", { name: "Sections menu" });
    const rail = document.querySelector<HTMLElement>(".navrail");
    const hrefs = [...document.querySelectorAll<HTMLAnchorElement>(".menu-panel a")].map((a) =>
      a.getAttribute("href"),
    );
    // Five fragments into this page, then one link OUT of it. The deliberation
    // client is its own surface on this origin and the rail is the only place a
    // reader can discover it exists, so it is the one entry here that is not a
    // section of this document.
    expect(hrefs).toEqual(["#method", "#product", "#ruleset", "#result", "#record", "/deliberation/"]);
    // The panel is a second copy of the rail, not a different route table.
    expect(hrefs).toEqual([...(rail?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href")));
    expect(panel).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(document.querySelector(".menu-panel")).toBeNull();
  });
});

describe("hero", () => {
  /** jsdom ships no ResizeObserver, and the eyes measure themselves with one. */
  function stubResizeObserver(width: number, height: number) {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: (entries: { contentRect: { width: number; height: number } }[]) => void) {}
        observe() {
          this.cb([{ contentRect: { width, height } }]);
        }
        unobserve() {}
        disconnect() {}
      },
    );
  }
  afterEach(() => vi.unstubAllGlobals());

  it("leads with the wordmark and keeps both calls to action", () => {
    renderLanding();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Arbiter");
    expect(screen.getByRole("link", { name: "Read The Method" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open The Record" })).toBeInTheDocument();
  });

  it("draws two eyes whose sclerae do not intersect", () => {
    // `gap` is CENTRE to centre, not the space between, so any value below twice the
    // eye radius silently overlaps the two circles into a figure of eight. Asserted
    // on the rendered geometry rather than on the prop, because the component scales
    // both to fit its box and only the result is the thing that can be wrong.
    stubResizeObserver(600, 280);
    const { container } = renderLanding();
    const sclerae = [...container.querySelectorAll(".hero-eyes svg > circle")];
    expect(sclerae).toHaveLength(2);

    const cx = sclerae.map((c) => Number(c.getAttribute("cx")));
    const r = Number(sclerae[0]?.getAttribute("r"));
    expect(r).toBeGreaterThan(0);
    expect(Math.abs((cx[1] ?? 0) - (cx[0] ?? 0))).toBeGreaterThan(2 * r);

    // Two pupils, and the eyes say nothing to a screen reader: the wordmark beside
    // them carries the name.
    expect(container.querySelectorAll(".hero-eyes svg > ellipse")).toHaveLength(2);
    expect(container.querySelector(".hero-eyes > div")).toHaveAttribute("aria-hidden", "true");
  });

  it("never mounts the WebGL grid under prefers-reduced-motion", () => {
    // The grid is a continuously animating WebGL surface that reacts to the pointer,
    // which is exactly what that setting asks not to be given. Gating it before the
    // lazy import also means a reader with the preference set never pays the 130KB
    // Three.js chunk at all - the flat paper ground is the design's own background,
    // so nothing is missing.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
      dispatchEvent: () => false,
    }));
    const { container } = renderLanding();
    expect(container.querySelector(".hero-grid")).toBeNull();
    // The hero itself is untouched by the grid's absence.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Arbiter");
  });

  it("degrades to an empty box where ResizeObserver is missing", () => {
    // No stub here. The eyes cannot measure themselves, so they draw nothing rather
    // than throwing and taking the whole hero down with them.
    const { container } = renderLanding();
    expect(container.querySelector(".hero-eyes")).not.toBeNull();
    expect(container.querySelector(".hero-eyes svg")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Arbiter");
  });
});

describe("counters", () => {
  it("numbers every section, in order, and the total matches how many there are", () => {
    // The counters are a promise about the length of the page, so removing a section
    // without renumbering leaves "[ 11 of 12 ]" as the last thing a reader sees and
    // makes them look for a twelfth that is not there. Derived from the rendered
    // count rather than hardcoded, so the next removal cannot silently break it.
    const { container } = renderLanding();
    const labels = [...container.querySelectorAll(".counter b")].map((n) => n.textContent);
    const total = labels.length;
    expect(total).toBeGreaterThan(0);
    expect(labels).toEqual(
      Array.from({ length: total }, (_, i) => `[ ${String(i + 1).padStart(2, "0")} of ${total} ]`),
    );
  });
});

describe("stat count-ups", () => {
  it("renders the final figure, so a reader who never animates still sees the number", () => {
    // The count-up writes into these text nodes. If the animation is the only thing
    // that ever produces the value - no JS, reduced motion, a failed hook - the page
    // shows 0.000 where it means 0.992, which is the worst possible lie for this
    // particular product to tell.
    renderLanding();
    expect(screen.getByText("97.4%")).toBeInTheDocument();
    expect(screen.getByText("7/267")).toBeInTheDocument();
    expect(screen.getAllByText("0.992").length).toBeGreaterThan(0);
  });

  it("quotes the run's own metrics.json, not numbers typed from memory", () => {
    // THE REGRESSION THIS EXISTS FOR. The page said "4/267 Positions Committed",
    // which took the numerator from the conflict subset (metric1, n=61) and the
    // denominator from the whole split (metric4, n=267) - two populations in one
    // fraction. It read as a modest, honest figure and was simply wrong.
    //
    // Read off disk rather than hardcoded here, so re-running the harness moves the
    // page and the test together, and a stale marketing figure fails CI instead of
    // being discovered by a reader with the results open beside it.
    const metrics = JSON.parse(readFileSync(resolve(__dirname, "../../../results/metrics.json"), "utf8"));
    const scored: number = metrics.sampleSizes.scored;
    const declineRate: number = metrics.metric4_abstentionQuality.declineRate;
    const committed: number = metrics.metric4_abstentionQuality.nCommitted;
    const robustness: number = metrics.metric5_plannerSensitivity.meanUnchangedFraction;

    renderLanding();
    expect(screen.getByText(`${(declineRate * 100).toFixed(1)}%`)).toBeInTheDocument();
    expect(screen.getByText(`${committed}/${scored}`)).toBeInTheDocument();
    expect(screen.getAllByText(robustness.toFixed(3)).length).toBeGreaterThan(0);

    // BALANCED ACCURACY IS NO LONGER READ FROM metrics.json, and the reason is the
    // point of this whole test rather than an exception to it.
    //
    // results/metrics.json was produced under ruleset v1.0, whose binarisation
    // HANDOVER section 13.1 declares invalid: it counted vLess-DILI-Concern as
    // positive, so a system correctly declining to flag amlodipine was scored wrong.
    // The page now shows the v2.0 re-grade from results/rescore-v2.txt, so asserting
    // it against metrics.json would demand the page display a figure the project has
    // published a correction retiring.
    //
    // The other three above are still read from the file because none of them moves
    // under v2.0: v2.0 changes the target definition only, and declineRate, nCommitted
    // and the planner figure do not read the label.
    //
    // This becomes a plain file read again the moment metrics.json is regenerated
    // under v2.0, which is the remaining half of P1-A.
    const V2_CONFLICT_SUBSET_BALANCED_ACCURACY = "0.500";
    expect(screen.getAllByText(V2_CONFLICT_SUBSET_BALANCED_ACCURACY).length).toBeGreaterThan(0);
  });

  it("fixes decimals and groups only integers", () => {
    // A belief mass with a thousands separator would be nonsense; a draw count
    // without one is unreadable.
    expect(formatCount(0.75, 3, "")).toBe("0.750");
    expect(formatCount(97.4, 1, "%")).toBe("97.4%");
    expect(formatCount(4, 0, "/267")).toBe("4/267");
    expect(formatCount(2000, 0, "")).toBe("2,000");
  });
});

describe("every compound named on the page is one the run actually scored", () => {
  // THE REGRESSION THIS EXISTS FOR. Hero.tsx said verbatim "These are the run's
  // actual numbers, not filler" while four of its six rows did not survive being
  // checked: Troglitazone, Acetaminophen and Valproate are not in the scored split
  // at all, and Isoniazid, which is, was printed with belief 0.070 and gap 0.930 on
  // "qsar only" when its real figures are 0.000, 0.865 and two claims.
  //
  // A mockup may be an illustration or it may be data. It may not claim to be data
  // and be an illustration. Reading the answer off disk is what stops the claim and
  // the page drifting apart again.
  const results = JSON.parse(readFileSync(resolve(__dirname, "../../../results/results.json"), "utf8"));
  const compounds = JSON.parse(readFileSync(resolve(__dirname, "../../../data/out/compounds.json"), "utf8"));
  const rows: { compoundId: string }[] = Array.isArray(results) ? results : results.rows;
  const list: { compoundId: string; name: string }[] = Array.isArray(compounds) ? compounds : compounds.compounds;

  const scoredNames = new Set(
    rows
      .map((r) => list.find((c) => c.compoundId === r.compoundId)?.name?.toLowerCase())
      .filter((n): n is string => n !== undefined),
  );

  // TAK-994 is the hand-built fixture case rather than a corpus compound, so it is
  // named here as the one deliberate exception instead of being silently allowed.
  const FIXTURE = new Set(["tak-994"]);

  it.each(["Perhexiline", "Sirolimus", "Ticagrelor", "Isoniazid", "Cyclosporine"])(
    "%s is in the scored split",
    (name) => {
      expect(scoredNames.has(name.toLowerCase())).toBe(true);
    },
  );

  it("names no compound the run never scored", () => {
    renderLanding();
    for (const gone of ["Troglitazone", "Acetaminophen", "Valproate"]) {
      expect(scoredNames.has(gone.toLowerCase())).toBe(false);
      expect(screen.queryByText(new RegExp(gone, "i"))).toBeNull();
    }
    expect(FIXTURE.has("tak-994")).toBe(true);
  });
});

describe("honesty", () => {
  it("states the honest result and the abstention rate on the page, not only in the table", () => {
    // Master spec section 9a: the caveats are the part a compressed screen-share
    // loses first, so they are asserted here rather than trusted to survive a
    // redesign.
    //
    // This asserted "It Ties One Stream, Exactly." until 2026-08-14. That claim was
    // true under ruleset v1.0 and is false under the v2.0 re-grade, where ARBITER
    // ties THREE baselines and is beaten by weightedAverage at 0.519. The heading a
    // reader sees must survive the correction, so the assertion moved with it.
    renderLanding();
    expect(screen.getByText(/Under An Honest Target, Nothing Does\./)).toBeInTheDocument();
    expect(screen.getByText(/ARBITER abstains on 260 of 267/)).toBeInTheDocument();
    expect(screen.getByText(/We Will Not Quote/)).toBeInTheDocument();
  });

  it("names every position as a word, never as a colour alone", () => {
    renderLanding();
    expect(screen.getAllByText("Abstain").length).toBeGreaterThan(0);
    expect(screen.getByText("Do Not Advance")).toBeInTheDocument();
  });

  it("prints the six registered rules with their strengths", () => {
    const { container } = renderLanding();
    const ids = [...container.querySelectorAll(".ruleset tbody .id")].map((n) => n.textContent);
    expect(ids).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
  });
});

describe("marquees", () => {
  it("hides the duplicated half from assistive tech", () => {
    // The track renders its contents twice so the loop has no seam. Without
    // aria-hidden on the copy, every quote and every standards body is announced
    // twice.
    const { container } = renderLanding();
    const halves = container.querySelectorAll(".marquee-half");
    expect(halves.length).toBeGreaterThan(0);
    expect(halves.length % 2).toBe(0);
    expect(container.querySelectorAll('.marquee-half[aria-hidden="true"]').length).toBe(halves.length / 2);
  });
});

describe("opening scene", () => {
  // The flag is the whole behaviour, so every test in here starts from a clean one.
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  const renderWithScene = () => render(<Landing dither={false} />);

  it("?intro=0 suppresses it even on a first arrival", () => {
    // For screenshots, and for demoing the page rather than the entrance.
    window.history.replaceState({}, "", "/?intro=0");
    try {
      expect(renderWithScene().container.querySelector(".opening")).toBeNull();
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  it("?intro=1 replays it even once the session flag is set", () => {
    window.sessionStorage.setItem("arbiter.openingScene.played", "1");
    window.history.replaceState({}, "", "/?intro=1");
    try {
      expect(renderWithScene().container.querySelector(".opening")).not.toBeNull();
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  it("lets the reader's reduced-motion setting beat ?intro=1", () => {
    // A query parameter is the author asking; the media query is the reader telling.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
      dispatchEvent: () => false,
    }));
    window.history.replaceState({}, "", "/?intro=1");
    try {
      expect(renderWithScene().container.querySelector(".opening")).toBeNull();
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });

  it("plays on arrival, and never again in the same session", () => {
    // A three-second gate on every visit is a tax, not an entrance. The second
    // viewing is the one that annoys, so it is the one asserted.
    const first = renderWithScene();
    expect(first.container.querySelector(".opening")).not.toBeNull();
    first.unmount();

    const second = renderWithScene();
    expect(second.container.querySelector(".opening")).toBeNull();
  });

  it("never mounts under prefers-reduced-motion", () => {
    // Not "plays instantly" - does not exist. There is nothing behind it to wait
    // for, so the correct reduced-motion behaviour is no scene at all.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
      dispatchEvent: () => false,
    }));
    const { container } = renderWithScene();
    expect(container.querySelector(".opening")).toBeNull();
  });

  it("hides itself from assistive tech and leaves the page readable behind it", () => {
    // The scene is decoration over a page that is already fully rendered. A screen
    // reader should be walking the page, not held at a counter for three seconds.
    const { container } = renderWithScene();
    expect(container.querySelector(".opening")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(/Under An Honest Target, Nothing Does\./)).toBeInTheDocument();
  });

  it("starts the counter at 000 so it never reflows as it passes 9 and 99", () => {
    const { container } = renderWithScene();
    expect(container.querySelector(".opening-count")?.textContent).toBe("000");
  });

  it("drives the counter and the bar from the frame loop", () => {
    // The regression this exists for: React StrictMode runs an effect, tears it
    // down, and runs it again. The first version marked the session as played on
    // the first run, so the SECOND run read its own flag back, bailed out, and left
    // the overlay mounted with nothing driving it - frozen at 000 forever, in
    // development only, which is the only place anyone would be looking at it.
    // Asserting the number MOVES is the only way that bug is visible to a test, and
    // it has to render inside <StrictMode> or the double-invoke never happens and
    // this passes against the broken version.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      const { container } = render(
        <StrictMode>
          <Landing dither={false} />
        </StrictMode>,
      );
      const count = () => container.querySelector(".opening-count")?.textContent ?? "";
      const bar = () => container.querySelector<HTMLElement>(".opening-bar i")?.style.transform ?? "";
      expect(count()).toBe("000");

      act(() => void vi.advanceTimersByTime(1500));
      expect(Number(count())).toBeGreaterThan(0);
      expect(bar()).not.toBe("scaleX(0)");

      act(() => void vi.advanceTimersByTime(2000));
      expect(count()).toBe("100");
      expect(container.querySelector('.opening[data-exiting="true"]')).not.toBeNull();

      // And it actually leaves, rather than sitting on the page at 100.
      act(() => void vi.advanceTimersByTime(1000));
      expect(container.querySelector(".opening")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still leaves when requestAnimationFrame never fires", () => {
    // Browsers PAUSE rAF in a hidden tab - measured: 0 ticks in a second with the
    // tab backgrounded. Without a backstop, a page opened in a background tab mounts
    // this overlay, never advances it, and holds body{overflow:hidden} until the
    // reader comes back. Nothing may be able to weld itself over the page.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    try {
      const { container } = renderWithScene();
      expect(container.querySelector(".opening")).not.toBeNull();

      act(() => void vi.advanceTimersByTime(4200));
      expect(container.querySelector('.opening[data-exiting="true"]')).not.toBeNull();

      act(() => void vi.advanceTimersByTime(1000));
      expect(container.querySelector(".opening")).toBeNull();
      expect(document.body.style.overflow).not.toBe("hidden");
    } finally {
      vi.useRealTimers();
    }
  });

  it("can be skipped with any key", () => {
    const { container } = renderWithScene();
    expect(container.querySelector('.opening[data-exiting="false"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: "a" });
    expect(container.querySelector('.opening[data-exiting="true"]')).not.toBeNull();
  });
});

describe("theming", () => {
  it("drives the accent through one custom property", () => {
    const { container } = render(<Landing dither={false} accent="#1CA64C" />);
    const root = container.querySelector<HTMLElement>(".landing");
    expect(root?.style.getPropertyValue("--blue")).toBe("#1CA64C");
  });
});
