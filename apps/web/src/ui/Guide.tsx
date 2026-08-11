import type { TabId } from "../router.js";
import { Character, type CharacterFace } from "./Character.js";

/**
 * A one-line orientation for whichever tab you have landed on, with a face beside it.
 *
 * WHY A LINE AND NOT A TOUR STOP. The tour already exists and is the guided path;
 * this is for the reader who arrived on a tab from a shared link, a keyboard jump or
 * a mistyped fragment, and has no idea which of seven screens they are on or what it
 * is for. One sentence, in plain language, above the tab's own heading.
 *
 * The copy is deliberately not marketing. Every line says what the screen is FOR and,
 * where it matters, what it will not tell you - the same voice as the caveats, for
 * the same reason: a guide that oversells the screen it introduces is worse than no
 * guide, because the reader then has to discover the limit for themselves.
 *
 * Typed as a total Record<TabId, ...>, so adding a tab without deciding how to
 * introduce it fails the typecheck rather than shipping a screen with no orientation.
 */
const GUIDES: Record<TabId, { face: CharacterFace; line: string }> = {
  about: {
    face: "girl1",
    line: "New here? This page says what ARBITER does, and is just as careful about what it does not.",
  },
  compounds: {
    face: "boy1",
    line: "Every scored compound. The ones whose streams genuinely conflict are the ones worth your time.",
  },
  case: {
    face: "girl2",
    line: "One compound, three panels: the evidence, the argument it produced, and where you can push back.",
  },
  ruleset: {
    face: "boy2",
    line: "The six rules exactly as they were registered. Move a strength and watch the verdict answer live.",
  },
  validation: {
    face: "boy2",
    line: "The measured numbers, including the ones that do not flatter us. The caveats are the point.",
  },
  record: {
    face: "girl1",
    line: "Positions are signed here. Each block hashes the one before it, which is what makes tampering show.",
  },
  intake: {
    face: "boy1",
    line: "Bring your own compound. ARBITER will tell you what it cannot conclude about it, and why.",
  },
};

export function Guide({ tab }: { tab: TabId }) {
  const guide = GUIDES[tab];
  return (
    // A note, not a status: it does not change in response to anything the reader
    // does, so announcing it politely on every tab change would interrupt rather
    // than help. It is read in document order like the prose it introduces.
    <aside className="guide" data-testid={`guide-${tab}`}>
      <Character face={guide.face} size={40} />
      <p className="guide-line">{guide.line}</p>
    </aside>
  );
}
