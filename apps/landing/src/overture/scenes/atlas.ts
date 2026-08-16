import {
  AdditiveBlending,
  CylinderGeometry,
  GLSL3,
  InstancedBufferAttribute,
  InstancedMesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
} from "three";
import { PALETTE } from "../lib/palette.js";
import { mulberry32 } from "../lib/noise.js";
import { makeMotes } from "../lib/motes.js";
import { makeRibbon, meander } from "../lib/ribbon.js";
import { makeSky } from "../lib/sky.js";
import { makeTerrain } from "../lib/terrain.js";
import { fovFor, type SceneHandle, type SceneOptions } from "../lib/types.js";

/**
 * 6 — ATLAS.  "The whole record, in one view."
 *
 * A valley seen from high up, its floor covered in small standing lights, framed left
 * and right by two bright trails running over the ridges.
 *
 * WHY THIS FOR THIS SECTION. It is the last frame, and the only one that pulls back far
 * enough to show ALL of something. Every earlier scene shows one of a thing — one
 * object, one path, one gap; this shows the accumulated set, and it is the only place
 * where quantity is the subject. That is the right closing argument for a record: not
 * any single adjudication but the fact that there are hundreds and they are all still
 * there.
 *
 * THE MARKERS ARE NOT EVENLY SPACED. A regular grid is what this wants to be and it is
 * wrong — a lattice reads as a chart, and the moment it does, the frame is describing
 * data rather than showing a place. Jittered onto a loose grid, at unequal heights and
 * unequal brightness, they read as a settlement, and the eye counts them the way it
 * counts lit windows from a plane.
 */

const MARKER_VERT = /* glsl */ `
in vec2 aMarker;      // seed, brightness
out float vBright;
out float vUpY;
uniform float uTime;

void main() {
  vBright = aMarker.y;
  // Local Y within the cylinder, 0 at the base and 1 at the cap.
  vUpY = position.y + 0.5;

  vec4 world = instanceMatrix * vec4(position, 1.0);

  // A slow individual pulse, decorrelated by seed. Every marker breathing together
  // would read as one object flashing rather than as many independent ones.
  float pulse = 0.86 + 0.14 * sin(uTime * 0.7 + aMarker.x * 31.0);
  vBright *= pulse;

  gl_Position = projectionMatrix * modelViewMatrix * world;
}
`;

const MARKER_FRAG = /* glsl */ `
precision highp float;
in float vBright;
in float vUpY;
uniform vec3 uCore;
uniform vec3 uFoot;
out vec4 fragColor;

void main() {
  // Hot at the cap, deepening down the shaft. Same ramp rule as the cube: these are
  // small enough that the gradient is most of what makes them read as lit objects
  // rather than as coloured dots.
  vec3 col = mix(uFoot, uCore, pow(clamp(vUpY, 0.0, 1.0), 0.7));
  float a = vBright * (0.35 + 0.65 * vUpY);
  fragColor = vec4(col * a, a);
}
`;

export function createAtlas(opts: SceneOptions): SceneHandle {
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 16 / 9, 0.1, 1400);
  // High and looking down. The only elevated camera in the set — everything else is at
  // or near ground level, so the change of altitude is itself the signal that this is
  // the closing shot.
  camera.position.set(0, 130, 210);
  camera.lookAt(0, 0, -110);

  /* ---- the valley ------------------------------------------------------ */

  const terrain = makeTerrain({
    width: 900,
    depth: 900,
    segments: Math.max(64, Math.round(200 * opts.quality)),
    amp: 62,
    scale: 190,
    valley: 130,
    seed: 21.8,
    lit: PALETTE.azure.clone().lerp(PALETTE.sky, 0.5),
  });
  const sky = makeSky();
  scene.add(sky.mesh);
  scene.add(terrain.mesh);

  /* ---- the record ------------------------------------------------------ */

  const rnd = mulberry32(0xa71a5);
  const COUNT = Math.max(90, Math.round(240 * opts.quality));
  const geo = new CylinderGeometry(0.9, 1.15, 1, 7, 1, false);
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: MARKER_VERT,
    fragmentShader: MARKER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: PALETTE.white.clone() },
      uFoot: { value: PALETTE.cyan.clone() },
    },
  });

  const markers = new InstancedMesh(geo, mat, COUNT);
  const attr = new Float32Array(COUNT * 2);
  const dummy = new Object3D();

  // A loose grid, jittered hard. The grid keeps them spread across the valley floor
  // instead of clumping; the jitter is what stops it reading as a lattice.
  const COLS = Math.ceil(Math.sqrt(COUNT * 1.6));
  const ROWS = Math.ceil(COUNT / COLS);
  for (let i = 0; i < COUNT; i++) {
    const cx = i % COLS;
    const cz = Math.floor(i / COLS);
    const x = ((cx + 0.5) / COLS - 0.5) * 460 + (rnd() - 0.5) * 34;
    const z = ((cz + 0.5) / ROWS - 0.5) * 420 - 90 + (rnd() - 0.5) * 30;

    const h = 3.5 + rnd() * rnd() * 11;
    dummy.position.set(x, h / 2, z);
    dummy.scale.set(1, h, 1);
    dummy.rotation.y = rnd() * Math.PI;
    dummy.updateMatrix();
    markers.setMatrixAt(i, dummy.matrix);

    attr[i * 2] = rnd();
    // Biased low, with a minority bright. An even distribution is the thing that makes
    // a field of lights look computer-generated.
    attr[i * 2 + 1] = 0.30 + rnd() * rnd() * 0.95;
  }
  markers.instanceMatrix.needsUpdate = true;
  geo.setAttribute("aMarker", new InstancedBufferAttribute(attr, 2));
  markers.frustumCulled = false;
  scene.add(markers);

  /* ---- the two framing trails ------------------------------------------ */

  const ribbons: ReturnType<typeof makeRibbon>[] = [];
  const FRAME = [
    { from: new Vector3(-430, 20, 240), to: new Vector3(-70, 46, -420), seed: 0xb101 },
    { from: new Vector3(430, 20, 250), to: new Vector3(120, 48, -420), seed: 0xb202 },
  ];

  FRAME.forEach((f, i) => {
    for (let j = 0; j < 4; j++) {
      const isLead = j === 0;
      const r = makeRibbon({
        points: meander(f.seed + j * 733, { from: f.from, to: f.to, sway: 40 * (0.4 + j / 4), points: 7 }),
        radius: isLead ? 1.5 : 0.42,
        segments: Math.max(100, Math.round(240 * opts.quality)),
        colorCore: isLead ? PALETTE.white.clone() : PALETTE.sky.clone(),
        colorHalo: PALETTE.cyan.clone(),
        pulses: isLead ? 3 : 0,
        speed: 0.06,
        intensity: isLead ? 1 : 0.4,
        seed: f.seed + j,
      });
      ribbons.push(r);
      scene.add(r.group);
    }
    terrain.setLight(i, f.from.clone().lerp(f.to, 0.5), 210);
  });

  // The remaining two terrain lights sit over the settlement itself, so the valley
  // floor is lit by its own contents rather than only from the sides.
  terrain.setLight(2, new Vector3(-90, 24, -80), 235);
  terrain.setLight(3, new Vector3(110, 24, -150), 235);

  const motes = makeMotes(Math.round(700 * opts.quality), 120, 0xc315, {
    colorA: PALETTE.sky.clone(),
    colorB: PALETTE.cyan.clone(),
    size: 1.2,
    speed: 0.12,
  });
  motes.position.set(0, 70, -60);
  scene.add(motes);

  return {
    scene,
    camera,
    update(t) {
      mat.uniforms["uTime"]!.value = t;
      for (const r of ribbons) r.update(t);
      (motes.material as ShaderMaterial).uniforms["uTime"]!.value = t;
      if (opts.reducedMotion) return;

      // A slow descent and drift, as if the view is still coming down. The closing shot
      // is the one place a little camera movement toward the subject is right — every
      // other scene holds its distance.
      camera.position.x = Math.sin(t * 0.031) * 22;
      camera.position.y = 130 + Math.sin(t * 0.024) * 8;
      camera.lookAt(0, 0, -110);
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
      geo.dispose();
      mat.dispose();
      markers.dispose();
      motes.geometry.dispose();
      (motes.material as ShaderMaterial).dispose();
    },
  };
}
