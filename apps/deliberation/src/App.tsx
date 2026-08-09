import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  api, ApiError,
  type Adjudication, type AuditResult, type BlindView, type CaseSummary,
  type Finding, type Inventory, type Person, type Refusal, type StoredDocument,
  type UnanimityReport,
} from "./api.js";
import { Audit, Documents, InventoryPanel, PositionForm, Refused, Reveal, SignIn, Verdict, Waiting } from "./screens.js";
import "./app.css";

/**
 * The deliberation client.
 *
 * SIGN IN, THEN SWITCH SEATS. Identity is a bearer token issued against a password,
 * so a position is attributable to someone who proved they hold one. The token lives
 * in React state and never in localStorage: closing the tab signs you out, which is
 * the right behaviour for something that will hold unpublished safety data.
 *
 * The seat switcher is the demonstration device, and it is a real sign-in rather than
 * a client-side costume change. Blind submission is a property you have to WATCH to
 * believe: sign in as one person, submit, sign in as the next, and the first answer
 * is not on the screen — because the server never sent it, which the network tab
 * will confirm.
 *
 * POLLING, NOT PUSH. Every two seconds. The one piece of stale state that would
 * matter is whether everyone has submitted, because that decides whether the reveal
 * is offered.
 */

const DEMO_OWNER = "r.okafor@arbiter.demo";
const DEMO_PANEL = [
  "a.silva@arbiter.demo",
  "b.mehta@arbiter.demo",
  "c.lindqvist@arbiter.demo",
  "d.abara@arbiter.demo",
];

export function App(): ReactElement {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Person | null>(null);
  const [people, setPeople] = useState<Person[]>([]);

  const [caseName, setCaseName] = useState<string>("tak994");
  const [catalogue, setCatalogue] = useState<CaseSummary[]>([]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [caseId, setCaseId] = useState<string>("");
  const [scope, setScope] = useState<string | null>(null);
  const [heading, setHeading] = useState({ compoundLabel: "", context: "" });

  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [view, setView] = useState<BlindView | null>(null);
  const [unanimity, setUnanimity] = useState<UnanimityReport | null>(null);
  const [adjudication, setAdjudication] = useState<{ adjudication: Adjudication; source: "stub" | "live" } | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);

  const [docs, setDocs] = useState<StoredDocument[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  /** Ids are what the record stores; a screen full of `u_9f2a…` is unreadable. */
  const nameOf = useCallback(
    (id: string): string => people.find((p) => p.id === id)?.displayName ?? id,
    [people],
  );

  const refresh = useCallback(async (t: string, id: string): Promise<void> => {
    if (id === "") return;
    try {
      const v = await api.view(t, id);
      setView(v);
      if (v.status === "open") {
        setUnanimity(null);
        setAudit(null);
      } else {
        setUnanimity(await api.unanimity(t, id));
        setAudit(await api.audit(t, id));
      }
      setDocs(await api.documents(t, id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return;
      setFatal(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const signedIn = (t: string, user: Person): void => {
    setToken(t);
    setMe(user);
    setFatal(null);
  };

  const signOut = (): void => {
    if (token !== null) void api.logout(token).catch(() => undefined);
    setToken(null);
    setMe(null);
    setView(null);
    setInventory(null);
    setAdjudication(null);
  };

  useEffect(() => {
    if (token === null) return;
    void (async () => {
      try {
        setPeople(await api.people(token));
        setCatalogue(await api.catalogue(token));
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [token]);

  // Seeds or opens the selected case. Runs on sign-in and on case change, never on a
  // re-render: re-seeding on every render would be a POST per render.
  useEffect(() => {
    if (token === null || people.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        setInventory(null);
        setView(null);
        setAdjudication(null);
        setRefusal(null);

        const participantIds = DEMO_PANEL
          .map((email) => people.find((p) => p.email === email)?.id)
          .filter((id): id is string => id !== undefined);

        const res = await fetch("/api/demo", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ case: caseName, participantIds, at: new Date().toISOString() }),
        });
        // 422 is not an error path: the document exists and cannot be processed, and
        // the reason is the thing worth showing.
        if (res.status === 422) {
          if (!cancelled) setRefusal(await res.json() as Refusal);
          return;
        }
        if (!res.ok) throw new Error(`Could not open the case: HTTP ${res.status}`);
        const body = await res.json() as {
          inventory: Inventory; caseId: string; compoundLabel: string;
          context: string; documentScope: string | null;
        };
        if (cancelled) return;

        setInventory(body.inventory);
        setCaseId(body.caseId);
        setScope(body.documentScope);
        setHeading({ compoundLabel: body.compoundLabel, context: body.context });
        setFindings((await api.adjudicationRequest(token, body.caseId)).findings);
        await refresh(token, body.caseId);
      } catch (e) {
        if (!cancelled) setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [token, caseName, people, refresh]);

  useEffect(() => {
    if (token === null || caseId === "" || refusal !== null) return;
    const t = setInterval(() => { void refresh(token, caseId); }, 2000);
    return () => clearInterval(t);
  }, [token, caseId, refresh, refusal]);

  const upload = (file: File): void => {
    if (token === null) return;
    setUploadBusy(true);
    setUploadError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/cases/${caseId}/documents`, {
          method: "POST",
          headers: {
            "content-type": "application/pdf",
            "x-filename": file.name,
            authorization: `Bearer ${token}`,
          },
          body: await file.arrayBuffer(),
        });
        const body = await res.json() as { detail?: string; error?: string };
        if (!res.ok) setUploadError(body.detail ?? `Upload failed: ${body.error ?? res.status}`);
        setDocs(await api.documents(token, caseId));
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploadBusy(false);
      }
    })();
  };

  if (token === null || me === null) {
    return (
      <div className="shell">
        <h1>ARBITER</h1>
        <p className="muted">Blind deliberation on drug-safety evidence.</p>
        <SignIn onSignedIn={signedIn} />
      </div>
    );
  }

  if (fatal !== null) {
    return (
      <div className="shell">
        <h1>ARBITER</h1>
        <div className="stub">
          Cannot reach the deliberation service. Start it with <span className="mono">npm run api</span>, then reload.
          <div className="small" style={{ fontWeight: 400, marginTop: 8 }}>{fatal}</div>
        </div>
        <button className="ghost" onClick={signOut}>Sign out</button>
      </div>
    );
  }

  const seats = (
    <div className="personas">
      <span className="small muted">Signed in as</span>
      <strong className="small">{me.displayName}</strong>
      <button className="ghost" onClick={signOut}>Sign out</button>
      <span className="small muted" style={{ marginLeft: "auto" }}>
        Switching seats signs you out and back in — a real token each time, not a costume change.
      </span>
    </div>
  );

  const picker = (
    <div className="personas">
      <span className="small muted">Case:</span>
      {catalogue.map((c) => (
        <button key={c.name} className="persona" aria-pressed={caseName === c.name}
          onClick={() => setCaseName(c.name)} title={c.shape}>
          {c.usable ? "" : "⃠ "}{c.label}
        </button>
      ))}
    </div>
  );

  if (refusal !== null) {
    return <div className="shell"><h1>ARBITER</h1>{seats}{picker}<Refused r={refusal} /></div>;
  }

  if (inventory === null || view === null) {
    return <div className="shell"><h1>ARBITER</h1>{seats}{picker}<p className="muted">Loading the case…</p></div>;
  }

  const isOwner = me.email === DEMO_OWNER;
  const step = view.status === "open"
    ? (view.own !== null ? "waiting" : "position")
    : view.status === "signed" ? "signed" : "reveal";

  const act = (fn: () => Promise<unknown>): void => {
    void (async () => {
      try {
        await fn();
        await refresh(token, caseId);
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  return (
    <div className="shell">
      <h1>{heading.compoundLabel}</h1>
      <p className="muted">{heading.context}</p>

      {seats}
      {picker}

      <div className="rail">
        {["inventory", "your position", "reveal", "verdict", "sign"].map((s, i) => {
          const order = ["inventory", "position", "reveal", "verdict", "signed"];
          const nowIdx = order.indexOf(step === "waiting" ? "position" : step);
          return <span key={s} className={i === nowIdx ? "now" : i < nowIdx ? "done" : ""}>{s}</span>;
        })}
      </div>

      <InventoryPanel inv={inventory} documentScope={scope} />

      <hr style={{ border: 0, borderTop: "1px solid var(--hairline)", margin: "32px 0" }} />

      <Documents docs={docs} onUpload={upload} busy={uploadBusy} error={uploadError} />

      <hr style={{ border: 0, borderTop: "1px solid var(--hairline)", margin: "32px 0" }} />

      {step === "position" && (
        <PositionForm token={token} caseId={caseId} findings={findings}
          onDone={() => { void refresh(token, caseId); }} />
      )}
      {step === "waiting" && (
        <Waiting view={view} isOwner={isOwner} nameOf={nameOf}
          onReveal={(mode) => act(() => api.reveal(token, caseId, mode, new Date().toISOString()))} />
      )}

      {(step === "reveal" || step === "signed") && (
        <>
          <Reveal view={view} unanimity={unanimity} nameOf={nameOf} />
          {adjudication === null && view.status !== "signed" && isOwner && (
            <button className="primary"
              onClick={() => act(async () => {
                setAdjudication(await api.adjudicate(token, caseId, new Date().toISOString()));
              })}>
              Adjudicate across the positions
            </button>
          )}
          {adjudication !== null && (
            <Verdict adjudication={adjudication.adjudication} source={adjudication.source}
              onSign={(agrees, reason) => act(() => api.sign(token, caseId, {
                at: new Date().toISOString(), agreesWithAdjudication: agrees, reason,
              }))} />
          )}
          {view.status === "signed" && <p className="ok">Signed. The record is closed and every position in it is preserved.</p>}
          {audit !== null && <Audit audit={audit} />}
        </>
      )}
    </div>
  );
}
