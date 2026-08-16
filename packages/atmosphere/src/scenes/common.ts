import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  GLSL3,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { PALETTE } from "../core/palette.js";
import { SIMPLEX3 } from "../core/shaders.js";

/**
 * Parts every scene shares.
 *
 * Not a base class. A scene composes these; it does not inherit from them. Five
 * scenes with five genuinely different shapes have almost nothing in common except
 * the air they sit in, and pretending otherwise produces a base class that every
 * scene fights.
 */

/** Deterministic PRNG. Seeded per scene so a layout is reproducible between reloads —
 *  a background that reshuffles every refresh cannot be art-directed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** GLSL's `smoothstep`, on the CPU side. Here rather than in two scene files because a
 *  crossfade whose two halves are eased by two copies of this drifts the moment one of
 *  them is tuned. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * THE ATMOSPHERE ITSELF — a full-frame gradient that every scene sits inside.
 *
 * This is the layer doing the most work for the least code. The reference never has a
 * flat background: there is always a soft, slowly-breathing radial bloom of deep
 * colour behind the geometry, which is what stops the frame reading as objects
 * floating on black. Two octaves of noise keep it from looking like a CSS gradient.
 */
export function makeAirdrop(opts: {
  inner: Color; outer: Color; centre?: [number, number]; scale?: number; speed?: number;
}): Mesh<PlaneGeometry, ShaderMaterial> {
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uInner: { value: opts.inner },
      uOuter: { value: opts.outer },
      uCentre: { value: opts.centre ?? [0.5, 0.55] },
      uScale: { value: opts.scale ?? 1.0 },
      uSpeed: { value: opts.speed ?? 0.05 },
      uTime: { value: 0 },
      uAspect: { value: 1 },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv;
      out vec4 fragColor;
      uniform vec3 uInner, uOuter;
      uniform vec2 uCentre;
      uniform float uScale, uSpeed, uTime, uAspect;
      ${SIMPLEX3}
      void main(){
        vec2 p = vUv - uCentre;
        p.x *= uAspect;
        float d = length(p) * uScale;

        // Two slow octaves warp the falloff so the pool breathes instead of pulsing.
        float n = fbm(vec3(vUv * 2.4, uTime * uSpeed));
        d += n * 0.16;

        float f = 1.0 - smoothstep(0.0, 0.95, d);
        f = pow(max(f, 0.0), 1.9);
        vec3 col = mix(uOuter, uInner, f);

        // A second, much wider and dimmer pool keeps the corners from going dead.
        float wide = 1.0 - smoothstep(0.0, 1.8, length(p));
        col += uInner * pow(max(wide, 0.0), 3.0) * 0.18;

        fragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

/**
 * Suspended particulate — the dust/motes layer.
 *
 * Present in every scene because it is what sells DEPTH. Without something small and
 * out-of-focus between the camera and the subject, a dark 3D scene reads as flat.
 * Points are drawn as soft discs with a squared falloff, never as sprites: a texture
 * lookup for a 3px dot is wasted bandwidth at these counts.
 */
export function makeMotes(count: number, radius: number, seed: number, opts?: {
  colorA?: Color; colorB?: Color; size?: number; speed?: number; rise?: number;
}): Points<BufferGeometry, ShaderMaterial> {
  const rnd = mulberry32(seed);
  const pos = new Float32Array(count * 3);
  const attr = new Float32Array(count * 3); // seed, size, speed

  for (let i = 0; i < count; i++) {
    // Cube-root radial distribution gives uniform density in the volume; a naive
    // random radius bunches everything at the centre.
    const r = radius * Math.cbrt(rnd());
    const theta = rnd() * Math.PI * 2;
    const phi = Math.acos(2 * rnd() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6;
    pos[i * 3 + 2] = r * Math.cos(phi);
    attr[i * 3] = rnd() * 100;
    attr[i * 3 + 1] = 0.4 + rnd() * rnd() * 1.6; // biased small
    attr[i * 3 + 2] = 0.3 + rnd() * 0.9;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("aMote", new BufferAttribute(attr, 3));

  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: opts?.size ?? 2.2 },
      uSpeed: { value: opts?.speed ?? 1 },
      uRise: { value: opts?.rise ?? 0.35 },
      /* Global dimmer, 1 unless a scene is taking the layer out. Here rather than on
         `visible`, because these are additive and switching them off is a step change in
         the brightness of the whole frame. A scene that flies the camera from one place
         to another needs to cross-fade its particulate the way it cross-fades everything
         else. */
      uFade: { value: 1 },
      uColorA: { value: opts?.colorA ?? PALETTE.cyan },
      uColorB: { value: opts?.colorB ?? PALETTE.sky },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      in vec3 aMote;
      out float vAlpha;
      out float vMix;
      uniform float uTime, uSize, uSpeed, uRise, uPixelRatio, uFade;
      ${SIMPLEX3}
      void main(){
        vec3 p = position;
        float s = aMote.x;

        // Curl-ish drift: three decorrelated noise lookups. Cheaper than a real curl
        // and indistinguishable at this scale.
        float t = uTime * uSpeed * aMote.z * 0.12;
        p.x += snoise(vec3(p.yz * 0.12, t + s)) * 1.4;
        p.y += snoise(vec3(p.zx * 0.12, t + s + 10.0)) * 1.0 + mod(uTime * uRise * aMote.z, 1.0) * 0.0;
        p.z += snoise(vec3(p.xy * 0.12, t + s + 20.0)) * 1.4;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float dist = -mv.z;
        gl_PointSize = uSize * aMote.y * uPixelRatio * (14.0 / max(dist, 0.6));

        // Fade at both ends of the depth range: near motes would otherwise smear
        // across the lens, far ones would stipple.
        vAlpha = smoothstep(0.5, 4.0, dist) * (1.0 - smoothstep(26.0, 46.0, dist));
        vAlpha *= 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 0.7 * aMote.z + s * 6.0));
        vAlpha *= uFade;
        vMix = fract(s * 0.37);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in float vAlpha;
      in float vMix;
      out vec4 fragColor;
      uniform vec3 uColorA, uColorB;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        // Squared falloff, then squared again: a tight core with a wide skirt, which
        // is what the bloom pass wants to find.
        float a = 1.0 - d * 4.0;
        a *= a;
        vec3 col = mix(uColorA, uColorB, vMix);
        fragColor = vec4(col * a * vAlpha, a * vAlpha);
      }
    `,
  });

  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** Shared easing for camera drift — a scene should never move linearly. */
export function driftCamera(
  target: Vector3, base: Vector3, t: number, amp: number, rate = 1,
): void {
  target.set(
    base.x + Math.sin(t * 0.13 * rate) * amp + Math.sin(t * 0.071 * rate) * amp * 0.6,
    base.y + Math.cos(t * 0.11 * rate) * amp * 0.7,
    base.z + Math.sin(t * 0.085 * rate + 1.7) * amp * 0.5,
  );
}
