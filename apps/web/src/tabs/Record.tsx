import { useState } from "react";
import { useAppState, useDispatch, visibleClaims } from "../state/store.js";
import { useCaseReasoning } from "../engine/useCaseReasoning.js";
import { evidenceSnapshot, recordHash, sha256Hex } from "../record/chain.js";

const GENESIS = "0".repeat(64);

export function RecordTab() {
  const { data, ruleset, asOf, selectedCompoundId, positions } = useAppState();
  const dispatch = useDispatch();
  const r = useCaseReasoning();
  const [name, setName] = useState("Jack He");
  const [position, setPosition] = useState<"agree" | "dissent" | "abstain">("agree");
  const [rationale, setRationale] = useState("");

  const all = selectedCompoundId === data.fixture.compoundId
    ? data.fixture.claims
    : (data.claimsByCompound.get(selectedCompoundId) ?? []);

  async function sign() {
    const snapshot = await sha256Hex(evidenceSnapshot(visibleClaims(all, asOf), r));
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
        rulesetHash: ruleset.version,
        evidenceSnapshotHash: snapshot,
        asOfDate: asOf,
        signatureMethod: "demo-persona",
        prevRecordHash: prev,
      },
    });
    setRationale("");
  }

  return (
    <section style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "var(--serif)" }}>Review-ready evidence package</h2>
      <p style={{ color: "var(--muted)" }}>
        Positions are recorded against the exact evidence and verdict on screen. The log is a hash-chained
        audit log: each entry carries the hash of the one before it, so tampering is detectable.
      </p>

      <fieldset style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 12 }}>
        <legend>Record a position</legend>
        <label>Reviewer <input value={name} onChange={(e) => setName(e.target.value)} /></label>{" "}
        <label>Position{" "}
          <select value={position} onChange={(e) => setPosition(e.target.value as typeof position)}>
            <option value="agree">agree</option>
            <option value="dissent">dissent</option>
            <option value="abstain">abstain</option>
          </select>
        </label>{" "}
        <label>Rationale <input value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>{" "}
        <button type="button" onClick={() => void sign()}>Sign</button>
      </fieldset>

      <ol>
        {positions.map((p, i) => (
          <li key={i} data-testid="position-row" style={{ marginTop: 10, fontSize: 13 }}>
            <strong>{p.displayName}</strong> — {p.position}
            {p.rationale ? ` · ${p.rationale}` : ""}
            <div style={{ color: "var(--muted)" }}>
              snapshot {p.evidenceSnapshotHash.slice(0, 12)}… · prev {p.prevRecordHash.slice(0, 12)}… ·
              as of {p.asOfDate ?? "all evidence"} · {p.signatureMethod}
            </div>
          </li>
        ))}
      </ol>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        ARBITER holds no position. The named decision owner signs.
      </p>
    </section>
  );
}
