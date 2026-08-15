import type { ReactElement } from "react";
import { Decode, Wordmark } from "@arbiter/design";
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
