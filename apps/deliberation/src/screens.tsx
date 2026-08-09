import { useState, type ReactElement } from "react";
import { api, ApiError, type Adjudication, type BlindView, type Finding, type Inventory, type Position, type UnanimityReport } from "./api.js";

/**
 * The screens of the deliberation, in the order §3.5 fixes them:
 * inventory -> your position -> reveal -> verdict -> sign, with the audit last.
 *
 * The linearity is the point. Seven parallel tabs left the order to the reader; the
 * order is exactly what §3.1 exists to protect, because reading anybody else's call
 * before writing your own is the failure blind submission was built to prevent.
 */

export function basisOf(p: Position): "cited" | "external" | "unsupported" {
  if (p.citedFindingIds.length > 0) return "cited";
  if (p.external.length > 0) return "external";
  return "unsupported";
}

const CALL_LABEL: Record<string, string> = {
  advance: "Advance",
  do_not_advance: "Do not advance",
  cannot_conclude: "Cannot conclude",
};

/** ------------------------------------------------------------------ inventory */
export function InventoryPanel({ inv }: { inv: Inventory }): ReactElement {
  const absent = inv.entries.filter((e) => e.state === "absent").length;
  const consequenceAbsent = inv.entries.filter((e) => e.state === "absent" && e.half === "consequence").length;
  const na = inv.entries.filter((e) => e.state === "not_applicable").length;

  return (
    <section>
      <h2>What the documents contain</h2>
      <p className="muted">
        Published to everyone before anybody answers. No verdict, no score, no ranking —
        ordered by checklist id and by nothing else, because ordering gaps by importance
        would push the room before it has spoken.
      </p>
      <div className="inv">
        {inv.entries.map((e) => (
          <div className="inv-row" key={e.itemId}>
            <div className={`state ${e.state}`}>{e.state === "not_applicable" ? "n/a" : e.state}</div>
            <div>
              <strong>{e.field}</strong>
              <div className="small muted">{e.whatItBlocks}</div>
              {e.findingIds.length > 0 && <div className="mono muted">{e.findingIds.join(", ")}</div>}
            </div>
          </div>
        ))}
      </div>
      <p className="small muted">
        Checklist v{inv.checklistVersion}. {absent} of {inv.entries.length} questions unanswered
        {consequenceAbsent > 0 && <>, {consequenceAbsent} of them on the consequence side — dose, exposure margin,
          injury pattern, reversibility. A mechanism can be real and still not be a reason to stop.</>}
        {na > 0 && <> {na} do not arise for a {inv.modality.replace("_", " ")} and are marked n/a rather than
          missing — an antibody has no reactive metabolite and no QSAR model, and listing those as gaps
          would fill the list with items nobody can supply.</>}
      </p>
    </section>
  );
}

/** -------------------------------------------------------------- your position */
export function PositionForm({ actor, caseId, findings, onDone }: {
  actor: string; caseId: string; findings: Finding[]; onDone: () => void;
}): ReactElement {
  const [call, setCall] = useState<"advance" | "do_not_advance" | "cannot_conclude">("advance");
  const [reasoning, setReasoning] = useState("");
  const [cited, setCited] = useState<string[]>([]);
  const [claim, setClaim] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string): void =>
    setCited((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const basis = cited.length > 0 ? "cited" : claim.trim() !== "" ? "external" : "unsupported";

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.submit(actor, caseId, {
        call, reasoning, citedFindingIds: cited,
        external: claim.trim() === "" ? [] : [{ claim, ...(source.trim() === "" ? {} : { source }) }],
        submittedAt: new Date().toISOString(),
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Your position</h2>
      <p className="muted">
        Sealed the moment you submit, and you cannot change it. Nobody sees it — and you
        see nobody — until everyone has answered.
      </p>

      <label htmlFor="call">Your call</label>
      <div className="rail" id="call">
        {(["advance", "do_not_advance", "cannot_conclude"] as const).map((c) => (
          <button key={c} type="button" className="persona" aria-pressed={call === c} onClick={() => setCall(c)}>
            {CALL_LABEL[c]}
          </button>
        ))}
      </div>

      <label htmlFor="why">Why. This is the part a later reader needs.</label>
      <textarea id="why" value={reasoning} onChange={(e) => setReasoning(e.target.value)}
        placeholder="The transporter result is real, but this assay overcalls for this class and the margin is 40x." />

      <label>What you are relying on, from this case</label>
      <p className="small muted">
        A selection, not free text. A selected citation points at a specific object, so
        the check is arithmetic — and a typed one would have to be run through a model to
        decide whether it referred to anything real, which would put a model in charge of
        which dissent counts.
      </p>
      {findings.map((f) => (
        <div className="cite" key={f.id}>
          <input type="checkbox" id={f.id} checked={cited.includes(f.id)} onChange={() => toggle(f.id)} />
          <label htmlFor={f.id} style={{ margin: 0, fontWeight: 400 }}>
            <strong>{f.label}</strong> <span className="muted">— asserts {f.assertion}</span>
            <div className="small muted">{f.detail}</div>
          </label>
        </div>
      ))}

      <label htmlFor="claim">Relying on something outside these documents? State it.</label>
      <p className="small muted">
        Not a weaker citation — an assertion not yet in evidence, and useful because
        somebody can go and check it. It joins the missing-evidence list rather than
        evaporating.
      </p>
      <input id="claim" type="text" value={claim} onChange={(e) => setClaim(e.target.value)}
        placeholder="This assay overcalls for phenothiazines." />
      <input type="text" value={source} onChange={(e) => setSource(e.target.value)}
        placeholder="Source, if you have one (optional)" style={{ marginTop: 8 }} />

      <p className="small">
        Your position will be recorded as <span className={`basis ${basis}`}>{basis}</span>
        {basis === "unsupported" && " — which is allowed, is never deleted, and is visible to whoever signs."}
      </p>

      <button className="primary" disabled={busy || reasoning.trim() === ""} onClick={() => void submit()}>
        {busy ? "Sealing…" : "Seal and submit"}
      </button>
      {reasoning.trim() === "" && <div className="small muted">A call with no argument can only be counted, and counts never decide here.</div>}
      {error !== null && <div className="err">{error}</div>}
    </section>
  );
}

/** ------------------------------------------------------------------- waiting */
export function Waiting({ view, isOwner, onReveal }: {
  view: BlindView; isOwner: boolean; onReveal: (mode: "all_in" | "close_early") => void;
}): ReactElement {
  const outstanding = view.others.filter((o) => !o.submitted);
  return (
    <section>
      <h2>Sealed. Waiting for the others.</h2>
      <p className="muted">
        This screen shows one bit per person, and that is all the server will send: not
        their call, not their reasoning, not a running tally. A tally drags a room exactly
        as hard as the positions would.
      </p>
      <div className="inv">
        {view.others.map((o) => (
          <div className="inv-row" key={o.participantId}>
            <div className={`state ${o.submitted ? "present" : "inconclusive"}`}>{o.submitted ? "in" : "waiting"}</div>
            <div>{o.participantId}</div>
          </div>
        ))}
      </div>
      {isOwner && (
        <>
          <button className="primary" disabled={outstanding.length > 0} onClick={() => onReveal("all_in")}>
            Reveal all positions
          </button>
          {outstanding.length > 0 && (
            <p className="small muted">
              Waiting on {outstanding.map((o) => o.participantId).join(", ")}.{" "}
              <button className="ghost" onClick={() => onReveal("close_early")}>Close without them</button>{" "}
              — their absence is written into the record.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** -------------------------------------------------------------------- reveal */
export function Reveal({ view, unanimity }: { view: BlindView; unanimity: UnanimityReport | null }): ReactElement {
  return (
    <section>
      <h2>Every position, at once</h2>
      {(view.revealed ?? []).map((p) => (
        <div className="pos" key={p.participantId}>
          <div className="pos-head">
            <strong>{p.participantId}</strong>
            <span>{CALL_LABEL[p.call]}</span>
            <span className={`basis ${basisOf(p)}`}>{basisOf(p)}</span>
          </div>
          <p>{p.reasoning}</p>
          {p.citedFindingIds.length > 0 && <div className="mono muted">cites: {p.citedFindingIds.join(", ")}</div>}
          {p.external.map((e, i) => (
            <div className="small muted" key={i}>outside this case: “{e.claim}”{e.source !== undefined && ` — ${e.source}`}</div>
          ))}
        </div>
      ))}

      {unanimity !== null && unanimity.unanimous && (
        <>
          <h2 style={{ marginTop: 32 }}>Everyone agreed. That is not the same as being right.</h2>
          <p className="muted small">
            Nothing below came from a model. Unanimity beside an unanswered question is a
            fact about the record, and it is checkable arithmetic.
          </p>
          {unanimity.concerns.map((c, i) => <div className="concern" key={i}>{c}</div>)}
          {unanimity.concerns.length === 0 && <p className="ok">No gaps and every position rests on cited evidence.</p>}
        </>
      )}
    </section>
  );
}

/** ------------------------------------------------------------------- verdict */
export function Verdict({ adjudication, source, onSign }: {
  adjudication: Adjudication; source: "stub" | "live";
  onSign: (agrees: boolean, reason: string) => void;
}): ReactElement {
  const [reason, setReason] = useState("");
  const [agrees, setAgrees] = useState(true);

  return (
    <section>
      <h2>The adjudication</h2>
      {source === "stub" && (
        <div className="stub">
          STUB — no model was called. The wiring is real; the words below are not a
          judgment about this compound and must not be quoted as one.
        </div>
      )}

      <h3>Mechanism — is there a route to liver injury?</h3>
      <p>{adjudication.mechanism.present ? "Present." : "Not established."} {adjudication.mechanism.pathway}</p>

      <h3>Consequence — is it severe enough to stop?</h3>
      <p><strong>{CALL_LABEL[adjudication.consequence.verdict] ?? adjudication.consequence.verdict}</strong></p>
      <p>{adjudication.consequence.reasoning}</p>

      <h3>Every rule, answered</h3>
      {adjudication.ruleDisclosure.map((d) => (
        <p key={d.ruleId} className="small">
          <span className="mono">{d.ruleId}</span> — {d.position === "applies" ? "applies" : "does not apply"}. {d.reasoning}
        </p>
      ))}

      {adjudication.missing.length > 0 && (
        <>
          <h3>Still unanswered</h3>
          {adjudication.missing.map((m, i) => <p key={i} className="small">{m.field} — {m.whyItMatters}</p>)}
        </>
      )}
      {adjudication.nextExperiment !== null && (
        <>
          <h3>What would settle it</h3>
          <p>{adjudication.nextExperiment}</p>
        </>
      )}

      <h2 style={{ marginTop: 32 }}>Sign</h2>
      <p className="muted">
        One named person. No quorum, no threshold, no consensus mechanism — a committee
        advises and an individual decides, and you may override this adjudication.
      </p>
      <div className="rail">
        <button type="button" className="persona" aria-pressed={agrees} onClick={() => setAgrees(true)}>Agree</button>
        <button type="button" className="persona" aria-pressed={!agrees} onClick={() => setAgrees(false)}>Override</button>
      </div>
      <label htmlFor="reason">{agrees ? "Anything to add (optional)" : "Why you are overriding — required"}</label>
      <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="primary" disabled={!agrees && reason.trim() === ""} onClick={() => onSign(agrees, reason)}>
        Sign the record
      </button>
    </section>
  );
}

/** --------------------------------------------------------------------- audit */
export function Audit({ audit }: { audit: NonNullable<Awaited<ReturnType<typeof api.audit>>> }): ReactElement {
  const clean = audit.chain.length === 0 && audit.seals.length === 0;
  return (
    <section>
      <h2>The record</h2>
      <p className={clean ? "ok" : "err"}>
        {clean
          ? "Chain intact, and every revealed position matches the commitment written while the case was blind."
          : "TAMPERING DETECTED."}
      </p>
      <p className="small muted">
        What that proves: no position was edited after it was sealed. What it does not
        prove: that the server never read one early. No server-side scheme can, and
        claiming otherwise would be the more dangerous error.
      </p>
      <table className="audit">
        <thead><tr><th>#</th><th>event</th><th>actor</th><th>hash</th></tr></thead>
        <tbody>
          {audit.entries.map((e) => (
            <tr key={e.seq}>
              <td>{e.seq}</td><td>{e.kind}</td><td>{e.actorId}</td><td>{e.hash.slice(0, 16)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
