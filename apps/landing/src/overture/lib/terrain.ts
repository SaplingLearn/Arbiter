import { Color, GLSL3, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { PALETTE } from "./palette.js";
import { SIMPLEX3 } from "./noise.js";

/**
 * THE GROUND — a dark heightfield that the light in a scene falls on.
 *
 * Every frame in the reference except the first has one, and in all of them it does the
 * same job: it is almost entirely black, and it exists so that the bright thing in the
 * frame has something to illuminate. That is the whole trick. A glowing ribbon on an
 * empty background is a neon squiggle; the same ribbon with a hillside catching its
 * light half a second behind it is a place.
 *
 * SO THE LIGHTING IS THE POINT, and it is done here rather than with three's own lights
 * for one reason: the emitters in these scenes are ribbons and cubes drawn with additive
 * custom shaders, which contribute nothing to a standard lighting pass. Handing this
 * shader the emitter positions directly is the only way the ground can know where the
 * light in the frame actually is.
 *
 * A VALLEY, OPTIONALLY. Sections 2 and 5 need the ground to open a channel the ribbon
 * runs along. Rather than a second geometry, the height is scaled down toward x = 0,
 * which turns the same rolling field into a canyon without another mesh.
 */

export type TerrainOptions = {
  width?: number;
  depth?: number;
  /** Grid subdivisions. Displacement is per-vertex, so this is what decides whether the
   *  landform is smooth or faceted. */
  segments?: number;
  /** Peak height of the noise. */
  amp?: number;
  /** Feature size. Larger is smoother. */
  scale?: number;
  /** Half-width of the flat channel down the middle. 0 for open ground. */
  valley?: number;
  /** Up to four emitters, in world space. `w` is that emitter's reach. */
  lights?: { at: Vector3; reach: number }[];
  body?: Color;
  lit?: Color;
  seed?: number;
};

const VERT = /* glsl */ `
uniform float uAmp;
uniform float uScale;
uniform float uValley;
uniform float uSeed;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;

${SIMPLEX3}

float height(vec2 p) {
  float h = 0.0;
  h += snoise(vec3(p / uScale, uSeed)) * 0.62;
  h += snoise(vec3(p / (uScale * 0.42), uSeed + 11.0)) * 0.26;
  h += snoise(vec3(p / (uScale * 0.17), uSeed + 23.0)) * 0.12;

  // Open a channel down the middle. Applied as a MULTIPLIER on the height rather than
  // as a subtraction, so the hills keep their shape as they rise out of it instead of
  // being sliced flat by a plane.
  if (uValley > 0.0) {
    h *= smoothstep(uValley, uValley * 2.6, abs(p.x));
  }
  return h * uAmp;
}

void main() {
  vUv = uv;
  vec3 p = position;
  float h = height(p.xy);
  p.z += h;

  // Normals by central difference. Cheaper than a second geometry pass and accurate
  // enough for a surface that is never more than dimly lit.
  float e = uScale * 0.06;
  float hx = height(p.xy + vec2(e, 0.0)) - height(p.xy - vec2(e, 0.0));
  float hy = height(p.xy + vec2(0.0, e)) - height(p.xy - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx, -hy, 2.0 * e));

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
uniform vec3 uBody;
uniform vec3 uLit;
uniform vec3 uHaze;
uniform vec4 uLights[4];   // xyz = position, w = reach (0 = unused)
out vec4 fragColor;

void main() {
  vec3 n = normalize(vNormal);
  float wash = 0.0;

  for (int i = 0; i < 4; i++) {
    float reach = uLights[i].w;
    if (reach <= 0.0) continue;
    vec3 d = uLights[i].xyz - vWorld;
    float dist = length(d);

    // Inverse-square would be physically right and looks wrong at this scale — it puts
    // a hot spot under the emitter and nothing anywhere else. A smoothstep falloff
    // spreads the light the way a wide soft source in fog actually behaves.
    //
    // CUBED, though, not squared. The first version summed four squared falloffs with a
    // generous ambient floor, every one of them reaching most of the field, and the
    // result was a single flat blue blob covering two thirds of the frame with no
    // landform visible in it at all. Two things were wrong and both matter: the reach
    // overlapped so the sum saturated everywhere, and the floor was high enough that
    // the lambert term — the ONLY thing carrying topography — barely moved the result.
    // SQUARED. Cubed was the over-correction that followed the blob: with the reaches
    // also pulled in, the ground went from a flat wash to invisible, which is the same
    // bug wearing the opposite sign. Squared, with the small ambient floor below and the
    // averaging further down, is where topography actually shows.
    float fall = 1.0 - smoothstep(0.0, reach, dist);
    fall = fall * fall;

    float lambert = max(dot(n, normalize(d)), 0.0);

    // A small floor, so a face turned away is dark but not absolutely black — fog
    // between here and the emitter would not allow that. Small enough that the slope
    // facing the light is several times brighter than the one behind it, which is what
    // makes the ground read as having a shape.
    wash += fall * (0.07 + 0.93 * lambert);
  }

  // Averaged, not summed. Overlapping emitters should light a patch more evenly, not
  // several times harder.
  wash *= 0.42;

  vec3 col = mix(uBody, uLit, clamp(wash, 0.0, 1.0));

  // Distance haze. The far edge of the field dissolves rather than ending on a line.
  float far = smoothstep(0.55, 1.0, vUv.y);
  col = mix(col, uHaze, far * 0.85);

  fragColor = vec4(col, 1.0);
}
`;

export type Terrain = {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  /** Move an emitter after construction — used where the light travels. */
  setLight(index: number, at: Vector3, reach?: number): void;
  dispose(): void;
};

export function makeTerrain(opts: TerrainOptions = {}): Terrain {
  const width = opts.width ?? 420;
  const depth = opts.depth ?? 320;
  const segments = opts.segments ?? 200;

  const lights = new Float32Array(16);
  (opts.lights ?? []).slice(0, 4).forEach((l, i) => {
    lights[i * 4] = l.at.x;
    lights[i * 4 + 1] = l.at.y;
    lights[i * 4 + 2] = l.at.z;
    lights[i * 4 + 3] = l.reach;
  });

  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uAmp: { value: opts.amp ?? 18 },
      uScale: { value: opts.scale ?? 60 },
      uValley: { value: opts.valley ?? 0 },
      uSeed: { value: opts.seed ?? 3.7 },
      uBody: { value: opts.body ?? PALETTE.abyss.clone().lerp(PALETTE.violet, 0.09) },
      uLit: { value: opts.lit ?? PALETTE.azure.clone().lerp(PALETTE.sky, 0.5) },
      uHaze: { value: PALETTE.abyss.clone().lerp(PALETTE.navy, 0.5) },
      uLights: { value: lights },
    },
  });

  const geo = new PlaneGeometry(width, depth, segments, Math.round(segments * 0.8));
  const mesh = new Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;

  return {
    mesh,
    setLight(index, at, reach) {
      const a = mat.uniforms["uLights"]!.value as Float32Array;
      a[index * 4] = at.x;
      a[index * 4 + 1] = at.y;
      a[index * 4 + 2] = at.z;
      if (reach !== undefined) a[index * 4 + 3] = reach;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
