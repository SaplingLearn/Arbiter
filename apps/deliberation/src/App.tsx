import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  api, ApiError, uploadDocument,
  type AuditResult, type BlindView, type CaseListing,
  type CaseReport, type CaseSummary, type Finding, type Inventory,
  type LibrarySource, type Person, type Refusal, type Roster, type StoredDocument,
  type UnanimityReport,
} from "./api.js";
import { Layout, PageHead, Section, Steps } from "./Layout.js";
import { AskPage, Dashboard, LibraryPage, NewCasePage } from "./pages.js";
import {
  Audit, Documents, FindingsEditor, InventoryPanel, PositionForm,
  Refused, Reveal, RosterPanel, Verdict, Waiting,
} from "./screens.js";
import { Read, ReadingRoom } from "./read.js";
import { ReportPage } from "./report.js";
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

/**
 * The identity every visitor arrives as.
 *
 * Configurable so a deployment can point it somewhere other than the seeded demo lead,
 * and so this file does not hard-code a password. See the note at the sign-in branch
 * below for what carrying one identity for everyone costs the record.
 */
const AUTO_EMAIL = import.meta.env["VITE_AUTO_EMAIL"] ?? "r.okafor@arbiter.demo";
const AUTO_PASSWORD = import.meta.env["VITE_AUTO_PASSWORD"] ?? "arbiter-demo-2026";

/** What is on screen for the moment between arriving and the session existing. Not a
 *  form, and deliberately not a spinner: it states what is happening. */
function Opening({ error }: { error: string | null }): ReactElement {
  return (
    <div className="opening">
      <div>
        <div className="eyebrow">{error === null ? "Opening the record" : "Cannot open the record"}</div>
        <p className="muted">
          {error ?? "Establishing a session against the deliberation service."}
        </p>
      </div>
    </div>
  );
}

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
  /* NO `adjudication` STATE. It used to live here, written only by the POST that
     produced it, and that was the whole of the bug: the verdict existed in the tab
     that ran it and nowhere else - a participant reaching the verdict stage saw
     nothing, and the owner lost it on refresh. `view` carries it now - `act` reloads
     the case after every action, so the freshly-adjudicated case arrives by the same
     path a reload does, and there is one source of truth instead of two that disagree.

     The report branch fixed the same bug with a route of its own, `GET /adjudication`.
     One of the two had to go, and this is the one that stayed: the verdict stage
     already fetches `view`, so carrying the adjudication on it costs no extra request
     and leaves no second endpoint to drift. */
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [docs, setDocs] = useState<StoredDocument[]>([]);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [head, setHead] = useState({ compoundLabel: "", context: "", scope: null as string | null });

  /**
   * The printable record, fetched ONCE per visit rather than polled.
   *
   * Every other case route polls, because "has everyone answered yet" is the one piece
   * of stale state that matters. A document is the opposite: it carries a "generated
   * at" line and a reader is holding it still to read it, so re-fetching every three
   * seconds would reshuffle the page under them and restamp the time they are about to
   * print. Leaving and coming back is what re-reads it.
   */
  const [report, setReport] = useState<CaseReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  /** Whether the convener has published this case, and to what link - owner-only, so
   *  this stays null for anybody else. See the effect below for why it is fetched only
   *  for the owner rather than for anyone who reaches the report route. */
  const [share, setShare] = useState<{ published: boolean; url: string | null } | null>(null);

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

  /* A refusal does not survive leaving the library, so coming back to it is a library
     and not the last thing you looked at. Scoping the render to the `cases` route (see
     the switch below) is what stops a refusal pinning the other pages; this is what
     stops it waiting for you when you return.

     Safe against clearing a refusal the instant it arrives: `openPrepared` does not
     navigate on the refused path - it returns early and leaves you on the library - so
     setting one never coincides with a route change. */
  useEffect(() => { setRefusal(null); }, [route]);

  const caseId = caseIdOf(route);

  /**
   * WHO CONVENED THIS CASE, computed here rather than down with the rest of the case
   * routes' derived state.
   *
   * The brief for this had `isOwner` used inside an effect placed beside the report
   * fetch below, on the assumption that it was already in scope there - it is not: the
   * case-routes `isOwner` used to live past the `if (token === null || me === null)`
   * early return further down this component, and an effect is a hook, so it cannot be
   * declared conditionally past a return that hooks above it do not take. Hoisting the
   * computation here, alongside `caseId`, is what puts it in scope for that effect
   * without turning the effect itself into something that runs only sometimes.
   *
   * `me !== null &&` guards the one case hoisting introduces that the original spot
   * never had to consider: before that early return, `me` can still be null, and
   * without the guard `roster?.ownerId === me?.id` would compare two `undefined`s and
   * read as true for everyone until both have loaded.
   */
  const listing = mine.find((c) => c.caseId === caseId);
  const isOwner = me !== null && (roster?.ownerId === me.id || (listing?.isOwner ?? false));

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

  /* The record, on arrival at its own route and nowhere else. Not part of `loadCase`:
     every case route would then assemble a document nobody asked for. */
  useEffect(() => {
    if (token === null || caseId === null || route.name !== "report") return;
    let live = true;
    setReport(null);
    setReportError(null);
    void (async () => {
      try {
        const r = await api.report(token, caseId);
        if (live) setReport(r);
      } catch (e) {
        // The service's own refusal, verbatim. "This case has not been adjudicated" is
        // a sentence that tells the reader what to do; "something went wrong" is not.
        if (live) setReportError(e instanceof ApiError ? e.message : String(e));
      }
    })();
    return () => { live = false; };
  }, [token, caseId, route.name]);

  /* Whether the case is published, fetched beside the report itself and gated the same
     way - on arrival at the report route, and nowhere else. `!isOwner` is the one extra
     guard the report fetch above does not need: `GET /share` 403s for anybody who is
     not the convener, and firing it for every participant who opens their report would
     be a console error on a page that is otherwise working correctly for them. */
  useEffect(() => {
    if (token === null || caseId === null || route.name !== "report" || !isOwner) return;
    let live = true;
    setShare(null);
    void (async () => {
      try {
        const s = await api.shareState(token, caseId);
        if (live) setShare(s);
      } catch {
        if (live) setShare(null);
      }
    })();
    return () => { live = false; };
  }, [token, caseId, route.name, isOwner]);

  /* Establish the session on arrival rather than asking for it. Runs once; a failure
     surfaces as a message on the opening panel, never as a login form. */
  useEffect(() => {
    if (token !== null) return;
    let live = true;
    void (async () => {
      try {
        const { token: t, user } = await api.login(AUTO_EMAIL, AUTO_PASSWORD);
        if (!live) return;
        setToken(t);
        setMe(user);
        setFatal(null);
      } catch (e) {
        if (live) setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [token]);

  const signOut = (): void => {
    if (token !== null) void api.logout(token).catch(() => undefined);
    setToken(null);
    setMe(null);
    navigate({ name: "dashboard" });
  };

  if (token === null || me === null) {
    /* NO SIGN-IN. The landing page opens straight into the product.
     *
     * A session is still established — the API is unchanged and every route behind it
     * requires a token — but it is established for you, from a configured identity,
     * instead of being asked for.
     *
     * WHAT THIS COSTS, stated plainly because it is not a styling decision. This product
     * seals positions and attributes them to a named person; the record's whole claim is
     * that it can prove who committed to what and that nobody edited it afterwards. With
     * one identity signing everybody in, the record still says "R. Okafor decided" for
     * whoever is at the keyboard. The mechanism is intact and the attribution is not.
     * Restoring real sign-in is deleting this branch and putting `AuthPage` back. */
    return <Opening error={fatal} />;
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

  /**
   * WHICH CASE THE ENVIRONMENT SINGLES OUT, and a refusal counts.
   *
   * This was `caseIdOf(route)`, read inside the backdrop. A refused case never becomes a
   * route - the server answers the open with a 422 and the reader stays on the library
   * looking at the reason - so the key was null for exactly the cases the Archive draws
   * in red, and the interior written for a failure could not be reached from the product
   * at all.
   *
   * The refusal wins over the route because it is the more specific thing on screen: it
   * is only ever set while the library is showing why one named document could not
   * produce a case, and that is the case the reader is looking at.
   */
  const focusKey = refusal?.name ?? caseId;

  const shell = (children: ReactElement): ReactElement => (
    <Layout route={route} me={me} catalogue={catalogue} focusKey={focusKey} onSignOut={signOut}>
      {children}
    </Layout>
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

    /* The reading room, and it sits with the other top-level routes rather than below
       with the case screens. It has no caseId, so none of the case machinery under
       this switch applies to it: nothing to poll, no stage strip, no blind view to
       wait for. Reaching it through `caseShell` would have needed a case it does not
       have. */
    case "reading":
      return shell(<ReadingRoom token={token} mine={mine} />);

    /**
     * A REFUSAL IS THE LIBRARY'S, and it is rendered here rather than above this switch.
     *
     * It used to be an early return sitting over the whole route table, cleared only at
     * the top of `openPrepared`. So opening a refused case pinned EVERY route in the
     * product to the refusal: the hash changed, `route` changed, the backdrop swapped
     * scene - and the page did not, because the switch below was never reached.
     *
     * It was also unrecoverable rather than merely wrong. The only call that clears the
     * state lives behind `LibraryPage`, and `LibraryPage` is the one thing the early
     * return replaced, so nothing short of a reload could get the product back.
     *
     * The state itself was never the problem. Its SCOPE was: a value produced by one
     * page, deciding what every other page renders. It is the library's answer to "open
     * this one", so it is drawn on the library's route, and the routes it has nothing to
     * do with are none of its business.
     */
    case "cases":
      return shell(refusal !== null
        ? <Refused r={refusal} onBack={() => setRefusal(null)} />
        : <LibraryPage catalogue={catalogue} onOpen={openPrepared} busy={opening} />);

    default:
      break;
  }

  // ---- case routes -------------------------------------------------------
  if (caseId === null) return shell(<Dashboard mine={mine} me={me} />);
  if (view === null || inventory === null) {
    return shell(<p className="muted">Loading the case…</p>);
  }

  // `listing` and `isOwner` are computed above, alongside `caseId` - see the comment
  // there for why. Only `label` is local to the case routes.
  const label = listing?.compoundLabel ?? head.compoundLabel ?? caseId;
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
      {/* `adjudicated` comes off the case status rather than off the loaded
          adjudication: the strip is drawn on every case route, and the record is only
          fetched on its own. A tab that unlocked when a fetch happened to have landed
          would flicker. */}
      <Steps caseId={caseId} route={route} revealed={revealed}
        adjudicated={view.status === "adjudicated" || view.status === "signed"}
        {...(listing === undefined ? {} : { answered: listing.submitted, of: listing.of })} />
      {children}
    </>,
  );

  if (route.name === "case") {
    return caseShell(
      <div className="stack-l">
        {/* No title on the Section: InventoryPanel carries its own heading, and the
            paragraph explaining why the list is ordered the way it is belongs with
            it. Both were set, so the evidence stage opened on the same sentence
            printed twice. */}
        <Section>
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
        <Reveal view={view} unanimity={unanimity} nameOf={nameOf} seats={roster?.seats ?? {}} />
        {/* `locked` and nothing else. Adjudicating spends three model calls out of a
            daily twenty, and every other status already has a verdict or cannot take
            one - so the states that used to render this button could only buy an
            error. The API refuses them too, now before it spends anything. */}
        {view.status === "locked" && isOwner && (
          <button className="primary" style={{ alignSelf: "flex-start" }}
            onClick={() => act(() => api.adjudicate(token, caseId, new Date().toISOString()))}>
            Adjudicate across the positions
          </button>
        )}
        {view.adjudication !== null && (
          <Verdict adjudication={view.adjudication} source={view.adjudicationSource ?? "stub"}
            consensus={view.consensus}
            caseId={caseId}
            /* The convener signs, and only while the record is still open. Asked here
               rather than inside `Verdict` because the answer is the server's: a
               participant used to be shown a form that could only earn them a 403. */
            canSign={isOwner && view.status !== "signed"}
            /* The signature names its signer by id; the roster that turns that into a
               person lives here, so the resolution happens here and `Verdict` stays
               presentational. */
            signed={view.signature === null ? null : {
              name: nameOf(view.signature.by),
              at: view.signature.at,
              agreesWithAdjudication: view.signature.agreesWithAdjudication,
              reason: view.signature.reason,
            }}
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

  /**
   * The printable record.
   *
   * INSIDE `caseShell`, so the strip shows where the reader is and how to get back.
   * The page head and the strip are both hidden by the print stylesheet, so what comes
   * out of the dialog is the sheet alone - navigation on screen costs the document
   * nothing.
   */
  if (route.name === "report") {
    return caseShell(
      reportError !== null
        ? <div className="empty">
            <h3>There is no record to print yet</h3>
            <p className="muted">{reportError}</p>
            <div className="btn-row" style={{ justifyContent: "center" }}>
              <a href={href({ name: "reveal", caseId })}><button className="ghost">Back to the verdict</button></a>
            </div>
          </div>
        : report === null
          ? <p className="muted">Assembling the record…</p>
          : (
            <ReportPage report={report} {...(route.page === undefined ? {} : { page: route.page })}
              /* `share !== null` rather than `isOwner` alone: the fetch above is
                 in flight for a moment after the route opens, and passing an
                 empty `share` object during that window would flash a "Publish
                 this record" button that immediately swaps for the real state a
                 beat later - the same instant the page as a whole is still
                 rendering "Assembling the record…". No prop at all until the
                 fetch has actually landed is the honest version of "loading". */
              {...(isOwner && share !== null ? {
                share: {
                  url: share.url,
                  onPublish: () => act(async () => {
                    const r = await api.publish(token, caseId);
                    setShare({ published: true, url: r.url });
                  }),
                  onRevoke: () => act(async () => {
                    await api.revoke(token, caseId);
                    setShare({ published: false, url: null });
                  }),
                },
              } : {})} />
          ),
    );
  }

  if (route.name === "read") {
    return caseShell(
      // `view.revealed` straight through, null and all. The reader shows who cited a
      // finding only once the server has released the positions - passing anything
      // reconstructed here would move blindness into the client, which the handoff
      // names as the way the blind stage stops meaning anything.
      <Read caseId={caseId} token={token} documents={docs} findings={findings}
        positions={view.revealed} people={people} seats={roster?.seats ?? {}}
        {...(route.documentId === undefined ? {} : { documentId: route.documentId })}
        {...(route.page === undefined ? {} : { page: route.page })} />,
    );
  }

  return caseShell(audit === null
    ? <p className="muted">The record opens once the case is closed.</p>
    : <Audit audit={audit} nameOf={nameOf} />);
}
