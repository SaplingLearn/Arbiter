import { useRef, type CSSProperties } from "react";
import { Hatch } from "./ui/primitives.js";
import { useReveals } from "./motion/useReveals.js";
import { OpeningScene } from "./sections/OpeningScene.js";
import { Header } from "./sections/Header.js";
import { Hero } from "./sections/Hero.js";
import { Standards } from "./sections/Standards.js";
import { Metrics } from "./sections/Metrics.js";
import { Features } from "./sections/Features.js";
import { Capabilities } from "./sections/Capabilities.js";
import { CaseView } from "./sections/CaseView.js";
import { HowItWorks } from "./sections/HowItWorks.js";
import { Result } from "./sections/Result.js";
import { UseCases } from "./sections/UseCases.js";
import { RecordSpeaks } from "./sections/RecordSpeaks.js";
import { Faq } from "./sections/Faq.js";
import { GetStarted } from "./sections/GetStarted.js";
import { Footer } from "./sections/Footer.js";
import "./landing.css";

/** BLUEPRINT's one electric accent. Every other colour on the page is paper or ink. */
export const DEFAULT_ACCENT = "#2B2BF0";

export type LandingProps = {
  /**
   * Overrides `--blue`. The design carries this as a knob because the accent is the
   * only colour decision on the page - swapping it is the whole of re-theming.
   */
  accent?: string;
  /** The hero's canvas texture. Off leaves the layout untouched. */
  dither?: boolean;
  /** Scroll reveals and stat count-ups. The reader's OS preference wins regardless. */
  reveals?: boolean;
  /**
   * The opening scene. On by default; the scene itself then decides whether to
   * actually play (once a session, never under reduced motion). Off is for tests
   * and for anything that needs the page immediately.
   */
  opening?: boolean;
};

/**
 * The whole page.
 *
 * Twelve numbered sections separated by hatched bands, between two rails. The order is
 * an argument and not a menu: the numbers first, then how they were produced, then the
 * result stated against its baselines, then who it is for - so that by the time the
 * page asks for anything it has already admitted that it ties a single stream and
 * abstains on 97.4% of the split.
 */
export function Landing({
  accent = DEFAULT_ACCENT,
  dither = true,
  reveals = true,
  opening = true,
}: LandingProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveals(rootRef, reveals);

  return (
    <div ref={rootRef} className="landing" style={{ "--blue": accent } as CSSProperties}>
      {/* Mounted first but painted over everything, and it removes itself. The page
          below is fully rendered the whole time, so a failure in the scene costs
          the reader nothing. */}
      {opening ? <OpeningScene /> : null}

      <Header />

      {/* The first band is shorter than the rest and carries the `#top` target the
          wordmark links back to. */}
      <Hatch id="top" short />

      <main>
        <Hero accent={accent} dither={dither} />
        <Standards />
        <Hatch />
        <Metrics />
        <Hatch />
        <Features />
        <Hatch />
        <Capabilities />
        <Hatch />
        <CaseView />
        <Hatch />
        <HowItWorks />
        <Hatch />
        <Result />
        <Hatch />
        <UseCases />
        <Hatch />
        <RecordSpeaks />
        <Hatch />
        <Faq />
        <Hatch />
        <GetStarted />
        <Hatch />
      </main>

      <Footer />
    </div>
  );
}
