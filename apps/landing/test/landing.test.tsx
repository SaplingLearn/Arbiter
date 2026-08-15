import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { StrictMode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Landing } from "../src/Landing.js";
import { SECTIONS } from "../src/overture/content.js";
import { ORDER } from "../src/overture/scenes/registry.js";
import { APP_URL } from "../src/links.js";

/**
 * Tests for the overture page.
 *
 * WHAT IS AND IS NOT TESTED HERE. Not a pixel of the artwork: jsdom has no WebGL, the
 * scenes are behind a lazy boundary that never resolves in these tests, and a snapshot
 * of a shader is worthless anyway — that work is judged from screenshots against the
 * reference. What is tested is everything the page still has to get right when the
 * canvas never arrives, which is the whole argument and every route out of it.
 *
 * That split is deliberate and it is also the design's own claim: the page's fallback
 * is a designed background, so a reader with no WebGL loses the pictures and nothing
 * else. These tests are what hold that claim up.
 */

describe("structure", () => {
  it("renders one panel per section, in order", () => {
    const { container } = render(<Landing />);
    const panels = [...container.querySelectorAll<HTMLElement>("[data-panel]")];
    expect(panels.map((p) => p.id)).toEqual(SECTIONS.map((s) => `ov-${s.id}`));
  });

  it("keeps the copy and the scenes in the same order", () => {
    // The two live in separate modules so that `content.ts` does not drag `three` into
    // the eager bundle. The cost of that split is exactly this: they can drift apart by
    // one and every section would then show the wrong artwork, silently and plausibly.
    expect(SECTIONS.map((s) => s.id)).toEqual([...ORDER]);
  });

  it("exposes exactly the chapter you are on, and it opens with the first", () => {
    const { container } = render(<Landing />);

    // All six headings exist in the DOM...
    expect(container.querySelectorAll("h1, h2")).toHaveLength(SECTIONS.length);

    // ...but only the current chapter's is in the accessibility tree. The other five
    // are `visibility: hidden`, which is the deliberate choice: it takes them out of
    // the a11y tree AND out of the tab order together, so a keyboard user cannot land
    // focus on a call to action that is scrolled 400vh away and invisible. Exposing all
    // six instead — opacity alone — reads the whole page at once to a screen reader and
    // leaves five invisible focus traps behind it.
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/Reasoning/i);

    // And it is an h1. Six h1s is the tempting alternative — they are typographically
    // identical and each owns a full screen — and it leaves the document with no
    // outline at all.
    expect(headings[0]!.tagName).toBe("H1");
    expect(container.querySelectorAll("h2")).toHaveLength(SECTIONS.length - 1);
  });

  it("gives the reader a route to every chapter that is not exposed", () => {
    // The corollary of hiding five chapters: the index has to reach all six, or most of
    // the page is unreachable by anything but scrolling.
    const { container } = render(<Landing />);
    const rail = container.querySelector<HTMLElement>('nav[aria-label="Chapters"]')!;
    expect(rail.querySelectorAll("button")).toHaveLength(SECTIONS.length);
  });

  it("states every section's argument as text, with no canvas", () => {
    // The scenes never load here. Everything below still has to be readable.
    const { container } = render(<Landing />);
    expect(container.querySelector("canvas")).toBeNull();
    for (const s of SECTIONS) {
      expect(screen.getByText(s.sub)).toBeInTheDocument();
    }
  });
});

describe("the rail", () => {
  it("lists every section and marks the first as current", () => {
    const { container } = render(<Landing />);
    const rail = container.querySelector<HTMLElement>('nav[aria-label="Chapters"]')!;
    const items = [...rail.querySelectorAll("li")];
    expect(items).toHaveLength(SECTIONS.length);
    // The ACCESSIBLE NAME, not `textContent`. Every decoded label renders its string
    // three times — an invisible sizing ghost, the animated glyph spans, and a screen
    // reader copy — so raw text content is tripled by design. What a user is offered is
    // the accessible name, and that is the thing worth asserting.
    expect(items.map((li) => within(li).getByRole("button").textContent?.trim())).toEqual(
      SECTIONS.map((s) => `${s.label}${s.label}${s.label}`),
    );
    for (const [i, li] of items.entries()) {
      expect(within(li).getByRole("button")).toHaveAccessibleName(SECTIONS[i]!.label);
    }

    // No IntersectionObserver in jsdom, so the spy never runs and the rail holds its
    // initial entry. That is the documented fallback, and it is worth pinning: the
    // alternative — an unguarded observer — threw from the mount effect and took the
    // whole suite down.
    expect(within(items[0]!).getByRole("button")).toHaveAttribute("aria-current", "true");
    for (const li of items.slice(1)) {
      expect(within(li).getByRole("button")).not.toHaveAttribute("aria-current");
    }
  });

  it("gives every rail entry a scroll target that exists", () => {
    const { container } = render(<Landing />);
    for (const s of SECTIONS) {
      expect(container.querySelector(`#ov-${s.id}`), `${s.id} has no panel`).not.toBeNull();
    }
  });
});

describe("calls to action", () => {
  it("points every link at a real destination", () => {
    const { container } = render(<Landing />);
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a[href]")];
    expect(links.length).toBeGreaterThan(0);

    for (const a of links) {
      const href = a.getAttribute("href")!;
      if (href.startsWith("#")) {
        // The regression this exists for: an in-page link whose target is not in the
        // document scrolls nowhere and throws nothing, so it is invisible in review.
        expect(container.querySelector(href), `${href} has no target`).not.toBeNull();
      } else {
        expect(href).toMatch(/^(https?:|\/)/);
      }
    }
  });

  it("opens every external link safely", () => {
    const { container } = render(<Landing />);
    const external = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')];
    expect(external.length).toBeGreaterThan(0);
    for (const a of external) {
      // `target=_blank` without `rel=noreferrer` hands the opened page a handle back to
      // this one via window.opener.
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel")).toContain("noreferrer");
    }
  });

  it("sends the header's one link into the product", () => {
    // The header pair is LOGIN + MENU. LOGIN is the link and MENU is the filled pill —
    // filled is the visual emphasis, but the thing that leaves the page is LOGIN, and
    // it has to reach the real app rather than a marketing anchor.
    const { container } = render(<Landing />);
    const login = container.querySelector<HTMLAnchorElement>('a[data-pill]')!;
    expect(login).toHaveTextContent(/login/i);
    expect(login).toHaveAttribute("href", APP_URL);
  });

  it("makes MENU a real control rather than a dead affordance", () => {
    render(<Landing />);
    const menu = screen.getByRole("button", { name: /menu/i });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: /menu/i })).toBeInTheDocument();
  });

  it("puts no call to action under the section about restraint", () => {
    // Load-bearing, not an oversight. A button under a statement about declining to
    // commit asks for the opposite of what the statement says.
    const { container } = render(<Landing />);
    const panel = container.querySelector<HTMLElement>("#ov-restraint")!;
    expect(panel.querySelector("[data-cta]")).toBeNull();

    // Every other section does have one, so the absence reads as a choice.
    for (const s of SECTIONS.filter((x) => x.id !== "restraint")) {
      expect(
        container.querySelector(`#ov-${s.id} [data-cta]`),
        `${s.id} is missing its call to action`,
      ).not.toBeNull();
    }
  });
});

describe("the motion toggle", () => {
  it("starts on and reports its state", () => {
    render(<Landing />);
    const toggle = screen.getByRole("button", { name: /motion/i });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveTextContent(/motion on/i);
  });

  it("flips, because it is the page's one real accessibility control", () => {
    // The reference puts an audio toggle in this corner. This page has no audio, and a
    // dead switch is worse than an empty corner — so it has to actually do something.
    render(<Landing />);
    const toggle = screen.getByRole("button", { name: /motion/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveTextContent(/motion off/i);
  });
});

describe("copy", () => {
  it("quotes no figures", () => {
    // This project has already shipped a fix titled "stop showing a retired number".
    // A marketing page is the worst place for a statistic to go stale, so the rule here
    // is that the page states the SHAPE of the claim and the results page carries the
    // numbers, which are generated from the run.
    for (const s of SECTIONS) {
      expect(s.sub, `${s.id} quotes a figure`).not.toMatch(/\d+(\.\d+)?\s*%/);
    }
  });

  it("authors both lines of every headline", () => {
    // Display type at this size cannot be left to wrap: where it breaks is a design
    // decision. Two lines, always.
    for (const s of SECTIONS) {
      expect(s.headline).toHaveLength(2);
      for (const line of s.headline) expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("strict mode", () => {
  it("mounts twice without duplicating the page", () => {
    // StrictMode double-invokes effects in development. The rail's observer and the
    // canvas host both live in effects, and a missing teardown shows up here as two of
    // everything rather than as a subtle leak.
    const { container } = render(
      <StrictMode>
        <Landing />
      </StrictMode>,
    );
    expect(container.querySelectorAll("[data-panel]")).toHaveLength(SECTIONS.length);
    expect(container.querySelectorAll('nav[aria-label="Chapters"]')).toHaveLength(1);
    expect(container.querySelectorAll("footer")).toHaveLength(1);
    // Not the canvas stage — that lives inside the lazy `Atmosphere` chunk, whose
    // import never resolves under jsdom, so the Suspense fallback (null) is what
    // renders. Its absence here is the split working, not a missing element.
  });
});
