import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Header } from "../src/shell/Chrome.js";
import type { Person } from "../src/api.js";

/**
 * THE HEADER GETS OUT OF THE WAY.
 *
 * It is `position: fixed`, floating over a scene rather than sitting on a bar, and the
 * work scrolls underneath it - so on a long case table it covers the rows passing
 * behind it. The answer is the one every reading surface uses: it leaves when you are
 * going down the page and comes back the moment you turn around, because wanting the
 * navigation back is what scrolling up means.
 */

const me: Person = {
  id: "u1", email: "r.okafor@arbiter.demo",
  displayName: "R. Okafor (programme lead)", signatureMethod: "typed",
};

/** jsdom never scrolls anything, so the position is stated and the event announced. */
function scrollTo(y: number): void {
  act(() => {
    Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
    window.dispatchEvent(new Event("scroll"));
  });
}

const header = (): HTMLElement | null => document.querySelector(".hud-head");

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
});

describe("the header on scroll", () => {
  const mount = (): void => {
    render(<Header route={{ name: "dashboard" }} me={me} onSignOut={() => {}} />);
  };

  it("is showing at the top of the page", () => {
    mount();
    expect(header()).toHaveAttribute("data-hidden", "false");
  });

  it("goes up when you scroll down the page", () => {
    mount();
    scrollTo(400);
    expect(header()).toHaveAttribute("data-hidden", "true");
  });

  it("comes back the moment you turn around", () => {
    mount();
    scrollTo(400);
    scrollTo(320);
    expect(header()).toHaveAttribute("data-hidden", "false");
  });

  /**
   * Back at the top it is showing whichever way the last move went. Scrolling to the
   * very top with one flick is a downward-free gesture in principle and an inertial
   * mess in practice; the header belongs on screen there regardless of what the last
   * few pixels did.
   */
  it("is showing again once you are back at the top", () => {
    mount();
    scrollTo(400);
    scrollTo(0);
    expect(header()).toHaveAttribute("data-hidden", "false");
  });

  /**
   * A trackpad emits a stream of one- and two-pixel events, including some in the
   * wrong direction, all through a single gesture. Without a floor the header
   * flickers on and off through a normal scroll.
   */
  it("ignores the jitter inside a single gesture", () => {
    mount();
    scrollTo(400);
    scrollTo(398);
    expect(header()).toHaveAttribute("data-hidden", "true");
  });

  /**
   * The header holds the only sign-out control and the whole main menu. Hidden, it
   * must not be reachable by tab: focus landing on something scrolled off the top of
   * the viewport moves the reader nowhere they can see.
   */
  it("is out of the tab order while it is away", () => {
    mount();
    scrollTo(400);
    expect(header()).toHaveAttribute("inert");
  });
});
