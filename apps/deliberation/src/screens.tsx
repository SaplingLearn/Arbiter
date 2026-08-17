import { useState, type ReactElement } from "react";
import { api, ApiError, type Adjudication, type BlindView, type Consensus, type Finding, type Inventory, type Position, type Refusal, type Roster, type Signature, type StoredDocument, type UnanimityReport } from "./api.js";
import { Markdown } from "./markdown.js";
import { Reviewer, collidingInitials } from "./Reviewer.js";
import { initials } from "./Layout.js";

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

/**
 * The verdict's colour, and it is the only colour on the panel.
 *
 * `open` for `cannot_conclude` rather than a fourth hue: declining to call it is a
 * real answer (§0 says it is the one the engine owed irbesartan), so it gets the
 * neutral the rest of the app already spends on "unresolved" - not a warning tint
 * that would read as a soft no.
 */
const CALL_TONE: Record<string, string> = {
  advance: "go",
  do_not_advance: "stop",
  cannot_conclude: "",
};

/**
 * How loudly a rule row asks to be read - NOT whether its answer is good news.
 *
 * Deliberately not the go/stop pair the verdict uses. Green on "applies" would say a
 * rule that bites is reassuring, and red on "does not apply" would say a rule that is
 * simply irrelevant here is a problem; both are the category error this screen keeps
 * having to undo. `accent` marks the rows that carry an argument, and the plain badge
 * lets the rest recede without disappearing - every rule is still answered on screen.
 */
const POSITION_TONE: Record<string, string> = {
  applies: "accent",
  does_not_apply: "",
  cannot_determine: "open",
};

/**
 * Strip the separator this codebase put in front of the sentence itself.
 *
 * `adjudicate.ts` renders every recorded absence into the prompt as
 * `${field} - blocks: ${whatItBlocks}`, and the model copies that string back
 * wholesale, so `whyItMatters` arrives carrying our own delimiter. On screen the
 * field is already its own line, which left every gap opening on a lowercase
 * "blocks:" fragment.
 *
 * REMOVED HERE RATHER THAN IN THE PROMPT because the prompt's wording is measured -
 * the adjudicator's behaviour was characterised against it - and no cosmetic defect
 * is worth re-running that. This deletes a label, never a clause: the pattern is
 * anchored, and text that does not start with it is passed through untouched.
 */
function withoutPromptLabel(s: string): string {
  return s.replace(/^\s*blocks:\s*/i, "");
}

/** ------------------------------------------------------------------ inventory */
/** -------------------------------------------------------------- the roster */
/**
 * Who is on the case, and inviting somebody who has no account yet.
 *
 * An invitation here does NOT send an email - nothing does, from this deployment -
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
  // Computed ONCE for the whole panel, not per row: whether two people share initials
  // is a property of the roster, and a per-row computation would ask the question
  // against a list of one and always answer no.
  const collisions = collidingInitials(roster.members.map((m) => m.displayName));

  return (
    <div className="stack">
      {/* Who holds this power, and why, stated on the screen where it is exercised.
          Picking the panel is the strongest lever on the outcome, so it should never
          be a control whose authority the reader has to infer. */}
      <div className="note">
        <strong>{isOwner ? "You convene this case." : `${ownerName} convenes this case.`}</strong>{" "}
        The convener chooses who answers and signs at the end - and does not answer, so
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
              {/* The seat colour, shown wherever the person is named. A colour is only
                  learnable if it is the same on the roster as on every later screen -
                  a reviewer who looks different in two places is two people as far as
                  the reader is concerned. */}
              <Reviewer name={m.displayName} seat={roster.seats[m.id] ?? null}
                disambiguate={collisions.has(initials(m.displayName))} />{" "}
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
                No account yet. They join automatically when they register - nothing was
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
 * Extraction - a model reading a PDF and proposing findings - is not built. Until it
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
  onAdd: (f: { id: string; label: string; assertion: "toxic" | "safe" | "ambiguous"; detail: string; sourcePage?: number; sourceDocumentId?: string; sourceQuote?: string; covers: string[] }) => void;
  onRemove: (id: string) => void;
  error: string | null;
}): ReactElement {
  const [label, setLabel] = useState("");
  const [assertion, setAssertion] = useState<"toxic" | "safe" | "ambiguous">("safe");
  const [detail, setDetail] = useState("");
  const [page, setPage] = useState("");
  const [docId, setDocId] = useState("");
  const [quote, setQuote] = useState("");
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
      // Dropped unless it is anchored, which is the same rule the server enforces:
      // a quote with no document and no page names a passage nobody can find.
      ...(quote.trim() === "" || docId === "" || page.trim() === ""
        ? {}
        : { sourceQuote: quote.trim() }),
      covers,
    });
    setLabel(""); setDetail(""); setPage(""); setQuote(""); setCovers([]); setAssertion("safe");
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
              fill this in for you to check - the checking step stays either way.
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
            <label htmlFor="f-quote">The passage, word for word</label>
            <textarea id="f-quote" value={quote} onChange={(e) => setQuote(e.target.value)}
              placeholder="Paste the sentence exactly as it appears in the document." />
            <span className="hint">
              {docId === "" || page.trim() === ""
                ? "Name the document and the page first - a quote with nowhere to point cannot be marked, and is dropped."
                : "Marked on the page for every reader. Matched exactly: if a word is changed the mark is not drawn, and the reader is told why rather than shown the nearest similar sentence."}
            </span>
          </div>

          <div className="field">
            <label>Which questions does this answer?</label>
            <span className="hint" style={{ marginTop: 0 }}>
              Tick only what this result genuinely addresses. Coverage is never guessed
              from the wording - a question wrongly marked answered never comes back on
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
        documents collected for this project were unusable - one was 48 pages of
        scanned images with no readable text, one was the wrong document entirely -
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

/**
 * WHY THIS TAKES A WAY BACK.
 *
 * A refusal is not an error page and not a route - it is what the library shows when
 * you ask it to open a document that cannot produce a case. So it has to be leaveable
 * from inside, the way the fatal panel is: it lives on the library's own route, which
 * means the header's Library link is the tab you are ALREADY on and clicking it fires
 * no hashchange. Without a control here, the one obvious gesture for going back to the
 * list does nothing at all.
 */
/**
 * AND WHY IT CARRIES `section`, WHICH IS NOT DECORATION.
 *
 * `h2`, `h3` and `p` are all `margin: 0` in app.css - the whole app takes its vertical
 * rhythm from a container, never from the type. A bare `<section>` is therefore not a
 * neutral wrapper here, it is NO rhythm at all: this panel rendered as a solid block of
 * text with the red refusal box wedged into the middle of it, touching the title above
 * and the first heading below. Every other screen in this file that reads correctly is
 * inside `.section` or a `Section`; this one was the exception and looked it.
 *
 * TWO SCALES, NOT ONE. `.section` alone spaces every child equally, which leaves each
 * `h3` floating exactly as far from its own paragraph as from the block before it - so
 * the headings stop owning their text and the panel reads as six unrelated lines. Each
 * heading is paired with its body in a `.stack-s` instead, so the pairs sit 8px apart
 * inside and 16px apart from each other, and the reader gets three groups rather than
 * six items.
 */
export function Refused({ r, onBack }: { r: Refusal; onBack: () => void }): ReactElement {
  return (
    <section className="section">
      <h2>{r.label}</h2>
      <div className="stub">
        This document cannot produce a case. The splitter refused it, and nothing here
        will quietly build one anyway.
      </div>
      <div className="stack-s">
        <h3>What data/prep/split_review.py said</h3>
        <p className="mono">{r.splitterReason}</p>
      </div>
      <div className="stack-s">
        <h3>Measured</h3>
        <p>{r.measurement}</p>
      </div>
      <div className="stack-s">
        <h3>Why it is on this list at all</h3>
        <p className="muted">
          Two of the four documents collected cannot be used, and that ratio is the
          finding - it is what killed the plan to replay the drugs withdrawn for
          hepatotoxicity. A picker showing only what worked would imply every document
          works.
        </p>
      </div>
      <p className="mono small muted">{r.document}</p>
      <div className="btn-row">
        <button className="ghost" onClick={onBack}>Back to the library</button>
      </div>
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
        Published to everyone before anybody answers. No verdict, no score, no ranking -
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
        {consequenceAbsent > 0 && <>, {consequenceAbsent} of them on the consequence side - dose, exposure margin,
          injury pattern, reversibility. A mechanism can be real and still not be a reason to stop.</>}
        {na > 0 && <> {na} do not arise for a {inv.modality.replace("_", " ")} and are marked n/a rather than
          missing - an antibody has no reactive metabolite and no QSAR model, and listing those as gaps
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
    /* ON A PLATE, the same one the evidence stage uses. A heading, four labels, three
       paragraphs of explanation and a basis line were sitting directly on a live scene.
       `.glass` is the product's one surface that carries a ground, and this is the
       screen where failing to read a sentence costs a reviewer their answer rather than
       their patience - the fields already made that argument for themselves further
       down in app.css, and the prose around them had no equivalent. */
    <section className="glass">
      <h2>Your position</h2>
      <p className="muted">
        Sealed the moment you submit, and you cannot change it. Nobody sees it - and you
        see nobody - until everyone has answered.
      </p>

      {/* `.field` and `.choice`, which is what the rest of the product's forms are
          built from - see "Open a case". This was `.rail` and `.persona`, two classes
          the redesign dropped and nothing replaced, so the three-way call button - the
          single most important control in the product - rendered as three words run
          together with no gap, no border and no pressed state. `.choice` carries the
          layout and `button.ghost` carries the states, including aria-pressed. */}
      <div className="field">
        <label htmlFor="call">Your call</label>
        <div className="choice" id="call">
          {(["advance", "do_not_advance", "cannot_conclude"] as const).map((c) => (
            <button key={c} type="button" className="ghost" aria-pressed={call === c} onClick={() => setCall(c)}>
              {CALL_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="why">Why. This is the part a later reader needs.</label>
        <textarea id="why" value={reasoning} onChange={(e) => setReasoning(e.target.value)}
          placeholder="The transporter result is real, but this assay overcalls for this class and the margin is 40x." />
      </div>

      {/* The explanation belongs to the label above it, so it is a `.hint` inside the
          field rather than a paragraph floating between two controls - the same shape
          every field on the new-case form uses. A `.small.muted` here sat at the same
          rhythm as the body copy and read as prose about the page rather than as
          instructions for the control underneath it. */}
      <div className="field">
        <label>What you are relying on, from this case</label>
        <span className="hint">
          A selection, not free text. A selected citation points at a specific object, so
          the check is arithmetic - and a typed one would have to be run through a model to
          decide whether it referred to anything real, which would put a model in charge of
          which dissent counts.
        </span>
      </div>
      {findings.map((f) => (
        <div className="cite" key={f.id}>
          <input type="checkbox" id={f.id} checked={cited.includes(f.id)} onChange={() => toggle(f.id)} />
          <label htmlFor={f.id} style={{ margin: 0, fontWeight: 400 }}>
            <strong>{f.label}</strong> <span className="muted">- asserts {f.assertion}</span>
            <div className="small muted">{f.detail}</div>
          </label>
        </div>
      ))}

      <div className="field">
        <label htmlFor="claim">Relying on something outside these documents? State it.</label>
        <span className="hint">
          Not a weaker citation - an assertion not yet in evidence, and useful because
          somebody can go and check it. It joins the missing-evidence list rather than
          evaporating.
        </span>
        <input id="claim" type="text" value={claim} onChange={(e) => setClaim(e.target.value)}
          placeholder="This assay overcalls for phenothiazines." />
        <input type="text" value={source} onChange={(e) => setSource(e.target.value)}
          aria-label="Source for the outside claim, optional"
          placeholder="Source, if you have one (optional)" />
      </div>

      {/* What the form is about to do, immediately above the button that does it. */}
      <p className="small basis-line">
        Your position will be recorded as <span className={`basis ${basis}`}>{basis}</span>
        {basis === "unsupported" && " - which is allowed, is never deleted, and is visible to whoever signs."}
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
  // Whether the VIEWER has sealed anything, which is not the same question as whether
  // this screen has something to show. A convener never seals - access.ts: "an owner
  // who is not also a participant convenes and signs but does not hold an opinion on
  // the record" - so "Sealed." was a false statement to exactly the person who has the
  // only control on this screen.
  const sealed = view.own !== null;
  return (
    // The other half of the position tab, and it carries the plate for the same reason
    // the form does: this is what that tab becomes once you have sealed, so a ground on
    // only one of them would disappear at the moment you submit.
    <section className="glass">
      <h2>{sealed ? "Sealed. Waiting for the others." : "Waiting for the panel."}</h2>
      <p className="muted">
        This screen shows one bit per person, and that is all the server will send: not
        their call, not their reasoning, not a running tally. A tally drags a room exactly
        as hard as the positions would.
        {!sealed && " You convene this case and do not answer it, so there is nothing of yours here."}
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
              - their absence is written into the record.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** -------------------------------------------------------------------- reveal */
export function Reveal({ view, unanimity, nameOf, seats }: {
  view: BlindView; unanimity: UnanimityReport | null; nameOf: (id: string) => string;
  /** Participant id -> seat, from the roster. Same allocation the panel above shows. */
  seats: Record<string, number>;
}): ReactElement {
  const revealed = view.revealed ?? [];
  // Over the people actually on this screen. This is the screen where "who said
  // what" carries the most weight, so two reviewers sharing initials have to be
  // told apart here even if the roster panel is not open beside it.
  const collisions = collidingInitials(revealed.map((p) => nameOf(p.participantId)));

  return (
    <section>
      <h2>Every position, at once</h2>
      {revealed.map((p) => (
        <div className="pos" key={p.participantId}>
          <div className="pos-head">
            <Reviewer name={nameOf(p.participantId)} seat={seats[p.participantId] ?? null}
              disambiguate={collisions.has(initials(nameOf(p.participantId)))} />
            <strong>{nameOf(p.participantId)}</strong>
            <span>{CALL_LABEL[p.call]}</span>
            <span className={`basis ${basisOf(p)}`}>{basisOf(p)}</span>
          </div>
          <p>{p.reasoning}</p>
          {p.citedFindingIds.length > 0 && <div className="mono muted">cites: {p.citedFindingIds.join(", ")}</div>}
          {p.external.map((e, i) => (
            <div className="small muted" key={i}>outside this case: “{e.claim}”{e.source !== undefined && ` - ${e.source}`}</div>
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
/**
 * PROSE GOES THROUGH `Markdown`, the same renderer the ask answers use.
 *
 * The adjudicator prompt does not request Markdown and this does not add such a
 * request: `SHAPE_ADJUDICATION` is 16,000 tokens measured with zero truncation across
 * ten runs, and inviting longer prose would spend that headroom on decoration. This
 * is the defensive half only. Models emit `**bold**`, hyphen bullets and blank-line
 * paragraphs unprompted, and a raw `<p>` renders every one of them as literal syntax
 * in the middle of a safety verdict. `Markdown` builds React elements from strings
 * and never touches innerHTML, so it is strictly safer than the interpolation it
 * replaces as well as strictly more readable.
 */
export function Verdict({ adjudication, source, consensus = null, signature = null, onSign }: {
  adjudication: Adjudication; source: "stub" | "live";
  consensus?: Consensus | null;
  /** Present once the case is signed, which closes the record: the form becomes the
   *  fact of who signed and what they said. */
  signature?: Signature | null;
  onSign: (agrees: boolean, reason: string) => void;
}): ReactElement {
  const [reason, setReason] = useState("");
  const [agrees, setAgrees] = useState(true);

  const verdict = adjudication.consequence.verdict;

  return (
    <section className="verdict">
      <div className="verdict-group">
        <h2>The adjudication</h2>
        {source === "stub" && (
          <div className="stub">
            STUB - no model was called. The wiring is real; the words below are not a
            judgment about this compound and must not be quoted as one.
          </div>
        )}
      </div>

      <div className="halves">
        <div className="half">
          <span className="eyebrow">Mechanism</span>
          <p className="answer">{adjudication.mechanism.present ? "Present" : "Not established"}</p>
          <p className="ask">Is there a route to liver injury?</p>
          {adjudication.mechanism.pathway !== null && (
            <div className="md"><Markdown>{adjudication.mechanism.pathway}</Markdown></div>
          )}
        </div>

        <div className={`half ${CALL_TONE[verdict] ?? ""}`}>
          <span className="eyebrow">Consequence</span>
          <p className="answer">{CALL_LABEL[verdict] ?? verdict}</p>
          <p className="ask">Is it severe enough to stop?</p>
          <div className="md"><Markdown>{adjudication.consequence.reasoning}</Markdown></div>
          {/* A verdict that only two of three runs reached is a different object from
              one they all reached, and this is the only place a reader could learn
              which they are holding. Silent on a unanimous run: an unbroken "3 of 3"
              on every case teaches people to stop reading the line that matters. */}
          {consensus !== null && consensus.split && (
            <p className="split-note">
              Split across runs: {consensus.votes} of {consensus.runs} agreed
              ({Object.entries(consensus.distribution)
                .map(([v, n]) => `${CALL_LABEL[v] ?? v} ${n}`).join(", ")}).
              The most cautious answer wins a tie.
            </p>
          )}
        </div>
      </div>

      <div className="verdict-group">
        <h3>Every rule, answered</h3>
        <div className="inv">
          {adjudication.ruleDisclosure.map((d) => (
            <div key={d.ruleId} className="rule-row">
              <div className="rule-key">
                <span className="ref">{d.ruleId}</span>
                <span className={`badge ${POSITION_TONE[d.position] ?? ""}`}>
                  {POSITION_LABEL[d.position] ?? d.position}
                </span>
              </div>
              <div className="md"><Markdown>{d.reasoning}</Markdown></div>
            </div>
          ))}
        </div>
      </div>

      {adjudication.missing.length > 0 && (
        <div className="verdict-group">
          <h3>Still unanswered</h3>
          <div className="inv">
            {adjudication.missing.map((m, i) => (
              <div key={i} className="gap-row">
                <span className="field">{m.field}</span>
                <span className="blocks">{withoutPromptLabel(m.whyItMatters)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {adjudication.nextExperiment !== null && (
        <div className="verdict-group">
          <h3>What would settle it</h3>
          <div className="md"><Markdown>{adjudication.nextExperiment}</Markdown></div>
        </div>
      )}

      {signature !== null ? (
        <div className="verdict-group">
          <h2>Signed</h2>
          <p>
            <strong>{signature.agreesWithAdjudication ? "Agreed with" : "Overrode"} this adjudication.</strong>
          </p>
          {signature.reason.trim() !== "" && <div className="md"><Markdown>{signature.reason}</Markdown></div>}
        </div>
      ) : (
        <div className="verdict-group">
          <h2>Sign</h2>
          <p className="muted">
            One named person. No quorum, no threshold, no consensus mechanism - a committee
            advises and an individual decides, and you may override this adjudication.
          </p>
          {/* The same pair of dropped classes as the call control above, and the same
              replacement: signing off on an adjudication is a two-way choice and it was
              rendering as "AgreeOverride". */}
          <div className="choice">
            <button type="button" className="ghost" aria-pressed={agrees} onClick={() => setAgrees(true)}>Agree</button>
            <button type="button" className="ghost" aria-pressed={!agrees} onClick={() => setAgrees(false)}>Override</button>
          </div>
          <label htmlFor="reason">{agrees ? "Anything to add (optional)" : "Why you are overriding - required"}</label>
          <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="primary" disabled={!agrees && reason.trim() === ""} onClick={() => onSign(agrees, reason)}>
            Sign the record
          </button>
        </div>
      )}
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
