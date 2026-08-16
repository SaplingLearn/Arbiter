import { lazy, Suspense, useRef } from "react";
import { Cta, Mark, TopTicks } from "../ui/primitives.js";
import { GooglyEyes } from "../ui/GooglyEyes.js";
import { useDitherField } from "../motion/useDitherField.js";
import { prefersReducedMotion } from "../motion/reducedMotion.js";

/**
 * Three.js is ~170KB gzipped - more than twice the rest of this page - and it draws
 * decoration behind a headline. Split out, it never blocks first paint: the hero
 * renders on the flat paper ground and the grid arrives underneath it a moment
 * later, which nobody watching the page load will notice.
 */
const InteractiveGrid = lazy(() =>
  import("../ui/InteractiveGrid.js").then((m) => ({ default: m.InteractiveGrid })),
);
import { APP_URL, HANDOVER_URL, REPO_URL } from "../links.js";

/**
 * The library rows the mockup shows.
 *
 * These are the run's actual numbers, not filler. Five of the six abstain, and the
 * one commitment is the contested one - which is the honest shape of the result and
 * the reason the hero can show a product screenshot without overclaiming. A mockup
 * populated with six confident verdicts would be a different product.
 */
const ROWS = [
  { code: "TK", name: "TAK-994", sub: "hepatotoxicity (DILI)", position: "Abstain", committed: false, belief: "0.090", gap: "0.910", streams: "qsar · invivo", status: "gap rule" },
  { code: "CY", name: "Cyclosporine", sub: "BSEP inhibition", position: "Do not advance", committed: true, belief: "0.886", gap: "0.098", streams: "all three", status: "contested" },
  { code: "TG", name: "Troglitazone", sub: "withdrawn 2000", position: "Abstain", committed: false, belief: "0.120", gap: "0.880", streams: "qsar · cytotox", status: "gap rule" },
  { code: "AP", name: "Acetaminophen", sub: "dose-dependent", position: "Abstain", committed: false, belief: "0.210", gap: "0.790", streams: "qsar · cytotox", status: "gap rule" },
  { code: "IZ", name: "Isoniazid", sub: "idiosyncratic", position: "Abstain", committed: false, belief: "0.070", gap: "0.930", streams: "qsar only", status: "single claim" },
  { code: "VP", name: "Valproate", sub: "mitochondrial", position: "Abstain", committed: false, belief: "0.160", gap: "0.840", streams: "qsar · cytotox", status: "gap rule" },
] as const;

const SIDE_NAV = ["Case", "Compounds", "Ruleset", "Validation", "Record", "About"] as const;

export function Hero({ accent, dither }: { accent: string; dither: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useDitherField(canvasRef, accent);

  return (
    <section className="section hero-section">
      {/* The hero's ground. Behind the rails and everything in them, and outside the
          content column on purpose - the grid runs the full width of the viewport
          while the argument stays between the two rails.

          Not mounted under prefers-reduced-motion: it is a continuously animating
          WebGL surface that reacts to the pointer, which is precisely what that
          setting is asking not to be given. The paper ground underneath is the
          whole fallback, and it is the design's own background. */}
      {prefersReducedMotion() ? null : (
        <Suspense fallback={null}>
          {/* Tuned off the original's defaults, which are built for a dark hero at
              world scale 8000. Two things follow from that:

              gridSize is the WORLD EXTENT and density the subdivisions across it, so
              cell size is gridSize/density - dropping density alone (the first
              attempt) does not refine the grid, it enlarges every cell. Shrinking
              the world to 3000 gives a graph-paper cell at a fifth of the vertex
              count the defaults need.

              radius and strength are in the same world units, so they have to come
              down with it or the lens swallows the whole viewport. */}
          <InteractiveGrid
            className="hero-grid"
            dotColor="#2B2BF0"
            lineColor="#C9C9C4"
            dotSize={2}
            lineOpacity={0.5}
            gridSize={3000}
            density={80}
            radius={260}
            strength={90}
            interactionStyle="Lens"
          />
        </Suspense>
      )}

      <div className="rails rails--relative">
        <TopTicks />

        <div className="hero-stack">
          {/* Wordmark, then the eyes, then the actions - one centred column. Sclera
              in paper-white with an ink hairline: BLUEPRINT has no fills without an
              edge, and white on the paper ground would otherwise have nothing
              holding it. */}
          <div data-reveal className="hero-googly">
            <h1 className="h1 hero-title">Arbiter</h1>
            <div className="hero-eyes">
              <GooglyEyes
                scleraColor="#FFFFFF"
                pupilColor="#0E0E0E"
                outline
                outlineColor="#0E0E0E"
                outlineWidth={3}
                eyeRadius={120}
                pupilRadius={46}
                /* Centre-to-centre, NOT the space between them: at 2 x 120 radius
                   anything under 240 makes the two eyes intersect. 270 leaves a
                   hairline's worth of paper showing between them. */
                gap={270}
              />
            </div>
          </div>

          {/* THE PRODUCT GOES FIRST. The hero used to offer the handover and the
              repository and nothing else, so the page's most prominent pair of
              actions sent a first-time reader to two documents and never to the
              thing they document. The figure immediately to the right of this row
              is a picture OF the app drawn in divs - offering a mockup while the
              running app sat one link away in the header was the gap.

              The other two are kept, not replaced: "Read The Method" is still how
              someone who wants the argument before the artifact gets it, and
              landing.test.tsx pins both by name. */}
          <div data-reveal className="cta-row">
            <Cta href={APP_URL} variant="primary">
              Open The App
            </Cta>
            <Cta href={HANDOVER_URL} variant="secondary">
              Read The Method
            </Cta>
            <Cta href={REPO_URL} variant="secondary">
              Open The Record
            </Cta>
          </div>
        </div>

        {/* The figure is shorter than the window inside it on purpose: the app is
            cropped by the section boundary, so it reads as a view onto something
            that continues rather than a screenshot pasted onto a page. */}
        <div className="hero-figure">
          {/* Decorative texture with no information in it, so it is hidden from
              assistive tech rather than given an empty alt. */}
          {dither ? <canvas ref={canvasRef} className="hero-dither" aria-hidden="true" /> : null}

          {/* aria-hidden: this is a picture OF the product, drawn in divs. Every fact
              in it is stated in prose elsewhere on the page, and letting a screen
              reader walk sixty table cells that are not a table would be worse than
              silence. */}
          <div data-reveal className="hero-app" aria-hidden="true">
            <div className="mock-side">
              <div className="mock-brand">
                <Mark ink small />
                <span>Arbiter</span>
              </div>
              <div className="mock-search">
                <span>Search compound</span>
                <span className="mock-key">⌘ K</span>
              </div>
              <div className="mock-nav">
                {SIDE_NAV.map((item) => (
                  <div key={item} className={item === "Case" ? "is-current" : ""}>
                    {item}
                  </div>
                ))}
              </div>
              <div className="mock-group">Others</div>
              <div className="mock-nav">
                <div>Intake</div>
              </div>
              <div className="mock-foot mock-nav">
                <div>Help Center</div>
                <div>Settings</div>
              </div>
            </div>

            <div className="mock-main">
              <div className="mock-title">Compounds</div>
              <div className="mock-controls">
                <div className="mock-control mock-control--grow">Search compound</div>
                <div className="mock-control">Filter</div>
                <div className="mock-control">Test split ▾</div>
                <div className="mock-action">Open Case</div>
              </div>

              <div className="mock-grid mock-head">
                <div>Compound</div>
                <div>Position</div>
                <div>Belief</div>
                <div>Gap</div>
                <div>Streams</div>
                <div>Status</div>
                <div />
              </div>

              {ROWS.map((row) => (
                <div key={row.name} className="mock-grid mock-row">
                  <div className="mock-compound">
                    <span className="mock-avatar">{row.code}</span>
                    <span>
                      <span className="mock-name">{row.name}</span>
                      <span className="mock-sub">{row.sub}</span>
                    </span>
                  </div>
                  <div className="mock-position">
                    <span className={`mock-dot${row.committed ? " mock-dot--ink" : ""}`} />
                    {row.position}
                  </div>
                  <div className="mock-value">{row.belief}</div>
                  <div className="mock-value">{row.gap}</div>
                  <div className="mock-streams">{row.streams}</div>
                  <div>
                    <span className="mock-chip">{row.status}</span>
                  </div>
                  <div className="mock-more">⋮</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
