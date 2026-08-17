/**
 * Which body in the Archive a case is, decided without any of the graphics.
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

  const stem = key.split("--")[0] ?? key;
  const byPrefix = keys.findIndex((k) => stem === k || stem.startsWith(`${k}-`));
  if (byPrefix !== -1) return byPrefix;

  const live: number[] = [];
  for (let i = 0; i < keys.length; i++) if (usable[i] === true) live.push(i);
  if (live.length === 0) return hash32(key) % keys.length;
  return live[hash32(key) % live.length]!;
}
