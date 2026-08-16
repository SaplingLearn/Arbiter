import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";

export interface SceneContext {
  renderer: WebGLRenderer;
  /** Particle-count multiplier from the boot-time quality probe. 0.35 – 1.0. */
  quality: number;
  reducedMotion: boolean;
}

/**
 * One background state.
 *
 * A scene knows nothing about routing, about the other scenes, or about how it is
 * being composited. It owns geometry and its own motion; the controller owns when it
 * exists. That boundary is what makes a scene replaceable without touching anything
 * else, and it is worth keeping strictly even when a shortcut would be easy.
 */
export interface AtmosphereScene {
  readonly id: string;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;

  /**
   * @param dt      seconds since last frame, clamped by the caller
   * @param elapsed seconds since this scene was mounted, not since page load, so a
   *                scene always begins its own motion at zero however late it mounts
   */
  update(dt: number, elapsed: number): void;
  resize(width: number, height: number): void;
  dispose(): void;

  /**
   * Single out one thing in this scene, or `null` to return to the wide shot.
   *
   * OPTIONAL, and most scenes will never implement it. It exists for the scenes that
   * draw MANY of something, where the consumer has many of the same something - the
   * dashboard's field of colonies against a reviewer's list of cases. A scene that
   * draws one object has nothing to single out and should leave this undefined rather
   * than implement it as a no-op.
   *
   * The key is an opaque string from the consumer, never an index. The scene decides
   * which of its objects a key lands on and must do so deterministically, so the same
   * case is the same cell every time it is opened - a case that moves between visits
   * is scenery pretending to be information.
   */
  focus?(key: string | null): void;

  /**
   * Tell this scene what it is drawing, one subject per body.
   *
   * OPTIONAL, and for the same family of scenes as `focus` - the ones that draw many
   * of something. The difference is that `focus` singles one out of a field the scene
   * invented for itself, and this replaces the invention with the real set.
   *
   * A DECORATIVE COUNT IS A LIE THE READER CAN CHECK. A field of forty-two bodies over
   * a library holding six says the archive is large; the reader counts six rows in the
   * table and now knows the background is scenery. One body per subject costs nothing
   * and makes the environment a second reading of the same fact.
   *
   * Keys are opaque and the ORDER is the consumer's, so the same list always builds the
   * same field - a body that moves between visits is scenery pretending to be
   * information, which is the same rule `focus` is held to.
   *
   * Called on mount and again whenever the set changes. A scene must handle being
   * populated before it has ever drawn, and being re-populated with a different length.
   */
  populate?(subjects: readonly SceneSubject[]): void;
}

/** One thing a scene draws a body for. */
export interface SceneSubject {
  /** Stable, opaque identifier from the consumer. Never an index. */
  key: string;
  /** Whether the subject is usable. Scenes that distinguish live from dead read this. */
  usable: boolean;
}

export type SceneFactory = (ctx: SceneContext) => AtmosphereScene;
