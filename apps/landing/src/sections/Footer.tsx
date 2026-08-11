import { Tick, TopTicks } from "../ui/primitives.js";
import {
  ENGINE_URL,
  HANDOVER_URL,
  HARNESS_URL,
  README_URL,
  RESULTS_URL,
  RULESET_URL,
  SPECS_URL,
  WEB_URL,
} from "../links.js";

/**
 * Four columns: what it is, where the code is, what to read, and what was fixed
 * before the run.
 *
 * The provenance column is not decoration. Split seed, perturbation range and
 * endpoint are the three numbers somebody would need to reproduce the result, and
 * putting them in the footer rather than in a methods appendix is the cheapest
 * possible way of saying they are not negotiable.
 */
const REPO_LINKS = [
  { href: ENGINE_URL, label: "packages/engine" },
  { href: WEB_URL, label: "apps/web" },
  { href: HARNESS_URL, label: "apps/harness" },
  { href: RULESET_URL, label: "rules/ruleset-v1.0" },
] as const;

const READ_LINKS = [
  { href: README_URL, label: "README" },
  { href: HANDOVER_URL, label: "HANDOVER" },
  { href: SPECS_URL, label: "Specs & plans" },
  { href: RESULTS_URL, label: "results/" },
] as const;

const PROVENANCE = [
  "Endpoint · Hepatotoxicity (DILI)",
  "Split seed · 20260726",
  "Perturbation · ±50%",
  "Due · 16 August 2026",
] as const;

export function Footer() {
  return (
    <footer className="footer">
      <div className="rails footer-rails">
        <TopTicks />

        <div className="cells footer-grid">
          <div className="footer-cell">
            <div className="footer-word">ARBITER</div>
            <p>
              A reasoning layer that adjudicates conflicting preclinical toxicity evidence. An internal
              capability, not a product for sale.
            </p>
            <div className="footer-label" style={{ marginBottom: 0 }}>
              DILI · Ruleset v1.0 · ed073a8a…
            </div>
          </div>

          <div className="footer-cell">
            <h2 className="footer-label">Repo</h2>
            <div className="footer-links">
              {REPO_LINKS.map((link) => (
                <a key={link.label} href={link.href}>
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div className="footer-cell">
            <h2 className="footer-label">Read</h2>
            <div className="footer-links">
              {READ_LINKS.map((link) => (
                <a key={link.label} href={link.href}>
                  {link.label}
                </a>
              ))}
            </div>
          </div>

          <div className="footer-cell">
            <h2 className="footer-label">Provenance</h2>
            <div className="footer-provenance">
              {PROVENANCE.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="footer-colophon">
          <Tick at="tl" small />
          <Tick at="tr" small />
          <span>© 2026 Arbiter · Pfizer Digital &amp; Technology Hackathon · Problem Statement 3</span>
          <span>Team BU 1 · He · Lopez · Cruz-Lopez</span>
        </div>
      </div>
    </footer>
  );
}
