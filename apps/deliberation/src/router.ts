/**
 * Hash routing, hand-rolled.
 *
 * NO ROUTER DEPENDENCY, for the same reason auth.ts adds no crypto dependency: this
 * is thirty lines, the whole surface is visible on one screen, and a routing library
 * would bring a transitive tree into a project that will hold unpublished safety
 * data. apps/web already made this call (`src/router.ts`); this is the same decision
 * for a different route table.
 *
 * HASH ROUTING RATHER THAN HISTORY API, deliberately. The client is served by Vite in
 * development and by whatever static host is convenient later; path routing needs the
 * server to rewrite unknown paths to index.html, and a deep link that 404s because
 * somebody forgot that rewrite is a bad first impression nobody notices until a
 * stakeholder clicks a shared URL.
 */

export type Route =
  | { name: "signin" }
  | { name: "dashboard" }
  | { name: "new" }
  | { name: "cases" }
  | { name: "case"; caseId: string }
  | { name: "position"; caseId: string }
  | { name: "reveal"; caseId: string }
  /**
   * The record as one printable document.
   *
   * A ROUTE RATHER THAN A DOWNLOAD, and that is the whole design of the feature. What
   * a reader needs first is to SEE what they are about to send somebody; a file that
   * lands in a downloads folder has to be opened before it can be checked, and by then
   * it has usually already been forwarded. This page is the check, and the browser's
   * own print dialog - which every reader already knows, and which has "Save as PDF"
   * in it - is the export.
   */
  | { name: "report"; caseId: string }
  | { name: "record"; caseId: string }
  | { name: "read"; caseId: string; documentId?: string; page?: number }
  /**
   * The reading room: every document this account can open, across every case it is
   * named on, with no case of its own.
   *
   * A SEPARATE NAME FROM `read`, not an optional caseId on it. `read` carries a
   * caseId in its type and forty lines of this app narrow on that fact - `caseIdOf`,
   * the case shell, the polling effect, `Steps`. Making it optional would turn every
   * one of those into a null check to express a page that shares none of their
   * behaviour: it has no stage strip, no poll, and no case to load. Two names cost
   * one line in each switch and keep the case routes' invariant intact.
   */
  | { name: "reading" }
  | { name: "ask" };

export const DEFAULT_ROUTE: Route = { name: "dashboard" };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter((p) => p !== "");
  if (parts.length === 0) return DEFAULT_ROUTE;

  if (parts[0] === "ask") return { name: "ask" };
  if (parts[0] === "new") return { name: "new" };
  // `#/read` and nothing after it. A trailing segment is NOT treated as a caseId and
  // quietly forwarded into the case reader: `#/read/abc` names no route this app
  // publishes, and guessing that `abc` is a case would send somebody who mistyped a
  // URL into a case they may not be on, to be told it does not exist. The reading
  // room lists what they can actually open instead.
  if (parts[0] === "read") return { name: "reading" };
  if (parts[0] === "library") return { name: "cases" };
  if (parts[0] === "dashboard") return { name: "dashboard" };

  if (parts[0] === "case" && parts[1] !== undefined) {
    const caseId = decodeURIComponent(parts[1]);
    switch (parts[2]) {
      case undefined: return { name: "case", caseId };
      case "position": return { name: "position", caseId };
      case "reveal": return { name: "reveal", caseId };
      case "report": return { name: "report", caseId };
      case "record": return { name: "record", caseId };
      case "read": {
        // #/case/:id/read/:documentId/:page. Both tail segments are optional, and a
        // page that is not a number is dropped rather than defaulted - a deep link
        // that silently lands on page 1 is worse than one that lands on the document.
        const documentId = parts[3] === undefined ? undefined : decodeURIComponent(parts[3]);
        const page = parts[4] === undefined || !/^\d+$/.test(parts[4])
          ? undefined
          : Number.parseInt(parts[4], 10);
        return {
          name: "read", caseId,
          ...(documentId === undefined ? {} : { documentId }),
          ...(page === undefined ? {} : { page }),
        };
      }
      // An unknown sub-route falls back to the case overview rather than to a 404
      // page. The caseId is still valid, so dropping the reader at the top of the
      // case they asked for beats telling them nothing exists.
      default: return { name: "case", caseId };
    }
  }

  return DEFAULT_ROUTE;
}

export function href(route: Route): string {
  switch (route.name) {
    case "signin": return "#/";
    case "dashboard": return "#/dashboard";
    case "new": return "#/new";
    case "cases": return "#/library";
    case "case": return `#/case/${encodeURIComponent(route.caseId)}`;
    case "position": return `#/case/${encodeURIComponent(route.caseId)}/position`;
    case "reveal": return `#/case/${encodeURIComponent(route.caseId)}/reveal`;
    case "report": return `#/case/${encodeURIComponent(route.caseId)}/report`;
    case "record": return `#/case/${encodeURIComponent(route.caseId)}/record`;
    case "read": {
      const base = `#/case/${encodeURIComponent(route.caseId)}/read`;
      if (route.documentId === undefined) return base;
      const doc = `${base}/${encodeURIComponent(route.documentId)}`;
      return route.page === undefined ? doc : `${doc}/${route.page}`;
    }
    case "reading": return "#/read";
    case "ask": return "#/ask";
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

/** The route's own caseId, or null on the routes that have none. Saves every caller
 *  re-narrowing the union to ask a question with an obvious answer. */
export function caseIdOf(route: Route): string | null {
  return "caseId" in route ? route.caseId : null;
}
