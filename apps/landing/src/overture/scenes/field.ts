import { PerspectiveCamera, Scene, ShaderMaterial, Vector3 } from "three";
import { PALETTE } from "../lib/palette.js";
import { makeCube } from "../lib/cube.js";
import { makeGlow } from "../lib/glow.js";
import { makeMotes } from "../lib/motes.js";
import { makeRibbon, meander } from "../lib/ribbon.js";
import { makeSky } from "../lib/sky.js";
import { makeTerrain } from "../lib/terrain.js";
import { fovFor, type SceneHandle, type SceneOptions } from "../lib/types.js";

/**
 * 4 — FIELD.  "A library of cases, not one."
 *
 * Three cubes of different sizes standing on open ground, with light running past them
 * along the plain.
 *
 * WHY THIS FOR THIS SECTION. The section is the case library, and its argument is the
 * simplest in the set: there is more than one of these. Returning to the OPENING's
 * object and showing three of it says that in one look, and says it far better than any
 * new form could — the eye recognises the cube from four screens ago and does the
 * counting itself.
 *
 * THE SIZES ARE UNEQUAL AND THE SPACING IS NOT. Three identical cubes evenly spaced is
 * a product-feature diagram; three different ones at unrelated distances is a place
 * that happens to have three in it. The reference makes exactly that choice and it is
 * the whole difference between the frame reading as a landscape and as an infographic.
 *
 * The cubes do not carry the CUT. It is the opening object's signature and repeating it
 * three times would turn a detail into a pattern — these are other cases, not copies of
 * that one.
 */
export function createField(opts: SceneOptions): SceneHandle {
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 16 / 9, 0.1, 900);
  camera.position.set(0, 22, 104);
  camera.lookAt(-4, 20, -30);

  /* ---- the plain ------------------------------------------------------- */

  // Low amplitude and a long scale. This is the flattest ground in the set because the
  // cubes have to sit ON it and be seen against the sky — over rolling hills their
  // bases disappear and they stop being objects standing somewhere.
  const terrain = makeTerrain({
    width: 700,
    depth: 620,
    segments: Math.max(64, Math.round(190 * opts.quality)),
    amp: 11,
    scale: 150,
    seed: 9.4,
    lit: PALETTE.azure.clone().lerp(PALETTE.sky, 0.36),
  });
  const sky = makeSky();
  scene.add(sky.mesh);
  scene.add(terrain.mesh);

  /* ---- the cases ------------------------------------------------------- */

  const SPECS = [
    { size: 30, at: new Vector3(-58, 15, -66), yaw: 0.28, gain: 0.92 },
    { size: 11, at: new Vector3(6, 5.5, -104), yaw: -0.42, gain: 1.15 },
    { size: 22, at: new Vector3(62, 11, -84), yaw: 0.5, gain: 1.0 },
  ];

  const cubes = SPECS.map((s, i) => {
    const c = makeCube(s.size, { cut: false, seedShift: i * 3.1 + 1, gain: s.gain });
    c.mesh.position.copy(s.at);
    c.mesh.rotation.y = s.yaw;
    scene.add(c.mesh);

    const g = makeGlow(s.size * 3.4, PALETTE.cyan.clone().multiplyScalar(0.22));
    g.mesh.position.copy(s.at);
    scene.add(g.mesh);

    terrain.setLight(i, s.at, s.size * 3.8);
    return { cube: c, glow: g };
  });

  /* ---- the highways ---------------------------------------------------- */

  // Left to right across the whole plain, passing between and behind the cubes. They
  // are what stops the three objects reading as a still life: something is moving
  // through this place and the cubes are what it moves past.
  const ribbons: ReturnType<typeof makeRibbon>[] = [];
  const LANES = [
    { z: 30, y: 2.0, sway: 26, lead: true, seed: 0x5101 },
    { z: -6, y: 3.0, sway: 34, lead: false, seed: 0x5202 },
    { z: -46, y: 4.0, sway: 30, lead: true, seed: 0x5303 },
    { z: -92, y: 6.0, sway: 22, lead: false, seed: 0x5404 },
  ];

  for (const lane of LANES) {
    const count = lane.lead ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const isLead = lane.lead && i === 0;
      const r = makeRibbon({
        points: meander(lane.seed + i * 613, {
          from: new Vector3(-320, lane.y, lane.z + 40),
          to: new Vector3(320, lane.y + 2, lane.z - 40),
          sway: lane.sway * (0.4 + i / count),
          points: 8,
        }),
        radius: isLead ? 0.55 : 0.16,
        segments: Math.max(90, Math.round(220 * opts.quality)),
        colorCore: isLead ? PALETTE.white.clone() : PALETTE.sky.clone(),
        colorHalo: PALETTE.cyan.clone(),
        pulses: isLead ? 4 : 0,
        speed: 0.1,
        intensity: isLead ? 1 : 0.4,
        seed: lane.seed + i,
      });
      ribbons.push(r);
      scene.add(r.group);
    }
  }

  // The fourth terrain light rides the nearest lane, so the ground under the highways
  // is lit by them rather than only by the cubes.
  terrain.setLight(3, new Vector3(0, 3, 20), 118);

  const motes = makeMotes(Math.round(800 * opts.quality), 70, 0x6612, {
    colorA: PALETTE.sky.clone(),
    colorB: PALETTE.cyan.clone(),
    size: 1.3,
    speed: 0.18,
  });
  motes.position.set(0, 24, -30);
  scene.add(motes);

  return {
    scene,
    camera,
    update(t) {
      for (const r of ribbons) r.update(t);
      for (const c of cubes) {
        c.cube.material.uniforms["uTime"]!.value = t;
        c.glow.material.uniforms["uTime"]!.value = t;
      }
      (motes.material as ShaderMaterial).uniforms["uTime"]!.value = t;
      if (opts.reducedMotion) return;

      // A long lateral track. The three cubes are at three different depths, so this is
      // the shot where parallax does the most work in the whole set — the near one
      // crosses the far one and the plain acquires a size.
      camera.position.x = Math.sin(t * 0.038) * 16;
      camera.position.y = 22 + Math.sin(t * 0.027) * 2.0;
      camera.lookAt(-4, 20, -30);
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.fov = fovFor(camera.aspect);
      camera.updateProjectionMatrix();
    },
    dispose() {
      sky.dispose();
      terrain.dispose();
      for (const r of ribbons) r.dispose();
      for (const c of cubes) {
        c.cube.dispose();
        c.glow.dispose();
      }
      motes.geometry.dispose();
      (motes.material as ShaderMaterial).dispose();
    },
  };
}
