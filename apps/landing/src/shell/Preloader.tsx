import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { BlockWipe, type BlockWipeHandle } from "@arbiter/design";

/**
 * THE BOOT SCREEN.
 *
 * A system coming up, not a playful loader. Everything here is in service of that one
 * word — MECHANICAL. The counter does not sweep, it steps. The label does not fade, it
 * gets overwritten. The mark does not spin, it assembles. Nothing eases in and out on a
 * sine.
 *
 * THE COUNTER IS TIED TO REAL WORK and then quantised, which is a deliberate pair of
 * decisions. A loader that animates 0→100 on a fixed duration and then waits is lying,
 * and it is obvious: it always finishes at the same moment regardless of the network. A
 * loader that renders raw byte progress is honest and looks broken, because real
 * progress arrives in a few large jumps with dead air between them. So: the TARGET is
 * three genuine milestones, and the DISPLAY snaps toward it in irregular steps. The
 * numbers on screen are real; only their granularity is designed.
 */

/** Where the counter is allowed to rest. Irregular on purpose — 3, 17, 42 reads as a
 *  machine reporting what it has actually finished, where 10, 20, 30 reads as a timer. */
const STOPS = [0, 3, 9, 17, 28, 42, 51, 66, 74, 88, 96, 100];

const CURSOR = "▮";

/**
 * Real completion, in three milestones.
 *
 * Fonts matter because the whole page is 11px tracked mono and a swap after reveal is
 * far more visible than a longer boot. The scene chunk matters because it is 147KB gzip
 * and revealing before it lands shows the CSS ground instead of the artwork. The frame
 * gate is what stops the reveal landing on a black canvas that has not drawn yet.
 */
function useBootProgress(sceneReady: boolean): number {
  const [done, setDone] = useState({ fonts: false, frame: false });

  useEffect(() => {
    let live = true;
    const fonts = document.fonts?.ready ?? Promise.resolve();
    void fonts.then(() => live && setDone((d) => ({ ...d, fonts: true })));

    // Two rAFs: the first lands inside the current paint, the second is the earliest
    // moment a real frame has been presented.
    const a = requestAnimationFrame(() =>
      requestAnimationFrame(() => live && setDone((d) => ({ ...d, frame: true }))),
    );
    return () => {
      live = false;
      cancelAnimationFrame(a);
    };
  }, []);

  const hit = [done.fonts, done.frame, sceneReady].filter(Boolean).length;
  return hit / 3;
}

export function Preloader({
  sceneReady,
  onDone,
}: {
  /** True once the WebGL chunk has loaded and can draw. */
  sceneReady: boolean;
  onDone: () => void;
}) {
  const target = useBootProgress(sceneReady);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<"counting" | "wiping" | "leaving">("counting");

  const rootRef = useRef<HTMLDivElement>(null);
  const centreRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<SVGSVGElement>(null);
  const flashRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<BlockWipeHandle | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const takeLabel = useCallback((h: BlockWipeHandle) => {
    labelRef.current = h;
  }, []);

  /* ---- the counter: steps toward real progress, never past it ---------- */

  useEffect(() => {
    if (phase !== "counting") return;
    const ceiling = target * 100;
    // Never display more than the work actually done — except for the last stop, which
    // is released only when everything is genuinely finished.
    const next = STOPS.find((s) => s > shown && s <= Math.max(ceiling, 3));
    if (next === undefined) return;

    // Irregular dwell. A constant interval between steps is a metronome, and a
    // metronome is the thing that gives a fake loader away.
    const dwell = 90 + ((next * 37) % 130);
    const t = setTimeout(() => setShown(next), dwell);
    return () => clearTimeout(t);
  }, [shown, target, phase]);

  /* ---- the indicator LED: random 2-6Hz -------------------------------- */

  useEffect(() => {
    const el = flashRef.current;
    if (!el) return;
    let raf = 0;
    let timer = 0;
    const tick = () => {
      el.style.opacity = el.style.opacity === "0.15" ? "1" : "0.15";
      // 2-6Hz, re-rolled every blink. A fixed rate reads as a CSS animation; a varying
      // one reads as something reacting to work it is actually doing.
      timer = window.setTimeout(() => (raf = requestAnimationFrame(tick)), 1000 / (2 + Math.random() * 4));
    };
    tick();
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  /* ---- the mark: four groups assembling ------------------------------- */

  useEffect(() => {
    const svg = markRef.current;
    if (!svg) return;
    const groups = svg.querySelectorAll("g");
    const tl = gsap.timeline({ repeat: -1 });
    tl.fromTo(
      groups,
      { opacity: 0.2, rotate: -8, transformOrigin: "center" },
      {
        opacity: 1,
        rotate: 0,
        duration: 0.5,
        // Each quadrant lands separately, so the mark assembles rather than appearing.
        stagger: { each: 0.12, from: "start" },
        ease: "power3.out",
      },
    ).to(groups, { opacity: 0.2, rotate: 8, duration: 0.4, stagger: 0.06, ease: "power2.in" }, "+=0.5");
    return () => {
      tl.kill();
    };
  }, []);

  /* ---- the sequence at 100% ------------------------------------------- */

  const sequenceStarted = useRef(false);

  useEffect(() => {
    if (shown !== 100 || sequenceStarted.current) return;

    /* RUN-ONCE VIA A REF, NOT VIA `phase`.
       The obvious version guards on `phase === "counting"` and calls `setPhase("wiping")`
       as its first statement — and that version deadlocks. Setting state re-renders,
       `phase` is in the dependency array, the effect tears down, and the cleanup flips
       `cancelled` on the closure that is at that moment awaiting the beat between the
       two wipes. The first swap lands, the second never fires, and the loader sits at
       "100% LOADED" forever. An effect must not depend on state it sets in its own body.
       The ref is not a style preference here; it is the fix. */
    sequenceStarted.current = true;
    setPhase("wiping");

    let cancelled = false;
    void (async () => {
      const label = labelRef.current;
      if (label) {
        await label.swap("100% loaded");
        await new Promise((r) => setTimeout(r, 260)); // the beat
        if (cancelled) return;
        await label.swap("Ready to explore");
      }
      await new Promise((r) => setTimeout(r, 400)); // the hold
      if (cancelled) return;
      setPhase("leaving");
    })();

    return () => {
      cancelled = true;
    };
  }, [shown]);

  /* ---- the reveal ------------------------------------------------------ */

  useEffect(() => {
    if (phase !== "leaving") return;
    const root = rootRef.current;
    const centre = centreRef.current;
    if (!root || !centre) {
      onDoneRef.current();
      return;
    }

    const tl = gsap.timeline({
      onComplete: () => {
        onDoneRef.current();
      },
    });

    // The loader's own exit: a small scale UP as it goes, not down. Scaling away reads
    // as a dialog dismissing; scaling toward the viewer as it dissolves reads as a
    // curtain being pulled through, which is what leaves the hero feeling arrived-at.
    tl.to(centre, { scale: 1.06, opacity: 0, duration: 0.42, ease: "power2.in" })
      .to(root, { opacity: 0, duration: 0.5, ease: "power2.inOut" }, "-=0.22")
      // The hero is revealed MID-ANIMATION. Its own intro starts before the curtain has
      // finished leaving, so the page is already moving when you first see it — the
      // alternative, a static hero appearing behind a fade, always reads as a
      // screenshot loading.
      .add(() => {
        const hero = document.querySelector<HTMLElement>("[data-hero-copy]");
        const hairlines = document.querySelectorAll<HTMLElement>("[data-hairline]");
        gsap.fromTo(
          hero,
          { opacity: 0, scale: 0.95 },
          { opacity: 1, scale: 1, duration: 0.9, ease: "power3.out" },
        );
        gsap.fromTo(
          hairlines,
          { scaleX: 0, transformOrigin: "left center" },
          { scaleX: 1, duration: 0.8, stagger: 0.08, ease: "power2.inOut" },
        );
      }, "-=0.45");

    return () => {
      tl.kill();
    };
  }, [phase]);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-[100] flex items-center justify-center bg-dark-blue"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div ref={centreRef} className="flex flex-col items-center gap-7">
        <span className="t-label tabular-nums text-off-blue">{shown}%</span>

        <div className="relative">
          {/* The mark, as four quadrant groups. Split into groups rather than drawn as
              one path precisely so it can assemble — a single path can only fade. */}
          <svg
            ref={markRef}
            viewBox="0 0 32 32"
            className="size-11 text-off-blue"
            fill="currentColor"
            aria-hidden="true"
          >
            <g>
              <rect x="0" y="0" width="15" height="15" />
            </g>
            <g>
              <rect x="17" y="0" width="15" height="15" />
            </g>
            <g>
              <rect x="0" y="17" width="15" height="15" />
            </g>
            <g>
              {/* The notched quadrant — the brand's one diagonal. */}
              <path d="M17 17 H32 V24 L24 32 H17 Z" />
            </g>
          </svg>

          <span
            ref={flashRef}
            className="absolute -right-5 top-0 size-1.5 bg-accent-bright shadow-[0_0_8px_var(--color-accent-bright)]"
            aria-hidden="true"
          />
        </div>

        <span className="t-label flex items-center gap-1 text-off-blue">
          <BlockWipe
            initial="Loading content"
            // The ghost is sized to the LONGEST string of the three, so the label's box
            // never changes width across two swaps.
            sizeFor="Ready to explore"
            onReady={takeLabel}
          />
          <span className="animate-[ov-blink_1s_steps(1)_infinite]" aria-hidden="true">
            {CURSOR}
          </span>
        </span>
      </div>
    </div>
  );
}
