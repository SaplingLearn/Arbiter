/**
 * Shared GLSL.
 *
 * Kept as string chunks rather than separate .glsl files so the whole shading
 * language of the app is greppable in one place. Every scene composes from these;
 * a scene that needs its own noise is a scene that has drifted.
 */

/** Ashima simplex noise, 3D. Public domain. Used by every scene for organic drift. */
export const SIMPLEX3 = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * snoise(p); p *= 2.02; a *= 0.5; }
  return v;
}
`;

/**
 * Fullscreen pass vertex shader, paired with a PlaneGeometry(2, 2).
 *
 * Uses three's injected `position` / `uv` attributes rather than gl_VertexID, because
 * the attributeless trick needs a geometry with a manual draw range and three's
 * frustum culling then has nothing to work with. The saving is one triangle.
 */
export const FULLSCREEN_VERT = /* glsl */ `
out vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * THE TRANSITION.
 *
 * This is the signature move of the reference and the one thing that must not be a
 * cross-fade. The frame is torn into uneven vertical bands which slide against each
 * other and smear, while the incoming scene resolves underneath. Bands are derived
 * from a hash of their own index, so the tear is irregular rather than a comb.
 *
 * The chromatic split is sampled at three different offsets rather than being a
 * post-hoc RGB shift, so fringing appears at band EDGES — where a real signal fault
 * would put it — instead of uniformly across the frame.
 *
 * `progress` is 0 at the outgoing scene and 1 at the incoming one. Displacement peaks
 * in the middle and is zero at both ends, so the transition cannot leave residue.
 */
export const TRANSITION_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
uniform float uTime;
uniform float uAspect;

/**
 * The tear's shape, so one transition can be many.
 *
 * uBands  how many strips the frame is cut into. Few and wide reads heavy and
 *         deliberate; many and thin reads fast and electrical.
 * uAxis   0 = strips run across the frame and slide sideways, 1 = strips run down
 *         it and slide vertically.
 *
 * These exist because the consumer navigates between pages that mean different
 * things, and one transition played identically every time stops being a
 * transition and becomes a wipe. Three wide bands closing slowly is a seal; two
 * dozen thin ones is a thought.
 */
uniform float uBands;
uniform float uAxis;

float hash(float n){ return fract(sin(n) * 43758.5453123); }

void main(){
  float p = clamp(uProgress, 0.0, 1.0);

  // Peaks at p=0.5, zero at both ends. sin gives a softer shoulder than a triangle,
  // which keeps the tear from arriving as a snap.
  float energy = sin(p * 3.14159265);
  energy = pow(energy, 0.7);

  // Bands of uneven height. Hashing the band index (not the row) is what makes
  // them irregular; hashing the row would shimmer every frame.
  float bands = max(uBands, 1.0);
  // The axis the bands are cut ALONG. Everything below works in this one
  // coordinate, so a vertical tear is the same maths with the frame turned.
  float along = mix(vUv.y, vUv.x, uAxis);
  float bandIdx = floor(along * bands);
  float r1 = hash(bandIdx * 12.9898);
  float r2 = hash(bandIdx * 78.233 + 4.0);

  // Each band picks a direction and a speed. The time term is deliberately coarse
  // (quantised to ~15Hz) so the tear stutters like dropped frames rather than sliding.
  float stutter = floor(uTime * 15.0) / 15.0;
  float dir = r1 > 0.5 ? 1.0 : -1.0;
  float amount = (0.04 + r2 * 0.16) * energy * dir;
  amount *= 0.6 + 0.4 * hash(bandIdx + stutter * 3.0);

  // The slide is perpendicular to the cut, so bands cut across the frame move
  // sideways and bands cut down it move up and down.
  vec2 slideA = mix(vec2(amount, 0.0), vec2(0.0, amount), uAxis);
  vec2 slideB = mix(vec2(amount * 0.6, 0.0), vec2(0.0, amount * 0.6), uAxis);
  vec2 uvA = vUv + slideA;
  vec2 uvB = vUv - slideB;

  // Per-channel offsets, scaled by the same energy, so fringing tracks the tear.
  float ca = 0.006 * energy;
  vec3 from = vec3(
    texture(uFrom, uvA + vec2(ca, 0.0)).r,
    texture(uFrom, uvA).g,
    texture(uFrom, uvA - vec2(ca, 0.0)).b
  );
  vec3 to = vec3(
    texture(uTo, uvB + vec2(ca, 0.0)).r,
    texture(uTo, uvB).g,
    texture(uTo, uvB - vec2(ca, 0.0)).b
  );

  // The mix is band-staggered: bands cross over at slightly different times, so the
  // new scene arrives in pieces. A single global mix would read as a dissolve.
  float stagger = (r1 - 0.5) * 0.22;
  float m = smoothstep(0.28 + stagger, 0.72 + stagger, p);

  vec3 col = mix(from, to, m);

  // A thin bright seam on the leading edge of each displaced band — the scan-line
  // flare that sells it as a signal fault rather than a filter.
  float seam = smoothstep(0.985, 1.0, fract(along * bands)) * energy;
  col += vec3(0.25, 0.55, 0.9) * seam * 0.5;

  fragColor = vec4(col, 1.0);
}
`;

/** Bright-pass. Soft knee so geometry near threshold doesn't pop as it brightens. */
export const BRIGHT_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uKnee;

void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float w = max(soft, l - uThreshold) / max(l, 1e-5);
  fragColor = vec4(c * w, 1.0);
}
`;

/** Separable gaussian, 9-tap with linear-sampling weights. */
export const BLUR_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uDirection;

void main(){
  vec3 sum = texture(uTex, vUv).rgb * 0.227027;
  vec2 o1 = uDirection * 1.3846153846;
  vec2 o2 = uDirection * 3.2307692308;
  sum += texture(uTex, vUv + o1).rgb * 0.3162162162;
  sum += texture(uTex, vUv - o1).rgb * 0.3162162162;
  sum += texture(uTex, vUv + o2).rgb * 0.0702702703;
  sum += texture(uTex, vUv - o2).rgb * 0.0702702703;
  fragColor = vec4(sum, 1.0);
}
`;

/**
 * Final composite: bloom add, ACES tonemap, grain, vignette, sRGB encode.
 *
 * Grain is added AFTER tonemapping on purpose. Grain in linear light gets crushed in
 * the shadows, which is exactly where it is doing its job — breaking up the banding
 * that a near-black gradient across 1080p would otherwise show on an 8-bit display.
 */
export const FINAL_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uBloom1;
uniform sampler2D uBloom2;
uniform sampler2D uBloom3;
uniform float uBloomStrength;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uFade;

vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main(){
  vec3 col = texture(uScene, vUv).rgb;

  vec3 bloom = texture(uBloom1, vUv).rgb * 1.0
             + texture(uBloom2, vUv).rgb * 0.7
             + texture(uBloom3, vUv).rgb * 0.45;
  col += bloom * uBloomStrength;

  col = aces(col);

  // Vignette, generous and soft. The reference never lets the corners reach the
  // ground value — they go slightly below it, which is what makes the frame feel lit.
  vec2 q = vUv - 0.5;
  float v = 1.0 - dot(q, q) * uVignette;
  col *= clamp(v, 0.0, 1.0);

  float g = hash21(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5;
  col += g * uGrain;

  col *= uFade;

  // Linear -> sRGB. Done here because the renderer's output conversion is disabled;
  // see Atmosphere.ts.
  col = max(col, vec3(0.0));
  vec3 lo = col * 12.92;
  vec3 hi = 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055;
  fragColor = vec4(mix(hi, lo, step(col, vec3(0.0031308))), 1.0);
}
`;
