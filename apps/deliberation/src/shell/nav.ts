import type { Route } from "../router.js";

/**
 * THE MENU, AND THE ENVIRONMENT BEHIND EACH ENTRY — one table, because they are one
 * decision.
 *
 * The rail names the scene you are standing in (`codename`), and the backdrop mounts
 * it (`scene`). Kept apart, those two drift the first time a tab is reordered or a
 * scene renamed, and the failure is silent: a rail that says ARCHIVE over a field of
 * cells. Nothing here reaches into `packages/atmosphere` — `scene` is the id the
 * package publishes, and a wrong one is caught by the backdrop at mount.
 */
export interface NavItem {
  label: string;
  /** The environment's own name, as the rail shows it on the active entry. */
  codename: string;
  /** Scene id in `@arbiter/atmosphere`. */
  scene: string;
  to: Route;
}

export const NAV: NavItem[] = [
  { label: "Dashboard", codename: "Culture", scene: "dashboard", to: { name: "dashboard" } },
  { label: "New case", codename: "Genesis", scene: "new", to: { name: "new" } },
  { label: "Library", codename: "Archive", scene: "library", to: { name: "cases" } },
  { label: "Ask", codename: "Synapse", scene: "ask", to: { name: "ask" } },
];

/**
 * Which environment a route stands in.
 *
 * THE CASE ROUTES STAND IN THE ARCHIVE, and the bodies there are why.
 *
 * This used to send them to the dashboard, on the argument that opening a case should
 * fly to one cell of the field you came from rather than cut to a different world - the
 * background answering "where am I" with "in one of those". The reasoning was right and
 * the field was wrong: the dashboard's colonies are organic blobs picked by hashing the
 * case id, so the thing you flew to was A cell, never THAT case's cell. Nothing in that
 * field knows what a case is.
 *
 * The Archive does. It draws one body per case in the library, keyed by case, and it
 * can be entered - so opening a case now goes inside the specific body that case is.
 * A named object beats an unnamed neighbourhood.
 *
 * WHAT THIS COSTS, stated rather than buried: opening a case from the dashboard cuts
 * from the colonies to the archive, which is a scene swap the old arrangement existed
 * to avoid. And a case somebody opened themselves has no body in the library at all, so
 * the Archive picks one deterministically and the environment is, for that case,
 * showing something it does not know. Both are real. The exchange is a gesture that
 * means something for library cases against one that meant nothing for any case.
 *
 * The record is still the exception. Once a case is closed and signed the subject is no
 * longer the case among its neighbours - it is the seal - so the Helix takes over.
 */
export function sceneFor(route: Route): string {
  if (route.name === "record") return "record";
  // READING STANDS IN ITS OWN SCENE, and it is the one case route that does not stay in
  // the Archive. The argument above for sending case routes there is that the Archive
  // draws the case as a body you go inside; that holds while the subject is the case
  // among its neighbours. On the reading surface the subject is narrower than the case -
  // it is one document, and one passage of it - and Section is the environment for
  // exactly that: a volume with a focal plane moving through it. A field of vitrines
  // behind somebody reading page 112 is the case's neighbourhood answering a question
  // about a paragraph.
  if (route.name === "read") return "read";
  if (route.name === "case" || route.name === "position" || route.name === "reveal") {
    return "library";
  }
  return NAV.find((n) => n.to.name === route.name)?.scene ?? "dashboard";
}

/** Rail entry by scene id, so inserting a NAV entry cannot silently repoint another. */
const navByScene = (scene: string): NavItem | undefined => NAV.find((n) => n.scene === scene);

/**
 * HOW EACH ARRIVAL LOOKS.
 *
 * The engine's transition is a band tear, and its character is entirely in how many
 * bands there are, which way they run, and how long they take. One transition played
 * identically every time stops being a transition and becomes a wipe, so each
 * destination gets the move that suits what it is:
 *
 *   dashboard  wide horizontal bands, unhurried — opening onto a field
 *   new        few, vertical, quick — a structure standing up out of nothing
 *   library    many fine horizontal bands — shelves, riffled through
 *   read       few wide horizontal bands, slow — a plane settling onto a page
 *   ask        thin vertical bands, fastest of the set — a thought firing
 *   record     three heavy bands, slowest of the set — something closing
 *
 * Keyed by destination rather than by pair. A per-pair table is more expressive and
 * has twenty-five entries, twenty of which nobody will ever look at closely enough to
 * justify keeping them correct.
 */
export function transitionFor(scene: string): { duration: number; bands: number; axis: "x" | "y" } {
  switch (scene) {
    case "new": return { duration: 1.0, bands: 5, axis: "y" };
    case "library": return { duration: 1.45, bands: 18, axis: "x" };
    case "read": return { duration: 1.6, bands: 6, axis: "x" };
    case "ask": return { duration: 0.85, bands: 26, axis: "y" };
    case "record": return { duration: 1.8, bands: 3, axis: "x" };
    default: return { duration: 1.35, bands: 9, axis: "x" };
  }
}

/**
 * The rail entry a route lights up.
 *
 * CASE ROUTES LIGHT THE LIBRARY, because that is the scene behind them. This file's
 * opening note is that the rail and the backdrop are one decision and drift silently
 * when they are two - a rail reading ARCHIVE over a field of cells. Moving the case
 * routes to the Archive without moving this would have produced exactly that, the other
 * way round: DASHBOARD over a field of cubes, with the codename naming the wrong world.
 */
export function currentNav(route: Route): NavItem | undefined {
  // BY SCENE, NOT BY INDEX. These were NAV[2] and NAV[0] until a sixth entry was
  // inserted second, which moved Library from 2 to 3 and would have lit the wrong rail
  // entry everywhere a case is open - silently, because an index that still resolves
  // does not throw. The lookup is the same decision the file's opening note makes about
  // the rail and the backdrop: name the thing, do not count to it.
  if (route.name === "cases") return navByScene("library");
  const direct = NAV.find((n) => n.to.name === route.name);
  if (direct !== undefined) return direct;
  // Reading has no rail entry of its own yet - there is no top-level route to give one,
  // since `read` needs a caseId and a menu entry has none. It lights the Library, which
  // is where the case it belongs to lives.
  if (route.name === "read") return navByScene("library");
  if (route.name === "case" || route.name === "position" || route.name === "reveal") {
    return navByScene("library");
  }
  return navByScene("dashboard");
}
