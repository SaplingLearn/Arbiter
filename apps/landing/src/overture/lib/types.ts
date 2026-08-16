import type { PerspectiveCamera, Scene } from "three";

/** What every scene in the set has to provide, and nothing more. */
export type SceneHandle = {
  scene: Scene;
  camera: PerspectiveCamera;
  /** `t` is seconds since the page loaded, shared by every scene so a swap does not
   *  restart anybody's animation from zero. */
  update(t: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
  /**
   * Optional. Where the reader is inside this chapter's own scroll track, 0→1.
   *
   * The hook a scroll controller drives camera paths and scene morphs through. Optional
   * because a scene that ignores it is a valid scene — the opening is a held shot by
   * design — and forcing all six to implement a no-op would hide which ones actually
   * respond to scroll.
   */
  setProgress?(local: number): void;
};

export type SceneOptions = {
  /** 0..1. Scales vertex and particle counts on weaker hardware. */
  quality: number;
  /** Freezes every motion term. The frame is still fully composed and lit. */
  reducedMotion: boolean;
};

export type SceneFactory = (opts: SceneOptions) => SceneHandle;

/**
 * Widen the lens as the frame narrows.
 *
 * Shared by every scene because every one of them is composed HORIZONTALLY — a subject
 * between two flanking forms. A fixed vertical FOV is the three.js default and it is
 * wrong for all six: on a phone it crops the flanks out and zooms into the middle of
 * the picture, leaving the subject on an empty ground.
 *
 * The square root, and the ceiling, are both doing work. Holding the horizontal field
 * exactly constant needs ~100 degrees vertical at 9:19, which is a fisheye — the ground
 * stretches and objects bend at the edges. Half the correction, capped, keeps the
 * flanks in shot without distorting anything.
 */
export function fovFor(aspect: number, base = 34): number {
  const WIDE = 16 / 9;
  return aspect >= WIDE ? base : Math.min(56, base * Math.sqrt(WIDE / Math.max(aspect, 0.3)));
}
