import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  GLSL3,
  Group,
  Mesh,
  Points,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from "three";
import { PALETTE } from "./palette.js";
import { mulberry32 } from "./noise.js";

/**
 * THE LIGHT RIBBON — the reference's other signature form, after the cube.
 *
 * Four of the six frames are built from these: one trail through a canyon, several
 * converging, several diverging, and a pair framing an aerial view. Rather than write
 * four one-off effects, this is the one primitive they all instance, differing only in
 * their curve, their count and their speed. If the ribbon looks wrong anywhere it looks
 * wrong everywhere, which is the property worth having.
 *
 * THREE LAYERS, because a single mesh cannot be both a hot filament and a soft glow:
 *
 *   1. Core     a thin tube, additive, hottest along its centre-line
 *   2. Halo     a much wider tube of the same curve, very dim
 *   3. Sparks   points scattered along the curve, drifting off it
 *
 * ON THE CORE'S BRIGHTNESS TERM. It is `abs(dot(normal, view))`, which peaks where the
 * tube faces the camera and falls to nothing at its silhouette. The instinct is the
 * inverse — the usual fresnel rim — and that is precisely wrong here: a rim-lit tube
 * reads as a glass PIPE with a dark bore, where light along a path has to be brightest
 * through its middle. With DoubleSide and additive blending the far wall sums with the
 * near one, and the falloff to the edges comes out on its own.
 */

export type RibbonOptions = {
  /** Control points, in world space. Sampled as a Catmull-Rom spline. */
  points: Vector3[];
  /** Core tube radius. The halo is drawn at roughly six times this. */
  radius?: number;
  /** Segments along the curve. The one number that decides whether a bend is smooth. */
  segments?: number;
  colorCore?: Color;
  colorHalo?: Color;
  /** Travelling pulses per full length of the curve. 0 disables them. */
  pulses?: number;
  /** Pulse travel, in curve-lengths per second. */
  speed?: number;
  /** Sparks scattered along the curve. 0 disables them. */
  sparks?: number;
  seed?: number;
  /** Overall multiplier, for a ribbon that should sit behind another. */
  intensity?: number;
};

const CORE_VERT = /* glsl */ `
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

const CORE_FRAG = /* glsl */ `
in vec2 vUv;
in vec3 vNormal;
in vec3 vView;
uniform float uTime;
uniform vec3 uColor;
uniform float uPulses;
uniform float uSpeed;
uniform float uIntensity;
uniform float uHalo;
out vec4 fragColor;

void main() {
  // Brightest through the middle of the tube, dark at its silhouette. See the note in
  // ribbon.ts — the inverse of this reads as a pipe, not as light along a path.
  float face = abs(dot(normalize(vNormal), normalize(vView)));
  float body = pow(face, uHalo > 0.5 ? 1.4 : 2.6);

  // Both ends taper out rather than stopping. A ribbon that ends on a flat disc reads
  // as a cut length of tube, and the eye finds the cut immediately.
  float ends = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);

  float amp = 1.0;
  if (uPulses > 0.0) {
    // Travelling pulses. Asymmetric on purpose: a fast leading edge and a long tail,
    // so each one reads as moving in a direction. A symmetric bump has no heading and
    // the ribbon looks like it is merely flickering.
    float p = fract(vUv.x * uPulses - uTime * uSpeed);
    float head = smoothstep(0.10, 0.0, p);
    float tail = smoothstep(0.55, 0.06, p) * 0.55;
    amp += (head + tail) * 1.9;
  }

  float a = body * ends * amp * uIntensity;
  fragColor = vec4(uColor * a, a);
}
`;

const SPARK_VERT = /* glsl */ `
in vec3 aSpark;              // seed, size, speed
out float vAlpha;
uniform float uTime;
uniform float uPixelRatio;
void main() {
  vec3 p = position;
  float s = aSpark.x;

  // Sparks lift off the ribbon and fade, then wrap. A sawtooth on fract() rather than
  // a sine, so they do not all turn round together at the top of a shared cycle.
  float life = fract(uTime * 0.14 * aSpark.z + s);
  p.y += life * 3.4;
  p.x += sin(s * 21.0 + uTime * 0.5) * life * 1.2;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSpark.y * uPixelRatio * (13.0 / max(-mv.z, 0.7));

  // Fade in fast, out slow — a spark that appears at full brightness pops.
  vAlpha = smoothstep(0.0, 0.10, life) * (1.0 - smoothstep(0.25, 1.0, life));
}
`;

const SPARK_FRAG = /* glsl */ `
precision highp float;
in float vAlpha;
uniform vec3 uColor;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = 1.0 - d * 4.0;
  a *= a;
  fragColor = vec4(uColor * a * vAlpha, a * vAlpha);
}
`;

export type Ribbon = {
  group: Group;
  update(t: number): void;
  dispose(): void;
};

export function makeRibbon(opts: RibbonOptions): Ribbon {
  const radius = opts.radius ?? 0.16;
  const segments = opts.segments ?? 220;
  const intensity = opts.intensity ?? 1;
  const curve = new CatmullRomCurve3(opts.points, false, "catmullrom", 0.5);
  const group = new Group();

  const mats: ShaderMaterial[] = [];
  const geos: (TubeGeometry | BufferGeometry)[] = [];

  const tube = (r: number, radial: number, color: Color, halo: boolean, mul: number) => {
    const geo = new TubeGeometry(curve, segments, r, radial, false);
    const mat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: CORE_VERT,
      fragmentShader: CORE_FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: color },
        uPulses: { value: halo ? 0 : (opts.pulses ?? 0) },
        uSpeed: { value: opts.speed ?? 0.12 },
        uIntensity: { value: intensity * mul },
        uHalo: { value: halo ? 1 : 0 },
      },
    });
    mats.push(mat);
    geos.push(geo);
    group.add(new Mesh(geo, mat));
  };

  // Halo first, so the core composites over it. Additive makes the order irrelevant to
  // the result, but it keeps the draw list readable.
  //
  // THE CORE MULTIPLIER IS 0.42, NOT 1. Additive blending through a bloom pass is not
  // forgiving: at full strength a lead filament clipped to pure white and its bloom
  // skirt swelled into a soft blob, so the ribbon stopped being a LINE and became a
  // smear with a bright middle. The pulses still reach white — that is what they are
  // for — and the steady body sits below the clip so the curve stays readable along
  // its whole length.
  tube(radius * 6.5, 10, opts.colorHalo ?? PALETTE.azure.clone(), true, 0.13);
  tube(radius, 8, opts.colorCore ?? PALETTE.sky.clone(), false, 0.42);

  /* ---- sparks ---------------------------------------------------------- */

  let sparkMat: ShaderMaterial | null = null;
  const sparkCount = opts.sparks ?? 0;
  if (sparkCount > 0) {
    const rnd = mulberry32(opts.seed ?? 0x51a2b);
    const pos = new Float32Array(sparkCount * 3);
    const attr = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      const p = curve.getPointAt(rnd());
      // Scattered off the line, not on it. Sparks exactly on the curve read as a
      // dotted line rather than as something the ribbon is shedding.
      pos[i * 3] = p.x + (rnd() - 0.5) * 2.4;
      pos[i * 3 + 1] = p.y + (rnd() - 0.5) * 1.1;
      pos[i * 3 + 2] = p.z + (rnd() - 0.5) * 2.4;
      attr[i * 3] = rnd();
      attr[i * 3 + 1] = 0.7 + rnd() * rnd() * 2.2;
      attr[i * 3 + 2] = 0.5 + rnd();
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("aSpark", new BufferAttribute(attr, 3));
    sparkMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: opts.colorCore ?? PALETTE.sky.clone() },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
    });
    const pts = new Points(geo, sparkMat);
    pts.frustumCulled = false;
    geos.push(geo);
    mats.push(sparkMat);
    group.add(pts);
  }

  return {
    group,
    update(t) {
      for (const m of mats) m.uniforms["uTime"]!.value = t;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

/** A curve that wanders across the frame. Used wherever a scene wants several ribbons
 *  that are clearly siblings without being copies of one another. */
export function meander(
  seed: number,
  opts: { from: Vector3; to: Vector3; sway: number; points?: number },
): Vector3[] {
  const rnd = mulberry32(seed);
  const n = opts.points ?? 6;
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = opts.from.clone().lerp(opts.to, u);
    // No sway at the ends, so a set of these can share endpoints and still separate in
    // the middle — which is exactly what the converging and diverging frames need.
    const w = Math.sin(u * Math.PI) * opts.sway;
    p.x += (rnd() - 0.5) * w;
    p.z += (rnd() - 0.5) * w * 0.7;
    p.y += (rnd() - 0.5) * w * 0.18;
    out.push(p);
  }
  return out;
}
