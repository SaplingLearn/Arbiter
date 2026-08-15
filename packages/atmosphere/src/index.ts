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
export { Atmosphere } from "./core/Atmosphere.js";
export { PALETTE } from "./core/palette.js";
export type {
  AtmosphereScene,
  SceneContext,
  SceneFactory,
} from "./core/types.js";

export { STATES, STATE_IDS, type StateDef } from "./scenes/registry.js";

export { createArchive } from "./scenes/archive.js";
export { createCulture } from "./scenes/culture.js";
export { createGenesis } from "./scenes/genesis.js";
export { createHelix } from "./scenes/helix.js";
export { createMonolith } from "./scenes/monolith.js";
export { createSynapse } from "./scenes/synapse.js";
