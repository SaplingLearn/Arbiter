import { PerspectiveCamera, Scene, ShaderMaterial, Vector3 } from "three";
import { PALETTE } from "../lib/palette.js";
import { makeMotes } from "../lib/motes.js";
import { makeRibbon, meander } from "../lib/ribbon.js";
import { makeSky } from "../lib/sky.js";
import { makeTerrain } from "../lib/terrain.js";
import { fovFor, type SceneHandle, type SceneOptions } from "../lib/types.js";

/**
 * 5 — DIVIDE.  "Where the evidence runs out."
 *
 * Two pairs of light trails sweeping away from each other across a dark basin, leaving
 * an empty gap between them. A dark ridge closes the top of the frame.
 *
 * WHY THIS FOR THIS SECTION. This is the abstention section, and it is the hardest of
 * the six to picture, because what it has to depict is an ABSENCE — the case where the
 * streams do not meet and the product declines to take a position. Every instinct is to
 * draw the disagreement; the reference's fifth frame instead draws two paths leaving
 * and lets the space between them carry the meaning. The gap is the subject. Nothing is
 * in it, nothing crosses it, and it sits dead centre where the eye lands first.
 *
 * SO THE ONE RULE HERE IS: DO NOT FILL THE MIDDLE. No motes drift through it, no
 * terrain light reaches into it, and the trails' sway is small enough that none of them
 * ever wanders across. Every one of those was tried and each one quietly turned the
 * frame into a picture of four nice glowing lines.
 *
 * It is also the only section with no call to action, for the same reason: a button
 * under a statement about restraint asks for the opposite of what the statement says.
 */
export function createDivide(opts: SceneOptions): SceneHandle {
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 16 / 9, 0.1, 900);
  camera.position.set(0, 30, 92);
  camera.lookAt(0, 12, -50);

  /* ---- the basin ------------------------------------------------------- */

  // A wide shallow bowl with a rise at the back. The valley term is deliberately WIDER
  // than the gap between the trails, so the ground under the gap is the flattest and
  // darkest part of the frame — the emptiness reads as a place, not as a hole in the
  // render.
  const terrain = makeTerrain({
    width: 620,
    depth: 640,
    segments: Math.max(64, Math.round(190 * opts.quality)),
    amp: 34,
    scale: 110,
    valley: 60,
    seed: 14.2,
    lit: PALETTE.azure.clone().lerp(PALETTE.sky, 0.3),
  });
  const sky = makeSky();
  scene.add(sky.mesh);
  scene.add(terrain.mesh);

  /* ---- the two departures ---------------------------------------------- */

  const ribbons: ReturnType<typeof makeRibbon>[] = [];

  // Both pairs start near the centre-back and leave toward opposite bottom corners.
  // They share neither an origin point nor a destination — a shared origin would say
  // they came from the same finding and split, and the honest claim is weaker than
  // that: they were never reconciled in the first place.
  const ARMS = [
    { from: new Vector3(-26, 8, -190), to: new Vector3(-250, 2, 150), seed: 0x7a01 },
    { from: new Vector3(-8, 7, -210), to: new Vector3(-120, 2, 190), seed: 0x7b02 },
    { from: new Vector3(16, 7, -206), to: new Vector3(130, 2, 186), seed: 0x7c03 },
    { from: new Vector3(34, 8, -186), to: new Vector3(255, 2, 146), seed: 0x7d04 },
  ];

  ARMS.forEach((arm, i) => {
    const count = 4;
    for (let j = 0; j < count; j++) {
      const isLead = j === 0;
      const r = makeRibbon({
        points: meander(arm.seed + j * 431, {
          from: arm.from,
          // Small sway. See the note above — this is the knob that, turned up, sends a
          // strand across the gap and destroys the whole image.
          to: arm.to,
          sway: 9 * (0.4 + j / count),
          points: 7,
        }),
        radius: isLead ? 0.6 : 0.17,
        segments: Math.max(100, Math.round(240 * opts.quality)),
        colorCore: isLead ? PALETTE.white.clone() : PALETTE.sky.clone(),
        colorHalo: PALETTE.cyan.clone(),
        pulses: isLead ? 3 : 0,
        speed: 0.075,
        intensity: isLead ? 1 : 0.38,
        sparks: isLead ? Math.round(140 * opts.quality) : 0,
        seed: arm.seed + j,
      });
      ribbons.push(r);
      scene.add(r.group);
    }

    // One terrain light per arm, placed OUT along it rather than at its origin, so the
    // ground brightens where the trails are leaving and stays dark between them.
    terrain.setLight(i, arm.from.clone().lerp(arm.to, 0.55), 108);
  });

  // Off to the sides only. Motes through the centre would populate the emptiness, which
  // is the one thing this frame must not do.
  const motes = makeMotes(Math.round(420 * opts.quality), 56, 0x8813, {
    colorA: PALETTE.sky.clone(),
    colorB: PALETTE.azure.clone(),
    size: 1.2,
    speed: 0.15,
  });
  motes.position.set(-120, 26, 10);
  scene.add(motes);

  const motesR = makeMotes(Math.round(420 * opts.quality), 56, 0x9914, {
    colorA: PALETTE.sky.clone(),
    colorB: PALETTE.azure.clone(),
    size: 1.2,
    speed: 0.15,
  });
  motesR.position.set(120, 26, 10);
  scene.add(motesR);

  return {
    scene,
    camera,
    update(t) {
      for (const r of ribbons) r.update(t);
      (motes.material as ShaderMaterial).uniforms["uTime"]!.value = t;
      (motesR.material as ShaderMaterial).uniforms["uTime"]!.value = t;
      if (opts.reducedMotion) return;

      // The slowest camera in the set, and only vertical. A lateral move would swing the
      // gap off centre, and the gap being centred is the entire composition.
      camera.position.y = 30 + Math.sin(t * 0.043) * 2.6;
      camera.lookAt(0, 12, -50);
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
      for (const m of [motes, motesR]) {
        m.geometry.dispose();
        (m.material as ShaderMaterial).dispose();
      }
    },
  };
}
