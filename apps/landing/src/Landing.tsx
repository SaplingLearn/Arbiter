import { Overture } from "./overture/Overture.js";

/**
 * The landing page.
 *
 * Six full-viewport WebGL panels over one fixed canvas — see `overture/Overture.tsx`
 * for the structure and `overture/content.ts` for what each one says.
 *
 * THIS REPLACED THE BLUEPRINT PAGE, and the replacement was total rather than
 * incremental. That is worth recording, because the intermediate state existed for a
 * while and was worse than either end: the new dark opening was grafted on top of the
 * old twelve-section light page, which left two headers, two design systems, and a hard
 * dark-to-light seam a screen down. A page can be one thing or the other. Half a
 * redesign is not a smaller redesign, it is a different and worse page.
 *
 * The old sections still exist under `src/sections/` and are no longer rendered. They
 * are kept, for now, because they hold copy — the run's actual numbers, the FAQ, the
 * ruleset walkthrough — that has not yet been re-homed anywhere in the new structure,
 * and deleting them would lose it. They should go once it has.
 */
export function Landing() {
  return <Overture />;
}
