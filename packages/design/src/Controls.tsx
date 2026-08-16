import { useEffect, useRef, useState, type ReactNode } from "react";
import { Decode } from "./text/Decode.js";
import { reducedMotion } from "./text/motion.js";

/**
 * THE INTERACTIVE SET — glyph, primary CTA, header pair.
 *
 * One idea runs through all of them: a control is a PLATE, cut at one corner, that
 * inverts when you commit to it. Hover softens and animates; press is a hard, instant
 * flip to solid. Nothing here eases on press — the invert is the confirmation, and an
 * eased confirmation reads as a suggestion.
 */

/* -------------------------------------------------------------------- glyph */

/**
 * The pixel cluster: three squares on a 2×2 grid, one cell empty — an L, like the
 * corner marker of a QR code.
 *
 * The four arrangements are the four cells that can be the empty one, so shuffling
 * through them reads as the L rotating rather than as three dots moving at random. That
 * distinction is the whole effect: randomised positions look like a glitch, a rotating
 * corner looks like a machine indexing.
 */
const CELLS = [
  [0, 0],
  [6, 0],
  [0, 6],
  [6, 6],
] as const;

/** Each arrangement omits one cell. Order chosen so consecutive states differ by a
 *  rotation rather than by a reflection. */
const ARRANGEMENTS = [3, 1, 0, 2] as const;

export function PixelGlyph({
  /** Cycle the arrangement. Driven by the enclosing control's hover state. */
  shuffling = false,
  className = "",
}: {
  shuffling?: boolean;
  className?: string;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!shuffling || reducedMotion()) return;
    // ~150ms per step, as steps — not a continuous tween. The squares should arrive,
    // not glide.
    const id = window.setInterval(() => setStep((s) => s + 1), 150);
    return () => clearInterval(id);
  }, [shuffling]);

  const omit = ARRANGEMENTS[step % ARRANGEMENTS.length]!;
  const shown = CELLS.map((c, i) => ({ c, i })).filter(({ i }) => i !== omit);

  return (
    <svg
      className={`size-[9px] shrink-0 ${className}`}
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden="true"
    >
      {shown.map(({ c, i }) => (
        <rect
          key={i}
          x={c[0]}
          y={c[1]}
          width="4"
          height="4"
          style={{ transition: reducedMotion() ? undefined : "x 150ms linear, y 150ms linear" }}
        />
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------- press flash */

/**
 * The invert flash.
 *
 * 80ms of solid off-blue with dark text on pointer-down, then straight back. Held on a
 * timer rather than on `:active` because `:active` releases the instant the pointer
 * leaves the element — drag off a button mid-press and the flash never resolves, which
 * leaves the control looking stuck. A timer always completes.
 */
function usePressFlash(): [boolean, { onPointerDown: () => void }] {
  const [flashing, setFlashing] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  return [
    flashing,
    {
      onPointerDown: () => {
        setFlashing(true);
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setFlashing(false), 80);
      },
    },
  ];
}

/* ------------------------------------------------------------------ primary */

/**
 * THE PRIMARY CALL TO ACTION.
 *
 * A glassy plate with its bottom-right corner cut, and a second copy of itself offset
 * 4px behind at lower opacity. The offset plate is what makes it read as a physical
 * layer rather than as a rectangle with a border — it is the same trick as a drop shadow
 * and it is better here, because a blurred shadow on a near-black ground is invisible
 * while a hard offset edge is not.
 *
 * The backing plate is `aria-hidden` and inert; only the front one is the control.
 */
export function Cta({
  href,
  label,
  newTab,
  className = "",
}: {
  href: string;
  label: string;
  /** Open in a new tab. Decided by the CALLER, never inferred from the URL's shape
   *  here — a design system cannot know which hosts are "ours". Getting that wrong is
   *  what made the landing page's own product link open a popup in development and
   *  navigate in place in production. */
  newTab?: boolean;
  className?: string;
}) {
  const [hover, setHover] = useState(false);
  const [flashing, press] = usePressFlash();

  return (
    <span className={`relative inline-block ${className}`}>
      {/* The plate behind. Offset down and right, dimmer, same cut. */}
      <span
        aria-hidden="true"
        className="chamfer-br pointer-events-none absolute inset-0 translate-x-[4px] translate-y-[4px] border border-off-blue/10 bg-off-blue/[0.04]"
      />

      <a
        data-cta=""
        href={href}
        {...(newTab ? { target: "_blank" as const, rel: "noreferrer" } : {})}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        {...press}
        /* NO TRANSITION WHILE FLASHING. The press is specified as an instant invert, and
           an eased one is a different gesture: 200ms of the ground creeping toward solid
           reads as the control considering the click, where a snap reads as it accepting
           it. Measured mid-press with the transition still applied, the background was
           only 23% of the way to solid — the flash was over before it arrived. */
        className={`chamfer-br t-label relative inline-flex h-[52px] items-center gap-3 border px-7 ${
          flashing
            ? "border-off-blue bg-off-blue text-dark-blue transition-none"
            : hover
              ? "border-off-blue/45 bg-off-blue/[0.16] text-off-blue shadow-[0_0_24px_-6px_var(--color-accent-bright)] transition-[background-color,border-color,box-shadow] duration-200"
              : "border-off-blue/20 bg-off-blue/[0.08] text-off-blue transition-[background-color,border-color,box-shadow] duration-200"
        }`}
      >
        <PixelGlyph shuffling={hover && !flashing} />
        <Decode text={label} hover />
      </a>
    </span>
  );
}

/* ------------------------------------------------------------- header pair */

/**
 * The header's two segments.
 *
 * They share an edge — no gap, no rounding — so the pair reads as one control cut in
 * two rather than as two buttons placed next to each other. Only the block's outer
 * corner is chamfered, which is what ties it to the bezel behind it.
 */
export function SegmentPair({ children }: { children: ReactNode }) {
  return <div className="chamfer-tr flex items-stretch overflow-hidden">{children}</div>;
}

export function Segment({
  href,
  label,
  newTab,
  solid,
  inverted,
  onClick,
  pressed,
  hook,
}: {
  href?: string;
  label: string;
  /** Open in a new tab. Decided by the caller — see the note on `Cta`. */
  newTab?: boolean;
  /** Off-blue ground, dark text — the emphasis segment on the dark page. */
  solid?: boolean;
  /** Dark ground, off-blue text — the same emphasis, on the LIGHT menu panel. */
  inverted?: boolean;
  onClick?: () => void;
  pressed?: boolean;
  /** Extra data attribute, so another component can find this control to focus it. */
  hook?: string;
}) {
  const [hover, setHover] = useState(false);
  const [flashing, press] = usePressFlash();

  // The solid segment is ALREADY inverted, so its press flash has to go the other way —
  // to the dark ground. Flashing it lighter would be no change at all.
  const skin = flashing
    ? solid || inverted
      ? "bg-dark-blue text-off-blue"
      : "bg-off-blue text-dark-blue"
    : inverted
      ? "bg-dark-blue text-off-blue hover:bg-dark-blue/85"
      : solid
        ? "bg-off-blue text-dark-blue hover:bg-white"
        : hover
          ? "bg-off-blue/[0.16] text-off-blue"
          : "bg-dark-blue/70 text-off-blue";

  // Same rule as the CTA: the invert is instant, everything else eases.
  const common = `t-label inline-flex items-center gap-2.5 border px-5 py-3.5 ${
    inverted ? "border-dark-blue/20" : "border-off-blue/15"
  } ${flashing ? "transition-none" : "transition-colors duration-200"} ${skin}`;
  const inner = (
    <>
      <PixelGlyph shuffling={hover && !flashing} />
      <Decode text={label} hover />
    </>
  );

  const handlers = {
    onPointerEnter: () => setHover(true),
    onPointerLeave: () => setHover(false),
    ...press,
  };

  if (href) {
    return (
      <a
        data-pill={solid ? "primary" : "secondary"}
        className={common}
        href={href}
        {...(newTab ? { target: "_blank" as const, rel: "noreferrer" } : {})}
        {...handlers}
      >
        {inner}
      </a>
    );
  }

  return (
    <button
      type="button"
      data-pill={solid ? "primary" : "secondary"}
      {...(hook ? { [hook]: "" } : {})}
      className={common}
      onClick={onClick}
      aria-expanded={pressed}
      {...handlers}
    >
      {inner}
    </button>
  );
}
