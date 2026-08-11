import { useState, type ReactElement } from "react";
import { api, ApiError, type Adjudication, type BlindView, type Finding, type Inventory, type Position, type Refusal, type Roster, type StoredDocument, type UnanimityReport } from "./api.js";

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

/**
 * Three positions, three labels.
 *
 * This screen rendered `d.position === "applies" ? "applies" : "does not apply"` until
 * 2026-08-10 - a binary ternary, so the moment a third position existed it would have
 * displayed "cannot be determined" AS "does not apply". That is §10 rule 7 on the
 * screen: a rule nobody could answer would have read as a rule that was answered in the
 * negative, which is the one confusion this project exists to prevent.
 *
 * Falls through to the raw value rather than a default label, for the same reason
 * CALL_LABEL does: an unrecognised position should look wrong, not look plausible.
 */
const POSITION_LABEL: Record<string, string> = {
  applies: "applies",
  does_not_apply: "does not apply",
  cannot_determine: "cannot be determined from this package",
};

/** ------------------------------------------------------------------ inventory */
/** -------------------------------------------------------------- the roster */
/**
 * Who is on the case, and inviting somebody who has no account yet.
 *
 * An invitation here does NOT send an email — nothing does, from this deployment —
 * and the copy says so rather than implying a message went out. A convener who
 * believes a mail was sent will wait for an answer that is never coming.
 */
export function RosterPanel({ roster, canEdit, isOwner, ownerName, onInvite, onRemove, notice, error }: {
  roster: Roster;
  canEdit: boolean;
  isOwner: boolean;
  ownerName: string;
  onInvite: (email: string) => void;
  onRemove: (idOrEmail: string) => void;
  notice: string | null;
  error: string | null;
}): ReactElement {
  const [email, setEmail] = useState("");

  return (
    <div className="stack">
      {/* Who holds this power, and why, stated on the screen where it is exercised.
          Picking the panel is the strongest lever on the outcome, so it should never
          be a control whose authority the reader has to infer. */}
      <div className="note">
        <strong>{isOwner ? "You convene this case." : `${ownerName} convenes this case.`}</strong>{" "}
        The convener chooses who answers and signs at the end — and does not answer, so
        nobody both sets the question and votes on it.
        {canEdit
          ? " Every change here goes on the record: adding or removing somebody is a logged event anyone can read afterwards."
          : " The panel is fixed now, because somebody has already answered."}
      </div>
      <div className="inv">
        {roster.members.map((m) => (
          <div className="inv-row" key={m.id}>
            <div className="state present">on panel</div>
            <div>
              <strong>{m.displayName}</strong>
              <div className="tiny muted mono">{m.email}</div>
              {canEdit && roster.members.length > 1 && (
                <button className="link" style={{ marginTop: 8 }} onClick={() => onRemove(m.id)}>Remove</button>
              )}
            </div>
          </div>
        ))}
        {roster.pending.map((p) => (
          <div className="inv-row" key={p.email}>
            <div className="state inconclusive">invited</div>
            <div>
              <strong className="mono">{p.email}</strong>
              <div className="small muted">
                No account yet. They join automatically when they register — nothing was
                emailed, so tell them.
              </div>
              {canEdit && (
                <button className="link" style={{ marginTop: 8 }} onClick={() => onRemove(p.email)}>Cancel invitation</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="panel sunken">
          <div className="field">
            <label htmlFor="invite">Invite by email</label>
            <input id="invite" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com" />
            <span className="hint">
              They can be added before they have an account. The roster locks as soon as
              anybody answers, because “everyone has submitted” is what opens the reveal.
            </span>
          </div>
          <div className="btn-row">
            <button className="primary" disabled={email.trim() === ""}
              onClick={() => { onInvite(email.trim()); setEmail(""); }}>
              Add to case
            </button>
          </div>
          {notice !== null && <div className="note">{notice}</div>}
          {error !== null && <div className="err">{error}</div>}
        </div>
      )}
    </div>
  );
}

/** ---------------------------------------------------------- findings entry */
/**
 * Entering the evidence by hand.
 *
 * Extraction — a model reading a PDF and proposing findings — is not built. Until it
 * is, somebody types them; when it lands, it pre-fills exactly this form for a human
 * to approve. The approval step is not scaffolding that disappears later, because a
 * coverage declaration has to carry a human signature either way.
 *
 * The form asks for a source page and will not pretend it is optional. A finding
 * nobody can trace back to a sentence is the thing this whole product exists to stop
 * people relying on.
 */
export function FindingsEditor({ checklist, findings, documents, frozen, onAdd, onRemove, error }: {
  checklist: { itemId: string; field: string; state: string }[];
  findings: Finding[];
  documents: StoredDocument[];
  frozen: string | null;
  onAdd: (f: { id: string; label: string; assertion: "toxic" | "safe" | "ambiguous"; detail: string; sourcePage?: number; sourceDocumentId?: string; covers: string[] }) => void;
  onRemove: (id: string) => void;
  error: string | null;
}): ReactElement {
  const [label, setLabel] = useState("");
  const [assertion, setAssertion] = useState<"toxic" | "safe" | "ambiguous">("safe");
  const [detail, setDetail] = useState("");
  const [page, setPage] = useState("");
  const [docId, setDocId] = useState("");
  const [covers, setCovers] = useState<string[]>([]);

  const toggle = (id: string): void =>
    setCovers((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const add = (): void => {
    const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    onAdd({
      id: slug === "" ? `finding-${findings.length + 1}` : slug,
      label: label.trim(), assertion, detail: detail.trim(),
      ...(page.trim() === "" ? {} : { sourcePage: Number(page) }),
      ...(docId === "" ? {} : { sourceDocumentId: docId }),
      covers,
    });
    setLabel(""); setDetail(""); setPage(""); setCovers([]); setAssertion("safe");
  };

  return (
    <div className="stack">
      {findings.length > 0 && (
        <div className="inv">
          {findings.map((f) => (
            <div className="inv-row" key={f.id}>
              <div className={`state ${f.assertion === "toxic" ? "absent" : f.assertion === "safe" ? "present" : "inconclusive"}`}>
                {f.assertion}
              </div>
              <div>
                <strong>{f.label}</strong>
                <div className="small muted">{f.detail}</div>
                {frozen === null && (
                  <button className="link" style={{ marginTop: 8 }} onClick={() => onRemove(f.id)}>Remove</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {frozen !== null ? (
        <div className="note">
          <strong>The evidence is fixed now.</strong> {frozen}
        </div>
      ) : (
        <div className="panel sunken">
          <div>
            <h3>Add a finding</h3>
            <p className="hint">
              One result from the documents. When automatic extraction is built it will
              fill this in for you to check — the checking step stays either way.
            </p>
          </div>

          <div className="field">
            <label htmlFor="f-label">What was measured</label>
            <input id="f-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="Rat 26-week repeat-dose, liver histopathology" />
          </div>

          <div className="field">
            <label>What it shows</label>
            <div className="choice">
              {(["safe", "toxic", "ambiguous"] as const).map((a) => (
                <button key={a} type="button" className="ghost" aria-pressed={assertion === a}
                  onClick={() => setAssertion(a)}>
                  {a === "safe" ? "No signal" : a === "toxic" ? "A signal" : "Neither way"}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="f-detail">What it actually said</label>
            <textarea id="f-detail" value={detail} onChange={(e) => setDetail(e.target.value)}
              placeholder="Quote the document where you can. Doses, exposure multiples and whether it recovered are the parts other people will argue about." />
          </div>

          <div className="field">
            <label htmlFor="f-doc">Which document</label>
            {documents.length === 0
              ? <span className="hint">Upload a document below and you will be able to point at it here. A page number with no document is not a citation anybody can follow.</span>
              : (
                <select id="f-doc" value={docId} onChange={(e) => setDocId(e.target.value)}>
                  <option value="">Not from an uploaded document</option>
                  {documents.filter((d) => d.measurement.ok).map((d) => (
                    <option key={d.id} value={d.id}>{d.filename}</option>
                  ))}
                </select>
              )}
          </div>

          <div className="field">
            <label htmlFor="f-page">Page</label>
            <input id="f-page" type="number" min="1" value={page} onChange={(e) => setPage(e.target.value)}
              style={{ maxWidth: 140 }} />
            <span className="hint">So anyone can go and check it.</span>
          </div>

          <div className="field">
            <label>Which questions does this answer?</label>
            <span className="hint" style={{ marginTop: 0 }}>
              Tick only what this result genuinely addresses. Coverage is never guessed
              from the wording — a question wrongly marked answered never comes back on
              the missing list.
            </span>
            {checklist.filter((i) => i.state !== "not_applicable").map((i) => (
              <div className="cite" key={i.itemId}>
                <input type="checkbox" id={`c-${i.itemId}`} checked={covers.includes(i.itemId)}
                  onChange={() => toggle(i.itemId)} />
                <label htmlFor={`c-${i.itemId}`}>
                  <span className="mono tiny muted">{i.itemId}</span> {i.field}
                </label>
              </div>
            ))}
          </div>

          <div className="btn-row">
            <button className="primary" onClick={add} disabled={label.trim() === "" || detail.trim() === ""}>
              Add finding
            </button>
          </div>
          {error !== null && <div className="err">{error}</div>}
        </div>
      )}
    </div>
  );
}

/** --------------------------------------------------------------- documents */
export function Documents({ docs, onUpload, busy, error }: {
  docs: StoredDocument[];
  onUpload: (file: File) => void;
  busy: boolean;
  error: string | null;
}): ReactElement {
  return (
    <section>
      <h2>Documents</h2>
      <p className="muted">
        A PDF is measured before it is accepted. Two of the first five regulatory
        documents collected for this project were unusable — one was 48 pages of
        scanned images with no readable text, one was the wrong document entirely —
        and neither failure was visible without measuring. An unreadable file is
        refused here, while you still have it in front of you.
      </p>

      <label htmlFor="pdf">Upload a study PDF</label>
      <input id="pdf" type="file" accept="application/pdf"
        onChange={(e) => { const f = e.target.files?.[0]; if (f !== undefined) onUpload(f); }} />
      {busy && <p className="small muted">Measuring…</p>}
      {error !== null && <div className="stub">{error}</div>}

      {docs.length === 0
        ? <p className="small muted">Nothing uploaded yet.</p>
        : (
          <div className="inv" style={{ marginTop: 16 }}>
            {docs.map((d) => (
              <div className="inv-row" key={d.id}>
                <div className={`state ${d.measurement.ok ? "present" : "absent"}`}>
                  {d.measurement.ok ? "readable" : "refused"}
                </div>
                <div>
                  <strong>{d.filename}</strong>
                  <div className="small muted">{d.measurement.reason}</div>
                  {d.measurement.note !== undefined && <div className="small muted">{d.measurement.note}</div>}
                  <div className="mono small muted">
                    {d.measurement.pages} pages · {d.measurement.characters?.toLocaleString()} characters
                    {" · "}{d.measurement.embeddedImages} images
                    {" · "}liver terms {d.measurement.liverTermHits}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
    </section>
  );
}

export function Refused({ r }: { r: Refusal }): ReactElement {
  return (
    <section>
      <h2>{r.label}</h2>
      <div className="stub">
        This document cannot produce a case. The splitter refused it, and nothing here
        will quietly build one anyway.
      </div>
      <h3>What data/prep/split_review.py said</h3>
      <p className="mono">{r.splitterReason}</p>
      <h3>Measured</h3>
      <p>{r.measurement}</p>
      <h3>Why it is on this list at all</h3>
      <p className="muted">
        Two of the four documents collected cannot be used, and that ratio is the
        finding — it is what killed the plan to replay the drugs withdrawn for
        hepatotoxicity. A picker showing only what worked would imply every document
        works.
      </p>
      <p className="mono small muted">{r.document}</p>
    </section>
  );
}

export function InventoryPanel({ inv, documentScope }: { inv: Inventory; documentScope?: string | null }): ReactElement {
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
      {documentScope !== undefined && documentScope !== null && (
        <div className="concern">{documentScope}</div>
      )}
      <div className="inv">
        {inv.entries.map((e) => (
          <div className="inv-row" key={e.itemId}>
            <div className={`state ${e.state}`}>{e.state === "not_applicable" ? "n/a" : e.state}</div>
            <div>
              <strong>{e.field}</strong>
              {/* One or the other, never both. `whatItBlocks` says what goes wrong
                  when a question is unanswered - the wrong sentence entirely for a
                  question that does not arise, and showing it beside an n/a badge
                  made four non-issues read as four untested liabilities. */}
              <div className="small muted">
                {e.state === "not_applicable"
                  ? (e.whyNotApplicable ?? "Does not apply to this kind of drug.")
                  : e.whatItBlocks}
              </div>
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
export function PositionForm({ token, caseId, findings, onDone }: {
  token: string; caseId: string; findings: Finding[]; onDone: () => void;
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
      await api.submit(token, caseId, {
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
export function Waiting({ view, isOwner, nameOf, onReveal }: {
  view: BlindView; isOwner: boolean; nameOf: (id: string) => string;
  onReveal: (mode: "all_in" | "close_early") => void;
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
            <div>{nameOf(o.participantId)}</div>
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
              Waiting on {outstanding.map((o) => nameOf(o.participantId)).join(", ")}.{" "}
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
export function Reveal({ view, unanimity, nameOf }: {
  view: BlindView; unanimity: UnanimityReport | null; nameOf: (id: string) => string;
}): ReactElement {
  return (
    <section>
      <h2>Every position, at once</h2>
      {(view.revealed ?? []).map((p) => (
        <div className="pos" key={p.participantId}>
          <div className="pos-head">
            <strong>{nameOf(p.participantId)}</strong>
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
          <span className="mono">{d.ruleId}</span> — {POSITION_LABEL[d.position] ?? d.position}. {d.reasoning}
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
const EVENT_LABEL: Record<string, string> = {
  case_opened: "Case opened",
  inventory_published: "Evidence published",
  participant_added: "Someone added to the panel",
  participant_removed: "Someone removed from the panel",
  case_described: "Case renamed or restated",
  position_sealed: "A position was sealed",
  revealed: "Positions revealed",
  adjudicated: "Adjudicated",
  signed: "Signed",
};

export function Audit({ audit, nameOf }: {
  audit: NonNullable<Awaited<ReturnType<typeof api.audit>>>;
  nameOf?: (id: string) => string;
}): ReactElement {
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
      <div className="scroll">
        <table>
          <thead><tr><th style={{ width: 44 }}>#</th><th>What happened</th><th>Who</th><th>Hash</th></tr></thead>
          <tbody>
            {audit.entries.map((e) => {
              // Roster changes are called out, because they are the events a reader
              // scanning this table is least likely to be expecting and most likely
              // to care about: who was taken off the panel, and by whom.
              const roster = e.kind === "participant_added" || e.kind === "participant_removed";
              const who = (e.payload as { participantId?: string } | null)?.participantId;
              return (
                <tr key={e.seq}>
                  <td className="mono">{e.seq}</td>
                  <td>
                    <strong>{EVENT_LABEL[e.kind] ?? e.kind}</strong>
                    {roster && who !== undefined && (
                      <div className="small muted">{nameOf === undefined ? who : nameOf(who)}</div>
                    )}
                  </td>
                  <td className="small">{nameOf === undefined ? e.actorId : nameOf(e.actorId)}</td>
                  <td className="mono tiny muted">{e.hash.slice(0, 12)}…</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
