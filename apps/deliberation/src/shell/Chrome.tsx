import type { ReactElement } from "react";
import { Wordmark } from "@arbiter/design";
import { href, type Route } from "../router.js";
import type { Person } from "../api.js";
import { NAV, currentNav } from "./nav.js";

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
export function Header({ route, me, onSignOut }: {
  route: Route;
  me: Person | null;
  onSignOut: () => void;
}): ReactElement {
  return (
    <header className="hud-head">
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
 * THE MENU.
 *
 * One glass plate holding four entries, centred in the header. A single plate rather
 * than four chamfered buttons in a row: the pair of controls in the landing page's
 * header is built the same way and for the same reason - with a gap between them they
 * read as separate objects that happen to be adjacent, and the block loses its edge.
 *
 * ANCHORS, NOT BUTTONS, and every label permanently visible. The reference this is
 * drawn from reveals its labels on hover and consumes the wheel to move between
 * states, which is right for a page you look at and wrong for one you work in: a menu
 * you cannot read until you point at it cannot be scanned, tabbed through, or read
 * aloud. The look is kept; the interaction is not.
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
            {n.label}
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
  const active = currentNav(route);
  if (active === undefined) return null;

  return (
    <div className="corner" aria-hidden="true">
      <span className="corner-dot" />
      {active.codename}
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/[\s.]+/).filter((p) => p !== "");
  const letters = parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return letters === "" ? "?" : letters;
}
