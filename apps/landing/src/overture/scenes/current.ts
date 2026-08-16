import { PerspectiveCamera, Scene, ShaderMaterial, Vector3 } from "three";
import { PALETTE } from "../lib/palette.js";
import { makeMotes } from "../lib/motes.js";
import { makeRibbon } from "../lib/ribbon.js";
import { makeSky } from "../lib/sky.js";
import { makeTerrain } from "../lib/terrain.js";
import { fovFor, type SceneHandle, type SceneOptions } from "../lib/types.js";

/**
 * 2 — CURRENT.  "One path through the evidence."
 *
 * A single luminous trail threading a dark canyon, seen from above and behind, with the
 * rock it passes lit for a moment as it goes.
 *
 * WHY THIS FOR THIS SECTION. The section is about METHOD, and the argument it has to
 * make visually is that there is exactly one route through — not a cloud of
 * possibilities, not a search. So this is the only frame in the set with a single
 * emitter and no field: one line, unbranched, going somewhere. Everything the frame
 * knows about the landscape it learns from what that line lights up, which is also
 * the honest picture of how the product works.
 *
 * The camera holds still and the PULSES travel. The reference moves the camera on most
 * of its frames and deliberately does not here, because a moving camera over a moving
 * trail loses which of the two is going anywhere.
 */
export function createCurrent(opts: SceneOptions): SceneHandle {
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 16 / 9, 0.1, 900);
  // BEHIND the near end of the trail, looking down its length. The first two placements
  // both sat at z = 96..104, which is in FRONT of where the path starts at z = 150 — so
  // the near half of the trail was behind the lens and the frame showed a short streak
  // receding into an empty canyon. Where the camera sits relative to the curve's start
  // is the whole shot here.
  camera.position.set(-8, 34, 186);
  camera.lookAt(6, 9, -90);

  /* ---- the canyon ------------------------------------------------------ */

  // A tall, tight valley. The amplitude is high and the channel narrow so the walls
  // read as rock rather than as dunes — at a gentler slope the trail looks like it is
  // crossing open country, and the sense of a route being FOUND goes with it.
  const terrain = makeTerrain({
    width: 460,
    depth: 620,
    segments: Math.max(64, Math.round(210 * opts.quality)),
    amp: 40,
    scale: 72,
    valley: 21,
    seed: 5.1,
    lit: PALETTE.azure.clone().lerp(PALETTE.sky, 0.42),
  });
  const sky = makeSky();
  scene.add(sky.mesh);
  scene.add(terrain.mesh);

  /* ---- the trail ------------------------------------------------------- */

  // Hand-placed rather than generated. The reference's curve does one thing worth
  // copying exactly: it swings wide EARLY and straightens as it recedes, so the near
  // half reads as a bend and the far half as distance. A symmetric sine does neither.
  const path = [
    new Vector3(-34, 3.0, 150),
    new Vector3(-16, 4.2, 96),
    new Vector3(-24, 4.6, 44),
    new Vector3(4, 5.2, 4),
    new Vector3(20, 6.0, -44),
    new Vector3(10, 7.4, -104),
    new Vector3(30, 9.0, -172),
    new Vector3(24, 11.0, -250),
  ];

  const trail = makeRibbon({
    points: path,
    radius: 0.95,
    segments: Math.max(120, Math.round(300 * opts.quality)),
    colorCore: PALETTE.white.clone(),
    colorHalo: PALETTE.cyan.clone(),
    pulses: 3,
    speed: 0.085,
    sparks: Math.round(320 * opts.quality),
    seed: 0x2f11,
  });
  scene.add(trail.group);

  // Four sample points along the trail become the terrain's light sources. Four is the
  // shader's limit and it is enough: any more and the washes merge into a single band
  // down the valley, which is the look of a lit corridor rather than of a light
  // travelling through a dark one.
  const lit = [0.18, 0.42, 0.66, 0.88].map((u) => {
    const i = Math.min(path.length - 1, Math.round(u * (path.length - 1)));
    return path[i]!;
  });
  lit.forEach((p, i) => terrain.setLight(i, p, 96));

  const motes = makeMotes(Math.round(700 * opts.quality), 60, 0x77c1, {
    colorA: PALETTE.sky.clone(),
    colorB: PALETTE.azure.clone(),
    size: 1.3,
    speed: 0.16,
  });
  motes.position.set(0, 22, -20);
  scene.add(motes);

  return {
    scene,
    camera,
    update(t) {
      trail.update(t);
      (motes.material as ShaderMaterial).uniforms["uTime"]!.value = t;
      if (opts.reducedMotion) return;

      // Barely anything — a slow breath in and out along the valley's axis. Enough that
      // the frame is not a photograph, far too little to compete with the pulses.
      camera.position.y = 34 + Math.sin(t * 0.09) * 1.8;
      camera.position.x = -8 + Math.sin(t * 0.055) * 3.0;
      camera.lookAt(6, 9, -90);
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.fov = fovFor(camera.aspect);
      camera.updateProjectionMatrix();
    },
    dispose() {
      sky.dispose();
      terrain.dispose();
      trail.dispose();
      motes.geometry.dispose();
      (motes.material as ShaderMaterial).dispose();
    },
  };
}
