import gsap from "gsap";
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { externalAttrs } from "../links.js";
import { prefersReducedMotion } from "../motion/reducedMotion.js";
import { ChapterIndex, Footer, Frame, Header } from "../shell/Chrome.js";
import { Cta } from "@arbiter/design";
import { Cursor } from "@arbiter/design";
import { MenuOverlay } from "../shell/MenuOverlay.js";
import { ease, getPointer } from "@arbiter/design";
import { Preloader } from "../shell/Preloader.js";
import { ProgressRail } from "../shell/ProgressRail.js";
import { Decode } from "@arbiter/design";
import { Headline, RevealParagraph } from "@arbiter/design";
import { SECTIONS } from "./content.js";
import { TRACKS, useScrollEngine, type ScrollEngine } from "./useScrollEngine.js";

/**
 * THE LANDING PAGE.
 *
 * Six chapters, one WebGL canvas, a HUD bezel, and a boot screen in front of all of it.
 *
 * THE SCROLL MODEL IS THE ARCHITECTURE, so it is worth stating plainly:
 *
 *   html/body      locked to the viewport. Never scrolls.
 *   .shell         a fixed-size positioning context, the whole viewport
 *     canvas       z 0  — one for the entire page, never moves
 *     .scroller    z 10 — SIX EMPTY SPACERS, ~2800vh. The only thing that scrolls,
 *                  and there is nothing visible inside it.
 *     copy         z 15 — the six text blocks, FIXED, shown by scroll position
 *     bezel        z 20 — inert hairline
 *     chrome       z 30 / 50 — chapter index, progress rail, footer, header
 *     preloader    z 100
 *
 * Nothing the reader can see is inside the scrolling element. The spacers exist only to
 * give the wheel something to travel through; a rAF loop turns that travel into a
 * number, and every visible thing is a function of it. That is what makes a camera
 * flight possible at all — the scene is not tied to the position of any DOM node.
 */

/**
 * `three` is ~500KB, more than the whole rest of this page, and it draws a background.
 * Split out, it never blocks first paint — and the boot screen's third milestone is
 * exactly this chunk landing, so the reveal cannot happen before the scene can draw.
 */
const Atmosphere = lazy(() =>
  import("./Atmosphere.js").then((m) => ({ default: m.Atmosphere })),
);

/**
 * A background may not take the page down with it.
 *
 * Not defensive padding. The scenes are a few thousand lines of WebGL against a driver
 * surface that varies by machine, and the failure mode without a boundary is the one
 * already seen once here: a single bad renderer property threw from an effect, React
 * unmounted the whole tree, and the page rendered blank — for a fault in the DECORATION
 * behind the headline.
 */
class SceneBoundary extends Component<
  { children: ReactNode; onFail: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("[overture] scenes failed, falling back to the ground:", error);
    // The boot screen waits on the scene. If it never arrives, the page must reveal
    // anyway — a loader that hangs forever on a broken GPU is worse than no artwork.
    this.props.onFail();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function Overture() {
  const [motion, setMotion] = useState(() => !prefersReducedMotion());
  const [menuOpen, setMenuOpen] = useState(false);
  /* BOOTED IMMEDIATELY UNDER prefers-reduced-motion, so the Preloader never mounts.
     OpeningScene.tsx states the rule this follows - "prefers-reduced-motion: never,
     the reader's setting, not overridable" - and the Preloader simply missed it, which
     left a counting overlay in front of the page as the one piece of the opening a
     reader could not turn off. It also hid the header from the e2e suite, whose
     documented escape hatch is exactly this setting. */
  const [booted, setBooted] = useState(() => prefersReducedMotion());
  const [sceneReady, setSceneReady] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { engine, chapter } = useScrollEngine(scroller, booted);

  const jump = useCallback(
    (id: string) => {
      const i = SECTIONS.findIndex((s) => s.id === id);
      if (i >= 0) engine.jumpTo(i);
      setMenuOpen(false);
    },
    [engine],
  );

  /* The page recedes behind the panel: 0.98 and dimmed, on the same 500ms as the wipe.
     Scaling DOWN rather than up is what makes the menu read as being in front — a stage
     that grows would push toward the reader and fight the panel for the foreground. */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.style.transform = "";
      el.style.opacity = menuOpen ? "0.35" : "1";
      return;
    }
    gsap.to(el, {
      scale: menuOpen ? 0.98 : 1,
      opacity: menuOpen ? 0.35 : 1,
      duration: 0.5,
      ease: "expo.inOut",
    });
  }, [menuOpen]);

  // Escape closes the menu. A full-screen overlay with no keyboard exit is a trap.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // A hard ceiling on the boot screen. Every milestone it waits for can fail silently —
  // a font host that never answers, a GPU that never gives up a context — and a loader
  // with no timeout turns any one of those into a permanently black page.
  useEffect(() => {
    const t = setTimeout(() => setSceneReady(true), 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-dark-blue" id="top">
      {/* THE STAGE — everything the menu dims behind it. The header is deliberately NOT
          in here: its close control has to stay lit and clickable above the panel. */}
      <div
        ref={stageRef}
        className="absolute inset-0"
        style={{ transformOrigin: "center", willChange: "transform" }}
      >
      <SceneBoundary onFail={() => setSceneReady(true)}>
        <Suspense fallback={null}>
          <Atmosphere
            engine={engine}
            reducedMotion={!motion}
            running={booted}
            onReady={() => setSceneReady(true)}
          />
        </Suspense>
      </SceneBoundary>

      {/* THE ONLY SCROLLING ELEMENT, AND IT IS EMPTY. Six spacers at the track lengths
          in `useScrollEngine`. `pointer-events-none` so the reader interacts with the
          fixed content on top rather than with a stack of invisible boxes. */}
      <div
        ref={scroller}
        className="ov-scroller absolute inset-0 z-10 overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SECTIONS.map((s, i) => (
          <div
            key={s.id}
            data-spacer={s.id}
            className="pointer-events-none w-full"
            style={{ height: `${TRACKS[i]}vh` }}
            aria-hidden="true"
          />
        ))}
      </div>

      {/* The copy. FIXED — it does not live in the scroller. Each block is shown by
          scroll position, not by its own place in the document. */}
      <div className="pointer-events-none absolute inset-0 z-[15]">
        {SECTIONS.map((s, i) => (
          <ChapterCopy key={s.id} index={i} active={chapter === i} engine={engine} section={s} />
        ))}
      </div>

      <Frame />

      <ChapterIndex
        chapters={SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
        current={chapter}
        onJump={jump}
      />

      <ProgressRail engine={engine} />

      <Footer>
        <button
          type="button"
          onClick={() => setMotion((m) => !m)}
          aria-pressed={motion}
          className="t-label flex items-center gap-2.5 text-off-blue/45 transition-colors duration-200 hover:text-off-blue"
        >
          <span
            className={`size-[7px] border border-current ${
              motion
                ? "border-accent-bright bg-accent-bright shadow-[0_0_9px_var(--color-accent-bright)]"
                : ""
            }`}
            aria-hidden="true"
          />
          <Decode text={`Motion ${motion ? "on" : "off"}`} hover />
        </button>
      </Footer>

      {chapter < SECTIONS.length - 1 ? (
        <button
          type="button"
          onClick={() => engine.jumpTo(Math.min(chapter + 1, SECTIONS.length - 1))}
          className="t-label absolute left-1/2 z-30 hidden -translate-x-1/2 items-center gap-2.5 text-off-blue/45 transition-colors duration-200 hover:text-off-blue sm:flex"
          // Clear of the call to action above it. At the old offset the two sat ~10px
          // apart and read as one crowded stack rather than as an action and a hint.
          style={{ bottom: "calc(var(--frame-inset) + 3.5rem + 0.5rem)" }}
        >
          <Chevron />
          <Decode text="Scroll to explore" hover />
        </button>
      ) : null}
      </div>

      <Header onMenu={() => setMenuOpen((o) => !o)} menuOpen={menuOpen} />

      <MenuOverlay open={menuOpen} />

      {/* Texture over both layers. Above the panel too — the inversion is part of the
          same surface. */}
      <div className="ov-wash" aria-hidden="true" />

      <Cursor />

      {!booted ? <Preloader sceneReady={sceneReady} onDone={() => setBooted(true)} /> : null}
    </div>
  );
}

/**
 * One chapter's text block.
 *
 * Visible only across the middle 40% of its chapter's track, and driven straight from
 * the engine inside a rAF rather than through React state. Six blocks re-rendering at
 * 60fps to change an opacity would cost more than the WebGL scene behind them; writing
 * to `style` directly costs nothing and skips reconciliation entirely.
 */
function ChapterCopy({
  index,
  active,
  engine,
  section,
}: {
  index: number;
  active: boolean;
  engine: ScrollEngine;
  section: (typeof SECTIONS)[number];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const isFirst = index === 0;
  const isLast = index === SECTIONS.length - 1;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;

    /* PARALLAX, OPPOSITE THE CAMERA.
       The WebGL camera translates TOWARD the cursor; these move away from it. Matching
       directions would slide the whole frame as one piece and read as a wobble — it is
       the OPPOSITION that separates the type from the scene and puts the text in front
       of it. The headline travels twice as far as the paragraph for the same reason a
       foreground object travels further than a mid-ground one.

       Eased far more heavily than the cursor (0.03 against 0.15): a headline that keeps
       up with the pointer is a headline being dragged around, where one that drifts
       toward where the pointer went a moment ago reads as depth. */
    const pointer = getPointer();
    const drift = { x: 0, y: 0 };
    let last = performance.now();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = now - last;
      last = now;
      const s = engine.read();

      // Outside its own chapter, hidden outright — no partial state from a neighbour's
      // window bleeding in.
      if (s.chapter !== index) {
        if (el.style.opacity !== "0") {
          el.style.opacity = "0";
          el.style.visibility = "hidden";
          el.style.pointerEvents = "none";
        }
        return;
      }

      /* A trapezoid across the window: in over the first quarter, hold, out over the
         last. `window` is 0→1 across the middle 40% of the track, so the other 60% of
         the scroll belongs to the camera — read, fly, arrive, read.

         THE TWO ENDS ARE EXCEPTIONS, and they are not cosmetic. Applied uniformly, the
         page opens on an empty hero — the reader lands at scroll 0, which is 30% of a
         track BEFORE the first text window, and has to scroll 120vh past a wordless
         cube to be told what any of it is. The same rule at the other end leaves the
         document's last screen blank. So the opening chapter starts held (the boot
         screen's reveal is its entrance) and the closing one never leaves. */
      const w = s.window;
      const ramp =
        w < 0.25 ? (isFirst ? 1 : w / 0.25) : w > 0.75 ? (isLast ? 1 : (1 - w) / 0.25) : 1;
      const k = Math.min(Math.max(ramp, 0), 1);

      el.style.visibility = k <= 0.001 ? "hidden" : "visible";
      el.style.opacity = String(k);
      el.style.transform = `translate(-50%, 0) translateY(${(1 - k) * 30}px) scale(${0.97 + k * 0.03})`;
      // Only the block being read may take a click; the others are still in the DOM and
      // would otherwise swallow pointer events across the whole viewport.
      el.style.pointerEvents = k > 0.9 ? "auto" : "none";

      drift.x = ease(drift.x, -pointer.x, 0.03, dt);
      drift.y = ease(drift.y, -pointer.y, 0.03, dt);
      if (headRef.current) {
        headRef.current.style.transform = `translate3d(${drift.x * 6}px, ${drift.y * 6}px, 0)`;
      }
      if (subRef.current) {
        subRef.current.style.transform = `translate3d(${drift.x * 3}px, ${drift.y * 3}px, 0)`;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, index, isFirst, isLast]);

  return (
    <div
      ref={ref}
      data-panel={section.id}
      {...(index === 0 ? { "data-hero-copy": "" } : {})}
      id={`ov-${section.id}`}
      aria-hidden={!active}
      className="absolute left-1/2 top-[51%] w-full px-6 text-center"
      // The opening block starts visible; the rest start hidden. The FIRST PAINT happens
      // before any rAF has fired, and a hero that is `visibility: hidden` at that moment
      // is a hero the boot screen reveals as a blank rectangle.
      style={
        isFirst
          ? { transform: "translate(-50%, 0)" }
          : { visibility: "hidden", opacity: 0, transform: "translate(-50%, 0)" }
      }
    >
      {/* The reveal plays on ACTIVATION and the scroll loop owns the container's own
          opacity, so the two never write the same property. The headline animates its
          inner lines; the wrapper above animates the block. Give both the same target
          and they fight, and the symptom is a headline that flickers whenever you
          scroll during its own entrance. */}
      {/* Each parallax layer gets its OWN wrapper. The reveal animations already own
          `transform` on the headline block and the paragraph — writing a parallax
          translate to the same elements would overwrite the slide-up mid-flight. Two
          nested transforms compose; one element with two owners does not. */}
      <div ref={headRef} style={{ willChange: "transform" }}>
        <Headline
          as={index === 0 ? "h1" : "h2"}
          lines={section.headline}
          play={active}
          className="t-display m-0 text-[clamp(32px,4.4vw,60px)] text-off-blue [text-shadow:0_0_34px_rgba(79,195,255,0.38)]"
        />
      </div>

      <div ref={subRef} style={{ willChange: "transform" }}>
        <RevealParagraph
          play={active}
          className="mx-auto mt-5 max-w-[34rem] text-[15px] leading-[1.6] text-off-blue/70 [text-shadow:0_1px_18px_rgba(2,10,24,0.95)] lg:max-w-[34vw]"
        >
          {section.sub}
        </RevealParagraph>
      </div>

      {section.cta ? (
        <Cta
          href={section.cta.href}
          label={section.cta.label}
          newTab={"target" in externalAttrs(section.cta.href)}
          className="mt-7"
        />
      ) : null}
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 8" className="h-2 w-3 shrink-0" fill="none" aria-hidden="true">
      <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
