import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { PageHead, Section } from "./Layout.js";
import { href } from "./router.js";
import { api, ApiError, uploadDocument, type AskAnswer, type CaseListing, type CaseSummary, type LibrarySource, type Person } from "./api.js";

/**
 * The composition pages: authentication, the dashboard, case creation, and the
 * method explainer. The working screens - inventory, position form, reveal,
 * verdict, audit, documents - stay in screens.tsx, where they carry behaviour and
 * tests. Moving them for the sake of a folder layout would churn a passing suite
 * for nothing.
 */

/** ---------------------------------------------------------- authentication */
export function AuthPage({ onSignedIn }: { onSignedIn: (token: string, user: Person) => void }): ReactElement {
  const [mode, setMode] = useState<"in" | "up" | "forgot" | "reset">("in");
  const [resetToken, setResetToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "forgot") {
        const r = await api.requestReset(email);
        setNotice(r.detail);
        setMode("reset");
        setBusy(false);
        return;
      }
      if (mode === "reset") {
        await api.resetPassword(resetToken, password);
        setNotice("Password changed, and every session was signed out. Sign in with the new one.");
        setMode("in");
        setPassword("");
        setBusy(false);
        return;
      }
      if (mode === "up") await api.register(email, displayName, password);
      const r = await api.login(email, password);
      onSignedIn(r.token, r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <aside className="auth-brand">
        <span className="mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <h1>Decide before you know, and leave a record of how.</h1>
        <p>
          Arbiter runs the safety review a drug programme has to hold anyway - but
          each person answers privately first, so the room produces four independent
          readings instead of one confident one.
        </p>
        <ul>
          <li><span className="num">01</span><span><b>Everyone reads the same evidence.</b> A neutral inventory of what the documents contain, and what they do not.</span></li>
          <li><span className="num">02</span><span><b>Positions are sealed.</b> Nobody sees another answer until all are in, and the record can prove none was edited afterwards.</span></li>
          <li><span className="num">03</span><span><b>Agreement gets checked too.</b> When a room agrees about a question nobody tested, it says so.</span></li>
          <li><span className="num">04</span><span><b>One named person signs.</b> No quorum, no vote. Dissent is kept.</span></li>
        </ul>
      </aside>

      <div className="auth-form">
        <div>
          <div className="tabs" role="group" aria-label="Sign in or create an account">
            <button type="button" aria-pressed={mode === "in"} onClick={() => { setMode("in"); setError(null); }}>Sign in</button>
            <button type="button" aria-pressed={mode === "up"} onClick={() => { setMode("up"); setError(null); }}>Create account</button>
          </div>

          <h2>
            {mode === "in" ? "Welcome back"
              : mode === "up" ? "Create your account"
                : mode === "forgot" ? "Reset your password"
                  : "Enter your reset token"}
          </h2>
          <p className="hint">
            {mode === "in" ? "Your session lasts twelve hours and is not stored in this browser - closing the tab signs you out."
              : mode === "up" ? "Anyone can create an account. You will be able to open cases and be added to other people's."
                : mode === "forgot" ? "Nothing is emailed from this deployment. A token is issued to whoever runs the server, and they hand it to you."
                  : "Paste the token you were given, and choose a new password. Every existing session is signed out."}
          </p>
          {notice !== null && <div className="note" style={{ marginTop: 16 }}>{notice}</div>}

          <form onSubmit={(e) => { void submit(e); }}>
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input id="email" type="email" autoComplete="username" required
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>

            {mode === "reset" && (
              <div className="field">
                <label htmlFor="rt">Reset token</label>
                <input id="rt" type="text" required value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)} placeholder="64 hexadecimal characters" />
              </div>
            )}

            {mode === "up" && (
              <div className="field">
                <label htmlFor="name">Your name and role</label>
                <input id="name" type="text" autoComplete="name"
                  value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="A. Silva (toxicology)" />
                <span className="hint">Shown beside your positions, so a later reader knows who was in the room.</span>
              </div>
            )}

            {mode !== "forgot" && (
            <div className="field">
              <label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</label>
              <input id="password" type="password" required
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                value={password} onChange={(e) => setPassword(e.target.value)} />
              {(mode === "up" || mode === "reset") && (
                <span className="hint">
                  At least 12 characters. No symbol or digit rules - length is what
                  actually protects a password, and composition rules just produce
                  <span className="mono"> Password1!</span>
                </span>
              )}
            </div>
            )}

            <div className="btn-row">
              <button className="primary" type="submit"
                disabled={busy || email === "" || (mode !== "forgot" && password === "") || (mode === "reset" && resetToken === "")}>
                {busy ? "Working…"
                  : mode === "in" ? "Sign in"
                    : mode === "up" ? "Create account"
                      : mode === "forgot" ? "Request a reset token"
                        : "Set new password"}
              </button>
              {mode === "in" && (
                <button type="button" className="link" onClick={() => { setMode("forgot"); setError(null); setNotice(null); }}>
                  Forgotten your password?
                </button>
              )}
              {(mode === "forgot" || mode === "reset") && (
                <button type="button" className="link" onClick={() => { setMode("in"); setError(null); }}>
                  Back to sign in
                </button>
              )}
            </div>
            {error !== null && <div className="err">{error}</div>}
          </form>
        </div>
      </div>
    </div>
  );
}

/** -------------------------------------------------------------- dashboard */

/** What this account has to DO about a case. The dashboard is organised by this and
 *  not by date, because "what is waiting on me" is the only question a person opens
 *  a dashboard to answer. */
export type Bucket = "yours" | "waiting" | "sign" | "closed";

export function bucketOf(c: CaseListing): Bucket {
  if (c.status === "signed") return "closed";
  if (c.status === "open") return c.submitted < c.of && !c.isOwner ? "yours" : "waiting";
  // Locked or adjudicated: the panel is done and the decision owner is the only
  // person who can move it.
  return c.isOwner ? "sign" : "waiting";
}

const BUCKETS: { key: Bucket; title: string; blurb: string }[] = [
  { key: "yours", title: "Needs your position", blurb: "Answer before you can see anyone else's." },
  { key: "sign", title: "Ready for your decision", blurb: "The panel has answered. You convene these." },
  { key: "waiting", title: "In progress", blurb: "Waiting on other people." },
  { key: "closed", title: "Signed", blurb: "Closed, and kept in full." },
];

export function Dashboard({ mine, me }: { mine: CaseListing[]; me: Person }): ReactElement {
  const grouped = new Map<Bucket, CaseListing[]>();
  for (const c of mine) {
    const b = bucketOf(c);
    grouped.set(b, [...(grouped.get(b) ?? []), c]);
  }
  const count = (b: Bucket): number => grouped.get(b)?.length ?? 0;
  const firstName = me.displayName.split(/[\s.]/)[0] ?? "there";

  return (
    <>
      <PageHead
        eyebrow="Dashboard"
        title={`Good to see you, ${firstName}`}
        lede="Cases you are named on, ordered by what they need from you."
        actions={<a className="primary" href={href({ name: "new" })}
          style={{ textDecoration: "none", display: "inline-block", padding: "12px 24px", borderRadius: 6, background: "var(--accent)", color: "#fff", fontWeight: 650, fontSize: 14.5 }}>
          New case
        </a>}
      />

      <div className="tiles" style={{ marginBottom: 32 }}>
        <div className={`tile${count("yours") > 0 ? " act" : ""}`}>
          <b>{count("yours")}</b><span className="small muted">Awaiting your position</span>
        </div>
        <div className={`tile${count("sign") > 0 ? " act" : ""}`}>
          <b>{count("sign")}</b><span className="small muted">Ready for your decision</span>
        </div>
        <div className="tile"><b>{count("waiting")}</b><span className="small muted">In progress</span></div>
        <div className="tile"><b>{count("closed")}</b><span className="small muted">Signed</span></div>
      </div>

      {mine.length === 0 ? (
        <div className="empty">
          <h3>No cases yet</h3>
          <p className="muted">
            Open a case for a compound you are deciding about, or start from one of the
            prepared cases in the library - each is built from a real regulatory review.
          </p>
          <div className="btn-row" style={{ marginTop: 0, justifyContent: "center" }}>
            <a href={href({ name: "new" })}><button className="primary">Create a case</button></a>
            <a href={href({ name: "cases" })}><button className="ghost">Browse the library</button></a>
          </div>
        </div>
      ) : (
        <div className="stack-l">
          {BUCKETS.filter((b) => count(b.key) > 0).map((b) => (
            <Section key={b.key} title={b.title} count={`${count(b.key)}`}>
              <p className="small muted" style={{ marginTop: -8 }}>{b.blurb}</p>
              <div className="grid">
                {(grouped.get(b.key) ?? []).map((c) => <CaseCard key={c.caseId} c={c} />)}
              </div>
            </Section>
          ))}
        </div>
      )}
    </>
  );
}

function CaseCard({ c }: { c: CaseListing }): ReactElement {
  const tone = c.status === "signed" ? "go" : c.status === "open" ? "open" : "accent";
  return (
    <a className="card" href={href({ name: "case", caseId: c.caseId })}>
      <div className="eyebrow">{c.isOwner ? "You convene this" : "You are on the panel"}</div>
      <h3>{c.compoundLabel}</h3>
      <div className="row">
        <span className={`badge ${tone}`}>{c.status}</span>
        {/* Who has answered, never what they said. */}
        <span className="tiny muted mono">{c.submitted} of {c.of} answered</span>
      </div>
    </a>
  );
}

/** ------------------------------------------------------------- new case */
export function NewCasePage({ token, people, onCreated }: {
  token: string;
  people: Person[];
  onCreated: (caseId: string) => void;
}): ReactElement {
  const [compoundLabel, setLabel] = useState("");
  const [context, setContext] = useState("");
  const [modality, setModality] = useState<"small_molecule" | "biologic">("small_molecule");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [rejected, setRejected] = useState<{ name: string; why: string }[]>([]);
  // Held so the "continue anyway" button after a refusal knows where to go.
  const [createdId, setCreatedId] = useState("");

  const toggle = (email: string): void =>
    setSelected((s) => (s.includes(email) ? s.filter((x) => x !== email) : [...s, email]));

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.createCase(token, {
        compoundLabel, context, modality, participantEmails: selected,
      });

      // UPLOADED AFTER THE CASE EXISTS, because a document belongs to a case and there
      // is nowhere to put one before. The case is already open at this point, so a
      // refused PDF is not a lost case - it is a case with one fewer document, and the
      // reader is told which and why rather than being bounced back to an empty form.
      //
      // SEQUENTIAL, not Promise.all. Each upload is up to 80 MB and every one runs
      // measure_pdf.py server-side; firing five at once buys nothing and makes the
      // failure ambiguous when one of them is the scanned document.
      setCreatedId(r.case.caseId);
      const refusals: { name: string; why: string }[] = [];
      for (const f of files) {
        setUploading(f.name);
        try {
          await uploadDocument(token, r.case.caseId, f);
        } catch (err) {
          refusals.push({ name: f.name, why: err instanceof ApiError ? err.message : String(err) });
        }
      }
      setUploading(null);

      // A refusal HOLDS THE SCREEN rather than navigating past it. Two of the first
      // five documents collected for this project were unusable and neither failure
      // was visible without measuring - a message that flashes past on the way to the
      // case tab is a measurement nobody reads.
      if (refusals.length > 0) {
        setRejected(refusals);
        setBusy(false);
        return;
      }

      onCreated(r.case.caseId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        crumb={<><a href={href({ name: "dashboard" })}>Dashboard</a><span>›</span><span>New case</span></>}
        title="Open a case"
        lede="Name the compound, the people who will answer, and the study documents. You can add more evidence afterwards."
      />

      <form onSubmit={(e) => { void submit(e); }} style={{ maxWidth: 720 }}>
        <div className="panel">
          <div className="field">
            <label htmlFor="compound">Compound</label>
            <input id="compound" type="text" required value={compoundLabel}
              onChange={(e) => setLabel(e.target.value)} placeholder="TAK-994, or your internal code" />
          </div>

          <div className="field">
            <label htmlFor="context">The decision in front of you</label>
            <textarea id="context" value={context} onChange={(e) => setContext(e.target.value)}
              placeholder="Indication, how long patients take it, and what you are deciding. For example: chronic daily dosing in otherwise healthy adults; whether to advance toward first-in-human." />
            <span className="hint">
              Everyone reads this before answering. Dosing duration and how sick the
              patients are decide what counts as an acceptable signal, so say them.
            </span>
          </div>

          <div className="field">
            <label>Modality</label>
            <span className="hint" style={{ marginTop: 0 }}>
              Four of the twelve questions do not apply to an antibody - it has no
              reactive metabolite and no structure a QSAR model can score - so this
              decides which questions get asked at all.
            </span>
            <div className="choice">
              <button type="button" className="ghost" aria-pressed={modality === "small_molecule"}
                onClick={() => setModality("small_molecule")}>Small molecule</button>
              <button type="button" className="ghost" aria-pressed={modality === "biologic"}
                onClick={() => setModality("biologic")}>Biologic</button>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 24 }}>
          <div>
            <h3>Who answers</h3>
            <p className="hint">
              They need an account already. Nobody can see anyone else's answer until
              all of them are in - including you.
            </p>
          </div>

          {people.length === 0
            ? <p className="small muted">No other accounts yet. Ask a colleague to register first.</p>
            : people.map((p) => (
              <div className="cite" key={p.id}>
                <input type="checkbox" id={`p-${p.id}`} checked={selected.includes(p.email)}
                  onChange={() => toggle(p.email)} />
                <label htmlFor={`p-${p.id}`}>
                  <strong>{p.displayName}</strong>
                  <div className="tiny muted mono">{p.email}</div>
                </label>
              </div>
            ))}
        </div>

        {/* Documents, uploaded once the case exists - see `submit`. Optional here
            because a case can be opened before the package arrives, and forcing a PDF
            at this step would push people to open the case elsewhere and never come
            back. */}
        <div className="panel" style={{ marginTop: 24 }}>
          <div className="field">
            <label htmlFor="new-docs">Study documents (PDF)</label>
            <input id="new-docs" type="file" accept="application/pdf,.pdf" multiple disabled={busy}
              onChange={(e) => setFiles([...(e.target.files ?? [])])} />
            <span className="hint">
              Every document is measured before it is accepted. A scanned file with no
              extractable text is refused rather than stored as though it were readable.
              You can add more later.
            </span>
          </div>
          {files.length > 0 && (
            <div className="inv">
              {files.map((f) => (
                <div className="inv-row" key={f.name}>
                  <div className="state present">{Math.round(f.size / 1024 / 1024 * 10) / 10} MB</div>
                  <div className="tiny mono">{f.name}</div>
                </div>
              ))}
            </div>
          )}
          {uploading !== null && <div className="note">Uploading and measuring {uploading}…</div>}
        </div>

        <div className="btn-row">
          <button className="primary" type="submit" disabled={busy || compoundLabel.trim() === "" || selected.length === 0}>
            {busy ? "Opening…" : "Open case"}
          </button>
          <a href={href({ name: "dashboard" })}><button className="ghost" type="button">Cancel</button></a>
        </div>
        {selected.length === 0 && <div className="hint">Pick at least one person. One person deciding alone does not need this.</div>}
        {error !== null && <div className="err">{error}</div>}

        {/* A refused document HOLDS THE SCREEN. The case is already open at this point,
            so this is not a lost case - it is a case with one fewer document, and the
            measurement is the only thing that tells an uploader why while they still
            have the file. Two of the first five documents collected for this project
            were unusable and neither failure was visible without measuring. */}
        {rejected.length > 0 && (
          <div className="panel" style={{ marginTop: 16 }}>
            <p><strong>The case is open. These documents were refused:</strong></p>
            {rejected.map((r) => (
              <p className="small" key={r.name}>
                <span className="mono">{r.name}</span> - {r.why}
              </p>
            ))}
            <div className="btn-row">
              <button className="primary" type="button" onClick={() => onCreated(createdId)}>
                Continue to the case
              </button>
            </div>
          </div>
        )}
      </form>
    </>
  );
}

/** --------------------------------------------------------------- library */
export function LibraryPage({ catalogue, onOpen, busy }: {
  catalogue: CaseSummary[]; onOpen: (name: string) => void; busy: string | null;
}): ReactElement {
  return (
    <>
      <PageHead
        eyebrow="Prepared cases"
        title="Case library"
        lede="Each is built from a real regulatory review, with every finding transcribed by hand and carrying the page it came from."
      />
      <div className="note" style={{ marginBottom: 32 }}>
        Five documents were collected and <strong>two cannot be used</strong> - one is
        scanned images with no readable text, one turned out to be a labelling
        supplement with no toxicology in it. They are listed anyway: that ratio is the
        finding, and a library showing only what worked would imply every document works.
      </div>
      <div className="grid">
        {catalogue.map((c) => (
          <button className="card" key={c.name} onClick={() => onOpen(c.name)} disabled={busy !== null}>
            <span className={`badge ${c.usable ? "accent" : "stop"}`} style={{ alignSelf: "flex-start" }}>
              {c.usable ? "Ready" : "Refused"}
            </span>
            <h3>{c.label}</h3>
            <p className="small muted">{c.shape}</p>
            <div className="row">
              <span className="tiny muted">{busy === c.name ? "Opening…" : c.usable ? "Open this case →" : "See why it was refused →"}</span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/** ---------------------------------------------------------------- method */
export function MethodPage(): ReactElement {
  return (
    <>
      <PageHead eyebrow="How this works" title="Method"
        lede="What the product does, what the record proves, and what is not built yet." />

      <div className="stack-l">
        <Section title="The evidence comes before any opinion">
          <p>
            Everyone reads the same neutral account of the documents before anyone
            states a position. It is ordered by checklist identifier and by nothing
            else - ranking gaps by severity would push the room before it has spoken.
          </p>
          <p>
            A finding covers a question only when it <em>declares</em> that it does.
            Nothing is inferred from a plausible-looking label, because guessing fails
            silently in the dangerous direction: a question wrongly marked answered
            never appears on the missing-evidence list again.
          </p>
        </Section>

        <Section title="Blind submission, and how it is enforced">
          <p>
            While a case is open the server returns your own position and, for everyone
            else, one bit: submitted or not. Not their call, not their reasoning, not a
            running tally - a tally drags a room as hard as the positions themselves.
            It is enforced by not sending the data, never by a screen choosing not to
            render it.
          </p>
          <div className="note">
            <strong>What the record proves.</strong> Every position is hashed when you
            submit, and only that hash enters the log while the case is open. At reveal
            the published answer must match it, so it can be proved that no position was
            edited after sealing.
            <p style={{ marginTop: 10 }}>
              <strong>What it does not prove.</strong> That the server never read one
              early. No server-side scheme can, because the server holds the text in
              order to hand it to the adjudicator. Claiming otherwise would be the more
              dangerous error.
            </p>
          </div>
        </Section>

        <Section title="Two questions, never one">
          <p>
            <em>Is there a route by which this compound injures the liver?</em> and{" "}
            <em>is it severe enough to stop the programme?</em> are answered separately.
            Collapsing them is a measured defect, not a theoretical one: an earlier
            fixed-rule version flagged five compounds that are approved and widely
            prescribed, because a mechanism finding alone was allowed to produce
            “do not advance”.
          </p>
        </Section>

        <Section title="What is not built yet">
          <div className="scroll">
            <table>
              <thead><tr><th style={{ width: "34%" }}>Part</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td>Blind deliberation, sealing, audit</td><td>Working. No model is involved in any of it.</td></tr>
                <tr><td>Accounts, access control, document upload</td><td>Working. Running locally, with no transport encryption.</td></tr>
                <tr><td>Reading findings out of a PDF automatically</td><td><b>Not built.</b> Findings are entered by hand, each with its source page. When extraction lands it will pre-fill exactly that form for a human to approve.</td></tr>
                <tr><td>The adjudication itself</td><td><b>Unmeasured.</b> Without an API key it runs against a fixed stub, and every stub answer is labelled as one.</td></tr>
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}


/** ------------------------------------------------------------------- ask */
/**
 * Ask the documents. A search over one case's PDFs and a conversation about what
 * they say.
 *
 * WHY THIS IS NOT INSIDE A CASE. The case tab strip is a sequence - inventory, your
 * position, reveal, sign - and section 3.5 makes that order the information
 * architecture, because reading somebody else's call before writing your own is the
 * failure blind submission prevents. Asking what a document SAYS is not a step in that
 * sequence. It is a fact about the folder, which section 3.1 puts before positions
 * rather than after, and the same question is often asked across cases.
 *
 * FOLLOW-UPS ARE REAL, WITH A LIMIT. Prior turns are sent so "what about the second
 * one" resolves to something, but they are sent as CONTEXT FOR THE QUESTION, never as
 * evidence: passages are retrieved fresh for every turn and every claim must still
 * cite one. An answer may not rest on an earlier answer, because an earlier answer is
 * not a document.
 *
 * WHY IT READS AS A THREAD AND NOT AS BUBBLES. The whole transcript is sent and the
 * server says how much of it it read, so the conversation is real and the page shows
 * where the model's memory starts - a thread that silently forgot its own opening
 * would be worse than one that never remembered. What it does not borrow from a chat
 * client is the styling: BLUEPRINT has no pills, no tinted clouds and no avatars, so a
 * turn is a block of type with a rule down its side, and the citations under an answer
 * stay the full-width evidence rows they are everywhere else in this app. They are the
 * reason the surface exists; they do not get shrunk to fit a chat aesthetic.
 */
/** What a summary turn is called on screen. The server owns the actual instruction. */
const SUMMARY_LABEL = "Summarise this document";

const SUGGESTED = [
  "What exposure margin does the report give, and on what basis?",
  "What NOAEL was set, and in which study?",
  "What liver findings are reported, and at what doses?",
  "Which studies included a recovery or reversibility phase?",
  "What histopathology is described in the repeat-dose studies?",
  "What does the report say was not investigated?",
];

/** An exchange. A null answer is one in flight, which the thread shows as pending. */
interface AskTurn {
  question: string;
  answer: AskAnswer | null;
}

export function AskPage({ token, library }: {
  token: string;
  library: LibrarySource[];
}): ReactElement {
  // THE LIBRARY ONLY, and case folders are deliberately not offered here. A case is a
  // deliberation - an inventory, positions, a reveal, a signed record - and its
  // documents are read inside it, next to the findings transcribed from them. This
  // surface is for reading the library's regulatory reviews, which need no case and no
  // upload. `POST /api/cases/{id}/ask` still exists and still works; nothing on this
  // page points at it.
  //
  // The first document that can be searched, so the page opens on something usable
  // rather than on whichever entry happens to be first.
  const [source, setSource] = useState(
    () => (library.find((s) => s.askable) ?? library[0])?.name ?? "",
  );
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const foot = useRef<HTMLDivElement>(null);

  // Follows the conversation down as it grows. Depends on the turn COUNT rather than
  // on `turns`, so an answer landing in a turn already on screen does not yank the
  // page while somebody is reading the citations above it.
  useEffect(() => {
    if (turns.length > 0) foot.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length]);

  // Turns belong to the document they were asked of. Carrying them across a change of
  // source would put one compound's answers under another's name on screen, and would
  // feed them back as context for a question about a different document.
  const pick = (id: string): void => { setSource(id); setTurns([]); setError(null); };

  const send = async (q: string): Promise<void> => {
    const text = q.trim();
    if (text === "" || busy || source === "") return;
    setBusy(true); setError(null);
    // The whole thread, oldest first. The server windows it and reports what it read;
    // trimming here as well would mean two truncations that can disagree.
    const history = turns.flatMap((t) =>
      t.answer === null ? [] : [{ question: t.question, answer: t.answer.answer }]);
    setTurns((t) => [...t, { question: text, answer: null }]);
    setQuestion("");
    try {
      const answer = await api.askLibrary(token, source, text, history);
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer } : turn)));
    } catch (e) {
      // The pending turn goes with the failure. Leaving a question on screen with no
      // answer and an error underneath reads as an answer that has not arrived yet.
      setTurns((t) => t.slice(0, -1));
      setQuestion(text);
      setError(e instanceof ApiError ? e.message : "That question could not be answered just now.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * A summary is a different REQUEST, not a cleverly worded question.
   *
   * Retrieval picks eight pages by word overlap, and "give a summary of this document"
   * overlaps with nothing in particular, so the model was handed eight arbitrary pages
   * and correctly refused to call that a summary. This route sends the whole document
   * instead. It carries no history: a summary is of the document, not of the
   * conversation, and an earlier answer must never become an input to one.
   */
  const summarise = async (): Promise<void> => {
    if (busy || source === "") return;
    setBusy(true); setError(null);
    setTurns((t) => [...t, { question: SUMMARY_LABEL, answer: null }]);
    try {
      const answer = await api.summarise(token, source);
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer } : turn)));
    } catch (e) {
      setTurns((t) => t.slice(0, -1));
      setError(e instanceof ApiError ? e.message : "That document could not be summarised just now.");
    } finally {
      setBusy(false);
    }
  };

  // Where the model's memory begins. The newest answered turn states how many turns
  // preceded it in the window; everything before that point was on screen but not in
  // front of the model. Computed from the server's count alone.
  const answered = turns.map((t, i) => ({ t, i })).filter((x) => x.t.answer !== null);
  const newest = answered.at(-1);
  const remembersFrom = newest === undefined ? 0 : newest.i - newest.t.answer!.historyTurnsUsed;

  // WHY THE SELECTION CAN REFUSE. The reason was decided when the document was
  // ingested and it is the splitter's own sentence - "this is a scanned document" is a
  // fact about the file, not about the compound, and an empty search over it would say
  // the opposite. It must stop the question: asking anyway spends a model call to
  // produce "the documents do not contain that", which on screen is indistinguishable
  // from a real document that happens not to cover it.
  const selected = library.find((s) => s.name === source);
  const refusal = selected !== undefined && !selected.askable ? selected.reason ?? "" : null;

  if (library.length === 0) {
    return (
      <>
        <PageHead crumb={<span>Ask</span>} title="Ask the documents"
          lede="Answers come only from a document, and name the page they rest on." />
        <div className="empty">
          <h3>Nothing to ask yet</h3>
          <p className="muted">
            The library holds no readable document in this checkout. The approval-package
            PDFs are not committed to the repository - each is retrievable from
            accessdata.fda.gov or ema.europa.eu by the URL the spec records.
          </p>
          <a href={href({ name: "cases" })}><button className="primary">See the library</button></a>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead crumb={<span>Ask</span>} title="Ask the documents"
        lede="Every answer comes from one of the library's regulatory reviews and names the page it rests on."
        actions={
          <div className="field">
            <label htmlFor="ask-source">Which document</label>
            <select id="ask-source" value={source} onChange={(e) => pick(e.target.value)} disabled={busy}>
              {/* A refused document stays SELECTABLE, exactly as it does on the case
                  library: choosing it shows the splitter's reason. Disabling it would
                  leave somebody who came looking for tolcapone with a greyed-out name
                  and no explanation. */}
              {library.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.label}{s.askable ? "" : " - cannot be searched"}
                </option>
              ))}
            </select>
          </div>
        } />

      {refusal !== null && (
        <div className="empty">
          <h3>This document cannot be searched</h3>
          {/* The refusal verbatim. `split_review.py` refuses rather than trimming by
              hand, and a paraphrase here would soften the one measurement that made
              the original replay plan impossible. */}
          <p className="muted">{refusal}</p>
          <p className="tiny muted">{selected?.document}</p>
        </div>
      )}

      {refusal === null && <>
      <div className="note">
        This reports what the documents say. It does not judge the compound and will not
        tell you whether to advance - that is the panel's to state and the adjudication's
        to weigh. Nothing asked here is written to the case record.
      </div>

      <div className="thread">
        {turns.map((t, i) => (
          <div key={`${i}-${t.question}`}>
            {/* Drawn ABOVE the first remembered turn, so what is above the line is
                visibly out of the model's reach rather than quietly ignored. */}
            {i === remembersFrom && remembersFrom > 0 && (
              <div className="memory-line"><span>remembers from here</span></div>
            )}
            <div className="turn asked">
              <p>{t.question}</p>
            </div>
            {t.answer === null
              ? (
                <div className="turn said pending">
                  {/* A summary reads every page of a 178-page review and takes tens of
                      seconds. "Reading the documents..." under that wait looks stuck. */}
                  <p className="muted">
                    {t.question === SUMMARY_LABEL
                      ? "Reading the whole document - this takes a while..."
                      : "Reading the documents..."}
                  </p>
                </div>
              )
              : (
                <div className="turn said">
                  {t.answer.answerable
                    ? <>
                        <p>{t.answer.answer}</p>
                        <div className="inv">
                          {t.answer.citations.map((c) => (
                            <div className="inv-row" key={`${c.documentId}-${c.page}`}>
                              <div className="state present">p.{c.page}</div>
                              <div className="tiny mono">{c.filename}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    : <>
                        <p><strong>The documents do not answer this.</strong></p>
                        <p className="muted">{t.answer.answer}</p>
                      </>}
                </div>
              )}
          </div>
        ))}
        <div ref={foot} />
      </div>

      <div className="composer">
        {error !== null && <div className="err">{error}</div>}
        {/* The summary stays available at every point in the thread, unlike the
            suggestions: it is an action on the DOCUMENT, and wanting it after three
            questions is at least as likely as wanting it before any. */}
        <div className="chips">
          <button className="primary" disabled={busy} onClick={() => void summarise()}>{SUMMARY_LABEL}</button>
          {/* A cold start aid. Once a thread exists the reader has better questions
              than these, and six of them under every follow-up is furniture. */}
          {turns.length === 0 && SUGGESTED.map((q) => (
            <button key={q} className="ghost" disabled={busy} onClick={() => void send(q)}>{q}</button>
          ))}
        </div>
        <div className="composer-row">
          <label className="sr-only" htmlFor="ask-q">Your question</label>
          <textarea id="ask-q" rows={2} value={question} disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
            // Enter sends, Shift+Enter is a newline. Ctrl+Enter keeps working because
            // it was the documented key here before this page became a thread.
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (e.shiftKey) return;
              e.preventDefault();
              void send(question);
            }}
            placeholder={turns.length === 0
              ? "What exposure margin does the report give, and on what basis?"
              : "Ask a follow-up..."} />
          <button className="primary" disabled={busy || question.trim() === ""} onClick={() => void send(question)}>
            {busy ? "Reading..." : "Ask"}
          </button>
        </div>
        <div className="composer-foot">
          <span className="hint">
            The search is over the words on the page, so naming the study, finding or
            number you want helps. Enter sends, Shift+Enter for a new line.
          </span>
          {turns.length > 0 && (
            <button className="link" disabled={busy} onClick={() => { setTurns([]); setError(null); }}>
              Clear thread
            </button>
          )}
        </div>
      </div>
      </>}
    </>
  );
}
