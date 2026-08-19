import { StrictMode, useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { ReportPage } from "./report.js";
import type { CaseReport } from "./api.js";
import "./app.css";

/**
 * The record, to somebody who is not signed in.
 *
 * ITS OWN ENTRY POINT, and that is the security design rather than a build convenience.
 * `App.tsx` authenticates on load wherever a build gave it an identity to authenticate as,
 * so a public route inside that shell would sign its visitor in, and the only thing
 * preventing it would be a condition somebody has to keep remembering. This bundle cannot
 * sign anybody in because the code that does it is not in it - the same argument
 * `access.ts` makes for writing rules that fail closed instead of open.
 *
 * NOTE THAT THIS ARGUMENT DOES NOT DEPEND ON THAT BUILD FLAG, and must not be rewritten to.
 * `App.tsx` only carries credentials in development or where a deployment asked for them,
 * which narrows how often the shell hands out a session - it does not make the shell a
 * thing this page may be folded into. A separate entry is structural; a build variable is
 * a condition, and the whole point of the separation is not having one.
 *
 * NOTHING AUTHENTICATED IS IMPORTED HERE. Not App, not the bearer-token api client, not
 * the case screens. If a future change needs one of them on this page, that is the
 * signal to ask why, not to add the import. `./api.js` is imported for its TYPE only
 * (`import type`), which Vite's esbuild transform erases at build time - the module
 * that carries `/api/auth/login` as a string literal never ships in this bundle. See
 * Step 8 of the task brief for the grep that proves it.
 */

export function parsePublicPath(path: string): { caseId: string; token: string } | null {
  const parts = path.split("/").filter((p) => p !== "");
  if (parts.length !== 3 || parts[0] !== "r") return null;
  return { caseId: decodeURIComponent(parts[1]!), token: parts[2]! };
}

/**
 * ONE MESSAGE FOR EVERY FAILURE, AND ONE COMPONENT FOR IT. Never published, wrong
 * token, revoked, no such case, and a URL that was not even share-link shaped all read
 * the same - telling them apart is exactly the probe the server's uniform 404 exists to
 * refuse. `PublicReport`'s failed fetch and `Boot`'s unparseable path used to each carry
 * their own copy of this text; two copies are two things to keep in sync, and a diff
 * that touched one and not the other would have reopened the distinction without either
 * author intending to.
 */
function LinkNotValid(): ReactElement {
  return (
    <div className="empty">
      <h3>This link is not valid</h3>
      {/* NOT "revoked" - not "does not exist" - not any reason at all. Naming a reason
          would tell an outside reader something the server's own uniform 404 was built
          not to say: whether a case by this id ever existed, or only ever had this one
          token die. One sentence, true of every cause at once. */}
      <p className="muted">
        It may be out of date or mistyped. Ask whoever shared it for a current one.
      </p>
    </div>
  );
}

export function PublicReport({ caseId, token }: { caseId: string; token: string }): ReactElement {
  const [report, setReport] = useState<CaseReport | null>(null);
  const [dead, setDead] = useState(false);
  // Which sheet is on screen. A hash route would be the ordinary way to hold this - see
  // `report.tsx`'s own note on why `Paginate` prefers one - but this bundle imports no
  // router, on purpose: `/r/:caseId/:token` is already the one real path this page
  // answers, and a hash fragment change here has nowhere to go but local state anyway.
  const [page, setPage] = useState(1);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/public/report/${encodeURIComponent(caseId)}/${token}`);
        if (!res.ok) { setDead(true); return; }
        setReport(JSON.parse(await res.text()) as CaseReport);
      } catch { setDead(true); }
    })();
  }, [caseId, token]);

  /* BOTH EFFECTS AT THE TOP, BEFORE ANY RETURN. React runs hooks in the same order on
     every render, so a hook placed after an early return - as the loading and dead
     states below would require if this one followed them - is a hook that sometimes
     does not run at all, which React refuses outright. The `report !== null` guard
     inside the effect body does the job the early return would have, without moving
     the call itself. */
  useEffect(() => {
    if (report !== null) document.title = `${report.compoundLabel} - deliberation record`;
  }, [report]);

  if (dead) return <LinkNotValid />;
  if (report === null) return <p className="muted">Opening the record…</p>;

  /* NO `publishedUrl`. It existed only to draw the QR the sheet used to print, and the
     code has moved to the convener's share widget - which this page, having no controls,
     deliberately does not render. A reader who is already AT the URL does not need a code
     encoding it. */
  return <ReportPage report={report} page={page} onNavigate={setPage} />;
}

function Boot(): ReactElement {
  const at = parsePublicPath(window.location.pathname);
  if (at === null) return <LinkNotValid />;
  return <PublicReport caseId={at.caseId} token={at.token} />;
}

const host = document.getElementById("root");
if (host !== null) createRoot(host).render(<StrictMode><Boot /></StrictMode>);
