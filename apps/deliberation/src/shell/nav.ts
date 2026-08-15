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
 * THE CASE ROUTES STAY IN THE DASHBOARD'S FIELD, and that is the whole idea rather
 * than a saving. The dashboard draws every case as one cell among many; opening a case
 * flies the camera to a single cell instead of cutting to a different world, so the
 * background answers "where am I" with "in one of those". A scene swap here would
 * throw away the only spatial relationship this interface has.
 *
 * The record is the exception. Once a case is closed and signed, the subject is no
 * longer the case among its neighbours - it is the seal - so the Helix takes over and
 * the swap is doing real work.
 */
export function sceneFor(route: Route): string {
  if (route.name === "record") return "record";
  if (route.name === "case" || route.name === "position" || route.name === "reveal") {
    return "dashboard";
  }
  return NAV.find((n) => n.to.name === route.name)?.scene ?? "dashboard";
}

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
    case "ask": return { duration: 0.85, bands: 26, axis: "y" };
    case "record": return { duration: 1.8, bands: 3, axis: "x" };
    default: return { duration: 1.35, bands: 9, axis: "x" };
  }
}

/** The rail entry a route lights up. Case routes belong to the dashboard. */
export function currentNav(route: Route): NavItem | undefined {
  if (route.name === "cases") return NAV[2];
  const direct = NAV.find((n) => n.to.name === route.name);
  if (direct !== undefined) return direct;
  return NAV[0];
}
