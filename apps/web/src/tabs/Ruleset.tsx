import { useAppState, useDispatch } from "../state/store.js";
import { useCaseReasoning } from "../engine/useCaseReasoning.js";

const REGISTERED_HASH = "ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136";

/**
 * Where "expert-governed, not algorithm-invented" becomes touchable.
 *
 * Editing a strength recomputes the selected case immediately, which is only
 * possible because the engine runs in the browser. Edits are held in memory: the
 * pre-registered file is never written, and the modified badge appears the moment
 * the working copy diverges so an edited ruleset can never be mistaken for the
 * registered one.
 *
 * Measured: full reason() over the TAK-994 fixture averages 1.46ms/call (50-run
 * loop via npx tsx against packages/engine/src/index.js directly). That is well
 * under the ~16ms frame budget a range input's pointer-move events demand, so the
 * slider stays on plain onChange - a debounce would only add latency to a control
 * whose entire point is answering under the cursor.
 */
export function RulesetTab() {
  const { data, ruleset } = useAppState();
  const dispatch = useDispatch();
  const r = useCaseReasoning();
  const modified = JSON.stringify(ruleset) !== JSON.stringify(data.ruleset);

  return (
    // No wide data here, so the whole tab takes the prose measure (the shell
    // supplies .container) and reads as a governance document, not a dashboard.
    <section className="prose stack">
      <p className="label">Governance</p>
      <h2 className="display">Ruleset</h2>

      <p className="small muted" data-testid="ruleset-hash">
        v{ruleset.version} · registered {ruleset.registeredAt} ·{" "}
        <span className="mono">{REGISTERED_HASH.slice(0, 8)}…</span>
        {modified && (
          <>
            {" "}
            <strong data-testid="modified-badge" className="chip chip-warn">
              MODIFIED — not the registered ruleset
            </strong>
          </>
        )}
      </p>

      <p className="lede">
        Live on the selected case: belief{" "}
        <strong className="num" data-testid="live-belief">{r.belief.toFixed(3)}</strong>, verdict{" "}
        <strong>{r.verdict}</strong>
      </p>
      <button type="button" className="btn" onClick={() => dispatch({ type: "resetRuleset" })}>
        Reset to registered
      </button>

      {/* .panel-flat, so six rules read as one governed list separated by
          hairlines rather than six boxes competing for attention. */}
      {ruleset.rules.map((rule) => (
        <article key={rule.id} data-testid="rule-card" className="panel-flat">
          <h3 className="subtitle">
            <span className="mono muted">{rule.id}</span> {rule.name}
          </h3>
          <p>{rule.statement}</p>
          <p className="small muted">
            {rule.framework.name} ({rule.framework.date})
            {rule.framework.note ? ` — ${rule.framework.note}` : ""}
          </p>
          <div className="row">
            <label className="control">
              Strength <span className="num">{rule.strength.toFixed(2)}</span>
              <input
                data-testid={`strength-${rule.id}`}
                type="range" min="0" max="1" step="0.05" value={rule.strength}
                onChange={(e) => dispatch({ type: "setRuleStrength", id: rule.id, strength: Number(e.target.value) })}
              />
            </label>
            <label className="control">
              <input type="checkbox" checked={rule.enabled}
                     onChange={(e) => dispatch({ type: "setRuleEnabled", id: rule.id, enabled: e.target.checked })} />
              Enabled
            </label>
          </div>
        </article>
      ))}
    </section>
  );
}
