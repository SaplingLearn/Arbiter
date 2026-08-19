import type { Route } from "../router.js";

/**
 * THE MENU, AND THE ENVIRONMENT BEHIND EACH ENTRY — one table, because they are one
 * decision.
 *
 * The rail lights the part of the product you are in (`scene` says which environment
 * that entry stands in), and the backdrop mounts it. Kept apart, those two drift the
 * first time a tab is reordered or a scene renamed, and the failure is silent: a rail
 * that says ARCHIVE over a field of cells. Nothing here reaches into
 * `packages/atmosphere` — `scene` is the id the package publishes, and a wrong one is
 * caught by the backdrop at mount.
 *
 * THAT LAST SENTENCE IS A BUNDLE CONSTRAINT, NOT A STYLE PREFERENCE, and it is why the
 * codenames below are a local table rather than a read of the registry that owns them.
 * `STATES` lives in `scenes/registry.ts`, which statically imports all seven scene
 * factories, and each of those imports `three` and `gsap`. `Backdrop.tsx` reaches the
 * package through `await import()` for exactly this reason. `Chrome.tsx` imports this
 * file eagerly, so a static `import { STATES }` here would pull the whole 3D stack into
 * the shell chunk that renders the sign-in screen. The duplication is paid for in
 * `test/nav.test.ts`, which imports the registry for real and fails if the two disagree
 * — a test can afford the import, the shell cannot.
 */
export interface NavItem {
  label: string;
  /** Scene id in `@arbiter/atmosphere`. */
  scene: string;
  to: Route;
}

/**
 * EVERY ENVIRONMENT'S NAME, keyed by the scene id the backdrop mounts.
 *
 * This was a `codename` field on the menu entries, and that shape could only ever name
 * the environments a menu entry points at. The record has no entry — it is reached from
 * inside a case, never from the menu — so the corner readout fell back to whichever
 * entry was lit and named the wrong world out loud: ARCHIVE while the Helix was closing
 * over a sealed record. Measured, not inferred: `currentNav` answered `Archive` for
 * `{ name: "record" }` while `sceneFor` mounted `record`, whose name is `Helix`.
 *
 * That is the drift this file's opening note warns about, arriving from the side the
 * note did not expect — not a stale table, but a table that never covered the case.
 * Keyed by scene it cannot recur, because the key IS what the backdrop mounted.
 */
export const CODENAME: Record<string, string> = {
  dashboard: "Culture",
  read: "Section",
  new: "Genesis",
  library: "Archive",
  ask: "Synapse",
  record: "Helix",
};

export const NAV: NavItem[] = [
  { label: "Dashboard", scene: "dashboard", to: { name: "dashboard" } },
  /**
   * SECOND, between the dashboard and opening a case, because that is where reading
   * sits in the work. The dashboard says what is waiting on you; the next thing a
   * reviewer does about it is read the evidence. Putting it after "New case" would
   * order the rail by how often a screen is BUILT rather than by how often it is used.
   *
   * It points at the reading room rather than at a document, because a menu entry has
   * no caseId and `read` requires one. See `{ name: "reading" }` in router.ts.
   */
  { label: "Read", scene: "read", to: { name: "reading" } },
  { label: "New case", scene: "new", to: { name: "new" } },
  { label: "Library", scene: "library", to: { name: "cases" } },
  { label: "Ask", scene: "ask", to: { name: "ask" } },
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
  //
  // The reading ROOM needs no line here: it is a NAV entry, so the lookup at the
  // bottom of this function already puts it in Section, which is where a page that
  // lists documents belongs.
  if (route.name === "read") return "read";
  // The printable record stands in the Archive with the rest of the case. It is the
  // case as a finished document, not a seal closing - the Helix is for the record
  // route, which is a different screen about a different subject.
  if (route.name === "case" || route.name === "position" || route.name === "reveal"
    || route.name === "report") {
    return "library";
  }
  return NAV.find((n) => n.to.name === route.name)?.scene ?? "dashboard";
}

/**
 * The name of the environment drawn behind a route — what the corner readout says.
 *
 * DERIVED FROM `sceneFor`, NOT FROM THE MENU, and that is the whole of the fix. The
 * chrome asks two different questions and had one answer between them: which part of
 * the product you are in (the menu highlight, `currentNav` below) and which place you
 * are standing in (this). The record is reached from inside a case and has no menu
 * entry, so answering the second question with the first named a world the reader was
 * not in.
 *
 * `undefined` for a scene with no name, so the corner draws nothing rather than an
 * empty dot. Adding a scene and forgetting to name it is now what shows up, instead of
 * a wrong name that does not.
 */
export function codenameFor(route: Route): string | undefined {
  return CODENAME[sceneFor(route)];
}

/** Rail entry by scene id, so inserting a NAV entry cannot silently repoint another. */

/**
 * Rail entry by the ROUTE it points at, and it used to be by scene.
 *
 * A scene id stops identifying an entry the moment two of them share a world. That is
 * not hypothetical: the Dashboard was briefly moved into the Archive so its field would
 * draw one body per case, and `find` returns the first match - so every lookup for
 * `library`, meaning the library page and all four case routes, silently resolved to the
 * DASHBOARD entry and printed its codename. The Dashboard has its own scene again and
 * nothing shares one today; this stays keyed on the destination because two entries
 * sharing a world is a legitimate arrangement and the scene-keyed lookup could not
 * survive it. No two entries share a DESTINATION, which is what makes this total.
 */
const navByRoute = (name: Route["name"]): NavItem | undefined =>
  NAV.find((n) => n.to.name === name);

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
  if (route.name === "cases") return navByRoute("cases");
  const direct = NAV.find((n) => n.to.name === route.name);
  if (direct !== undefined) return direct;
  // READING LIGHTS READ, and it lit the Library until this entry existed.
  //
  // That was not a preference, it was the drift this file's opening note is about. A
  // `read` route stands in Section - `sceneFor` says so, and the corner readout prints
  // the active entry's codename - so the rail read ARCHIVE over a focal plane moving
  // through a stained section, naming a world the reader was not in. The entry the
  // route lights and the scene behind it are one decision; now there is an entry to
  // make it with.
  if (route.name === "read") return navByRoute("reading");
  /**
   * RECORD IS IN THIS LIST, and leaving it out was a silent drift of exactly the kind
   * this file's opening note describes.
   *
   * It is a case route with no rail entry of its own - the Helix has no tab - so it
   * fell past every branch here to the closing `dashboard` fallback. The rail and the
   * corner readout therefore said CULTURE, naming a field of colonies, while the
   * screen sat in front of a seal closing. Nothing threw: the fallback is a legitimate
   * answer for a route that has no better one, which is why it was able to be wrong
   * for so long.
   *
   * The Library is the honest answer for the same reason it is for the other case
   * routes: the case being recorded is one of the bodies in it.
   */
  if (route.name === "case" || route.name === "position"
    || route.name === "reveal" || route.name === "report" || route.name === "record") {
    return navByRoute("cases");
  }
  return navByRoute("dashboard");
}
