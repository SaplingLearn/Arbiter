import {
  DoubleSide,
  GLSL3,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
} from "three";
import { PALETTE } from "../lib/palette.js";
import { SIMPLEX3, mulberry32 } from "../lib/noise.js";
import { makeMotes } from "../lib/motes.js";
import { makeCube } from "../lib/cube.js";
import { makeGlow } from "../lib/glow.js";
import { fovFor, type SceneHandle, type SceneOptions } from "../lib/types.js";

/**
 * 1 — MONOLITH.  "Reasoning in the dark."
 *
 * One luminous cube hanging above a dark sea, framed by two ridges, with the light it
 * emits running back at the camera across the water.
 *
 * WHY THIS FOR THIS SECTION. It is the only frame in the set built around a single
 * legible object rather than a field, a path or a process, and the opening of a page
 * has the one job the others do not: it has to be understood by somebody who has not
 * yet been told what any of this is. A stranger reads "there is one thing here, and it
 * is the subject" in well under a second, which is all the time an opening gets.
 *
 * FOUR LAYERS, back to front:
 *   1. Ridges    two silhouette planes, unlit, with a lit flank facing the cube
 *   2. Sea       a displaced plane whose specular is the cube's reflection
 *   3. Monolith  the emissive cube, plus a billboard halo
 *   4. Motes     drifting particulate, densest near the water
 *
 * The cube does NOT rotate. Every generated version of this image spins the object,
 * which immediately reads as a screensaver. It breathes on a slow sine and drifts a few
 * centimetres; the camera does the moving.
 */

const SEA_VERT = /* glsl */ `
uniform float uTime;
out vec2 vUv;
out vec3 vWorld;
out float vWave;

${SIMPLEX3}

/** Three octaves of travelling noise. The lowest carries the swell, the highest the
 *  chop that catches the specular. Amplitude falls off toward the horizon so the far
 *  water flattens into a mirror — which is what actually sells the depth. A uniformly
 *  choppy plane reads as a texture, not as distance. */
float surface(vec2 p, float t) {
  float d = 0.0;
  d += snoise(vec3(p * 0.35, t * 0.20)) * 0.55;
  d += snoise(vec3(p * 0.90, t * 0.32)) * 0.22;
  d += snoise(vec3(p * 2.40, t * 0.48)) * 0.08;
  return d;
}

void main() {
  vUv = uv;
  vec3 p = position;
  float far = clamp(abs(p.y) / 120.0, 0.0, 1.0);
  float damp = 1.0 - smoothstep(0.25, 1.0, far);
  float w = surface(p.xy, uTime) * damp;
  p.z += w;
  vWave = w;
  vWorld = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const SEA_FRAG = /* glsl */ `
in vec2 vUv;
in vec3 vWorld;
in float vWave;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uGlow;
uniform vec3 uHot;
uniform vec2 uSource;
uniform vec3 uHaze;
out vec4 fragColor;

${SIMPLEX3}

void main() {
  // The reflection is a COLUMN, not a radial pool: light on water runs back toward the
  // viewer along the line between them, and getting that wrong is the single most
  // common tell in a generated version of this image.
  float lateral = abs(vWorld.x - uSource.x);
  float column = exp(-lateral * lateral * 0.0060);

  // Local +Y maps to world -Z under the plane's -90deg X rotation, so LARGE vWorld.y is
  // FAR from the camera. This read the other way round at first and put the bright water
  // at the viewer's feet instead of under the object.
  float near = 1.0 - smoothstep(-40.0, 95.0, vWorld.y);
  float lane = column * mix(0.16, 1.0, near);

  // The chop is what glitters. Positive crests catch, troughs stay dark, and the
  // asymmetry is deliberate — a symmetric response reads as a gradient.
  float crest = smoothstep(0.04, 0.30, vWave);
  float glitter = crest * lane;

  float speck = snoise(vec3(vWorld.xy * 3.2, uTime * 0.6));
  speck = smoothstep(0.50, 0.92, speck) * crest * lane;

  vec3 col = uDeep;
  col = mix(col, uGlow, clamp(lane * 0.60 + glitter * 0.98, 0.0, 1.0));
  col += uHot * speck * 0.95;

  float horizon = smoothstep(0.72, 1.0, vUv.y);
  col = mix(col, uHaze, horizon);
  fragColor = vec4(col, 1.0);
}
`;

const RIDGE_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * A ridge is a silhouette that CATCHES light, not a lit object.
 *
 * The reference's two slopes are the second-brightest thing in the frame after the
 * cube: a broad wash on the flank facing the object, brightest where the slope meets
 * the water and dying well before the crest.
 */
const RIDGE_FRAG = /* glsl */ `
in vec2 vUv;
uniform vec3 uDark;
uniform vec3 uRim;
uniform vec3 uHot;
uniform float uFacing;
uniform float uSeed;
out vec4 fragColor;

/** Smooth 1D value noise. Two octaves is enough for a ridgeline: more reads as scree
 *  rather than as a landform at this distance. */
float ridgeNoise(float x) {
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(i * 127.1 + uSeed) * 43758.5453);
  float b = fract(sin((i + 1.0) * 127.1 + uSeed) * 43758.5453);
  return mix(a, b, f);
}

void main() {
  // uFacing flips which side catches the light, so one geometry serves both ridges
  // without them being mirror images — the eye picks that up immediately.
  float x = mix(vUv.x, 1.0 - vUv.x, uFacing);
  float t = 1.0 - x;   // 0 at the centre-facing edge, 1 at the outer edge

  // The FLOOR here has a narrow window. Too low (0.10) and the ridge tapers to nothing
  // before it reaches the object, so the lit flank — which is the centre-facing one —
  // lands on a sliver hidden behind the water's glare. Too high (0.44) and the two
  // planes meet across the centre line and become a single wall with a flat top, which
  // closes the gap the whole composition is built around.
  float h = 0.26 + 0.56 * pow(t, 1.40);
  h += (ridgeNoise(t * 3.0) - 0.5) * 0.16;
  h += (ridgeNoise(t * 7.0) - 0.5) * 0.07;
  h += (ridgeNoise(t * 17.0) - 0.5) * 0.028;

  // Everything above the ridgeline is sky. A hard cut is correct: this is a silhouette
  // against a night sky and any softness reads as fog on the peak.
  if (vUv.y > h) discard;

  float up = vUv.y / max(h, 0.001);
  float upSlope = 1.0 - smoothstep(0.05, 0.78, up);
  float toCentre = 1.0 - smoothstep(0.0, 0.62, t);
  float rim = pow(upSlope * toCentre, 1.6);
  float wet = (1.0 - smoothstep(0.0, 0.30, up)) * toCentre;

  vec3 col = mix(uDark, uRim, clamp(rim * 0.80, 0.0, 1.0));
  col += uHot * wet * 0.26;

  float foot = smoothstep(0.0, 0.05, vUv.y);

  // The inner edge dissolves too. The plane simply STOPS at t = 0, and because that is
  // also where the lit flank is brightest, the cut showed up as a hard bright rectangle
  // standing in the water on either side of the object — the one artifact that gave away
  // that these are two quads and not a landscape.
  float inner = smoothstep(0.0, 0.07, t);

  fragColor = vec4(col, foot * inner);
}
`;

export function createMonolith(opts: SceneOptions): SceneHandle {
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 16 / 9, 0.1, 600);
  camera.position.set(0, 7.4, 55);
  camera.lookAt(0, 14.2, 0);

  const rnd = mulberry32(0x4d0f11a);

  const seaMat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: SEA_VERT,
    fragmentShader: SEA_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: PALETTE.abyss.clone().lerp(PALETTE.navy, 0.45) },
      uGlow: { value: PALETTE.azure.clone() },
      uHot: { value: PALETTE.sky.clone() },
      uSource: { value: new Vector2(0, 0) },
      // Violet, not blue: the ramp rule holds here as everywhere, and a blue haze would
      // flatten the depth cue.
      uHaze: { value: PALETTE.abyss.clone().lerp(PALETTE.violet, 0.22) },
    },
  });

  const seg = Math.max(48, Math.round(190 * opts.quality));
  const sea = new Mesh(new PlaneGeometry(420, 300, seg, seg), seaMat);
  sea.rotation.x = -Math.PI / 2;
  scene.add(sea);

  const ridgeGeo = new PlaneGeometry(74, 44, 1, 1);
  const ridges: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const mat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: RIDGE_VERT,
      fragmentShader: RIDGE_FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uDark: { value: PALETTE.abyss.clone().lerp(PALETTE.violet, 0.11) },
        uRim: { value: PALETTE.azure.clone().lerp(PALETTE.sky, 0.62) },
        uHot: { value: PALETTE.pale.clone() },
        uFacing: { value: side < 0 ? 0 : 1 },
        uSeed: { value: side < 0 ? 11.3 : 74.9 },
      },
    });
    const m = new Mesh(ridgeGeo, mat);
    m.position.set(side * 47, 19.0, -44);
    m.rotation.y = side * -0.34;
    ridges.push(m);
    scene.add(m);
  }

  const CUBE = 8.2;
  const cube = makeCube(CUBE);
  cube.mesh.position.set(0, 15.2, 0);
  // A fixed three-quarter yaw. ORIENTATION, not rotation — it never changes. Dead-on, a
  // cube reads as a flat square; two faces and a sliver of top is the minimum that
  // reads as a solid.
  cube.mesh.rotation.y = 0.34;
  scene.add(cube.mesh);

  const halo = makeGlow(CUBE * 4.6, PALETTE.cyan.clone().multiplyScalar(0.34));
  halo.mesh.position.copy(cube.mesh.position);
  scene.add(halo.mesh);

  const motes = makeMotes(Math.round(1000 * opts.quality), 34, 0x9c0be, {
    colorA: PALETTE.sky.clone(),
    colorB: PALETTE.cyan.clone(),
    size: 1.6,
    speed: 0.22,
  });
  motes.position.y = 5;
  scene.add(motes);

  const baseY = cube.mesh.position.y;
  const phase = rnd() * Math.PI * 2;

  return {
    scene,
    camera,
    update(t) {
      seaMat.uniforms["uTime"]!.value = t;
      cube.material.uniforms["uTime"]!.value = t;
      halo.material.uniforms["uTime"]!.value = t;
      (motes.material as ShaderMaterial).uniforms["uTime"]!.value = t;
      if (opts.reducedMotion) return;

      // Two incommensurate periods, so the top of the rise never lands at the same point
      // in the sea's cycle and the pair never looks looped.
      const hover = Math.sin(t * 0.31 + phase) * 0.42 + Math.sin(t * 0.17) * 0.18;
      cube.mesh.position.y = baseY + hover;
      halo.mesh.position.y = cube.mesh.position.y;

      // The camera moves and the subject does not. A slow lateral arc, always aimed at
      // the cube, so the ridges part as it travels and the frame has parallax without
      // anything spinning.
      const a = t * 0.045 + phase * 0.2;
      camera.position.x = Math.sin(a) * 3.2;
      camera.position.y = 7.4 + Math.sin(a * 0.7) * 0.5;
      camera.lookAt(0, cube.mesh.position.y - 1.0, 0);
      seaMat.uniforms["uSource"]!.value.x = cube.mesh.position.x;
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.fov = fovFor(camera.aspect);
      camera.updateProjectionMatrix();
    },
    dispose() {
      sea.geometry.dispose();
      seaMat.dispose();
      ridgeGeo.dispose();
      for (const r of ridges) (r.material as ShaderMaterial).dispose();
      cube.dispose();
      halo.dispose();
      motes.geometry.dispose();
      (motes.material as ShaderMaterial).dispose();
    },
  };
}
