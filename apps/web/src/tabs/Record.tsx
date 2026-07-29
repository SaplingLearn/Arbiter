import { useState } from "react";
import { useAppState, useDispatch, visibleClaims, workingClaims } from "../state/store.js";
import { useCaseReasoning } from "../engine/useCaseReasoning.js";
import { evidenceSnapshot, recordHash, sha256Hex } from "../record/chain.js";
import { recordPosition } from "../ai/anchors.js";
import { browserRulesetHash } from "../data/rulesetHash.js";

const GENESIS = "0".repeat(64);

/**
 * Call site 4 of the four (§9).
 *
 * Routing this one is load-bearing, not cosmetic. `evidenceSnapshot` serialises
 * the WHOLE claim - every reclassifiable field included - so a position signed
 * over un-routed claims would hash evidence the panel beside it is not showing.
 * That is exactly the binding the function exists to provide: "I agree" must
 * attach to what was on screen.
 */
export function RecordTab() {
  const state = useAppState();
  const { ruleset, asOf, selectedCompoundId, positions } = state;
  const dispatch = useDispatch();
  const r = useCaseReasoning();
  const [name, setName] = useState("Jack He");
  const [position, setPosition] = useState<"agree" | "dissent" | "abstain">("agree");
  const [rationale, setRationale] = useState("");

  // `data` is no longer destructured: the compound lookup that needed it now
  // lives in the selector, which is the point of the refactor.
  const all = workingClaims(state, selectedCompoundId);

  async function sign() {
    const snapshot = await sha256Hex(evidenceSnapshot(visibleClaims(all, asOf), r));
    // The WORKING COPY (`ruleset`), never `data.ruleset`. The record documents the
    // ruleset that was on screen, which is the whole point of signing: after a
    // toxicologist drags R1 to 0.05, the recorded hash must differ from the
    // registered one. Hashing the pristine bundled copy would record the
    // registration on a position taken under something else.
    const rulesetHash = await browserRulesetHash(ruleset);
    const last = positions[positions.length - 1];
    const prev = last ? await recordHash(last) : GENESIS;
    dispatch({
      type: "addPosition",
      position: {
        reviewerId: name.toLowerCase().replace(/\s+/g, "."),
        displayName: name,
        role: "Safety reviewer",
        position,
        rationale: rationale || null,
        // Signing time is a real clock read, which is why it lives in the app and
        // never in the engine.
        signedAt: new Date().toISOString(),
        rulesetHash,
        evidenceSnapshotHash: snapshot,
        asOfDate: asOf,
        signatureMethod: "demo-persona",
        prevRecordHash: prev,
      },
    });
    setRationale("");
  }

  return (
    // The shell supplies .container.
    <section>
      <div className="prose">
        <p className="label">Sign-off</p>
        <h2 className="display">Review-ready evidence package</h2>
        <p className="lede muted" data-anchor="record.chainExplainer">
          Positions are recorded against the exact evidence and verdict on screen. The log is a hash-chained
          audit log: each entry carries the hash of the one before it, so tampering is detectable.
        </p>
      </div>

      <fieldset className="panel" data-anchor="record.signForm">
        <legend className="label">Record a position</legend>
        <div className="row">
          <label className="control">
            Reviewer <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="control">
            Position{" "}
            <select className="field" value={position}
                    onChange={(e) => setPosition(e.target.value as typeof position)}>
              <option value="agree">agree</option>
              <option value="dissent">dissent</option>
              <option value="abstain">abstain</option>
            </select>
          </label>
          <label className="control">
            Rationale <input className="field" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </label>
          {/* Signing is the one action on this tab, so it is the one primary
              button - the blue is rationed to it. */}
          <button type="button" className="btn btn-primary" onClick={() => void sign()}>Sign</button>
        </div>
      </fieldset>

      <ol className="position-list">
        {positions.map((p, i) => (
          <li key={i} data-testid="position-row" data-anchor={recordPosition(i)} className="position-row">
            <div>
              <strong>{p.displayName}</strong> — {p.position}
              {p.rationale ? ` · ${p.rationale}` : ""}
            </div>
            {/* Truncated on purpose: twelve hex characters is enough to compare two
                entries by eye, and the full digest is in the exported record. */}
            <div className="small muted">
              snapshot <span className="mono">{p.evidenceSnapshotHash.slice(0, 12)}</span>… ·
              prev <span className="mono">{p.prevRecordHash.slice(0, 12)}</span>… ·
              as of {p.asOfDate ?? "all evidence"} · {p.signatureMethod}
            </div>
          </li>
        ))}
      </ol>

      <hr className="rule" />
      <p className="caveat">ARBITER holds no position. The named decision owner signs.</p>
    </section>
  );
}
