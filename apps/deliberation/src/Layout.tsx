import type { ReactElement, ReactNode } from "react";
import { href, type Route } from "./router.js";
import { SITE_URL } from "./links.js";
import { Backdrop } from "./shell/Backdrop.js";
import { CornerReadout, Frame, Header } from "./shell/Chrome.js";
import type { CaseSummary, Person } from "./api.js";

/**
 * The page: a heads-up display over a live scene.
 *
 * The chrome itself is in `shell/Chrome.tsx`. This file composes it, and holds the
 * three pieces of furniture every working screen shares - a page head, a section, and
 * the case stage strip.
 *
 * ONE HEAVY COLOUR, still. Red, green and amber mean something specific on a safety
 * call and must never be spent on decoration; the accent is light, never a fill. The
 * palette moved to a dark ground and that discipline did not change.
 */

export { initials } from "./shell/Chrome.js";

export function Layout({ route, me, catalogue, mine = [], focusKey, onSignOut, children }: {
  route: Route;
  me: Person | null;
  /** Passed straight through to the backdrop: the Archive draws one body per case. */
  catalogue: CaseSummary[];
  /** The viewer's OWN cases, which the library catalogue knows nothing about. Also
   *  straight through - the Archive needs a body for each of these or several of them
   *  end up sharing one. Defaults to empty so a caller that has not loaded them yet
   *  draws the library's bodies rather than none. */
  mine?: { caseId: string }[];
  /** Also straight through — which case the environment singles out. See `Backdrop`. */
  focusKey: string | null;
  onSignOut: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      {/* THE CANVAS IS A SIBLING OF THE SHELL, NOT A CHILD, and that is load-bearing
          rather than tidy. Inside the shell it was a positioned element at z-index 0,
          which CSS paints in the same step as positioned descendants - ABOVE the
          inline text of everything non-positioned around it. The symptom was very
          specific and very confusing: every panel rendered perfectly and every bare
          line of type vanished, because a panel carries backdrop-filter, which makes
          a stacking context, and a page title carries nothing. Out here the order is
          the whole argument: canvas at 0, shell at 1. */}
      <Backdrop route={route} catalogue={catalogue} mine={mine} focusKey={focusKey} />

      <div className="shell">
      <Frame />
      <Header route={route} me={me} onSignOut={onSignOut} />
      {me !== null && <CornerReadout route={route} />}

      <main className="work">
        <div className="work-col">
          {children}

          {/* A real footer at the end of the work, not a fixed bar. Fixed, it would
              cover the last row of a table on a short page; here it arrives when the
              reading does. */}
          <footer className="work-foot">
            <span>
              Positions are sealed on submission and the record is hash-chained.{" "}
              <a href={SITE_URL}>What that proves, and what it does not</a>.
            </span>
            <span>Running locally · no transport encryption</span>
          </footer>
        </div>
      </main>
      </div>
    </>
  );
}

/** Title, one line of orientation, and the actions that belong to this page. */
export function PageHead({ crumb, eyebrow, title, lede, actions }: {
  crumb?: ReactNode; eyebrow?: string; title: string; lede?: string; actions?: ReactNode;
}): ReactElement {
  return (
    <div className="pagehead">
      <div className="titles">
        {crumb !== undefined && <div className="crumb">{crumb}</div>}
        {eyebrow !== undefined && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lede !== undefined && <p className="lede">{lede}</p>}
      </div>
      {actions !== undefined && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Section({ title, count, children }: {
  title?: string; count?: string; children: ReactNode;
}): ReactElement {
  return (
    <section className="section glass">
      {title !== undefined && (
        <header>
          <h2>{title}</h2>
          {count !== undefined && <span className="count">{count}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * The case stages. Ordered because the order IS the product: reading somebody
 * else's call before writing your own is the failure blind submission exists to
 * prevent, so the reveal stage is genuinely unreachable until the case locks
 * rather than merely styled as unavailable.
 *
 * STILL A HORIZONTAL STRIP, and not folded into the rail beside it. The rail is
 * navigation - four places that exist at all times, in no order. This is a sequence
 * with a gate in it, and the two must not look alike or the gate reads as a broken
 * link.
 */
export function Steps({ caseId, route, revealed, adjudicated, answered, of, marks }: {
  caseId: string; route: Route; revealed: boolean;
  /** Whether an adjudication exists. Gates the report, which is printed from one. */
  adjudicated?: boolean;
  answered?: number; of?: number;
  /** The VIEWER's own mark count. Never another participant's - see the pip note. */
  marks?: number;
}): ReactElement {
  const items: { label: string; to: Route; enabled: boolean; pip?: string; why?: string }[] = [
    { label: "Evidence", to: { name: "case", caseId }, enabled: true },
    {
      // Second, not appended. The strip claims the order is the product and then
      // skipped the part where somebody reads: a reviewer went from a list of
      // documents straight to a verdict form, so the reading happened off-system.
      // Read-then-decide is the order the work already has.
      //
      // Never gated, unlike Reveal. Status changes what this shows, not whether it
      // opens. The pip is the viewer's OWN count: own activity is not an aggregate
      // over other people, so it leaks nothing blind submission protects.
      label: "Read & mark", to: { name: "read", caseId }, enabled: true,
      ...(marks === undefined ? {} : { pip: String(marks) }),
    },
    {
      label: "Your position", to: { name: "position", caseId }, enabled: !revealed,
      ...(answered !== undefined && of !== undefined ? { pip: `${answered}/${of}` } : {}),
    },
    {
      label: "Reveal & verdict", to: { name: "reveal", caseId }, enabled: revealed,
      why: "Opens once everyone has answered",
    },
    { label: "Record", to: { name: "record", caseId }, enabled: true },
    {
      /**
       * LAST, AND VISIBLY LOCKED UNTIL THERE IS SOMETHING TO PRINT.
       *
       * The way through to the report used to exist only inside the verdict block, so
       * on any case that had not been adjudicated there was no trace of it anywhere
       * and nothing said why - the honest question it produced was "where is the
       * button?", which is a product failing to explain its own sequence rather than a
       * missing feature. The strip already has the answer for exactly this shape of
       * thing: Reveal is a tab you can see and cannot open yet, with the reason on it.
       *
       * Gated on the ADJUDICATION rather than on the reveal, because that is what the
       * document is printed from. A report with an empty verdict reads as a panel that
       * concluded nothing, which is not what a revealed-but-unadjudicated case means.
       */
      label: "Report", to: { name: "report", caseId }, enabled: adjudicated === true,
      why: "Opens once the case has been adjudicated",
    },
  ];

  return (
    <nav className="tabbar" aria-label="Case stages">
      {items.map((i) => (
        <a key={i.label} href={href(i.to)}
          {...(route.name === i.to.name ? { "aria-current": "page" as const } : {})}
          {...(i.enabled ? {} : { "aria-disabled": "true" as const, title: i.why ?? "" })}>
          {i.label}
          {i.pip !== undefined && <span className="pip">{i.pip}</span>}
          {!i.enabled && <span className="lock" aria-hidden="true">·</span>}
        </a>
      ))}
    </nav>
  );
}
