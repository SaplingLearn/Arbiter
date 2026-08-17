import { Color, GLSL3, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { PALETTE } from "../core/palette.js";
import { SIMPLEX3 } from "../core/shaders.js";

/**
 * THE GROUND — a dark heightfield that the light in a scene falls on.
 *
 * Ported from the landing page's `overture/lib/terrain.ts`, which exists for one reason
 * and it is the reason it is worth having twice: a glowing object on an empty background
 * is a neon squiggle, and the same object with a hillside catching its light is a place.
 * Every frame in the reference except the first has one.
 *
 * THE LIGHTING IS DONE HERE rather than with three's own lights, because the emitters in
 * these scenes are cubes and ribbons drawn with additive custom shaders and they
 * contribute nothing to a standard lighting pass. Handing this shader the emitter
 * positions directly is the only way the ground can know where the light in the frame
 * actually is.
 *
 * WHAT CHANGED ON THE WAY ACROSS FROM THE LANDING PAGE, and each of the three is here
 * because the archive asks something of its ground that the landing's plain does not:
 *
 *  - EMITTERS CARRY A COLOUR. The landing lights its ground from three identical cubes,
 *    so one `uLit` covers it. The archive's bodies are not identical: a refused case is
 *    the one red thing in the palette, and the ground under it has to agree with it.
 *
 *  - EIGHT SLOTS, not four. The library holds six.
 *
 *  - `uDissolve`, so the ground can leave with the rest of a field. The archive flies the
 *    camera inside one of its bodies and the world outside has to stop existing; a ground
 *    that stayed is the outside visibly still running.
 *
 * AND ONE OPTION THE LANDING DOES NOT HAVE: `bands`. The archive had a separate additive
 * plane drawing sweeping light bands, and a flat additive plane over an undulating opaque
 * one either z-fights with it or gets buried under every rise. Folded in here it is one
 * mesh, one shader, and — the actual gain — light that runs OVER the topography instead
 * of through it.
 *
 * The landing's `valley` option did not come across. Nothing here opens a channel.
 */

/** Emitter slots. Fixed, because a GLSL loop bound has to be a constant. */
export const MAX_TERRAIN_LIGHTS = 8;

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
  seed?: number;
  /**
   * KEEP THE NEAR FIELD FLAT, and let the height ramp in behind it. Both numbers are
   * distances INTO the scene, along -z.
   *
   * For a scene where things stand on the ground rather than fly over it. The landing's
   * own note says its plain is the flattest in that set "because the cubes have to sit ON
   * it"; a camera four units above the surface, looking at bodies a quarter that size,
   * needs the same argument taken one step further. Relief where the bodies stand either
   * buries a foot or lifts one off the ground, and it is not where the topography is
   * doing its work anyway — that happens in the mid-distance, where a swell reads against
   * the horizon. Omit for relief everywhere.
   */
  flat?: { until: number; over: number };
  /** Unlit ground. */
  body?: Color;
  /** What the far edge dissolves into. Match it to the scene's air or the plane ends on
   *  a visible line. */
  haze?: Color;
  /**
   * Where the haze starts and where it has finished, as distances into the field along
   * -z. Defaults to the middle half of the plane, which is only right for a plane whose
   * subject sits at the near edge — anything standing further in gets washed out by its
   * own scene's atmosphere. Set it past the furthest thing that has to stay legible.
   */
  hazeAt?: { from: number; to: number };
  /** Fine surface relief, as a normal perturbation rather than displacement. 0 is a
   *  perfectly smooth surface. See the fragment shader for why it is not in the vertex. */
  bump?: number;
  /**
   * Overall strength of the emitter wash. The default is the landing page's, tuned for a
   * camera twenty units above its plain; a camera nearer the surface sees the same pool
   * compressed into a few degrees of screen and needs more of it.
   */
  gain?: number;
  /** Where `setDissolve(1)` takes the whole surface. */
  fog?: Color;
  /** Sweeping light bands, in the surface. Off unless asked for. */
  bands?: {
    color?: Color;
    deep?: Color;
    /** Spatial frequency across x. Smaller is wider bands. */
    freq?: number;
    speed?: number;
    gain?: number;
  };
};

const VERT = /* glsl */ `
uniform float uAmp;
uniform float uScale;
uniform float uSeed;
uniform vec2 uFlat;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out float vDepth;

${SIMPLEX3}

float height(vec2 p) {
  float h = 0.0;
  h += snoise(vec3(p / uScale, uSeed)) * 0.62;
  h += snoise(vec3(p / (uScale * 0.42), uSeed + 11.0)) * 0.26;
  h += snoise(vec3(p / (uScale * 0.17), uSeed + 23.0)) * 0.12;

  // The plane is laid down by a -90° rotation about x, which maps local +y to world -z.
  // So local y IS distance into the scene, and the near field is the low end of it.
  // A MULTIPLIER on the height rather than a subtraction, so the hills keep their shape
  // as they rise out of the flat instead of being sliced off by a plane.
  h *= smoothstep(uFlat.x, uFlat.y, p.y);
  return h * uAmp;
}

void main() {
  vUv = uv;
  vec3 p = position;
  p.z += height(p.xy);

  // Normals by central difference. Cheaper than a second geometry pass and accurate
  // enough for a surface that is never more than dimly lit.
  float e = uScale * 0.06;
  float hx = height(p.xy + vec2(e, 0.0)) - height(p.xy - vec2(e, 0.0));
  float hy = height(p.xy + vec2(0.0, e)) - height(p.xy - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx, -hy, 2.0 * e));

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);

  vec4 view = viewMatrix * world;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in float vDepth;
uniform vec3 uBody;
uniform vec3 uHaze;
uniform vec3 uFog;
uniform vec4 uLights[${MAX_TERRAIN_LIGHTS}];   // xyz = position, w = reach (0 = unused)
uniform vec3 uLightCol[${MAX_TERRAIN_LIGHTS}];
uniform float uTime;
uniform float uDissolve;
uniform vec2 uHazeRange;
uniform float uGain;
uniform float uBump;
uniform vec3 uBandCol;
uniform vec3 uBandDeep;
uniform vec3 uBandTune;   // freq, speed, gain
out vec4 fragColor;

${SIMPLEX3}

void main() {
  vec3 n = normalize(vNormal);

  /* SURFACE, WITHOUT GEOMETRY. The lambert term is the only thing in this shader that
     tells the eye it is looking at a solid rather than at fog, and it needs the normal to
     vary. A scene that keeps its near field flat so things can stand on it has no
     variation left down there, and the pools come out as soft glows lying in the air.

     So the detail goes in the NORMAL and not in the vertex — the ground stays flat to the
     millimetre where feet meet it, and still breaks the light up like ground. Three
     samples of the same noise the displacement uses, at a much finer scale, differenced
     into a slope. */
  if (uBump > 0.0) {
    vec2 q = vWorld.xz * 0.075;
    float h0 = snoise(vec3(q, 0.0));
    float hx = snoise(vec3(q + vec2(0.35, 0.0), 0.0));
    float hz = snoise(vec3(q + vec2(0.0, 0.35), 0.0));
    n = normalize(n + vec3(h0 - hx, 0.0, h0 - hz) * uBump);
  }

  float wash = 0.0;
  vec3 tint = vec3(0.0);

  for (int i = 0; i < ${MAX_TERRAIN_LIGHTS}; i++) {
    float reach = uLights[i].w;
    if (reach <= 0.0) continue;
    vec3 d = uLights[i].xyz - vWorld;
    float dist = length(d);

    // Inverse-square would be physically right and looks wrong at this scale — it puts a
    // hot spot under the emitter and nothing anywhere else. A smoothstep falloff spreads
    // the light the way a wide soft source in fog actually behaves. SQUARED: the landing
    // page arrived at this exponent by overshooting it in both directions, once into a
    // flat blue blob covering the frame and once into a ground with no light on it at all.
    float fall = 1.0 - smoothstep(0.0, reach, dist);
    fall = fall * fall;

    float lambert = max(dot(n, normalize(d)), 0.0);

    // A small floor, so a face turned away is dark but not absolutely black — fog between
    // here and the emitter would not allow that. Small enough that the slope facing the
    // light is several times brighter than the one behind it, which is what makes the
    // ground read as having a shape.
    float w = fall * (0.07 + 0.93 * lambert);
    wash += w;
    tint += uLightCol[i] * w;
  }

  /* THE COLOUR IS A WEIGHTED AVERAGE OF THE EMITTERS, not their sum, and that is what
     makes a refusal legible. Summed, a dim red pool sitting inside the skirt of two
     bright azure ones is azure plus a rounding error. Averaged by the same weights that
     decide the brightness, the ground between two bodies carries whichever of them is
     actually lighting it, and red only stops being red where blue is genuinely closer. */
  vec3 lit = wash > 0.0001 ? tint / wash : vec3(0.0);

  // Averaged, not summed. Overlapping emitters should light a patch more evenly, not
  // several times harder.
  wash *= uGain;

  vec3 col = mix(uBody, lit, clamp(wash, 0.0, 1.0));

  /* SWEEPING BANDS. Long bands running with the field and drifting sideways, warped by a
     slow noise so they are not a ruler. Additive INTO the surface, which is the whole
     reason this is not its own plane: they now bend over the landform. */
  if (uBandTune.z > 0.0) {
    float band = sin(vWorld.x * uBandTune.x + uTime * uBandTune.y
                     + snoise(vec3(vWorld.xz * 0.004, uTime * 0.05)) * 2.2);
    band = pow(max(band, 0.0), 7.0);
    float grid = smoothstep(0.96, 1.0, abs(sin(vWorld.z * 0.13)));
    float near = 1.0 - smoothstep(20.0, 150.0, vDepth);
    col += mix(uBandDeep, uBandCol, band) * (band * 0.30 + grid * 0.05) * near * uBandTune.z;
  }

  // Distance haze. The far edge of the field dissolves rather than ending on a line, and
  // it goes ALL the way to the haze colour before the geometry runs out — at the 0.85 the
  // landing page uses, the last 15% of the ground colour draws the plane's own edge across
  // the frame. A camera this low is looking straight down the length of it.
  col = mix(col, uHaze, smoothstep(uHazeRange.x, uHazeRange.y, vUv.y));

  // Out through the same door the rest of the scene uses.
  col = mix(col, uFog, uDissolve);
  fragColor = vec4(col, 1.0);
}
`;

export type Terrain = {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  /** Light the ground from a point. `reach` of 0 retires the slot. */
  setLight(index: number, at: Vector3, reach: number, color?: Color): void;
  /** Retire every slot. A caller rebuilding its emitters must start here, or a shorter
   *  list than last time leaves the tail of the previous one still lighting the field. */
  clearLights(): void;
  setDissolve(k: number): void;
  update(t: number): void;
  dispose(): void;
};

export function makeTerrain(opts: TerrainOptions = {}): Terrain {
  const width = opts.width ?? 420;
  const depth = opts.depth ?? 320;
  const segments = opts.segments ?? 200;

  const lights = new Float32Array(MAX_TERRAIN_LIGHTS * 4);
  const lightCols = new Float32Array(MAX_TERRAIN_LIGHTS * 3);
  const bands = opts.bands;

  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uAmp: { value: opts.amp ?? 18 },
      uScale: { value: opts.scale ?? 60 },
      uSeed: { value: opts.seed ?? 3.7 },
      // Far below any coordinate the plane has, so the smoothstep is 1 everywhere and the
      // relief runs to the near edge. This is the "no flat" case, spelled as data.
      uFlat: { value: opts.flat ? [opts.flat.until, opts.flat.until + opts.flat.over] : [-1e6, -1e6 + 1] },
      uBody: { value: opts.body ?? PALETTE.abyss.clone().lerp(PALETTE.violet, 0.09) },
      uHaze: { value: opts.haze ?? PALETTE.abyss.clone().lerp(PALETTE.navy, 0.5) },
      uFog: { value: opts.fog ?? PALETTE.abyss.clone() },
      // The plane is centred on its own origin, so a distance of `d` into the field is
      // `0.5 + d / depth` along v.
      uHazeRange: {
        value: opts.hazeAt
          ? [0.5 + opts.hazeAt.from / depth, 0.5 + opts.hazeAt.to / depth]
          : [0.55, 0.95],
      },
      uGain: { value: opts.gain ?? 0.42 },
      uBump: { value: opts.bump ?? 0 },
      uLights: { value: lights },
      uLightCol: { value: lightCols },
      uTime: { value: 0 },
      uDissolve: { value: 0 },
      uBandCol: { value: bands?.color ?? PALETTE.azure.clone() },
      uBandDeep: { value: bands?.deep ?? PALETTE.reflex.clone() },
      uBandTune: { value: [bands?.freq ?? 0.05, bands?.speed ?? 0.2, bands ? (bands.gain ?? 1) : 0] },
    },
  });

  const geo = new PlaneGeometry(width, depth, segments, Math.round(segments * 0.8));
  const mesh = new Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;

  return {
    mesh,
    setLight(index, at, reach, color) {
      if (index < 0 || index >= MAX_TERRAIN_LIGHTS) return;
      lights[index * 4] = at.x;
      lights[index * 4 + 1] = at.y;
      lights[index * 4 + 2] = at.z;
      lights[index * 4 + 3] = reach;
      if (color) {
        lightCols[index * 3] = color.r;
        lightCols[index * 3 + 1] = color.g;
        lightCols[index * 3 + 2] = color.b;
      }
    },
    clearLights() {
      for (let i = 0; i < MAX_TERRAIN_LIGHTS; i++) lights[i * 4 + 3] = 0;
    },
    setDissolve(k) {
      mat.uniforms["uDissolve"]!.value = k;
    },
    update(t) {
      mat.uniforms["uTime"]!.value = t;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
