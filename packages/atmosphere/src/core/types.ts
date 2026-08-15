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
}

export type SceneFactory = (ctx: SceneContext) => AtmosphereScene;
