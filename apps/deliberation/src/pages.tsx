import { useState, type FormEvent, type ReactElement } from "react";
import { PageHead, Section } from "./Layout.js";
import { href } from "./router.js";
import { api, ApiError, type CaseListing, type CaseSummary, type Person } from "./api.js";

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
        lede="Name the compound and the people who will answer. You will add the evidence next."
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

        <div className="btn-row">
          <button className="primary" type="submit" disabled={busy || compoundLabel.trim() === "" || selected.length === 0}>
            {busy ? "Opening…" : "Open case"}
          </button>
          <a href={href({ name: "dashboard" })}><button className="ghost" type="button">Cancel</button></a>
        </div>
        {selected.length === 0 && <div className="hint">Pick at least one person. One person deciding alone does not need this.</div>}
        {error !== null && <div className="err">{error}</div>}
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
