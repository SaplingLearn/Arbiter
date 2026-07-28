import { useAppState, useDispatch } from "../state/store.js";
import { useLibraryVerdicts } from "../engine/useLibraryVerdicts.js";

/**
 * Tagged by CONFLICT STATUS first, verdict second.
 *
 * The master spec tagged rows by verdict. Measured, 260 of 267 abstain, so a
 * verdict-tagged library is a flat grey wall that tells a worse story than the
 * truth. The conflict rate is the number beat 1 needs - it is what shows the hero
 * case was not cherry-picked - and at 22.8% it is healthy.
 */
export function CompoundsTab() {
  const { data } = useAppState();
  const dispatch = useDispatch();
  const rows = useLibraryVerdicts();

  const ids = data.testSplit;
  const conflicting = ids.filter((id) => rows.get(id)?.conflicting).length;
  const declined = ids.filter((id) => rows.get(id)?.verdict === "abstain").length;

  return (
    <section style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "var(--serif)" }}>Compounds</h2>
      <p data-testid="conflict-rate">
        <strong>{conflicting} of {ids.length}</strong> scored compounds have streams in genuine conflict
        ({((conflicting / ids.length) * 100).toFixed(1)}%).
      </p>
      <p data-testid="decline-note" style={{ color: "var(--muted)" }}>
        ARBITER declines on {declined} of {ids.length}. See Validation for why — no compound in this set
        carries exposure-relevant evidence.
      </p>

      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 12 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--hairline)" }}>
            <th>Compound</th><th>Streams</th><th>Verdict</th><th>DILIrank</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const c = data.compounds.get(id)!;
            const r = rows.get(id)!;
            return (
              <tr key={id} data-testid="compound-row"
                  style={{ borderBottom: "1px solid var(--hairline-soft)" }}>
                <td>
                  <button type="button" onClick={() => { dispatch({ type: "selectCompound", compoundId: id }); window.location.hash = "#/case"; }}>
                    {c.name}
                  </button>
                </td>
                <td style={{ color: r.conflicting ? "var(--toxic)" : "var(--muted)" }}>
                  {r.conflicting ? "in conflict" : "agree"}
                </td>
                <td style={{ color: "var(--muted)" }}>{r.verdict}</td>
                <td style={{ color: "var(--muted)" }}>{c.dilirankLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
