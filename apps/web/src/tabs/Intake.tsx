import { useMemo, useState } from "react";
import type { EvidenceClaim } from "@arbiter/engine";
import { useAppState, useDispatch } from "../state/store.js";
import { assessReachability, reachabilitySentence } from "../intake/advisor.js";
import { validateIntake, type ExposureCitation } from "../intake/validate.js";

const STREAMS = ["cytotox", "transporter", "toxicogenomics", "invivo_rodent", "invivo_nonrodent", "qsar"] as const;
const ASSERTIONS = ["toxic", "safe", "ambiguous"] as const;
const SYSTEMS = ["human", "rodent", "nonrodent", "in_silico"] as const;

/** The form's own shape. Everything is a string until it is parsed into a claim. */
interface Draft {
  stream: string;
  assertion: string;
  strength: string;
  system: string;
  measuresKeyEvent: string;
  exposureRelevant: string;
  inApplicabilityDomain: string;
  klimisch: string;
  availableFrom: string;
  provenanceKind: string;
  provenanceSource: string;
}

const EMPTY: Draft = {
  stream: "cytotox", assertion: "toxic", strength: "0.7", system: "human",
  measuresKeyEvent: "", exposureRelevant: "unknown", inApplicabilityDomain: "unknown",
  klimisch: "2", availableFrom: "2026-01", provenanceKind: "literature", provenanceSource: "",
};

function tristate(v: string): boolean | null {
  return v === "yes" ? true : v === "no" ? false : null;
}

/**
 * Claim ids follow the corpus convention `${compoundId}:${stream}`, because
 * `findClaim` in the store slices the compound id at the FIRST colon. A second
 * claim on the same stream gets a suffix rather than colliding - two claims
 * sharing an id would make the evidence working copy edit both at once.
 */
function nextClaimId(compoundId: string, stream: string, taken: EvidenceClaim[]): string {
  const base = `${compoundId}:${stream}`;
  if (!taken.some((c) => c.id === base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.some((c) => c.id === candidate)) return candidate;
  }
}

function toClaim(d: Draft, compoundId: string, taken: EvidenceClaim[]): unknown {
  return {
    id: nextClaimId(compoundId, d.stream, taken),
    compoundId,
    stream: d.stream,
    assertion: d.assertion,
    strength: Number(d.strength),
    system: d.system,
    // Blank means "did not measure one", which is null rather than an empty
    // string. The schema's refine also forbids a non-null value here on a qsar or
    // in_silico claim, so the form does not have to police that itself.
    measuresKeyEvent: d.measuresKeyEvent.trim() === "" ? null : d.measuresKeyEvent.trim(),
    exposureRelevant: tristate(d.exposureRelevant),
    inApplicabilityDomain: tristate(d.inApplicabilityDomain),
    klimisch: d.klimisch === "" ? null : Number(d.klimisch),
    availableFrom: d.availableFrom.trim(),
    provenance: {
      kind: d.provenanceKind,
      source: d.provenanceSource.trim(),
      // Not a clock the ENGINE reads - the engine has none. This is provenance
      // metadata about when a human retrieved the source, which is exactly the
      // kind of fact a form is allowed to stamp.
      retrieved: new Date().toISOString().slice(0, 10),
    },
  };
}

/**
 * Intake spec §4 - six questions, one per rule, plus what the study found, how
 * strong it is, and where it came from.
 *
 * The reframe in §1 is the reason this screen asks for evidence rather than a
 * molecule: a structure alone yields one QSAR claim, R2 discounts it to 6% or 1%
 * for measuring no mechanism, and the ceiling is 0.01 against a bar of 0.5. A
 * "paste a SMILES" form would abstain on everything, correctly, and look broken.
 */
export function IntakeTab() {
  const state = useAppState();
  const dispatch = useDispatch();

  const [compoundId, setCompoundId] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [claims, setClaims] = useState<EvidenceClaim[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [exposure, setExposure] = useState<ExposureCitation | null>(null);
  const [cmax, setCmax] = useState("");
  const [cmaxSource, setCmaxSource] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  const set = <K extends keyof Draft>(k: K, v: string): void => setDraft((d) => ({ ...d, [k]: v }));

  const idError = useMemo(() => {
    const id = compoundId.trim();
    if (id === "") return null;
    // A colon would break `findClaim`'s first-colon slice in the store.
    if (id.includes(":")) return "A compound id may not contain a colon.";
    if (state.data.compounds.has(id) || state.data.heroCases.has(id)) {
      return `${id} is already in the benchmark corpus. Custom compounds must be new - see intake spec §6.`;
    }
    return null;
  }, [compoundId, state.data]);

  const reach = useMemo(
    () => (claims.length === 0 ? null : assessReachability(claims, state.ruleset)),
    [claims, state.ruleset],
  );

  function addClaim(): void {
    const id = compoundId.trim();
    if (id === "" || idError !== null) {
      setErrors(["Enter a compound id first."]);
      return;
    }
    const citation: ExposureCitation | null =
      cmax.trim() === "" ? exposure : { cmax: Number(cmax), basis: "clinical", citation: cmaxSource.trim() };
    const result = validateIntake([toClaim(draft, id, claims)], citation);
    if (result.errors.length > 0) {
      setErrors(result.errors);
      return;
    }
    setExposure(citation);
    setErrors([]);
    setClaims((cs) => [...cs, ...result.claims]);
    setDraft(EMPTY);
  }

  function create(): void {
    const id = compoundId.trim();
    dispatch({ type: "addCustomCompound", compoundId: id, claims });
    dispatch({ type: "selectCompound", compoundId: id });
    setCreated(id);
  }

  return (
    <section className="prose stack">
      <p className="label">Your compound</p>
      <h2 className="display">Intake</h2>

      <p className="lede">
        ARBITER adjudicates between sources that disagree, so it needs evidence rather than a
        molecule. A structure on its own yields one structural prediction, which R2 discounts for
        measuring no mechanism — not enough to license any decision.
      </p>
      <p className="small muted">
        Nothing entered here leaves this browser, is written to the benchmark, or changes a reported
        number. It is session-local and disappears on reload.
      </p>

      <div className="panel stack">
        <h3 className="subtitle">Compound</h3>
        <label className="control">
          Compound id{" "}
          <input
            className="field" data-testid="intake-compound-id" value={compoundId}
            placeholder="ACME-001" onChange={(e) => setCompoundId(e.target.value)}
          />
        </label>
        {idError !== null && <p className="caveat caveat-warn" data-testid="intake-id-error">{idError}</p>}
      </div>

      <div className="panel stack">
        <h3 className="subtitle">Add a study</h3>
        <p className="small muted">
          Six of these feed one rule each: system → R1, mechanism → R2, exposure → R3, applicability
          → R4, reliability → R5, and independent streams → R6.
        </p>

        <div className="row">
          <label className="control">What kind of test{" "}
            <select className="field" data-testid="intake-stream" value={draft.stream}
                    onChange={(e) => set("stream", e.target.value)}>
              {STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="control">What it found{" "}
            <select className="field" data-testid="intake-assertion" value={draft.assertion}
                    onChange={(e) => set("assertion", e.target.value)}>
              {ASSERTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="control">Strength{" "}
            <input className="field" data-testid="intake-strength" type="number" min="0" max="1" step="0.05"
                   value={draft.strength} onChange={(e) => set("strength", e.target.value)} />
          </label>
          <label className="control">Tested in (R1){" "}
            <select className="field" data-testid="intake-system" value={draft.system}
                    onChange={(e) => set("system", e.target.value)}>
              {SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <div className="row">
          <label className="control">Key event measured (R2){" "}
            <input className="field" data-testid="intake-key-event" value={draft.measuresKeyEvent}
                   placeholder="blank if none" onChange={(e) => set("measuresKeyEvent", e.target.value)} />
          </label>
          <label className="control">Clinically relevant exposure (R3){" "}
            <select className="field" data-testid="intake-exposure" value={draft.exposureRelevant}
                    onChange={(e) => set("exposureRelevant", e.target.value)}>
              <option value="unknown">unstated</option><option value="yes">yes</option><option value="no">no</option>
            </select>
          </label>
          <label className="control">In applicability domain (R4){" "}
            <select className="field" data-testid="intake-domain" value={draft.inApplicabilityDomain}
                    onChange={(e) => set("inApplicabilityDomain", e.target.value)}>
              <option value="unknown">not applicable</option><option value="yes">yes</option><option value="no">no</option>
            </select>
          </label>
          <label className="control">Klimisch reliability (R5){" "}
            <select className="field" data-testid="intake-klimisch" value={draft.klimisch}
                    onChange={(e) => set("klimisch", e.target.value)}>
              <option value="">not recorded</option>
              <option value="1">1</option><option value="2">2</option>
              <option value="3">3</option><option value="4">4</option>
            </select>
          </label>
        </div>

        <div className="row">
          <label className="control">Known from{" "}
            <input className="field" data-testid="intake-available-from" value={draft.availableFrom}
                   placeholder="2026-01" onChange={(e) => set("availableFrom", e.target.value)} />
          </label>
          <label className="control">Source kind{" "}
            <select className="field" data-testid="intake-prov-kind" value={draft.provenanceKind}
                    onChange={(e) => set("provenanceKind", e.target.value)}>
              <option value="literature">literature</option><option value="database">database</option>
            </select>
          </label>
          <label className="control">Source{" "}
            <input className="field" data-testid="intake-prov-source" value={draft.provenanceSource}
                   placeholder="internal study 4471" onChange={(e) => set("provenanceSource", e.target.value)} />
          </label>
        </div>

        {/* HANDOVER §3.1's prohibition, surfaced rather than buried in a validator:
            asserting exposure relevance on a SAFE finding needs a cited Cmax, and
            the asymmetry is R3's whole content. */}
        <div className="row">
          <label className="control">Clinical Cmax{" "}
            <input className="field" data-testid="intake-cmax" value={cmax}
                   placeholder="required for a safe finding at exposure"
                   onChange={(e) => setCmax(e.target.value)} />
          </label>
          <label className="control">Cmax citation{" "}
            <input className="field" data-testid="intake-cmax-source" value={cmaxSource}
                   onChange={(e) => setCmaxSource(e.target.value)} />
          </label>
        </div>

        <div className="row">
          <button type="button" className="btn" data-testid="intake-add-claim" onClick={addClaim}>
            Add study
          </button>
        </div>

        {errors.length > 0 && (
          <ul className="stack" data-testid="intake-errors">
            {errors.map((e) => <li key={e} className="caveat caveat-warn">{e}</li>)}
          </ul>
        )}
      </div>

      {claims.length > 0 && (
        <div className="panel stack">
          <h3 className="subtitle">Evidence entered ({claims.length})</h3>
          <table className="table" data-testid="intake-claims">
            <thead>
              <tr><th>Claim</th><th>Finding</th><th>System</th><th>Key event</th><th>Exposure</th><th /></tr>
            </thead>
            <tbody>
              {claims.map((c, i) => (
                <tr key={c.id}>
                  <td className="mono">{c.id}</td>
                  <td>{c.assertion} ({c.strength})</td>
                  <td>{c.system}</td>
                  <td>{c.measuresKeyEvent ?? "—"}</td>
                  <td>{c.exposureRelevant === null ? "unstated" : c.exposureRelevant ? "yes" : "no"}</td>
                  <td>
                    <button type="button" className="btn btn-ghost"
                            onClick={() => setClaims((cs) => cs.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Intake spec §8. A user who enters three weak claims and receives
          `abstain` will conclude the tool is broken. They are the 140-compound
          case, and the honest framing is available BEFORE they are disappointed. */}
      {reach !== null && (
        <div className="panel stack" data-testid="intake-advisor">
          <h3 className="subtitle">Can this evidence decide?</h3>
          <p className={reach.reachable ? "lede" : "caveat caveat-warn"} data-testid="intake-advisor-sentence">
            {reachabilitySentence(reach)}
          </p>
          <dl className="row">
            <div className="kv"><dt>ceiling</dt><dd>{reach.ceiling.toFixed(3)}</dd></div>
            <div className="kv"><dt>needs</dt><dd>{reach.bar.toFixed(3)}</dd></div>
            <div className="kv"><dt>verdict now</dt><dd>{reach.verdict}</dd></div>
          </dl>
        </div>
      )}

      <div className="row">
        <button
          type="button" className="btn btn-primary" data-testid="intake-create"
          disabled={claims.length === 0 || compoundId.trim() === "" || idError !== null}
          onClick={create}
        >
          Create compound and open it
        </button>
        {created !== null && (
          <a className="btn" href="#/case" data-testid="intake-open-case">Open {created} on the Case tab</a>
        )}
      </div>
    </section>
  );
}
