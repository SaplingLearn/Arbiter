import type { ReactNode } from "react";

/**
 * The five structural signatures BLUEPRINT calls non-negotiable, defined once each.
 *
 * They are here rather than inline at their ~90 call sites for the reason the product
 * app's stylesheet gives: when the same idea is written out by hand in forty places,
 * the forty copies drift, and the drift is invisible in review because each one looks
 * right on its own.
 */

/* ---------- registration ticks ---------- */

export type TickAt = "tl" | "tr" | "bl" | "br" | "tc";

/**
 * A "+" sitting ON a rail-and-boundary crossing, half of it on each side.
 *
 * aria-hidden, and drawn as text rather than as a border trick, because it is a
 * drafting mark: it says "this is where two lines meet" to a sighted reader and has
 * nothing to say to anyone else. Announcing eighty plus signs would be noise.
 */
export function Tick({ at, small }: { at: TickAt; small?: boolean }) {
  return <span aria-hidden="true" className={`tick tick--${at}${small ? " tick--sm" : ""}`}>+</span>;
}

/** The common case: the two ticks where a section's top boundary crosses both rails. */
export function TopTicks({ small }: { small?: boolean }) {
  return (
    <>
      <Tick at="tl" small={small ?? false} />
      <Tick at="tr" small={small ?? false} />
    </>
  );
}

/* ---------- hatched band ---------- */

/**
 * The 45° hairline band between major sections. Kept between the rails, bounded by a
 * hairline, and carrying no content - it is a page-level rest, and the one place the
 * layout is allowed to say nothing.
 */
export function Hatch({ id, short }: { id?: string; short?: boolean }) {
  return (
    <div className="hatch-band" {...(id === undefined ? {} : { id })}>
      <div className="rails">
        <div className={`hatch${short ? " hatch--top" : ""}`} />
      </div>
    </div>
  );
}

/* ---------- section counter ---------- */

/**
 * "[ 03 of 11 ] · Capabilities". The position is in ink and the name is not, so a
 * reader skimming for how much is left reads the count first.
 */
export function Counter({
  n,
  of = 11,
  name,
  className = "",
}: {
  n: number;
  of?: number;
  name: string;
  className?: string;
}) {
  return (
    <div data-reveal className={`counter ${className}`}>
      <b>[ {String(n).padStart(2, "0")} of {of} ]</b> · {name}
    </div>
  );
}

/* ---------- eyebrow ---------- */

/** Mono uppercase chip with a blue square, above a centred headline. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div data-reveal className="eyebrow">
      {children}
    </div>
  );
}

/* ---------- corner-bracket CTA ---------- */

/**
 * Square-cornered button with four L-shaped marks floating outside it. On hover the
 * marks push out and the fill darkens 6% - the button does not move, its registration
 * does, which is the whole conceit of the page in one control.
 *
 * The brackets are decorative and outside the text, so they are aria-hidden and the
 * accessible name is the label alone.
 */
export function Cta({
  href,
  variant,
  compact,
  children,
}: {
  href: string;
  variant: "primary" | "secondary";
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <a className={`cta cta--${variant}${compact ? " cta--compact" : ""}`} href={href}>
      <span className="cta-fill">{children}</span>
      {(["tl", "tr", "bl", "br"] as const).map((corner) => (
        <span key={corner} aria-hidden="true" className={`cta-bracket cta-bracket--${corner}`} />
      ))}
    </a>
  );
}

/* ---------- marquee ---------- */

/**
 * A track that scrolls its contents left forever, pausing on hover.
 *
 * The children are rendered TWICE and the animation travels exactly -50%, so the
 * track arrives at the second copy in the position the first copy started and the
 * loop has no seam. The duplicate is `aria-hidden`, or every quote on the page is
 * announced twice.
 */
export function Marquee({
  children,
  slow,
  reverse,
  className = "",
}: {
  children: ReactNode;
  slow?: boolean;
  reverse?: boolean;
  className?: string;
}) {
  return (
    <div className={`marquee-window ${className}`.trim()}>
      <div className={`marquee${slow ? " marquee--slow" : ""}${reverse ? " marquee--reverse" : ""}`}>
        <div className="marquee-half">{children}</div>
        <div className="marquee-half" aria-hidden="true">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---------- the mark ---------- */

/**
 * Four squares on a 2×2 grid. One is at 40% opacity and the bottom-right is inset two
 * pixels, so it reads as a panel that has not quite agreed with itself - which is the
 * product. A perfectly regular quad would say the opposite.
 */
export function Mark({ ink, small }: { ink?: boolean; small?: boolean }) {
  return (
    <span aria-hidden="true" className={`mark${ink ? " mark--ink" : ""}${small ? " mark--sm" : ""}`}>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/* ---------- stat count-up ---------- */

/**
 * A number that counts up when it scrolls into view.
 *
 * The FINAL value is what renders. `useReveals` reads the data attributes, animates
 * the text node from zero and writes the same string back at the end, so with
 * JavaScript off - or under `prefers-reduced-motion` - the reader gets the real
 * figure and never a zero.
 */
export function Stat({
  to,
  decimals = 0,
  suffix = "",
  className = "",
}: {
  to: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const body = decimals > 0 ? to.toFixed(decimals) : Math.round(to).toLocaleString("en-US");
  return (
    <div className={className} data-count data-to={to} data-decimals={decimals} data-suffix={suffix}>
      {body}
      {suffix}
    </div>
  );
}
