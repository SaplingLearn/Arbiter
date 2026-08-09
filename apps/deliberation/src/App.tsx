import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api, ApiError, type Adjudication, type AuditResult, type BlindView, type Finding, type Inventory, type UnanimityReport } from "./api.js";
import { Audit, InventoryPanel, PositionForm, Reveal, Verdict, Waiting } from "./screens.js";
import "./app.css";

/**
 * The deliberation client.
 *
 * WHY THERE IS A PERSONA SWITCHER AND NOT A LOGIN. There is no authentication in
 * this build — identity is an `x-arbiter-user` header the server takes at its word
 * (services/api/server.ts says so at length). Rendering a password box over that
 * would be a lie told in the most convincing possible place, so the switcher is
 * labelled for what it is.
 *
 * It also happens to be the right demonstration device. Blind submission is a
 * property you have to WATCH to believe: switch to one persona, submit, switch to
 * another, and the first answer is not on the screen — because the server never
 * sent it, which the network tab will confirm.
 *
 * POLLING, NOT PUSH. Every two seconds, and §3.3 says polling is sufficient. The one
 * piece of stale state that would matter is whether everyone has submitted, because
 * that decides whether the reveal is offered.
 */

const CASE_ID = "tak994-demo";
const OWNER = "r.okafor (programme lead)";
const PANEL = [
  "a.silva (tox)",
  "b.mehta (dmpk)",
  "c.lindqvist (clinical)",
  "d.abara (project)",
];

export function App(): ReactElement {
  const [actor, setActor] = useState(PANEL[0]!);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [view, setView] = useState<BlindView | null>(null);
  const [unanimity, setUnanimity] = useState<UnanimityReport | null>(null);
  const [adjudication, setAdjudication] = useState<{ adjudication: Adjudication; source: "stub" | "live" } | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const refresh = useCallback(async (who: string): Promise<void> => {
    try {
      const v = await api.view(who, CASE_ID);
      setView(v);
      if (v.status !== "open") {
        setUnanimity(await api.unanimity(who, CASE_ID));
        setAudit(await api.audit(who, CASE_ID));
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return;
      setFatal(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Boot: seed the case from the files on disk, then load. The client never
  // hand-builds findings - a demonstration whose evidence was typed into a browser
  // is a demonstration of something other than the repository's data.
  useEffect(() => {
    void (async () => {
      try {
        const seeded = await fetch("/api/demo", {
          method: "POST",
          headers: { "content-type": "application/json", "x-arbiter-user": OWNER },
          body: JSON.stringify({ caseId: CASE_ID, participantIds: PANEL, at: new Date().toISOString() }),
        });
        if (!seeded.ok) throw new Error(`seed failed: HTTP ${seeded.status}`);
        setInventory((await seeded.json()).inventory as Inventory);
        setFindings((await api.adjudicationRequest(OWNER, CASE_ID)).findings);
        // PANEL[0], not `actor`. Boot must run exactly once - re-seeding on every
        // persona switch would be a POST per click - and reading `actor` here would
        // make it a dependency of an effect that must not re-run. The effect below
        // refreshes on every actor change, so nothing is missed.
        await refresh(PANEL[0]!);
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [refresh]);

  useEffect(() => { void refresh(actor); }, [actor, refresh]);

  useEffect(() => {
    const t = setInterval(() => { void refresh(actor); }, 2000);
    return () => clearInterval(t);
  }, [actor, refresh]);

  if (fatal !== null) {
    return (
      <div className="shell">
        <h1>ARBITER</h1>
        <div className="stub">
          Cannot reach the deliberation service. Start it with <span className="mono">npm run api</span>, then reload.
          <div className="small" style={{ fontWeight: 400, marginTop: 8 }}>{fatal}</div>
        </div>
      </div>
    );
  }

  if (inventory === null || view === null) return <div className="shell"><h1>ARBITER</h1><p className="muted">Loading the case…</p></div>;

  const isOwner = actor === OWNER;
  const submitted = view.own !== null;
  const step = view.status === "open" ? (submitted ? "waiting" : "position") : view.status === "signed" ? "signed" : "reveal";

  const onReveal = (mode: "all_in" | "close_early"): void => {
    void (async () => {
      try {
        await api.reveal(OWNER, CASE_ID, mode, new Date().toISOString());
        await refresh(actor);
      } catch (e) { setFatal(e instanceof Error ? e.message : String(e)); }
    })();
  };

  const onAdjudicate = (): void => {
    void (async () => {
      try {
        setAdjudication(await api.adjudicate(OWNER, CASE_ID, new Date().toISOString()));
        await refresh(actor);
      } catch (e) { setFatal(e instanceof Error ? e.message : String(e)); }
    })();
  };

  const onSign = (agrees: boolean, reason: string): void => {
    void (async () => {
      try {
        await api.sign(OWNER, CASE_ID, { at: new Date().toISOString(), agreesWithAdjudication: agrees, reason });
        await refresh(actor);
      } catch (e) { setFatal(e instanceof Error ? e.message : String(e)); }
    })();
  };

  return (
    <div className="shell">
      <h1>TAK-994</h1>
      <p className="muted">Narcolepsy type 1. Chronic oral dosing in otherwise healthy adults. Decision: advance toward first-in-human?</p>

      <div className="personas">
        <span className="small muted">You are:</span>
        {[...PANEL, OWNER].map((p) => (
          <button key={p} className="persona" aria-pressed={actor === p} onClick={() => setActor(p)}>
            {p}{view.others.find((o) => o.participantId === p)?.submitted === true && <span className="tick"> ✓</span>}
            {p === actor && view.own !== null && <span className="tick"> ✓</span>}
          </button>
        ))}
        <span className="small muted" style={{ marginLeft: "auto" }}>
          Not a login. Identity is a header the server takes at its word — see services/api/server.ts.
        </span>
      </div>

      <div className="rail">
        {["inventory", "your position", "reveal", "verdict", "sign"].map((s, i) => {
          const order = ["inventory", "position", "reveal", "verdict", "signed"];
          const nowIdx = order.indexOf(step === "waiting" ? "position" : step);
          return <span key={s} className={i === nowIdx ? "now" : i < nowIdx ? "done" : ""}>{s}</span>;
        })}
      </div>

      <InventoryPanel inv={inventory} />

      <hr style={{ border: 0, borderTop: "1px solid var(--hairline)", margin: "32px 0" }} />

      {step === "position" && (
        <PositionForm actor={actor} caseId={CASE_ID} findings={findings} onDone={() => void refresh(actor)} />
      )}
      {step === "waiting" && <Waiting view={view} isOwner={isOwner} onReveal={onReveal} />}

      {(step === "reveal" || step === "signed") && (
        <>
          <Reveal view={view} unanimity={unanimity} />
          {adjudication === null && view.status !== "signed" && (
            <button className="primary" onClick={onAdjudicate}>Adjudicate across the positions</button>
          )}
          {adjudication !== null && (
            <Verdict adjudication={adjudication.adjudication} source={adjudication.source} onSign={onSign} />
          )}
          {view.status === "signed" && <p className="ok">Signed. The record is closed and every position in it is preserved.</p>}
          {audit !== null && <Audit audit={audit} />}
        </>
      )}
    </div>
  );
}
