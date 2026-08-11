import type { ReactElement, ReactNode } from "react";
import { href, type Route } from "./router.js";
import type { Person } from "./api.js";

/**
 * App chrome: a light sticky top bar, a single strong brand mark, and a quiet
 * footer. The one heavy colour in the product is the mark itself, so the palette
 * stays available for the evidence states - red, green and amber mean something
 * specific here and must never be spent on decoration.
 */

export function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/[\s.]+/).filter((p) => p !== "");
  const letters = parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return letters === "" ? "?" : letters;
}

export function Layout({ route, me, onSignOut, children }: {
  route: Route;
  me: Person | null;
  onSignOut: () => void;
  children: ReactNode;
}): ReactElement {
  const nav: { label: string; to: Route }[] = [
    { label: "Dashboard", to: { name: "dashboard" } },
    { label: "New case", to: { name: "new" } },
    { label: "Library", to: { name: "cases" } },
    // Top-level, not a case tab. The tab strip is a SEQUENCE - 3.5: "the workflow is
    // the information architecture" - and asking what a document says is not a step in
    // it. The same question is often asked across cases.
    { label: "Ask", to: { name: "ask" } },
    { label: "Method", to: { name: "method" } },
  ];

  return (
    <div className="page">
      <header className="topbar">
        <div className="col">
          <a className="brand" href={href({ name: "dashboard" })}>
            <span className="mark" aria-hidden="true"><i /><i /><i /><i /></span>
            <span>
              <b>Arbiter</b>
              <span>Preclinical safety review</span>
            </span>
          </a>

          {me !== null && (
            <>
              <nav className="nav" aria-label="Main">
                {nav.map((n) => (
                  <a key={n.label} href={href(n.to)}
                    {...(route.name === n.to.name ? { "aria-current": "page" as const } : {})}>
                    {n.label}
                  </a>
                ))}
              </nav>
              <div className="spacer" />
              <div className="account">
                <span className="avatar" aria-hidden="true">{initials(me.displayName)}</span>
                <span className="small muted" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {me.displayName}
                </span>
                <button className="ghost" onClick={onSignOut}>Sign out</button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* BLUEPRINT's hatched band, used once: the boundary between the app chrome
          and the work. On the landing page the device is the rest between major
          sections, which a working screen has no room for. */}
      <div className="hatch-band" aria-hidden="true" />

      <main>
        <div className="col">{children}</div>
      </main>

      <footer className="foot">
        <div className="col">
          <span>
            Positions are sealed on submission and the record is hash-chained.{" "}
            <a href={href({ name: "method" })}>What that proves, and what it does not</a>.
          </span>
          <span>Running locally · no transport encryption</span>
        </div>
      </footer>
    </div>
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
    <section className="section">
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
 */
export function Steps({ caseId, route, revealed, answered, of }: {
  caseId: string; route: Route; revealed: boolean; answered?: number; of?: number;
}): ReactElement {
  const items: { label: string; to: Route; enabled: boolean; pip?: string; why?: string }[] = [
    { label: "Evidence", to: { name: "case", caseId }, enabled: true },
    {
      label: "Your position", to: { name: "position", caseId }, enabled: !revealed,
      ...(answered !== undefined && of !== undefined ? { pip: `${answered}/${of}` } : {}),
    },
    {
      label: "Reveal & verdict", to: { name: "reveal", caseId }, enabled: revealed,
      why: "Opens once everyone has answered",
    },
    { label: "Record", to: { name: "record", caseId }, enabled: true },
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
