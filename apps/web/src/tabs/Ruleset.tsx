import { isEdited, useAppState, useDispatch } from "../state/store.js";
import { useCaseReasoning } from "../engine/useCaseReasoning.js";
import { ruleAnchor } from "../ai/anchors.js";

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
 *
 * The precedence order and the abstention threshold render here (spec §8.1) because
 * they were in the registered, hashed ruleset and on screen NOWHERE - so the two
 * likeliest questions about the pre-registration had no answer the app could point
 * at. Neither is editable: no control exists for either, so the working copy and
 * the registered copy cannot differ on them, and the block reads from `ruleset`
 * only for consistency with the rule cards below it.
 *
 * Note what the threshold block does NOT do. The ruleset registers a
 * `precedenceRationale` and registers no rationale for the threshold value, so the
 * block states the value and its provenance and stops. Writing a justification for
 * 0.5 into the UI would put an undisclosed number's defence in source instead of in
 * the reviewable, hashed artifact - which is the failure the pre-registration
 * exists to prevent.
 */
export function RulesetTab() {
  const { data, ruleset } = useAppState();
  const dispatch = useDispatch();
  const r = useCaseReasoning();
  // §9.3. The same predicate the pre-flight panel and the evidence panel use.
  const modified = isEdited(ruleset, data.ruleset);

  return (
    // No wide data here, so the whole tab takes the prose measure (the shell
    // supplies .container) and reads as a governance document, not a dashboard.
    <section className="prose stack">
      <p className="label">Governance</p>
      <h2 className="display">Ruleset</h2>

      <p className="small muted" data-testid="ruleset-hash" data-anchor="ruleset.hash">
        v{ruleset.version} · registered {ruleset.registeredAt} ·{" "}
        <span className="mono">{REGISTERED_HASH.slice(0, 8)}…</span>
        {modified && (
          <>
            {" "}
            <strong data-testid="modified-badge" data-anchor="ruleset.modifiedBadge" className="chip chip-warn">
              MODIFIED — not the registered ruleset
            </strong>
          </>
        )}
      </p>

      <p className="lede">
        Live on the selected case: belief{" "}
        <strong className="num" data-testid="live-belief" data-anchor="ruleset.liveBelief">{r.belief.toFixed(3)}</strong>, verdict{" "}
        <strong>{r.verdict}</strong>
      </p>
      <button type="button" className="btn" onClick={() => dispatch({ type: "resetRuleset" })}>
        Reset to registered
      </button>

      {/* Neither block below has a control: no input exists for the order or the
          threshold, so the working copy and the registered copy cannot disagree on
          either. .panel-flat matches the rule cards so these read as two more
          entries in one governed list, not a dashboard bolted onto it. */}
      <div data-anchor="ruleset.precedenceOrder" className="panel-flat">
        <h3 className="subtitle">Precedence order</h3>
        <p className="small muted">
          Which rule wins when two rules would each license an attack in opposite directions on the
          same pair of claims. R4 downweights rather than defeats and R6 is a property of a set of
          claims, so neither takes part.
        </p>
        <ol data-testid="precedence-order" className="stack">
          {ruleset.precedenceOrder.map((id) => {
            const rule = ruleset.rules.find((x) => x.id === id);
            return (
              <li key={id} data-testid="precedence-entry">
                <span className="mono muted">{id}</span>{rule ? ` ${rule.name}` : ""}
              </li>
            );
          })}
        </ol>
        <p data-testid="precedence-rationale">{ruleset.precedenceRationale}</p>
      </div>

      <div data-anchor="ruleset.abstentionThreshold" className="panel-flat">
        <h3 className="subtitle">Abstention threshold</h3>
        <p data-testid="abstention-threshold">
          ARBITER declines rather than answer when the belief-to-plausibility gap exceeds{" "}
          <strong className="num" data-testid="abstention-threshold-value">{ruleset.abstentionGapThreshold}</strong>.
        </p>
        <p data-testid="abstention-threshold-provenance" className="small muted">
          Read from the pre-registered, hashed ruleset rather than held as a constant in the engine,
          so it could not be tuned after the results were seen.
        </p>
      </div>

      {/* .panel-flat, so six rules read as one governed list separated by
          hairlines rather than six boxes competing for attention. */}
      {ruleset.rules.map((rule) => (
        <article key={rule.id} data-testid="rule-card" data-anchor={ruleAnchor(rule.id)} className="panel-flat">
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
