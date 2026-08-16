import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  GLSL3,
  Points,
  ShaderMaterial,
} from "three";
import { PALETTE } from "./palette.js";
import { SIMPLEX3, mulberry32 } from "./noise.js";

/**
 * Suspended particulate — the dust/motes layer.
 *
 * Present because it is what sells DEPTH. Without something small and out-of-focus
 * between the camera and the subject, a dark 3D scene reads as flat. Points are drawn
 * as soft discs with a squared falloff, never as sprites: a texture lookup for a 3px
 * dot is wasted bandwidth at these counts.
 */
export function makeMotes(
  count: number,
  radius: number,
  seed: number,
  opts?: { colorA?: Color; colorB?: Color; size?: number; speed?: number },
): Points<BufferGeometry, ShaderMaterial> {
  const rnd = mulberry32(seed);
  const pos = new Float32Array(count * 3);
  const attr = new Float32Array(count * 3); // seed, size, speed

  for (let i = 0; i < count; i++) {
    // Cube-root radial distribution gives uniform density in the volume; a naive random
    // radius bunches everything at the centre.
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
      uColorA: { value: opts?.colorA ?? PALETTE.cyan },
      uColorB: { value: opts?.colorB ?? PALETTE.sky },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      in vec3 aMote;
      out float vAlpha;
      out float vMix;
      uniform float uTime, uSize, uSpeed, uPixelRatio;
      ${SIMPLEX3}
      void main(){
        vec3 p = position;
        float s = aMote.x;

        // Curl-ish drift: three decorrelated noise lookups. Cheaper than a real curl
        // and indistinguishable at this scale.
        float t = uTime * uSpeed * aMote.z * 0.12;
        p.x += snoise(vec3(p.yz * 0.12, t + s)) * 1.4;
        p.y += snoise(vec3(p.zx * 0.12, t + s + 10.0)) * 1.0;
        p.z += snoise(vec3(p.xy * 0.12, t + s + 20.0)) * 1.4;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        float dist = -mv.z;
        gl_PointSize = uSize * aMote.y * uPixelRatio * (14.0 / max(dist, 0.6));

        // Fade at both ends of the depth range: near motes would otherwise smear across
        // the lens, far ones would stipple.
        vAlpha = smoothstep(0.5, 4.0, dist) * (1.0 - smoothstep(26.0, 46.0, dist));
        vAlpha *= 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 0.7 * aMote.z + s * 6.0));
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
        // Squared falloff, then squared again: a tight core with a wide skirt.
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
