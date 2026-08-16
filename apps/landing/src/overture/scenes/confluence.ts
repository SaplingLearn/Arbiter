import { PerspectiveCamera, Scene, ShaderMaterial, Vector3 } from "three";
import { PALETTE } from "../lib/palette.js";
import { makeMotes } from "../lib/motes.js";
import { makeRibbon, meander } from "../lib/ribbon.js";
import { fovFor, type SceneHandle, type SceneOptions } from "../lib/types.js";

/**
 * 3 — CONFLUENCE.  "Three streams, one position."
 *
 * Bundles of light rising through the dark, two of them merging on the left and one
 * running alone up the right. No ground at all.
 *
 * WHY THIS FOR THIS SECTION. The section is about the evidence streams — QSAR, cytotox,
 * in vivo — and what the product does with them when they disagree. The image has to
 * carry two facts at once: that the streams are SEPARATE things, and that they end up
 * in the same place. A bundle of filaments does both, and it does the second without
 * implying agreement: they converge, but you can still count them where they meet.
 *
 * THE ONLY SCENE WITH NO TERRAIN, on purpose. Every other frame answers "where is
 * this?" and this one refuses to, because the streams are not anywhere — they are the
 * abstract part of the argument and giving them a floor would place them.
 *
 * Filaments per bundle is the number that matters. Three is too few to read as a
 * bundle and looks like three lines; above about seven the individual strands stop
 * being countable and it becomes a glowing rope, which loses the fact that these are
 * distinct sources.
 */
export function createConfluence(opts: SceneOptions): SceneHandle {
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 16 / 9, 0.1, 700);
  camera.position.set(0, 6, 88);
  camera.lookAt(0, 6, 0);

  const ribbons: ReturnType<typeof makeRibbon>[] = [];
  const seg = Math.max(90, Math.round(200 * opts.quality));

  /**
   * A bundle: several filaments that share their endpoints and separate in between.
   * `meander` puts no sway at the ends for exactly this reason, so a bundle converges
   * without any of the strands being told where to converge.
   */
  const bundle = (
    seed: number,
    from: Vector3,
    to: Vector3,
    count: number,
    sway: number,
    lead: boolean,
  ) => {
    for (let i = 0; i < count; i++) {
      // One bright leader per bundle, the rest much dimmer. An evenly-lit bundle has no
      // subject and the eye slides off it; with a leader the group reads as one thing
      // travelling, with its own thickness.
      const isLead = lead && i === 0;
      const r = makeRibbon({
        points: meander(seed + i * 977, { from, to, sway: sway * (0.35 + i / count), points: 7 }),
        radius: isLead ? 0.5 : 0.13,
        segments: seg,
        colorCore: isLead ? PALETTE.white.clone() : PALETTE.sky.clone(),
        colorHalo: PALETTE.cyan.clone(),
        pulses: isLead ? 2 : 0,
        speed: 0.07,
        intensity: isLead ? 1 : 0.42,
        sparks: isLead ? Math.round(180 * opts.quality) : 0,
        seed: seed + i,
      });
      ribbons.push(r);
      scene.add(r.group);
    }
  };

  // Left: two bundles that meet. Their shared upper endpoint is what makes them merge —
  // the fork is not modelled, it falls out of two groups ending at the same point.
  const junction = new Vector3(-15, 44, -30);
  bundle(0x1a01, new Vector3(-52, -44, 10), junction, 6, 13, true);
  bundle(0x2b02, new Vector3(-4, -46, -6), junction, 5, 10, false);

  // Right: one bundle passing through, unjoined. The asymmetry is the point — a
  // symmetric pair of forks would say the streams always reconcile, and the product's
  // whole claim is that sometimes they do not.
  bundle(0x3c03, new Vector3(30, -48, 4), new Vector3(46, 46, -34), 6, 15, true);

  const motes = makeMotes(Math.round(900 * opts.quality), 52, 0x4411, {
    colorA: PALETTE.sky.clone(),
    colorB: PALETTE.cyan.clone(),
    size: 1.4,
    speed: 0.2,
  });
  scene.add(motes);

  return {
    scene,
    camera,
    update(t) {
      for (const r of ribbons) r.update(t);
      (motes.material as ShaderMaterial).uniforms["uTime"]!.value = t;
      if (opts.reducedMotion) return;

      // A slow drift across, which parallaxes the two groups against each other. With
      // no ground and no horizon this is the only depth cue the frame has.
      camera.position.x = Math.sin(t * 0.05) * 5.5;
      camera.position.y = 6 + Math.sin(t * 0.037) * 2.2;
      camera.lookAt(0, 6, 0);
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.fov = fovFor(camera.aspect);
      camera.updateProjectionMatrix();
    },
    dispose() {
      for (const r of ribbons) r.dispose();
      motes.geometry.dispose();
      (motes.material as ShaderMaterial).dispose();
    },
  };
}
