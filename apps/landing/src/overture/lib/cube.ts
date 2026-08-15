import { BoxGeometry, Color, GLSL3, Mesh, ShaderMaterial } from "three";
import { PALETTE } from "./palette.js";

/**
 * THE EMISSIVE CUBE — the reference's subject, and its recurring motif.
 *
 * It carries the first frame alone and returns in the fourth as three of them at
 * different sizes on open ground. Same object both times, which is the point: the
 * fourth frame reads as "more of these exist" rather than as a new idea, and that only
 * works if it is literally the same material.
 *
 * Three things separate it from a lit box, and all three are here:
 *
 *   1. A VERTICAL VALUE RAMP. Near-white along the top edge, deepening to a saturated
 *      blue at the foot. The strongest single cue — it reads as a volume of light with
 *      a surface, rather than as a uniformly emissive solid.
 *   2. IRREGULAR PANELLING at two scales, so the surface is built from parts of unequal
 *      size. A single grid reads as graph paper.
 *   3. A CUT. One wedge recessed into a face, with a lit edge along its hypotenuse. It
 *      is what makes the object read as constructed and specific rather than as a
 *      procedural texture, and it is the thing the eye returns to on a second look.
 *
 * Panelling is deterministic — no time term — so the facade is STRUCTURE. A crawling
 * facade reads as noise and destroys the object.
 */

const VERT = /* glsl */ `
out vec3 vNormal;
out vec3 vView;
out vec3 vObj;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
in vec3 vNormal;
in vec3 vView;
in vec3 vObj;
uniform float uTime;
uniform float uHalf;
uniform float uCut;
uniform float uSeedShift;
uniform vec3 uBody;
uniform vec3 uDeep;
uniform vec3 uPanel;
uniform vec3 uHot;
out vec4 fragColor;

float cell(vec2 id) {
  return fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
}

/** Planar coordinates for whichever face this fragment is on, plus a per-face seed so
 *  the four sides do not carry the same panel layout. */
vec2 faceUv(vec3 n, vec3 p, out float seed) {
  vec3 a = abs(n);
  if (a.x > a.y && a.x > a.z) { seed = n.x > 0.0 ? 1.0 : 2.0; return p.zy; }
  if (a.y > a.z)              { seed = n.y > 0.0 ? 3.0 : 4.0; return p.xz; }
                                seed = n.z > 0.0 ? 5.0 : 6.0; return p.xy;
}

void main() {
  float seed;
  vec2 fp = faceUv(normalize(vNormal), vObj, seed) / uHalf; // -1 .. 1
  vec2 q = fp * 0.5 + 0.5;                                  //  0 .. 1
  seed += uSeedShift;

  vec2 gA = floor(q * 7.0 + seed * 13.0);
  vec2 gB = floor(q * 19.0 + seed * 7.3 + 3.7);
  float a = cell(gA);
  float b = cell(gB);

  float panel = mix(0.80, 1.20, a);
  panel *= mix(0.93, 1.07, b);
  float bright = smoothstep(0.87, 0.99, a) * 0.60;

  // Height through the WHOLE object, not through the face, so the ramp is continuous
  // across the silhouette and the top cap sits at the hot end of it.
  float h = clamp(vObj.y / (uHalf * 2.0) + 0.5, 0.0, 1.0);
  float ramp = pow(h, 0.85);

  // The cut — a wedge recessed into the upper-middle of ONE face.
  //
  // Bounded to a box rather than written across the whole face. The first version ran
  // its hypotenuse corner to corner and read as a light shaft lying across the object
  // rather than as a notch taken out of it: at that size the eye resolves it as a
  // highlight, not as geometry. Roughly a third of the face is where it flips back to
  // reading as construction.
  float onCut = step(4.5, seed) * uCut;
  vec2 c = (q - vec2(0.30, 0.36)) / 0.40;
  float box = step(0.0, c.x) * step(c.x, 1.0) * step(0.0, c.y) * step(c.y, 1.0);
  float dCut = c.y - (1.0 - c.x);
  float inside = smoothstep(0.0, -0.07, dCut) * box;
  float lip = smoothstep(0.06, 0.0, abs(dCut)) * box;

  // A slow inhale. One cycle, no harmonics: anything more reads as flicker.
  float breath = 0.94 + 0.06 * sin(uTime * 0.55);

  // Fresnel, inverted. The FACES are hot and the silhouette edge cools, which is what
  // an object lit from within does. The usual rim-light fresnel would make it a glass
  // shell, and a glass shell is a different, weaker idea.
  float f = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
  float core = 1.0 - smoothstep(0.15, 0.85, f);

  vec3 col = mix(uDeep, uBody, ramp) * panel * breath;
  col = mix(col, uPanel, bright * ramp);
  col += uHot * core * 0.85 * ramp;

  col *= mix(1.0, 0.16, inside * onCut);
  col += uHot * lip * onCut * 0.14;

  vec2 seam = abs(fract(q * 7.0) - 0.5);
  float line = 1.0 - smoothstep(0.45, 0.5, max(seam.x, seam.y));
  col *= mix(1.0, 0.80, line);

  fragColor = vec4(col, 1.0);
}
`;

export type EmissiveCube = {
  mesh: Mesh<BoxGeometry, ShaderMaterial>;
  material: ShaderMaterial;
  dispose(): void;
};

export function makeCube(
  size: number,
  opts?: { gain?: number; cut?: boolean; seedShift?: number; body?: Color },
): EmissiveCube {
  const geo = new BoxGeometry(size, size, size);
  const gain = opts?.gain ?? 1;
  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uHalf: { value: size / 2 },
      uCut: { value: opts?.cut === false ? 0 : 1 },
      uSeedShift: { value: opts?.seedShift ?? 0 },
      uBody: { value: (opts?.body ?? PALETTE.cyan.clone()).clone().multiplyScalar(3.1 * gain) },
      // The foot of the ramp. Violet-leaning, so the object's own gradient obeys the
      // same rule as the rest of the palette.
      uDeep: {
        value: PALETTE.azure.clone().lerp(PALETTE.electric, 0.3).multiplyScalar(1.5 * gain),
      },
      uPanel: { value: PALETTE.sky.clone() },
      uHot: { value: PALETTE.pale.clone() },
    },
  });
  const mesh = new Mesh(geo, mat);
  return {
    mesh,
    material: mat,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
