import { useEffect, useRef, useState, type ReactElement } from "react";
import { Decode, Wordmark } from "@arbiter/design";
import { href, type Route } from "../router.js";
import type { Person } from "../api.js";
import { NAV, codenameFor, currentNav } from "./nav.js";

/**
 * THE PRODUCT'S CHROME, rebuilt as a heads-up display over a live scene.
 *
 * The old chrome was a sticky bar with a row of text links on an opaque ground. It was
 * fine, and it was from a different object than the site it is reached from. Everything
 * here is the landing page's bezel language - a hairline frame with mitred corners,
 * mono labels at 11px, the accent present only as light - carrying a product's
 * navigation rather than a page's chapter index.
 *
 * WHAT IS FIXED AND WHAT SCROLLS. The frame, the header and the corner readout are
 * fixed; the work scrolls under them. That is the opposite of the landing page, which
 * locks the document and scrolls nothing but an empty spacer stack, and the difference
 * is deliberate: a case table with three hundred rows is a document, and a product that
 * hijacks the wheel to animate a camera is a product nobody can use.
 */

/**
 * The bezel: a hairline inset from the viewport with all four corners cut at 45
 * degrees. A bordered box under a clip-path rather than an SVG, so the clip cuts the
 * border with it and the diagonal is a real mitre rather than a border meeting a
 * transparent corner. Inert to the pointer.
 */
export function Frame(): ReactElement {
  return <div className="bezel" aria-hidden="true" />;
}

/**
 * Brand, tabs, identity.
 *
 * NOT A FILLED BAR. An opaque strip across the top would put a band between the reader
 * and the scene, and the scene is the point. The header floats: the only surface with a
 * ground is the tab block itself, which needs one to stay legible over six different
 * backgrounds.
 */
/**
 * Where the header stops being a fixture and starts being in the way.
 *
 * REVEAL_AT is roughly its own height plus the inset it floats in: above that the
 * header is not covering anything yet, so hiding it would be motion with no reason.
 *
 * FLOOR exists because a trackpad does not emit one scroll event per gesture - it
 * emits a stream of one- and two-pixel moves, some of them in the wrong direction.
 * Without a floor the header flickers on and off all the way down a case table.
 */
const REVEAL_AT = 96;
const FLOOR = 6;

/**
 * Hidden while the reader is going down the page, showing the moment they turn round.
 *
 * DIRECTION, NOT POSITION. "Hide below 400px" would take the navigation away and keep
 * it away for the length of a 300-row table; scrolling up is the gesture that means
 * "give me the chrome back", and answering it is why this pattern is everywhere.
 *
 * NO rAF THROTTLE. The listener is passive and does two comparisons against a number
 * the browser already has; scroll events are frame-aligned as it is, so a rAF here
 * would buy a frame of latency and nothing else. The state only changes when the
 * answer changes, so React re-renders on the turn, not on the scroll.
 */
function useHideOnScroll(): boolean {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    last.current = window.scrollY;

    const onScroll = (): void => {
      const y = window.scrollY;
      const moved = y - last.current;
      if (Math.abs(moved) < FLOOR) return;
      last.current = y;
      // Showing at the top whichever way the last move went: a flick to the top is
      // downward in its final pixels and the header belongs on screen there anyway.
      setHidden(y > REVEAL_AT && moved > 0);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); };
  }, []);

  return hidden;
}

export function Header({ route, me, onSignOut }: {
  route: Route;
  me: Person | null;
  onSignOut: () => void;
}): ReactElement {
  const hidden = useHideOnScroll();

  return (
    /* INERT WHILE IT IS AWAY, not merely transparent. This holds the main menu and the
       only sign-out control, and a tab stop on something translated off the top of the
       viewport sends focus somewhere the reader cannot see. `inert` takes the whole
       subtree out of the tab order and off the accessibility tree in one attribute,
       which is exactly the state being described. */
    <header className="hud-head" data-hidden={hidden ? "true" : "false"} {...(hidden ? { inert: "" } : {})}>
      <a className="brand" href={href({ name: "dashboard" })} aria-label="Arbiter, to the dashboard">
        <Wordmark className="brand-word" />
        <span className="brand-sub">Preclinical safety review</span>
      </a>

      {me !== null && <Tabs route={route} />}

      {me !== null && (
        <div className="account">
          <span className="avatar" aria-hidden="true">{initials(me.displayName)}</span>
          <span className="account-name">{me.displayName}</span>
          <button type="button" className="seg" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </header>
  );
}

/**
 * THE MENU — the landing page's chapter index, laid along the top instead of down
 * the left edge.
 *
 * It is the same control, part for part: a 6px square in the current colour that is
 * present only on the entry you are on, a mono label at 11px tracked to .16em, and
 * the three states that page uses - 35% at rest, 70% on hover, full when current.
 * Inactive entries sitting at a third is not an accident of taste over there and it
 * is not one here either: the set is a position readout first and a menu second, and
 * at full contrast four stacked labels compete with the page title beside them.
 *
 * THE LABEL DECODES ON ACTIVATION, through the same component the landing page uses,
 * and for the reason its own comment gives: on ACTIVATION, never on hover, because a
 * label that scrambles when the pointer crosses it would fire three times on the way
 * to the one you meant.
 *
 * ANCHORS, NOT BUTTONS. The chapter index drives a scroll position, so a button is
 * right there; these change the URL and the page, so they have to be links - middle
 * click, open in a new tab, and copy link address are things a reviewer does with a
 * case list.
 */
function Tabs({ route }: { route: Route }): ReactElement {
  const active = currentNav(route);

  return (
    <nav className="hud-tabs" aria-label="Main">
      {NAV.map((n) => {
        const on = active?.label === n.label;
        return (
          <a
            key={n.label}
            className="hud-tab"
            href={href(n.to)}
            {...(on ? { "aria-current": "page" as const } : {})}
          >
            <span className="hud-dot" aria-hidden="true" />
            <Decode text={n.label} play={on} />
          </a>
        );
      })}
    </nav>
  );
}

/**
 * The corner readout: which environment is drawn behind this screen.
 *
 * The reference carries a GPU-tier figure here. That number is for whoever is tuning
 * the renderer and means nothing to a toxicologist, so the slot holds the one thing in
 * this corner a reader can act on - the name of the place they are standing in, which
 * is how the tab and the scene behind it are tied together at all.
 */
export function CornerReadout({ route }: { route: Route }): ReactElement | null {
  /* FROM THE SCENE, NOT FROM THE MENU ENTRY. This read the codename off whichever rail
     entry was lit, and the two are not the same question - the record has no rail entry,
     so it borrowed the Library's and this corner said ARCHIVE while the Helix was
     closing over a sealed record. `codenameFor` answers from `sceneFor`, which is the
     same function the backdrop asks, so the two cannot say different words. */
  const codename = codenameFor(route);
  if (codename === undefined) return null;

  return (
    <div className="corner" aria-hidden="true">
      <span className="corner-dot" />
      {codename}
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/[\s.]+/).filter((p) => p !== "");
  const letters = parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return letters === "" ? "?" : letters;
}
