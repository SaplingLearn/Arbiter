import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  api, ApiError, uploadDocument,
  type Adjudication, type AuditResult, type BlindView, type CaseListing,
  type CaseSummary, type Finding, type Inventory, type LibrarySource, type Person, type Refusal,
  type Roster, type StoredDocument, type UnanimityReport,
} from "./api.js";
import { Layout, PageHead, Section, Steps } from "./Layout.js";
import { AskPage, AuthPage, Dashboard, LibraryPage, MethodPage, NewCasePage } from "./pages.js";
import {
  Audit, Documents, FindingsEditor, InventoryPanel, PositionForm,
  Refused, Reveal, RosterPanel, Verdict, Waiting,
} from "./screens.js";
import { caseIdOf, href, navigate, parseHash, type Route } from "./router.js";
import "./app.css";

/**
 * The application shell: authentication, routing, and the data each page needs.
 *
 * THE TOKEN LIVES IN MEMORY, never in localStorage. A bearer token in localStorage
 * is readable by any script that reaches the page and it survives the tab; holding
 * it in React state means closing the tab signs you out, which is the right
 * behaviour for something that will hold unpublished safety data.
 *
 * POLLING, NOT PUSH, on the case routes only. The one piece of stale state that
 * matters is whether everyone has submitted, because that decides whether the
 * reveal is available.
 */

export function App(): ReactElement {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Person | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [catalogue, setCatalogue] = useState<CaseSummary[]>([]);
  const [library, setLibrary] = useState<LibrarySource[]>([]);
  const [mine, setMine] = useState<CaseListing[]>([]);

  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [view, setView] = useState<BlindView | null>(null);
  const [unanimity, setUnanimity] = useState<UnanimityReport | null>(null);
  const [adjudication, setAdjudication] = useState<{ adjudication: Adjudication; source: "stub" | "live" } | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [docs, setDocs] = useState<StoredDocument[]>([]);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [head, setHead] = useState({ compoundLabel: "", context: "", scope: null as string | null });

  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [findingError, setFindingError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    const onHash = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const caseId = caseIdOf(route);
  const nameOf = useCallback(
    (id: string): string => people.find((p) => p.id === id)?.displayName ?? id,
    [people],
  );

  const loadCase = useCallback(async (t: string, id: string): Promise<void> => {
    try {
      const [v, inv, req, d, r] = await Promise.all([
        api.view(t, id), api.inventory(t, id), api.adjudicationRequest(t, id),
        api.documents(t, id), api.roster(t, id),
      ]);
      setView(v);
      setInventory(inv);
      setFindings(req.findings);
      setDocs(d);
      setRoster(r);
      if (v.status === "open") {
        setUnanimity(null);
        setAudit(null);
      } else {
        setUnanimity(await api.unanimity(t, id));
        setAudit(await api.audit(t, id));
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setFatal("That case does not exist, or you are not named on it.");
        return;
      }
      setFatal(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadMine = useCallback(async (t: string): Promise<void> => {
    try { setMine(await api.myCases(t)); } catch { /* the fatal panel covers a dead service */ }
  }, []);

  useEffect(() => {
    if (token === null) return;
    void (async () => {
      try {
        // Loaded with the catalogue rather than inside AskPage, and for the same
        // reason: both describe what this deployment holds, neither changes while
        // somebody is signed in, and a fetch inside the page would re-run it on every
        // visit to Ask.
        const [p, c, l] = await Promise.all([api.people(token), api.catalogue(token), api.library(token)]);
        setPeople(p);
        setCatalogue(c);
        setLibrary(l);
        await loadMine(token);
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [token, loadMine]);

  useEffect(() => {
    if (token === null || caseId === null) return;
    setFatal(null);
    void loadCase(token, caseId);
  }, [token, caseId, loadCase]);

  useEffect(() => {
    if (token === null || caseId === null) return;
    const t = setInterval(() => { void loadCase(token, caseId); }, 3000);
    return () => clearInterval(t);
  }, [token, caseId, loadCase]);

  const signOut = (): void => {
    if (token !== null) void api.logout(token).catch(() => undefined);
    setToken(null);
    setMe(null);
    navigate({ name: "dashboard" });
  };

  if (token === null || me === null) {
    return <AuthPage onSignedIn={(t, u) => { setToken(t); setMe(u); setFatal(null); }} />;
  }

  const act = (fn: () => Promise<unknown>): void => {
    void (async () => {
      try {
        await fn();
        if (caseId !== null) await loadCase(token, caseId);
        await loadMine(token);
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const openPrepared = (name: string): void => {
    setOpening(name);
    setRefusal(null);
    void (async () => {
      try {
        // No participants named: the server uses the seeded demonstration team, which
        // is explicit. Sending "the first four accounts that happen to exist" is how a
        // stranger ends up on a case about somebody else's compound.
        const res = await fetch("/api/demo", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ case: name, at: new Date().toISOString() }),
        });
        if (res.status === 422) {
          const why = await res.json() as { error: string; detail?: string };
          if (why.error === "no_panel") { setFatal(why.detail ?? "That case has nobody to answer it."); setOpening(null); return; }
          setRefusal(why as unknown as Refusal); setOpening(null); return;
        }
        if (!res.ok) throw new Error(`Could not open that case: HTTP ${res.status}`);
        const body = await res.json() as { caseId: string; compoundLabel: string; context: string; documentScope: string | null };
        setHead({ compoundLabel: body.compoundLabel, context: body.context, scope: body.documentScope });
        await loadMine(token);
        navigate({ name: "case", caseId: body.caseId });
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      } finally {
        setOpening(null);
      }
    })();
  };

  const upload = (file: File): void => {
    if (caseId === null) return;
    setUploadBusy(true);
    setUploadError(null);
    void (async () => {
      try {
        await uploadDocument(token, caseId, file);
        setDocs(await api.documents(token, caseId));
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploadBusy(false);
      }
    })();
  };

  const shell = (children: ReactElement): ReactElement => (
    <Layout route={route} me={me} onSignOut={signOut}>{children}</Layout>
  );

  if (fatal !== null) {
    return shell(
      <div className="empty">
        <h3>Something is not right</h3>
        <p className="muted">{fatal}</p>
        <div className="btn-row" style={{ justifyContent: "center" }}>
          <a href={href({ name: "dashboard" })}><button className="ghost" onClick={() => setFatal(null)}>Back to dashboard</button></a>
        </div>
      </div>,
    );
  }

  if (refusal !== null) return shell(<Refused r={refusal} />);

  switch (route.name) {
    case "dashboard":
      return shell(<Dashboard mine={mine} me={me} />);

    case "new":
      return shell(
        <NewCasePage token={token} people={people.filter((p) => p.id !== me.id)}
          onCreated={(id) => { void loadMine(token); navigate({ name: "case", caseId: id }); }} />,
      );

    case "ask":
      return shell(<AskPage token={token} library={library} />);

    case "cases":
      return shell(<LibraryPage catalogue={catalogue} onOpen={openPrepared} busy={opening} />);

    case "method":
      return shell(<MethodPage />);

    default:
      break;
  }

  // ---- case routes -------------------------------------------------------
  if (caseId === null) return shell(<Dashboard mine={mine} me={me} />);
  if (view === null || inventory === null) {
    return shell(<p className="muted">Loading the case…</p>);
  }

  const listing = mine.find((c) => c.caseId === caseId);
  const label = listing?.compoundLabel ?? head.compoundLabel ?? caseId;
  const isOwner = roster?.ownerId === me.id || (listing?.isOwner ?? false);
  const revealed = view.status !== "open";
  const frozen = view.own !== null || view.others.some((o) => o.submitted)
    ? "Somebody has already answered against this evidence. Changing it now would put a position on the record against an inventory its author never saw."
    : null;

  const caseShell = (children: ReactElement, lede?: string): ReactElement => shell(
    <>
      <PageHead
        crumb={<><a href={href({ name: "dashboard" })}>Dashboard</a><span>›</span><span>{label}</span></>}
        title={label}
        {...(lede === undefined ? {} : { lede })}
      />
      <Steps caseId={caseId} route={route} revealed={revealed}
        {...(listing === undefined ? {} : { answered: listing.submitted, of: listing.of })} />
      {children}
    </>,
  );

  if (route.name === "case") {
    return caseShell(
      <div className="stack-l">
        <Section title="What the documents contain">
          <InventoryPanel inv={inventory} documentScope={head.scope} />
        </Section>

        {isOwner && (
          <Section title="Evidence" count={`${findings.length} findings`}>
            <FindingsEditor
              checklist={inventory.entries.map((e) => ({ itemId: e.itemId, field: e.field, state: e.state }))}
              findings={findings} documents={docs} frozen={frozen} error={findingError}
              onAdd={(f) => { setFindingError(null); act(async () => { try { await api.addFinding(token, caseId, f); } catch (e) { setFindingError(e instanceof ApiError ? e.message : String(e)); } }); }}
              onRemove={(id) => act(() => api.removeFinding(token, caseId, id))} />
          </Section>
        )}

        <Section title="Documents">
          <Documents docs={docs} onUpload={upload} busy={uploadBusy} error={uploadError} />
        </Section>

        {roster !== null && (
          <Section title="Who answers" count={`${roster.members.length} on the panel${roster.pending.length > 0 ? `, ${roster.pending.length} invited` : ""}`}>
            <RosterPanel roster={roster} canEdit={isOwner && frozen === null}
              isOwner={isOwner} ownerName={nameOf(roster.ownerId)}
              notice={inviteNotice} error={inviteError}
              onInvite={(email: string) => {
                setInviteNotice(null); setInviteError(null);
                act(async () => {
                  try {
                    const r = await api.invite(token, caseId, email);
                    if (r.pending === true) setInviteNotice(r.detail ?? "Invitation recorded.");
                  } catch (e) { setInviteError(e instanceof ApiError ? e.message : String(e)); }
                });
              }}
              onRemove={(idOrEmail: string) => act(() => api.removeParticipant(token, caseId, idOrEmail))} />
          </Section>
        )}
      </div>,
      head.context === "" ? undefined : head.context,
    );
  }

  if (route.name === "position") {
    return caseShell(
      view.own !== null
        ? <Waiting view={view} isOwner={isOwner} nameOf={nameOf}
            onReveal={(mode) => act(() => api.reveal(token, caseId, mode, new Date().toISOString()))} />
        : <PositionForm token={token} caseId={caseId} findings={findings}
            onDone={() => { void loadCase(token, caseId); void loadMine(token); }} />,
    );
  }

  if (route.name === "reveal") {
    if (!revealed) {
      // THE OWNER GETS THE CONTROLS HERE, and before this they could not reach them at
      // all. `Waiting` holds the only "Close without them" button, and the position
      // route renders it solely when `view.own !== null` - when the VIEWER has sealed.
      // A convener never seals (access.ts: they "convene and sign but do not hold an
      // opinion on the record"), so the one control only an owner may use lived behind
      // a condition no owner can satisfy. The API, the service and the button all
      // worked; nothing rendered them together.
      //
      // The reveal route is where an owner goes to close a case, so this is where they
      // belong. Everyone else keeps the dead end, because for a participant it is not a
      // dead end - it is the correct answer, and it points back at the thing they can
      // actually do.
      return caseShell(
        isOwner
          ? <Waiting view={view} isOwner={isOwner} nameOf={nameOf}
              onReveal={(mode) => act(() => api.reveal(token, caseId, mode, new Date().toISOString()))} />
          : <div className="empty">
              <h3>Not everyone has answered</h3>
              <p className="muted">Positions stay sealed until the case is closed. That is the whole point of collecting them separately.</p>
              <a href={href({ name: "position", caseId })}><button className="ghost">Back to your position</button></a>
            </div>,
      );
    }
    return caseShell(
      <div className="stack-l">
        <Reveal view={view} unanimity={unanimity} nameOf={nameOf} />
        {adjudication === null && view.status !== "signed" && isOwner && (
          <button className="primary" style={{ alignSelf: "flex-start" }}
            onClick={() => act(async () => { setAdjudication(await api.adjudicate(token, caseId, new Date().toISOString())); })}>
            Adjudicate across the positions
          </button>
        )}
        {adjudication !== null && (
          <Verdict adjudication={adjudication.adjudication} source={adjudication.source}
            onSign={(agrees, reason) => act(() => api.sign(token, caseId, {
              at: new Date().toISOString(), agreesWithAdjudication: agrees, reason,
            }))} />
        )}
        {view.status === "signed" && (
          <p className="ok">Signed. The record is closed, and every position in it is kept.</p>
        )}
      </div>,
    );
  }

  return caseShell(audit === null
    ? <p className="muted">The record opens once the case is closed.</p>
    : <Audit audit={audit} nameOf={nameOf} />);
}
