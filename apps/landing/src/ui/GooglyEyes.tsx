import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { prefersReducedMotion } from "../motion/reducedMotion.js";

/**
 * Googly eyes that follow the cursor.
 *
 * VENDORED FROM framer.com/m/GooglyEyes-e7CN.js@UjrCcF3EZr0JYBl5R4rI, and
 * transcribed rather than imported. Unlike the Animation-loader module, this one is
 * a hand-written code component: its only Framer dependency is
 * `addPropertyControls`/`ControlType`, used once at the bottom of the original to
 * draw the editor's property panel and inert outside Framer. Everything else is
 * React and one SVG.
 *
 * So importing it was possible - and still wrong. It would have meant a runtime
 * request to framerusercontent.com on every page load, a hero that breaks if that
 * host is down or the module is deleted, and a `framer` npm dependency pulled in to
 * satisfy two symbols that do nothing here. Transcribing costs one file and buys a
 * typed, lintable, offline component.
 *
 * The geometry, the defaults and the double-blink timing are the original's. Two
 * things are deliberately not:
 *
 *  1. THE POINTER IS A REF, NOT STATE, and the pupils are written straight to the
 *     SVG. The original held the pointer in state and called setPupils() inside an
 *     unconditional requestAnimationFrame loop, so it re-rendered React sixty times
 *     a second for the life of the page whether the mouse moved or not. On a
 *     landing page that is a permanent battery cost for an idle decoration.
 *  2. Blinking stops under prefers-reduced-motion. Tracking does not: following the
 *     cursor is a response to the reader's own input, where a blink is unrequested
 *     motion.
 */

export type GooglyEyesProps = {
  scleraColor?: string;
  pupilColor?: string;
  outline?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
  eyeRadius?: number;
  pupilRadius?: number;
  gap?: number;
  /** Clearance kept between the pupil edge and the sclera edge. */
  margin?: number;
  /** Per-frame lerp factor, 0..1. The original's default is 0.18. */
  smoothness?: number;
  blinking?: boolean;
  blinkInterval?: number;
  sizing?: "fit" | "fill";
  background?: string;
};

/** The original's double-blink: shut, open, shut, open - 120ms a beat. */
const BLINK_BEAT_MS = 120;
/** How flat the pupil goes when shut. */
const BLINK_SQUASH = 0.18;

export function GooglyEyes({
  scleraColor = "#ffffff",
  pupilColor = "#000000",
  outline = false,
  outlineColor = "#000000",
  outlineWidth = 2,
  eyeRadius = 120,
  pupilRadius = 46,
  gap = 260,
  margin = 4,
  smoothness = 0.18,
  blinking = true,
  blinkInterval = 3000,
  sizing = "fit",
  background = "transparent",
}: GooglyEyesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<SVGEllipseElement>(null);
  const rightRef = useRef<SVGEllipseElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [blink, setBlink] = useState(false);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((s) => (s.w === rect.width && s.h === rect.height ? s : { w: rect.width, h: rect.height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A ref, so moving the mouse does not re-render the page. The rAF loop below is
  // the only reader.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  /** Fitted radii and eye centres for the box we actually got. */
  const metrics = useMemo(() => {
    const { w, h } = size;
    if (w <= 0 || h <= 0) return null;
    const scale = Math.min(w / (gap + 2 * eyeRadius), h / (2 * eyeRadius), 1);
    const r = eyeRadius * scale;
    const pupil = Math.min(pupilRadius * scale, r - margin - 1);
    const spread = gap * scale;
    return {
      r,
      pupil,
      cxL: w / 2 - spread / 2,
      cxR: w / 2 + spread / 2,
      cy: h / 2,
      maxOffset: Math.max(0, r - pupil - margin),
    };
  }, [size, eyeRadius, pupilRadius, gap, margin]);

  useEffect(() => {
    if (!metrics) return;
    // Start centred rather than at 0,0, or the first frame flicks in from the
    // top-left corner of the SVG.
    const at = { left: { x: metrics.cxL, y: metrics.cy }, right: { x: metrics.cxR, y: metrics.cy } };
    const t = Math.max(0, Math.min(1, smoothness));

    let raf = 0;
    const step = (): void => {
      const box = containerRef.current?.getBoundingClientRect();
      if (box) {
        const localX = pointer.current.x - box.left;
        const localY = pointer.current.y - box.top;
        // Clamp the pupil to a disc of radius maxOffset around its eye centre, then
        // ease toward it. Same maths as the original.
        const aim = (cx: number, cy: number) => {
          const dx = localX - cx;
          const dy = localY - cy;
          const dist = Math.hypot(dx, dy) || 1;
          const k = Math.min(metrics.maxOffset, dist) / dist;
          return { x: cx + dx * k, y: cy + dy * k };
        };
        const targetL = aim(metrics.cxL, metrics.cy);
        const targetR = aim(metrics.cxR, metrics.cy);
        at.left = { x: at.left.x + (targetL.x - at.left.x) * t, y: at.left.y + (targetL.y - at.left.y) * t };
        at.right = { x: at.right.x + (targetR.x - at.right.x) * t, y: at.right.y + (targetR.y - at.right.y) * t };

        leftRef.current?.setAttribute("cx", String(at.left.x));
        leftRef.current?.setAttribute("cy", String(at.left.y));
        rightRef.current?.setAttribute("cx", String(at.right.x));
        rightRef.current?.setAttribute("cy", String(at.right.y));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [metrics, smoothness]);

  useEffect(() => {
    if (!blinking || prefersReducedMotion()) {
      setBlink(false);
      return;
    }
    const pending: number[] = [];
    const later = (fn: () => void, ms: number) => pending.push(window.setTimeout(fn, ms));

    const sequence = (): void => {
      setBlink(true);
      later(() => {
        setBlink(false);
        later(() => {
          setBlink(true);
          later(() => {
            setBlink(false);
            later(sequence, blinkInterval);
          }, BLINK_BEAT_MS);
        }, BLINK_BEAT_MS);
      }, BLINK_BEAT_MS);
    };

    later(sequence, blinkInterval);
    return () => pending.forEach(window.clearTimeout);
  }, [blinking, blinkInterval]);

  // Intrinsic height from the aspect ratio in "fit" mode, or the container would
  // measure zero, report zero, and never lay out.
  const aspect = (gap + 2 * eyeRadius) / Math.max(1, 2 * eyeRadius);
  const style = {
    width: "100%",
    height: sizing === "fill" ? "100%" : "auto",
    ...(sizing === "fit" ? { aspectRatio: String(aspect) } : {}),
    background,
  } as const;

  return (
    // Decorative: the wordmark beside it carries the meaning.
    <div ref={containerRef} style={style} aria-hidden="true">
      {metrics ? (
        <svg width="100%" height="100%" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="xMidYMid meet">
          {[metrics.cxL, metrics.cxR].map((cx) => (
            <circle
              key={cx}
              cx={cx}
              cy={metrics.cy}
              r={metrics.r}
              fill={scleraColor}
              stroke={outline ? outlineColor : "none"}
              strokeWidth={outline ? outlineWidth : 0}
            />
          ))}
          {/* One ellipse per pupil rather than swapping circle/ellipse on blink: an
              ellipse with rx === ry IS a circle, and keeping the element identical
              keeps the refs the rAF loop writes to stable across a blink. */}
          <ellipse
            ref={leftRef}
            cx={metrics.cxL}
            cy={metrics.cy}
            rx={metrics.pupil}
            ry={metrics.pupil * (blink ? BLINK_SQUASH : 1)}
            fill={pupilColor}
          />
          <ellipse
            ref={rightRef}
            cx={metrics.cxR}
            cy={metrics.cy}
            rx={metrics.pupil}
            ry={metrics.pupil * (blink ? BLINK_SQUASH : 1)}
            fill={pupilColor}
          />
        </svg>
      ) : null}
    </div>
  );
}
