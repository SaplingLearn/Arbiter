import { Marquee, Tick } from "../ui/primitives.js";

/**
 * The standards the ruleset is grounded in.
 *
 * Deliberately NOT a logo wall. There are no customers to display and no permission
 * to display anyone's mark, so this row names the evidence bodies the six rules cite
 * - which is the claim the page can actually support. Set in eight different faces
 * because they are eight different bodies, not one procurement list.
 */
const STANDARDS: readonly { name: string; variant: string; square?: boolean }[] = [
  { name: "ICH M3(R2)", variant: "wm--serif-bold" },
  { name: "OECD AOP", variant: "wm--sans-tight" },
  { name: "Klimisch 1997", variant: "wm--serif-italic" },
  { name: "Tox21", variant: "wm--sans-bold", square: true },
  { name: "DILIrank", variant: "wm--mono" },
  { name: "AOP-Wiki", variant: "wm--serif-bold" },
  { name: "OECD QSAR", variant: "wm--sans-wide" },
  { name: "FDA Roadmap", variant: "wm--serif-medium" },
];

export function Standards() {
  return (
    <div className="section">
      <div className="rails rails--relative">
        <Tick at="tl" small />
        <Tick at="tr" small />
        <Tick at="bl" small />
        <Tick at="br" small />

        <div className="standards">
          <div className="standards-label">
            <Tick at="tr" small />
            <Tick at="br" small />
            <div>
              Grounded in <span style={{ color: "var(--blue)" }}>8+</span>
            </div>
            <div>evidence standards</div>
            <div className="mono">peer-reviewed &amp; regulatory</div>
          </div>

          <Marquee className="standards-track">
            {STANDARDS.map((s) => (
              <div key={s.name} className="standard">
                {s.square ? <i /> : null}
                <span className={s.variant}>{s.name}</span>
              </div>
            ))}
          </Marquee>
        </div>
      </div>
    </div>
  );
}
