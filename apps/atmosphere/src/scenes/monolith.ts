import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  GLSL3,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
} from "three";
import { PALETTE } from "../core/palette.js";
import { SIMPLEX3 } from "../core/shaders.js";
import { makeMotes, mulberry32 } from "./common.js";
import type { AtmosphereScene, SceneContext } from "../core/types.js";

/**
 * LANDING — "MONOLITH"
 *
 * One luminous cube hanging above a dark sea, framed by two unlit ridges, with the
 * light it emits running back at the camera across the water.
 *
 * WHY THIS FOR THIS PAGE. The landing page has one job the five product scenes do
 * not: it has to be understood by somebody who has not yet been told what any of
 * this is. So it is the only scene in the set built around a single legible object
 * rather than a field, a network or a process. A stranger reads "there is one thing
 * here, and it is the subject" in well under a second, which is all the time a
 * landing page gets.
 *
 * The cube is the argument, made as an image: a hard-edged, faceted, obviously
 * CONSTRUCTED object, lit from inside, sitting in a landscape that is not. Nothing
 * else in the frame emits. That reads as reasoning in the dark, which is the one
 * sentence this product would like a visitor to leave with.
 *
 * WHAT THIS IS AND IS NOT, because the reference matters. The composition is built
 * from a reference: a glowing cube centred over water between two ridges. What is
 * reproduced is the TECHNIQUE - emissive volume, specular sea, silhouette framing,
 * god-rays through haze. What is not reproduced is anybody's brand: not their mark,
 * their name, their type, their copy, or their proportions. The palette is the
 * project's own violet-to-cyan ramp from core/palette.ts, which is a different
 * family from the reference's teal, and the ramp rule holds here as everywhere:
 * deep tones go violet, emissive goes cyan, never the reverse.
 *
 * FOUR LAYERS, back to front:
 *
 *   1. Ridges      two silhouette planes, unlit, with a rim where they catch the cube
 *   2. Sea         a displaced plane whose specular is the cube's reflection
 *   3. Monolith    the emissive cube, plus a backside shell for the halo
 *   4. Motes       drifting particulate, dense near the water
 *
 * The cube does NOT rotate. Every generated version of this image spins the object,
 * which immediately reads as a screensaver. It breathes on a slow sine and drifts a
 * few centimetres; the camera does the moving. Stillness is what makes it read as
 * architecture rather than as a loading state.
 */

/* -------------------------------------------------------------------- sea */

const SEA_VERT = /* glsl */ `
uniform float uTime;
out vec2 vUv;
out vec3 vWorld;
out float vWave;

${SIMPLEX3}

/**
 * Three octaves of travelling noise. The lowest carries the swell, the highest the
 * chop that catches the specular. Amplitude falls off toward the horizon so the far
 * water flattens into a mirror, which is what actually sells the depth: a uniformly
 * choppy plane reads as a texture, not as distance.
 */
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

  // Distance from the camera line, normalised over the plane's own extent.
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
  // Horizontal distance from the reflection axis, which sits under the cube. The
  // reflection is a COLUMN, not a radial pool: light on water runs back toward the
  // viewer along the line between them, and getting that wrong is the single most
  // common tell in a generated version of this image.
  float lateral = abs(vWorld.x - uSource.x);
  float column = exp(-lateral * lateral * 0.009);

  // Local +Y maps to world -Z under the plane's -90deg X rotation, so LARGE vWorld.y
  // is FAR from the camera. This read the other way round at first and put the bright
  // water at the viewer's feet instead of under the object, which is the single thing
  // that made the first render look like a swimming pool.
  float near = 1.0 - smoothstep(-25.0, 115.0, vWorld.y);
  float lane = column * mix(0.10, 1.0, near);

  // The chop is what glitters. Positive crests catch, troughs stay dark, and the
  // asymmetry is deliberate - a symmetric response reads as a gradient.
  float crest = smoothstep(0.06, 0.34, vWave);
  float glitter = crest * lane;

  // Broken specks riding the crests, so the lane is not a smooth airbrushed band.
  float speck = snoise(vec3(vWorld.xy * 3.2, uTime * 0.6));
  speck = smoothstep(0.55, 0.95, speck) * crest * lane;

  // Deliberately restrained. The reference frame is about 85% near-black and the
  // whole image depends on that: light everything and the object stops being the
  // only source in the picture, which is the entire idea.
  vec3 col = uDeep;
  col = mix(col, uGlow, clamp(lane * 0.52 + glitter * 0.85, 0.0, 1.0));
  col += uHot * speck * 0.85;

  // Horizon haze at the FAR edge (vUv.y -> 1), where the water meets the sky. Applied
  // at the near edge it floods the bottom of the frame, which is what it did first.
  float horizon = smoothstep(0.72, 1.0, vUv.y);
  col = mix(col, uHaze, horizon);

  fragColor = vec4(col, 1.0);
}
`;

/* --------------------------------------------------------------- monolith */

const CUBE_VERT = /* glsl */ `
out vec2 vUv;
out vec3 vNormal;
out vec3 vView;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const CUBE_FRAG = /* glsl */ `
in vec2 vUv;
in vec3 vNormal;
in vec3 vView;
uniform float uTime;
uniform vec3 uBody;
uniform vec3 uPanel;
uniform vec3 uHot;
out vec4 fragColor;

${SIMPLEX3}

/** Deterministic per-cell value. No time term, so the panelling is STRUCTURE and
 *  does not crawl - a crawling facade reads as noise and destroys the object. */
float cell(vec2 id) {
  return fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // Two panel grids at different scales, offset from each other, so the facade reads
  // as built from parts of unequal size rather than as a checkerboard.
  vec2 gA = floor(vUv * 9.0);
  vec2 gB = floor(vUv * 22.0 + 3.7);
  float a = cell(gA);
  float b = cell(gB);

  // Most panels sit near the body value; a minority are noticeably brighter or
  // darker. The distribution matters more than the values: an even spread looks
  // like static, and a few strong outliers look like windows.
  float panel = mix(0.82, 1.18, a);
  panel *= mix(0.94, 1.06, b);
  float bright = smoothstep(0.86, 0.99, a) * 0.55;

  // A slow inhale across the whole body. One cycle, no harmonics: anything more
  // complicated reads as flicker.
  float breath = 0.94 + 0.06 * sin(uTime * 0.55);

  // Fresnel, inverted. The FACES are hot and the silhouette edge cools, which is
  // what an object lit from within does. The usual rim-light fresnel would make it
  // a glass shell, and a glass shell is a different, weaker idea.
  float f = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
  float core = 1.0 - smoothstep(0.15, 0.85, f);

  vec3 col = uBody * panel * breath;
  col = mix(col, uPanel, bright);
  col += uHot * core * 0.35;

  // Seams. Thin dark lines on the panel grid, so the cube has construction rather
  // than being a lit box.
  vec2 seam = abs(fract(vUv * 9.0) - 0.5);
  float line = 1.0 - smoothstep(0.44, 0.5, max(seam.x, seam.y));
  col *= mix(1.0, 0.72, line);

  fragColor = vec4(col, 1.0);
}
`;

/**
 * The glow, as a camera-facing billboard rather than a scaled backside box.
 *
 * The box was tried first and it is wrong: the fresnel term peaks on the faces seen
 * edge-on, so a scaled cube renders its four side faces as a hard bright FRAME around
 * the object. It read as a picture border. A radial billboard has no edges to catch,
 * which is what a volume of scattered light actually looks like.
 *
 * Sized generously and kept faint. Most of the visible bloom comes from the post
 * chain reading the cube itself; this only fills the near field so the object sits IN
 * the air rather than in front of it.
 */
const GLOW_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  // Billboard: strip the rotation out of the model-view matrix so the quad always
  // faces the camera however the camera arcs.
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy;
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAG = /* glsl */ `
in vec2 vUv;
uniform vec3 uGlow;
uniform float uTime;
out vec4 fragColor;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;

  // Two falloffs summed: a tight core that reads as the object's own light, and a
  // very wide soft one that is really atmospheric haze. One exponent alone gives
  // either a hard disc or a grey wash.
  float core = exp(-d * d * 7.0);
  float wide = exp(-d * d * 1.6) * 0.35;
  float breath = 0.9 + 0.1 * sin(uTime * 0.55);

  float a = (core + wide) * breath;
  fragColor = vec4(uGlow * a, a);
}
`;

/* ------------------------------------------------------------------ ridge */

const RIDGE_FRAG = /* glsl */ `
in vec2 vUv;
uniform vec3 uDark;
uniform vec3 uRim;
uniform float uFacing;
uniform float uSeed;
out vec4 fragColor;

/** Smooth 1D value noise. Two octaves is enough for a ridgeline: more reads as
 *  scree rather than as a landform at this distance. */
float ridgeNoise(float x) {
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(i * 127.1 + uSeed) * 43758.5453);
  float b = fract(sin((i + 1.0) * 127.1 + uSeed) * 43758.5453);
  return mix(a, b, f);
}

void main() {
  // The lit flank faces the cube. uFacing flips which side catches it, so one
  // geometry serves both ridges without them being mirror images - the eye picks
  // that up immediately.
  float x = mix(vUv.x, 1.0 - vUv.x, uFacing);

  // x runs 1 at the CENTRE-facing edge and 0 at the outer edge, so the ridgeline
  // is written against its complement. Getting this the wrong way round put the
  // peaks in the middle of the frame and buried the object behind them, which is
  // exactly what the first render did.
  float t = 1.0 - x;

  // Highest at the outside, falling to almost nothing at the centre, so the two
  // ridges open a V and the object sits in the gap. That funnel is the whole
  // reason the composition works.
  float h = 0.10 + 0.76 * pow(t, 1.55);
  h += (ridgeNoise(t * 3.0) - 0.5) * 0.16;
  h += (ridgeNoise(t * 7.0) - 0.5) * 0.07;
  h += (ridgeNoise(t * 17.0) - 0.5) * 0.028;

  // Everything above the ridgeline is sky. A hard cut here is correct: this is a
  // silhouette against a night sky and any softness reads as fog on the peak.
  if (vUv.y > h) discard;

  // Light dies well before the ridgeline, so the crest stays black against the
  // sky. A rim that reaches the top turns the mountain into a hill and loses the
  // framing entirely.
  float upSlope = 1.0 - smoothstep(0.30, 0.95, vUv.y / max(h, 0.001));
  // The lit flank is the one FACING the object, which is the centre-facing side.
  float toCentre = 1.0 - smoothstep(0.0, 0.26, t);
  float rim = pow(upSlope * toCentre, 2.1);

  vec3 col = mix(uDark, uRim, rim * 0.42);

  // The foot dissolves into the water rather than ending on a line.
  float foot = smoothstep(0.0, 0.09, vUv.y);
  fragColor = vec4(col, foot);
}
`;

const RIDGE_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/* ------------------------------------------------------------------ scene */

export function createMonolith(ctx: SceneContext): AtmosphereScene {
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 16 / 9, 0.1, 600);

  // Low and close to the water. The horizon sits just under the cube's base, which
  // is what puts the reflection lane between the viewer and the object instead of
  // beside it.
  // Low, and a long way back. The first pass sat at z=26 and the cube filled the
  // frame, which loses the whole point: the reference works because one small bright
  // object sits in a large dark volume. At this distance it is about a quarter of
  // frame height, and the eye reads distance before it reads the object.
  camera.position.set(0, 10.6, 62);
  camera.lookAt(0, 8.6, 0);

  const rnd = mulberry32(0x4d0f11a);

  /* ---- sea ------------------------------------------------------------- */

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
      // The sky the far water fades into. Violet, not blue: the ramp rule holds
      // here as everywhere, and a blue haze would flatten the whole depth cue.
      uHaze: { value: PALETTE.abyss.clone().lerp(PALETTE.violet, 0.22) },
    },
  });

  // Segment count is the one place quality really bites: the displacement is
  // per-vertex, so a thin grid gives faceted swell rather than a smooth one.
  const seg = Math.max(48, Math.round(190 * ctx.quality));
  const sea = new Mesh(new PlaneGeometry(420, 300, seg, seg), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0;
  scene.add(sea);

  /* ---- ridges ---------------------------------------------------------- */

  const ridgeGeo = new PlaneGeometry(92, 46, 1, 1);
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
        uDark: { value: PALETTE.abyss.clone().lerp(PALETTE.violet, 0.045) },
        uRim: { value: PALETTE.azure.clone().lerp(PALETTE.sky, 0.55) },
        uFacing: { value: side < 0 ? 0 : 1 },
        // Different seed per side, so the two ridgelines are not the same shape
        // mirrored - which is instantly readable and cheap to avoid.
        uSeed: { value: side < 0 ? 11.3 : 74.9 },
      },
    });
    const m = new Mesh(ridgeGeo, mat);
    // Pushed well back and angled inward, so they read as distance and funnel the
    // eye to the centre.
    // Pushed well back and angled inward. The inner edge of each plane sits close
    // to the centre line so the gap between them is narrow, which is what makes
    // the object feel far away rather than merely small.
    m.position.set(side * 52, 16.0, -52);
    m.rotation.y = side * -0.30;
    ridges.push(m);
    scene.add(m);
  }

  /* ---- monolith -------------------------------------------------------- */

  const CUBE = 7.4;
  const cubeGeo = new BoxGeometry(CUBE, CUBE, CUBE);

  const cubeMat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: CUBE_VERT,
    fragmentShader: CUBE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uBody: { value: PALETTE.cyan.clone().multiplyScalar(1.25) },
      uPanel: { value: PALETTE.sky.clone() },
      uHot: { value: PALETTE.pale.clone() },
    },
  });
  const cube = new Mesh(cubeGeo, cubeMat);
  cube.position.set(0, 9.4, 0);
  // A fixed three-quarter yaw. This is ORIENTATION, not rotation - it never
  // changes. Dead-on, a cube reads as a flat square and the whole object is lost;
  // two faces and a sliver of top is the minimum that reads as a solid.
  cube.rotation.y = 0.36;
  scene.add(cube);

  const haloMat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uGlow: { value: PALETTE.cyan.clone().multiplyScalar(0.5) },
    },
  });
  const halo = new Mesh(new PlaneGeometry(CUBE * 5.2, CUBE * 5.2), haloMat);
  halo.position.copy(cube.position);
  halo.renderOrder = -1;
  scene.add(halo);

  /* ---- motes ----------------------------------------------------------- */

  const motes = makeMotes(Math.round(900 * ctx.quality), 34, 0x9c0be, {
    colorA: PALETTE.sky.clone(),
    colorB: PALETTE.cyan.clone(),
    size: 1.5,
    speed: 0.22,
    rise: 0.35,
  });
  motes.position.y = 5;
  scene.add(motes);

  /* ---- motion ---------------------------------------------------------- */

  const baseY = cube.position.y;
  // A fixed phase per mount, so two mounts of the same scene do not start in
  // lockstep, and the drift never repeats on a round number of seconds.
  const phase = rnd() * Math.PI * 2;

  return {
    id: "landing",
    scene,
    camera,

    update(_dt, t) {
      seaMat.uniforms.uTime!.value = t;
      cubeMat.uniforms.uTime!.value = t;
      haloMat.uniforms.uTime!.value = t;
      (motes.material as ShaderMaterial).uniforms.uTime!.value = t;

      if (ctx.reducedMotion) return;

      // The cube hovers. Two incommensurate periods, so the top of the rise never
      // lands at the same point in the sea's cycle and the pair never looks looped.
      const hover = Math.sin(t * 0.31 + phase) * 0.42 + Math.sin(t * 0.17) * 0.18;
      cube.position.y = baseY + hover;
      halo.position.y = cube.position.y;

      // The camera moves and the subject does not. A very slow lateral arc with a
      // slight rise, always aimed at the cube, so the ridges part as it travels and
      // the frame has parallax without anything spinning.
      const a = t * 0.045 + phase * 0.2;
      camera.position.x = Math.sin(a) * 3.2;
      camera.position.y = 10.6 + Math.sin(a * 0.7) * 0.5;
      camera.lookAt(0, cube.position.y - 0.8, 0);

      // The reflection follows the cube, because the lane is anchored to the source
      // rather than to the world origin.
      seaMat.uniforms.uSource!.value.x = cube.position.x;
    },

    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    dispose() {
      sea.geometry.dispose();
      seaMat.dispose();
      ridgeGeo.dispose();
      for (const r of ridges) (r.material as ShaderMaterial).dispose();
      cubeGeo.dispose();
      cubeMat.dispose();
      halo.geometry.dispose();
      haloMat.dispose();
      motes.geometry.dispose();
      (motes.material as ShaderMaterial).dispose();
    },
  };
}
