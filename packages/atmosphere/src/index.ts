/**
 * THE ATMOSPHERE — the product's living backgrounds.
 *
 * One WebGL context, a catalogue of scenes, and a displacement transition between
 * them. Lifted out of `apps/atmosphere` the moment there were two consumers, which is
 * the bar `packages/design` set for itself when it was written: one consumer does not
 * justify a package, two do. `apps/atmosphere` is now the demo shell that previews
 * these scenes in isolation; `apps/deliberation` is the product that lives inside them.
 *
 * NOTHING IN HERE KNOWS ABOUT A ROUTE, A CASE, OR AN API. Scenes own geometry and
 * their own motion; the consumer owns which one exists and when. That line is what
 * kept the engine reusable in the first place and it is worth holding.
 */
export { Atmosphere, type TransitionStyle } from "./core/Atmosphere.js";
export { PALETTE } from "./core/palette.js";
export type {
  AtmosphereScene,
  SceneContext,
  SceneFactory,
  SceneSubject,
} from "./core/types.js";

/* The field's population rule. Exported because the PRODUCT decides what a case is -
   the package only draws what it is handed - and the one thing it must not do is
   invent a second body for a case that already has one. */
export { mergeSubjects, type Subject } from "./core/subjects.js";

export { STATES, STATE_IDS, type StateDef } from "./scenes/registry.js";

export { createArchive } from "./scenes/archive.js";
export { createCulture } from "./scenes/culture.js";
export { createGenesis } from "./scenes/genesis.js";
export { createHelix } from "./scenes/helix.js";
export { createMonolith } from "./scenes/monolith.js";
export { createSection } from "./scenes/section.js";
export { createSynapse } from "./scenes/synapse.js";
