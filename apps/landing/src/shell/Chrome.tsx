import type { ReactNode } from "react";
import { APP_URL, REPO_URL, externalAttrs } from "../links.js";
import { Segment, SegmentPair } from "@arbiter/design";
import { Decode } from "@arbiter/design";
import { Wordmark } from "@arbiter/design";

/**
 * THE HUD BEZEL — frame, header, chapter index, footer.
 *
 * Everything here is a static child of a fixed shell, NOT a `position: fixed` element.
 * That is the point of locking the document and scrolling an inner container instead:
 * fixed elements over a scrolling document jitter on iOS during momentum scroll and
 * fight the URL bar, and the bezel is the one thing on this page that must never move
 * by a pixel.
 */

/**
 * The bezel.
 *
 * A 1px hairline inset from the viewport with all four corners cut at 45 degrees.
 * Drawn as a bordered box under a `clip-path` rather than as an SVG: the clip cuts the
 * border with it, so the diagonal is a real mitre rather than a border meeting a
 * transparent corner. Inert to the pointer — it sits above the canvas and must not
 * intercept anything.
 */
export function Frame() {
  return (
    <div
      className="chamfer-all pointer-events-none absolute z-20 border border-off-blue/[0.18]"
      style={{ inset: "var(--frame-inset)" }}
      aria-hidden="true"
    />
  );
}

export function Header({
  onMenu,
  menuOpen,
}: {
  onMenu: () => void;
  menuOpen: boolean;
}) {
  return (
    <header
      className="absolute z-[70] flex items-center justify-between"
      style={{
        top: "calc(var(--frame-inset) + var(--hud-gutter))",
        left: "calc(var(--frame-inset) + var(--hud-gutter))",
        right: "calc(var(--frame-inset) + var(--hud-gutter))",
      }}
    >
      {/* The wordmark inverts with the page. On the light panel an off-blue mark is
          invisible, and leaving it there is the most obvious way to give away that the
          overlay is a separate layer rather than the site turned inside out. */}
      <a
        href="#top"
        className={`block transition-colors duration-200 ${
          menuOpen ? "text-dark-blue" : "text-off-blue"
        }`}
        aria-label="Arbiter, back to top"
      >
        <Wordmark className="h-[15px] w-auto" />
      </a>

      {/* Two buttons as ONE unit: no gap between them, and only the block's outer
          corner is cut, so the pair reads as a single control with a mitre rather than
          as two chamfered buttons sitting next to each other. */}
      <SegmentPair>
        {/* LOGIN retires while the menu is open: a translucent dark pill on a solid
            light ground is the one combination in this palette with no good answer. The
            pair is right-aligned, so CLOSE lands in MENU's exact position. */}
        {menuOpen ? null : <Segment href={APP_URL} label="Login" />}
        {menuOpen ? (
          <Segment label="Close" inverted onClick={onMenu} pressed hook="data-menu-close" />
        ) : (
          <Segment label="Menu" solid onClick={onMenu} pressed={menuOpen} />
        )}
      </SegmentPair>
    </header>
  );
}

/**
 * The chapter index.
 *
 * Inactive entries sit at 35% — barely legible, and that is correct. This is a progress
 * readout first and a menu second; at full contrast six stacked labels compete with the
 * headline they sit beside, and the eye reads them as a sidebar.
 */
export function ChapterIndex({
  chapters,
  current,
  onJump,
}: {
  chapters: { id: string; label: string }[];
  current: number;
  onJump: (id: string) => void;
}) {
  return (
    <nav
      className="absolute top-1/2 z-30 hidden -translate-y-1/2 lg:block"
      style={{ left: "calc(var(--frame-inset) + var(--hud-gutter))" }}
      aria-label="Chapters"
    >
      <ol className="grid gap-3.5">
        {chapters.map((c, i) => {
          const active = i === current;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onJump(c.id)}
                aria-current={active ? "true" : undefined}
                className={`t-label flex items-center gap-2.5 transition-colors duration-200 ${
                  active ? "text-off-blue" : "text-off-blue/35 hover:text-off-blue/70"
                }`}
              >
                <span
                  className={`size-1.5 shrink-0 bg-current transition-opacity duration-200 ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                  aria-hidden="true"
                />
                {/* Decodes on ACTIVATION, not on hover — the index is a readout, and a
                    label that scrambles when the pointer crosses it would fire five
                    times on the way to the one you meant. */}
                <Decode text={c.label} play={active} />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The footer bar.
 *
 * ON THE ICON ROW. The reference carries four social platforms. Arbiter has no social
 * accounts, and four icons linking nowhere — or worse, to somebody else's profiles — is
 * the same dead-affordance problem as a sound toggle on a silent page. The row is
 * therefore the destinations this project actually has. The FORM the spec asks for is
 * intact: a right-aligned row of glyphs at 50%, lifting to full with a glow on hover.
 */
export function Footer({ children }: { children?: ReactNode }) {
  return (
    <footer
      className="absolute z-30 flex h-14 items-center border-t border-off-blue/12"
      style={{
        // Flush to the bezel's inner edge, not gutter-inset: the footer is a BAR whose
        // top hairline has to span the full inner width. Its contents are padded
        // instead, so the rule reaches the frame while the text does not touch it.
        bottom: "calc(var(--frame-inset) + 1px)",
        left: "calc(var(--frame-inset) + 1px)",
        right: "calc(var(--frame-inset) + 1px)",
      }}
    >
      <div className="t-label flex h-full flex-[0_0_48%] items-center text-off-blue/45"
        style={{ paddingLeft: "var(--hud-gutter)" }}>
        {children}
      </div>

      {/* The divider at 48%, full-bleed vertically — it is a rule between two regions,
          not a separator between two lines of text, so it runs the bar's whole height. */}
      <div className="h-full w-px bg-off-blue/12" aria-hidden="true" />

      <div
        className="flex flex-1 items-center justify-end gap-1"
        style={{ paddingRight: "calc(var(--hud-gutter) - 10px)" }}
      >
        <IconLink href={REPO_URL} label="Source on GitHub">
          <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
        </IconLink>
        <IconLink href={APP_URL} label="Open the app">
          <path d="M3 3h8v2H5v14h14v-6h2v8H3V3Zm10 0h8v8h-2V6.4L11.7 13.7 10.3 12.3 17.6 5H13V3Z" />
        </IconLink>
      </div>
    </footer>
  );
}

function IconLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      {...externalAttrs(href)}
      className="p-2.5 text-off-blue/50 transition-[color,filter] duration-200 hover:text-off-blue hover:drop-shadow-[0_0_6px_var(--color-accent-bright)]"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
        {children}
      </svg>
    </a>
  );
}
