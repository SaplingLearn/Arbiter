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
    // The shell supplies .container; the tab supplies the measure. Prose gets one,
    // the 267-row table does not.
    <section>
      <div className="prose">
        <p className="label">Library</p>
        <h2 className="display">Compounds</h2>
        <p className="lede" data-testid="conflict-rate" data-anchor="compounds.conflictRate">
          <strong>{conflicting} of {ids.length}</strong> scored compounds have streams in genuine conflict
          ({((conflicting / ids.length) * 100).toFixed(1)}%).
        </p>
        {/* .caveat, not .small.muted: the decline rate is the honest half of this
            screen, and shrinking it is how a screen-share loses it. */}
        <p className="caveat" data-testid="decline-note" data-anchor="compounds.declineNote">
          ARBITER declines on {declined} of {ids.length}. See Validation for why — no compound in this set
          carries exposure-relevant evidence.
        </p>
      </div>

      <hr className="rule" />

      <table className="table" data-anchor="compounds.table">
        <thead>
          <tr>
            <th scope="col">Compound</th>
            <th scope="col">Streams</th>
            <th scope="col">Verdict</th>
            <th scope="col">DILIrank</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const c = data.compounds.get(id)!;
            const r = rows.get(id)!;
            return (
              <tr key={id} data-testid="compound-row">
                <td>
                  <button type="button" className="cell-link"
                          onClick={() => { dispatch({ type: "selectCompound", compoundId: id }); window.location.hash = "#/case"; }}>
                    {c.name}
                  </button>
                </td>
                {/* The word carries the state; the colour only agrees with it. */}
                <td className={r.conflicting ? "state-conflict" : "muted"}>
                  {r.conflicting ? "in conflict" : "agree"}
                </td>
                <td className="muted">{r.verdict}</td>
                <td className="muted">{c.dilirankLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
