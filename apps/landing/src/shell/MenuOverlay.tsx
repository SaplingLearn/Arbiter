import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import {
  APP_URL,
  ENGINE_URL,
  HANDOVER_URL,
  HARNESS_URL,
  README_URL,
  REPO_URL,
  RESULTS_URL,
  RULESET_URL,
  SPECS_URL,
} from "../links.js";
import { Decode } from "./text/Decode.js";
import { reducedMotion } from "./text/motion.js";

/**
 * THE MENU — a full inversion of the page.
 *
 * Off-blue ground, dark ink: every value on the site swapped. That is the whole idea and
 * it is why this is not a panel or a drawer — the page does not gain an overlay, it turns
 * inside out. Anything less than a total inversion (a dark scrim, a translucent sheet)
 * reads as a layer on top of the site, and the effect depends on reading as the site
 * itself in negative.
 *
 * IT RESPECTS THE BEZEL. The panel is inset by `--frame-inset` and carries the same
 * chamfer, so the frame's cut corners survive the inversion. A full-bleed rectangle would
 * paint over the one element that has been constant on every screen so far, and the
 * illusion that this is the same object inverted would go with it.
 *
 * THE HEADER STAYS ABOVE IT. The close control has to be reachable and has to sit exactly
 * where MENU was — a close button that appears somewhere else is a different button.
 */

/** The five primary destinations. Real ones: every entry here goes somewhere. */
const PRIMARY = [
  { label: "App", href: APP_URL, notch: 1 },
  { label: "Method", href: RULESET_URL, notch: 4 },
  { label: "Results", href: RESULTS_URL, notch: 6 },
  { label: "Record", href: HANDOVER_URL, notch: 1 },
  { label: "Source", href: REPO_URL, notch: 1 },
] as const;

/** The numbered utility list. Deliberately more granular than the primary stack — these
 *  are the documents, where the stack above is the destinations. */
const UTILITY = [
  { label: "The ruleset", href: RULESET_URL },
  { label: "Design specifications", href: SPECS_URL },
  { label: "The engine", href: ENGINE_URL },
  { label: "The harness", href: HARNESS_URL },
  { label: "Readme", href: README_URL },
] as const;

/**
 * One word, with a single glyph carrying the brand's diagonal cut.
 *
 * The notch is applied to ONE letter per word, never two. It is a signature, and a
 * signature repeated within a single word stops being one — at two per word the eye
 * reads it as a broken font rather than as a mark.
 */
function NotchedWord({ text, notch }: { text: string; notch: number }) {
  return (
    <>
      {[...text].map((ch, i) =>
        i === notch ? (
          <span
            key={i}
            className="inline-block"
            // The same 45-degree cut as the bezel and the buttons, scaled to the glyph.
            style={{ clipPath: "polygon(0 0, 100% 0, 100% 62%, 62% 100%, 0 100%)" }}
          >
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

export function MenuOverlay({ open }: { open: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [hovered, setHovered] = useState<number | null>(null);

  // Kept mounted through the closing wipe, then removed. Unmounting on `open === false`
  // would delete the panel on the first frame of its own exit animation.
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    if (reducedMotion()) {
      gsap.set(panel, { scaleY: 1, opacity: open ? 1 : 0 });
      if (!open) setMounted(false);
      return;
    }

    if (open) {
      const tl = gsap.timeline();
      tl.fromTo(
        panel,
        { scaleY: 0, transformOrigin: "top center" },
        { scaleY: 1, duration: 0.5, ease: "expo.inOut" },
      ).fromTo(
        bodyRef.current?.querySelectorAll("[data-menu-line]") ?? [],
        { yPercent: 100 },
        { yPercent: 0, duration: 0.7, stagger: 0.05, ease: "expo.out" },
        0.22,
      );
      return () => {
        tl.kill();
      };
    }

    // Reverse: the panel rolls back up from the same edge it came down from. Collapsing
    // to the bottom would read as a different object leaving.
    const tl = gsap.timeline({ onComplete: () => setMounted(false) });
    tl.to(panel, { scaleY: 0, transformOrigin: "top center", duration: 0.42, ease: "expo.inOut" });
    return () => {
      tl.kill();
    };
  }, [open, mounted]);

  /* Focus moves to the header's CLOSE on open, so the keyboard is not left behind on a
     page that is now inert and invisible.
     
     It reaches for the header's button rather than owning one of its own. The first
     version rendered a screen-reader-only close inside the panel for exactly this, and
     that is a duplicate control: two things called "Close", one of them 1px and
     unclickable. Assistive tech would announce both, and it broke a click-by-role in the
     first browser run. One close button, and it is the visible one. */
  useEffect(() => {
    if (!open) return;
    document.querySelector<HTMLButtonElement>("[data-menu-close]")?.focus();
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      className="chamfer-all absolute z-[60] flex flex-col bg-off-blue text-dark-blue"
      style={{ inset: "var(--frame-inset)", willChange: "transform" }}
    >
      <div
        ref={bodyRef}
        className="flex h-full flex-col justify-between overflow-y-auto"
        style={{ padding: "var(--hud-gutter)" }}
      >
        {/* Top-left marker. The header's own row sits above this, outside the panel. */}
        <div className="t-label mt-14 flex items-center gap-2.5 text-dark-blue/70">
          <span className="size-1.5 bg-current" aria-hidden="true" />
          Explore
        </div>

        {/* ---- primary stack ---- */}
        <nav aria-label="Primary" className="py-10">
          <ul onPointerLeave={() => setHovered(null)}>
            {PRIMARY.map((item, i) => (
              <li key={item.label} className="overflow-hidden">
                <a
                  data-menu-line
                  href={item.href}
                  {...(item.href.startsWith("http")
                    ? { target: "_blank", rel: "noreferrer" }
                    : {})}
                  onPointerEnter={() => setHovered(i)}
                  onFocus={() => setHovered(i)}
                  className={`t-display flex items-center gap-5 py-1 text-[clamp(38px,6.4vw,72px)] leading-[1] transition-opacity duration-200 ${
                    // The hovered item holds; its siblings drop to 25%. Dimming the
                    // others rather than brightening the target is what makes the stack
                    // feel like one control with a selection, instead of five links.
                    hovered === null || hovered === i ? "opacity-100" : "opacity-25"
                  }`}
                >
                  <span
                    className={`size-2.5 shrink-0 bg-current transition-opacity duration-150 ${
                      hovered === i ? "opacity-100" : "opacity-0"
                    }`}
                    aria-hidden="true"
                  />
                  {hovered === i ? (
                    <Decode text={item.label} hover />
                  ) : (
                    <span>
                      <NotchedWord text={item.label} notch={item.notch} />
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* ---- utility list ---- */}
        <div>
          <div className="t-label mb-4 flex items-center gap-2.5 text-dark-blue/70">
            <span className="size-1.5 bg-current" aria-hidden="true" />
            Links
          </div>

          <ul className="border-t border-dark-blue/15">
            {UTILITY.map((item, i) => (
              <li key={item.label} className="border-b border-dark-blue/15">
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="t-label group flex items-center justify-between py-3.5 text-dark-blue/80 transition-colors duration-200 hover:text-dark-blue"
                >
                  <Decode text={item.label} hover />
                  <span className="text-dark-blue/40">{String(i + 1).padStart(2, "0")}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
