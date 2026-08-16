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
  | { name: "record"; caseId: string }
  | { name: "read"; caseId: string; documentId?: string; page?: number }
  | { name: "ask" }
  | { name: "method" };

export const DEFAULT_ROUTE: Route = { name: "dashboard" };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter((p) => p !== "");
  if (parts.length === 0) return DEFAULT_ROUTE;

  if (parts[0] === "method") return { name: "method" };
  if (parts[0] === "ask") return { name: "ask" };
  if (parts[0] === "new") return { name: "new" };
  if (parts[0] === "library") return { name: "cases" };
  if (parts[0] === "dashboard") return { name: "dashboard" };

  if (parts[0] === "case" && parts[1] !== undefined) {
    const caseId = decodeURIComponent(parts[1]);
    switch (parts[2]) {
      case undefined: return { name: "case", caseId };
      case "position": return { name: "position", caseId };
      case "reveal": return { name: "reveal", caseId };
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
    case "method": return "#/method";
    case "case": return `#/case/${encodeURIComponent(route.caseId)}`;
    case "position": return `#/case/${encodeURIComponent(route.caseId)}/position`;
    case "reveal": return `#/case/${encodeURIComponent(route.caseId)}/reveal`;
    case "record": return `#/case/${encodeURIComponent(route.caseId)}/record`;
    case "read": {
      const base = `#/case/${encodeURIComponent(route.caseId)}/read`;
      if (route.documentId === undefined) return base;
      const doc = `${base}/${encodeURIComponent(route.documentId)}`;
      return route.page === undefined ? doc : `${doc}/${route.page}`;
    }
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
