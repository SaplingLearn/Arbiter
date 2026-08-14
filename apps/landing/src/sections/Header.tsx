import { useEffect, useState } from "react";
import { Cta, Mark } from "../ui/primitives.js";
import { APP_URL, DELIBERATION_URL } from "../links.js";

/**
 * Fragment nav, not route nav. This page is one document; every destination is a
 * section of it.
 *
 * Two of the design source's four targets did not resolve, and both are fixed here
 * rather than shipped:
 *
 *   - "Case View" pointed at `#product`, an id that appears nowhere in the document,
 *     so the link did nothing at all. It now points at the Case View section, which
 *     carries that id.
 *   - "Ruleset" pointed at `#method`, the Capabilities section. That section mentions
 *     the ruleset in one cell; the six registered rules are a table two sections
 *     further down. A nav item that names a thing should land on the thing.
 */
const NAV_LINKS = [
  { href: "#method", label: "Method" },
  { href: "#product", label: "Case View" },
  { href: "#ruleset", label: "Ruleset" },
  { href: "#result", label: "Result" },
  { href: "#record", label: "Record" },
  // The one exception to "every destination is a section": the deliberation
  // client is its own surface on this origin, and this rail is the only place a
  // reader can discover it exists.
  { href: DELIBERATION_URL, label: "Deliberation" },
] as const;

export function Header() {
  const [open, setOpen] = useState(false);

  // Escape closes it. The panel covers the top of the document and the only other way
  // out is to hit the toggle again, which is off-screen for a reader using the
  // keyboard to move down the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="header">
      <div className="rails">
        <div className="header-bar">
          <a className="brand" href="#top">
            <Mark />
            <span className="brand-word">Arbiter</span>
          </a>

          <nav className="navrail" aria-label="Sections">
            {NAV_LINKS.map((link) => (
              <a key={link.label} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="header-right">
            {/* The header's one action goes INTO the product, not to more reading.
                "Read The Method" still exists - it is the hero's primary CTA, two
                hundred pixels below this one - so moving it here only duplicated
                the same destination twice in one viewport. */}
            <Cta href={APP_URL} variant="primary" compact>
              Open The App
            </Cta>

            {/* The design source draws this control and wires nothing to it, which
                leaves a dead affordance at every width and, under 1280px where the
                rail is hidden, a page with no navigation at all. Same two rules,
                same position; it now opens the same links. */}
            <button
              type="button"
              className="menu-toggle"
              aria-expanded={open}
              aria-controls="menu-panel"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
            >
              <i />
              <i />
            </button>
          </div>
        </div>

        {/* A distinct label, not a second "Sections": the rail is still a landmark at
            rail width, and two identically-named ones are worse in a landmark list
            than one badly-named one. */}
        {open ? (
          <nav className="menu-panel" id="menu-panel" aria-label="Sections menu">
            {NAV_LINKS.map((link) => (
              <a key={link.label} href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </a>
            ))}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
