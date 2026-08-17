/**
 * Which body in the Archive a case is, decided without any of the graphics.
 *
 * PUBLISHED AS `@arbiter/atmosphere/subjects`, ITS OWN ENTRY POINT, and that is not
 * tidiness. The package's main entry reaches `three`, which is ~500KB and larger than
 * the rest of the product's bundle put together - `Backdrop` imports it dynamically for
 * exactly that reason, so first paint never waits on scenery. The app has to decide the
 * field's population during render, long before the engine has arrived, so it needs
 * this rule at module scope. A second entry point that pulls in no graphics is what
 * lets it have one without dragging the renderer in front of the type.
 *
 * PULLED OUT OF `archive.ts` SO IT CAN BE TESTED. The rule below is the one place in
 * the scene where the environment makes a claim about a case rather than drawing one,
 * and it had a bug that no amount of looking at the shader would have found. Everything
 * here is arithmetic over strings and booleans; nothing imports `three`, so a test can
 * run it in jsdom.
 */

/** FNV-1a. Two callers: which body a stray case lands on, and which plain is inside
 *  the body it lands on. Both need the same case to give the same answer forever. */
export function hash32(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Which body a case is: EXACT, THEN PREFIX, THEN A HASH — and the hash may only ever
 * land on a body that was not refused.
 *
 * A prepared case opened from the library gets a caseId built from the case file's own
 * id and the opener's account - `nipocalimab-imaavy--<userId>` for the catalogue entry
 * named `nipocalimab`. So the route's key is neither the catalogue name nor equal
 * between two people who opened the same case. Cutting at `--` and matching the
 * remainder by prefix lands both of them on the same body, which is the behaviour a
 * reader would expect and the reason this is not a plain lookup.
 *
 * THE HASH IS FOR CASES THAT ARE NOT IN THE LIBRARY AT ALL - anything a person opened
 * themselves. There is no body of their own to fly into, and the honest options are to
 * stay wide or to pick one deterministically. Picking one keeps the gesture consistent
 * for every case; it is also the one place in this scene where the environment shows
 * something it does not know, and it is worth saying so out loud.
 *
 * WHAT IT MAY NOT DO IS PICK A REFUSED ONE, and it used to. The fallback was
 * `hash32(key) % keys.length` over the whole field, two of whose six bodies are the
 * library's refused documents - so roughly one case in three that somebody opened
 * themselves flew into the red chamber and was graded dead on arrival. `heldDead` is
 * read straight off the body's own state bit, so the interior went red, the air went
 * red, and the environment told a reviewer their case had been REFUSED when nothing of
 * the kind had happened. Borrowing a body is a small lie the scene already admits to;
 * borrowing its verdict is a different and much larger one.
 *
 * Falls back to the whole field only when NOTHING is usable, because a wrong body still
 * beats no gesture at all - and in that state every body is refused, so there is no
 * misleading answer left to give.
 *
 * @param keys   body key per index, in the order `populate` laid them out
 * @param usable whether each body is a usable case, parallel to `keys`
 */
export function resolveBody(keys: readonly string[], usable: readonly boolean[], key: string): number {
  if (keys.length === 0) return -1;

  const exact = keys.indexOf(key);
  if (exact !== -1) return exact;

  const byPrefix = keys.findIndex((k) => prefixMatches(k, key));
  if (byPrefix !== -1) return byPrefix;

  const live: number[] = [];
  for (let i = 0; i < keys.length; i++) if (usable[i] === true) live.push(i);
  if (live.length === 0) return hash32(key) % keys.length;
  return live[hash32(key) % live.length]!;
}

/** Whether `key` is a caseId minted from the catalogue entry `bodyKey`. One copy,
 *  because `resolveBody` and `mergeSubjects` have to agree about it exactly: the first
 *  sends a case to a body and the second decides no new body is needed. */
function prefixMatches(bodyKey: string, key: string): boolean {
  const stem = key.split("--")[0] ?? key;
  return stem === bodyKey || stem.startsWith(`${bodyKey}-`);
}

export interface Subject { key: string; usable: boolean }

/**
 * Every case that can be seen, as one body each.
 *
 * ONE CUBE PER CASE, AND NEVER TWO CASES SHARING ONE. The field used to be the library
 * catalogue and nothing else, so a case somebody opened themselves had no body and
 * borrowed one - which meant several of your own cases shared a cube, and flying to one
 * of them landed on a body belonging to a different case entirely. Passing your own
 * cases in gives `resolveBody` an exact match for every one of them, and the borrow
 * stops happening at all rather than being made safer.
 *
 * AN OPENED LIBRARY CASE IS NOT A SECOND CASE. Opening `nipocalimab` from the library
 * mints `nipocalimab-imaavy--<userId>`, which is the same case wearing an account's
 * name. It already resolves to the catalogue body by prefix, so adding it again would
 * put TWO cubes on screen for one case - the opposite error, and just as wrong. Those
 * are dropped here, by the same predicate that does the resolving.
 *
 * OWN CASES ARE USABLE. `usable: false` means a document the splitter refused, which is
 * a property of the library's corpus. A case a person opened is not a refused document
 * and must never be drawn as one.
 *
 * The catalogue keeps the front of the list so the library's own bodies stay in a
 * stable order as cases come and go behind them.
 */
export function mergeSubjects(
  catalogue: readonly Subject[],
  ownCaseIds: readonly string[],
): Subject[] {
  const out: Subject[] = [...catalogue];
  const seen = new Set(catalogue.map((s) => s.key));
  for (const id of ownCaseIds) {
    if (seen.has(id)) continue;
    if (catalogue.some((s) => prefixMatches(s.key, id))) continue;
    seen.add(id);
    out.push({ key: id, usable: true });
  }
  return out;
}
