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
    <section style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "var(--serif)" }}>Ruleset</h2>
      <p data-testid="ruleset-hash" style={{ color: "var(--muted)", fontSize: 13 }}>
        v{ruleset.version} · registered {ruleset.registeredAt} · {REGISTERED_HASH.slice(0, 8)}…
        {modified && (
          <strong data-testid="modified-badge" style={{ color: "var(--toxic)", marginLeft: 10 }}>
            MODIFIED — not the registered ruleset
          </strong>
        )}
      </p>
      <p>
        Live on the selected case: belief <strong data-testid="live-belief">{r.belief.toFixed(3)}</strong>,
        verdict <strong>{r.verdict}</strong>
      </p>
      <button type="button" onClick={() => dispatch({ type: "resetRuleset" })}>Reset to registered</button>

      {ruleset.rules.map((rule) => (
        <article key={rule.id} data-testid="rule-card"
                 style={{ borderTop: "1px solid var(--hairline)", padding: "14px 0" }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>
            <span style={{ color: "var(--pfizer-blue)" }}>{rule.id}</span> {rule.name}
          </h3>
          <p style={{ margin: "6px 0" }}>{rule.statement}</p>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0" }}>
            {rule.framework.name} ({rule.framework.date})
            {rule.framework.note ? ` — ${rule.framework.note}` : ""}
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Strength {rule.strength.toFixed(2)}
            <input
              data-testid={`strength-${rule.id}`}
              type="range" min="0" max="1" step="0.05" value={rule.strength}
              onChange={(e) => dispatch({ type: "setRuleStrength", id: rule.id, strength: Number(e.target.value) })}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={rule.enabled}
                   onChange={(e) => dispatch({ type: "setRuleEnabled", id: rule.id, enabled: e.target.checked })} />
            Enabled
          </label>
        </article>
      ))}
    </section>
  );
}
