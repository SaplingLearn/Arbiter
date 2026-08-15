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

/** The rail entry a route lights up. Case routes belong to the dashboard. */
export function currentNav(route: Route): NavItem | undefined {
  if (route.name === "cases") return NAV[2];
  const direct = NAV.find((n) => n.to.name === route.name);
  if (direct !== undefined) return direct;
  return NAV[0];
}
