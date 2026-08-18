import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { PageHead, Section } from "./Layout.js";
import { Markdown } from "./markdown.js";
import { href } from "./router.js";
import { stageOf } from "./stage.js";
import { api, ApiError, uploadDocument, type AskAnswer, type CaseListing, type CaseSummary, type LibrarySource, type Person } from "./api.js";

/**
 * The composition pages: authentication, the dashboard, case creation, the library
 * and ask. The working screens - inventory, position form, reveal, verdict, audit,
 * documents - stay in screens.tsx, where they carry behaviour and tests. Moving them
 * for the sake of a folder layout would churn a passing suite for nothing.
 *
 * THE METHOD PAGE USED TO BE HERE. It explained what the record proves and what it
 * does not; the landing page now makes that argument at length and in the same
 * palette, so the product links out to it rather than keeping a second copy that
 * would have to be corrected twice.
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

/**
 * DERIVED FROM `stageOf`, not from the status fields a second time.
 *
 * This used to read the fields itself - `c.submitted < c.of && !c.isOwner` for "yours" -
 * and that inference was wrong in one case that mattered: three of four answered with the
 * reader among them is `submitted < of`, so an already-answered participant kept finding
 * their case under "Needs your position" on the screen built to say what was waiting on
 * them. `youSubmitted` is on the listing now and `stageOf` reads it.
 *
 * Going through `stageOf` rather than reading the same field here is what stops the pile
 * and the card's own tag from disagreeing. A card labelled "Your position" filed under
 * "In progress" would be worse than either being wrong on its own, because each would
 * look like evidence the other was the mistake.
 */
export function bucketOf(c: CaseListing): Bucket {
  const { label, yours } = stageOf(c);
  if (label === "Report") return "closed";
  if (label === "Your position") return "yours";
  // The panel is done and the convener is the only person who can move it. `yours` is
  // already "is this the reader's move", so this asks nothing about ownership itself.
  if (label === "Reveal & verdict" || label === "Record") return yours ? "sign" : "waiting";
  // "Awaiting the panel", and any status this bundle does not recognise. Neither is the
  // reader's to act on, and a stage the client cannot name is never worth sending
  // somebody to look at.
  return "waiting";
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
        actions={<a className="cta" href={href({ name: "new" })}>New case</a>}
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
  const stage = stageOf(c);
  return (
    <a className="card" href={href({ name: "case", caseId: c.caseId })}>
      <div className="eyebrow">{c.isOwner ? "You convene this" : "You are on the panel"}</div>
      <h3>{c.compoundLabel}</h3>
      <div className="row">
        {/**
          * THE STAGE, NOT THE STATUS. This badge printed `c.status` - `open`, `locked`,
          * `adjudicated`, `signed` - which are the state machine's names from
          * services/api/deliberation.ts, chosen for its guards rather than for a reader.
          * `locked` was the one that cost most: it does not mean the case is closed, it
          * means the panel has finished and the verdict is waiting to be run, so the
          * status that was a call to action wore the word that sounds like the opposite.
          *
          * `stageOf` names it in the vocabulary the case's own tab strip already uses, so
          * the dashboard stops speaking a second language about the same objects.
          */}
        <span className={`badge ${tone}`}>{stage.label}</span>
        {/* Who has answered, never what they said - and only while the number can still
            change. `4/4` beside a signed case is true of every case that got that far,
            so it carries nothing and competes with the label for the same glance. */}
        {stage.pip === undefined
          ? null
          : <span className="tiny muted mono">{c.submitted} of {c.of} answered</span>}
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

      <form onSubmit={(e) => { void submit(e); }}>
        {/* NOT STACKED. Opening a case is one decision made of three independent parts -
            what the compound is, who answers, and what they read - and none of them is a
            step that waits on the one above it. The first two share the top row and the
            documents panel runs full width beneath; `.case-open` in app.css carries the
            track sizing and the single breakpoint where the pair unstacks. */}
        <div className="case-open">
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

          <div className="panel">
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
          <div className="panel case-docs">
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
  //
  // DERIVED, NOT SEEDED, AND THE DIFFERENCE WAS THE WHOLE PAGE. This was
  // `useState(() => ...library.find(...))`, whose initialiser runs on the FIRST render
  // only - and on the first render `library` is `[]`, because App.tsx fetches it after
  // mount. So `source` was fixed at "" for the life of the page while the `<select>`
  // showed Turalio: a select whose React value matches no option falls back to
  // displaying option zero, and reading `.value` off the DOM returns that option's
  // value. Every readout agreed and the state underneath was empty.
  //
  // What that cost: `send` and `summarise` both open with `if (... || source === "")
  // return`, so every suggestion chip, the summary button and the Ask button did
  // NOTHING AT ALL until the reader happened to change the dropdown by hand. Silently -
  // no request, no error, no pending turn. The page was inert on arrival and looked
  // completely normal.
  //
  // A `useEffect` that adopts the first document once the library lands would fix it
  // and would reintroduce the same class of bug the moment the two fall out of step
  // again. Deriving cannot: what the reader picked is state, what is SELECTED is a
  // function of that and the list, and a pick that no longer names a real document
  // (the library reloaded, an entry vanished) falls back on its own.
  const [picked, setPicked] = useState<string | null>(null);
  const preferred = (library.find((s) => s.askable) ?? library[0])?.name ?? "";
  const source = picked !== null && library.some((s) => s.name === picked) ? picked : preferred;
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
  const pick = (id: string): void => { setPicked(id); setTurns([]); setError(null); };

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
        lede="Every answer comes from one of the library's regulatory reviews and names the page it rests on." />

      {/* THE SCOPE OF THE PAGE, ON ITS OWN ROW. This was an action in the page head's
          right corner, where it rendered as a 565px native select floating below the
          lede with nothing to align to - the widest object on the screen, in the slot
          reserved for whatever a page happens to offer. It is not an action. Every
          question, every answer and every citation below it is about ONE document, and
          changing it clears the thread; that is the page's subject, so it gets a row
          above the conversation rather than a corner beside the title.

          The summary sits here for the same reason. It is an action on the DOCUMENT,
          not a message in the thread, and it spent this whole time in the composer's
          chip row wearing primary styling next to six ghost suggestions - two button
          languages in one wall, with the real send button greyed out beneath them. */}
      <div className="ask-scope">
        <div className="ask-scope-pick">
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
        <div className="ask-scope-meta">
          {/* The file, not the path. The label above already says which review this is;
              this line says which artefact on disk it was read from, which is the thing
              a reader checks when an answer surprises them.

              AN ENTRY WITH NO SOURCE PDF CARRIES "-", not an empty string - a case
              assembled from extracted findings has no file, and the server writes a
              dash rather than a name. Printed literally that is a stray hyphen floating
              in the bar with nothing to explain it; the refusal panel below already
              says why there is no document. */}
          {selected !== undefined && selected.document.includes("/") && (
            <span className="tiny mono">{selected.document.split("/").pop()}</span>
          )}
          {refusal === null && (
            <button className="ghost" disabled={busy} onClick={() => void summarise()}>
              {SUMMARY_LABEL}
            </button>
          )}
        </div>
      </div>

      {refusal !== null && (
        <div className="empty">
          <h3>This document cannot be searched</h3>
          {/* The refusal verbatim. `split_review.py` refuses rather than trimming by
              hand, and a paraphrase here would soften the one measurement that made
              the original replay plan impossible. */}
          <p className="muted">{refusal}</p>
          {/* Same guard as the scope bar: "-" is the server's way of saying there is no
              file, and the sentence above has already said so in words. */}
          {selected !== undefined && selected.document.includes("/") && (
            <p className="tiny muted">{selected.document}</p>
          )}
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
                        {/* THE ANSWER IS STRUCTURED PROSE AND WAS BEING DRAWN AS ONE
                            SENTENCE. A summary measured off this deployment is 5,953
                            characters with no newline in it; a question's answer runs
                            to a dozen labelled sections inside a single paragraph.
                            `services/api/ask.ts` now asks for the structure and this
                            renders it - neither half is any use alone. */}
                        <div className="md">
                          <Markdown>{t.answer.answer}</Markdown>
                        </div>
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
                        {/* A refusal says WHAT is missing and is often a list of it. */}
                        <div className="md muted"><Markdown>{t.answer.answer}</Markdown></div>
                      </>}
                </div>
              )}
          </div>
        ))}
        <div ref={foot} />
      </div>

      {/* A COLD START AID, AND NO LONGER PART OF THE COMPOSER. Six full sentences
          wrapped to three rows of buttons were the bulk of the box a reader was meant
          to type into, sharing it with a primary-styled summary button and a greyed-out
          send. They are not controls of the composer; they are a way in before there is
          a thread, so they sit above it and leave when they are spent. */}
      {turns.length === 0 && (
        <div className="ask-start">
          <p className="tiny mono">Or start with one of these</p>
          <div className="chips">
            {SUGGESTED.map((q) => (
              <button key={q} className="ghost" disabled={busy} onClick={() => void send(q)}>{q}</button>
            ))}
          </div>
        </div>
      )}

      <div className="composer">
        {error !== null && <div className="err">{error}</div>}
        <div className="composer-row">
          <label className="sr-only" htmlFor="ask-q">Your question</label>
          {/* NOT disabled while busy, and that is the whole point of this row. Typing
              and SENDING are different acts: the thread is one conversation, so a
              second question may not go out while the first is unanswered - but the
              moment a reader has thought of the next thing to ask is exactly while
              they are waiting, and a summary keeps them waiting eighty seconds. A
              disabled box also survives its cause: a request that never settles used
              to leave the composer dead until the page was reloaded. */}
          <textarea id="ask-q" rows={2} value={question}
            onChange={(e) => setQuestion(e.target.value)}
            // Enter sends, Shift+Enter is a newline. Ctrl+Enter keeps working because
            // it was the documented key here before this page became a thread.
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (e.shiftKey) return;
              e.preventDefault();
              // Said, not swallowed. A keystroke that does nothing and explains
              // nothing is indistinguishable from a broken input.
              if (busy) { setError("Still reading the last question - this will send when that answer arrives."); return; }
              void send(question);
            }}
            placeholder={turns.length === 0
              ? "What exposure margin does the report give, and on what basis?"
              : "Ask a follow-up..."} />
          <button className="primary" disabled={busy || question.trim() === ""} onClick={() => void send(question)}>
            {busy ? "Reading..." : "Ask"}
          </button>
        </div>
        {/* TWO SENTENCES, NOT ONE PARAGRAPH. This was a single wrapped block that mixed
            a search tip with a keyboard map, so neither was read. The tip is about how
            to write a question and stays on the left with the box; the keys are a
            property of the control and sit with the button that shares their job. */}
        <div className="composer-foot">
          <span className="hint">
            The search is over the words on the page - naming the study, finding or
            number you want helps.
          </span>
          <span className="keys">
            {turns.length > 0 && (
              <button className="link" disabled={busy} onClick={() => { setTurns([]); setError(null); }}>
                Clear thread
              </button>
            )}
            <span className="tiny mono"><kbd>Enter</kbd> sends · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line</span>
          </span>
        </div>
      </div>
      </>}
    </>
  );
}
