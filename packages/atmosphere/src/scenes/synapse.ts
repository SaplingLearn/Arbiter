import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  GLSL3,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
} from "three";
import { PALETTE } from "../core/palette.js";
import { SIMPLEX3 } from "../core/shaders.js";
import { makeAirdrop, makeMotes, mulberry32 } from "./common.js";
import type { AtmosphereScene, SceneContext } from "../core/types.js";

/**
 * ASK — "SYNAPSE"
 *
 * A branching vascular network carrying a current, seen from above across dark
 * terrain. Pulses travel the branches; where one arrives, a node lights and holds
 * briefly before decaying.
 *
 * WHY THIS FOR THIS PAGE. Ask is retrieval: a question goes out across a corpus and
 * comes back having touched specific passages. That is literally a signal propagating
 * through a network and illuminating a few nodes, which is the only page in the
 * product where the background can depict the actual mechanic rather than a metaphor
 * for it.
 *
 * FROM THE REFERENCE: the aerial river — top-down, terrain rotating slowly beneath,
 * a dense luminous current threading through it, brightest at the core and feathering
 * at the banks. The branching and the pulses are the departure.
 */

const FLOW_VERT = /* glsl */ `
in vec3 aP0;
in vec3 aP1;
in vec3 aP2;
in vec3 aP3;
in vec4 aParams;  // tOffset, lateral, speed, size

out float vGlow;
out float vFade;
out float vTint;

uniform float uTime;
uniform float uPulse;      // head position of the travelling pulse, 0..1
uniform float uPixelRatio;
${SIMPLEX3}

vec3 bezier(vec3 a, vec3 b, vec3 c, vec3 d, float t){
  float u = 1.0 - t;
  return u*u*u*a + 3.0*u*u*t*b + 3.0*u*t*t*c + t*t*t*d;
}

void main(){
  float t = fract(aParams.x + uTime * aParams.z * 0.045);
  vec3 p = bezier(aP0, aP1, aP2, aP3, t);

  // Lateral spread, wider at the middle of a vessel than at its ends, so branches
  // taper into their junctions instead of butting together.
  vec3 tangent = normalize(bezier(aP0, aP1, aP2, aP3, min(t + 0.02, 1.0)) - p + 1e-5);
  vec3 side = normalize(cross(tangent, vec3(0.0, 1.0, 0.0)) + 1e-5);
  float taper = sin(t * 3.14159265);
  p += side * aParams.y * taper;
  p.y += snoise(vec3(p.xz * 0.09, uTime * 0.06)) * 0.55 * taper;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // The pulse is a narrow band in t travelling the vessel. Particles inside it flare
  // and, crucially, get BIGGER — brightness alone reads as a flicker, size reads as
  // something passing through.
  float d = abs(t - uPulse);
  d = min(d, 1.0 - d);
  float hit = smoothstep(0.09, 0.0, d);

  vGlow = 0.22 + hit * 1.5;
  vTint = hit;
  vFade = 1.0 - smoothstep(30.0, 62.0, -mv.z);
  gl_PointSize = aParams.w * (1.0 + hit * 2.2) * uPixelRatio * (16.0 / max(-mv.z, 1.0));
}
`;

export function createSynapse(ctx: SceneContext): AtmosphereScene {
  const scene = new Scene();
  const camera = new PerspectiveCamera(48, 1, 0.1, 260);
  // High and steeply down-tilted: the reference's aerial framing.
  const baseCam = new Vector3(0, 26, 15);
  camera.position.copy(baseCam);

  const rnd = mulberry32(0x57a1);

  // ---- build a branching tree of cubic segments
  interface Seg { p0: Vector3; p1: Vector3; p2: Vector3; p3: Vector3; depth: number }
  const segs: Seg[] = [];

  const grow = (from: Vector3, dir: Vector3, len: number, depth: number): void => {
    if (depth > 3 || len < 2.2) return;
    const end = from.clone().addScaledVector(dir, len);
    end.y += (rnd() - 0.5) * 1.2;
    // Control points offset perpendicular to the run, which is what makes a vessel
    // curve rather than kink.
    const perp = new Vector3(-dir.z, 0, dir.x).multiplyScalar((rnd() - 0.5) * len * 0.75);
    const p1 = from.clone().addScaledVector(dir, len * 0.33).add(perp);
    const p2 = from.clone().addScaledVector(dir, len * 0.66).add(perp.clone().multiplyScalar(-0.6));
    segs.push({ p0: from.clone(), p1, p2, p3: end, depth });

    const branches = depth === 0 ? 3 : rnd() < 0.62 ? 2 : 1;
    for (let i = 0; i < branches; i++) {
      const a = (rnd() - 0.5) * 1.15;
      const nd = new Vector3(
        dir.x * Math.cos(a) - dir.z * Math.sin(a), 0,
        dir.x * Math.sin(a) + dir.z * Math.cos(a),
      ).normalize();
      grow(end, nd, len * (0.6 + rnd() * 0.2), depth + 1);
    }
  };

  // Two trunks entering from opposite corners, which fills the frame diagonally the
  // way the reference's river does.
  grow(new Vector3(-30, 0, 16), new Vector3(0.85, 0, -0.5).normalize(), 15, 0);
  grow(new Vector3(28, 0, 18), new Vector3(-0.8, 0, -0.6).normalize(), 14, 0);

  // ---- particles along the segments
  const perSeg = Math.round(70 * ctx.quality) + 20;
  const total = segs.length * perSeg;
  const p0 = new Float32Array(total * 3);
  const p1 = new Float32Array(total * 3);
  const p2 = new Float32Array(total * 3);
  const p3 = new Float32Array(total * 3);
  const par = new Float32Array(total * 4);

  let k = 0;
  for (const s of segs) {
    // Thinner and dimmer the deeper the branch — capillaries, not pipes.
    const width = 1.5 / (1 + s.depth * 0.85);
    for (let i = 0; i < perSeg; i++, k++) {
      p0.set([s.p0.x, s.p0.y, s.p0.z], k * 3);
      p1.set([s.p1.x, s.p1.y, s.p1.z], k * 3);
      p2.set([s.p2.x, s.p2.y, s.p2.z], k * 3);
      p3.set([s.p3.x, s.p3.y, s.p3.z], k * 3);
      par[k * 4] = rnd();
      // Gaussian-ish lateral: sum of two uniforms concentrates density at the core,
      // which is what makes the current read as having a bright centre line.
      par[k * 4 + 1] = (rnd() + rnd() - 1) * width;
      par[k * 4 + 2] = 0.6 + rnd() * 0.9;
      par[k * 4 + 3] = (1.2 + rnd() * rnd() * 2.4) / (1 + s.depth * 0.35);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(total * 3), 3));
  geo.setAttribute("aP0", new BufferAttribute(p0, 3));
  geo.setAttribute("aP1", new BufferAttribute(p1, 3));
  geo.setAttribute("aP2", new BufferAttribute(p2, 3));
  geo.setAttribute("aP3", new BufferAttribute(p3, 3));
  geo.setAttribute("aParams", new BufferAttribute(par, 4));

  const flowMat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uCool: { value: PALETTE.azure },
      uHot: { value: PALETTE.white },
      uCore: { value: PALETTE.cyan },
    },
    vertexShader: FLOW_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      in float vGlow; in float vFade; in float vTint;
      out vec4 fragColor;
      uniform vec3 uCool, uHot, uCore;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        float a = 1.0 - d * 4.0;
        a *= a;
        vec3 col = mix(uCool, uCore, 0.55);
        col = mix(col, uHot, vTint * 0.8);
        float alpha = a * vGlow * vFade * 0.42;
        fragColor = vec4(col * alpha, alpha);
      }
    `,
  });
  const flow = new Points(geo, flowMat);
  flow.frustumCulled = false;
  scene.add(flow);

  // ---- vessel walls: the same curves drawn as faint lines, which gives the network
  // a structure that persists when the current is dim between pulses.
  const wall: number[] = [];
  for (const s of segs) {
    const N = 24;
    let prev: Vector3 | null = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      const p = new Vector3()
        .addScaledVector(s.p0, u * u * u)
        .addScaledVector(s.p1, 3 * u * u * t)
        .addScaledVector(s.p2, 3 * u * t * t)
        .addScaledVector(s.p3, t * t * t);
      if (prev !== null) wall.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      prev = p;
    }
  }
  const wallGeo = new BufferGeometry();
  wallGeo.setAttribute("position", new BufferAttribute(new Float32Array(wall), 3));
  const wallMat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uColor: { value: PALETTE.reflex } },
    vertexShader: `
      out float vFade;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = 1.0 - smoothstep(30.0, 62.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision highp float;
      in float vFade; out vec4 fragColor; uniform vec3 uColor;
      void main(){ float a = 0.22 * vFade; fragColor = vec4(uColor * a, a); }`,
  });
  const walls = new LineSegments(wallGeo, wallMat);
  walls.frustumCulled = false;
  scene.add(walls);

  // ---- terrain: a dark noise-displaced plane the network sits over, so the aerial
  // read has a floor. Almost black — it exists to occlude and to catch a little light.
  const terrain = new Mesh(
    new PlaneGeometry(260, 260, 120, 120),
    new ShaderMaterial({
      glslVersion: GLSL3,
      uniforms: { uTime: { value: 0 }, uLow: { value: PALETTE.abyss }, uHigh: { value: PALETTE.navy } },
      vertexShader: /* glsl */ `
        out float vH;
        uniform float uTime;
        ${SIMPLEX3}
        void main(){
          vec3 p = position;
          float h = fbm(vec3(p.xy * 0.012, uTime * 0.012)) * 7.0;
          // Carve a trough under the network so the vessels sit in a valley rather
          // than on a tabletop.
          h -= exp(-pow(length(p.xy * vec2(0.045, 0.06)), 2.0)) * 5.0;
          p.z += h;
          vH = h;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        precision highp float;
        in float vH; out vec4 fragColor;
        uniform vec3 uLow, uHigh;
        void main(){
          float f = clamp(vH * 0.09 + 0.4, 0.0, 1.0);
          fragColor = vec4(mix(uLow, uHigh, f), 1.0);
        }`,
    }),
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = -5.5;
  scene.add(terrain);

  const air = makeAirdrop({
    inner: new Color().copy(PALETTE.reflex).multiplyScalar(0.38),
    outer: PALETTE.abyss,
    centre: [0.5, 0.5],
    scale: 1.05,
  });
  scene.add(air);

  const motes = makeMotes(Math.round(700 * ctx.quality), 30, 0x53ee, {
    colorA: PALETTE.azure, colorB: PALETTE.cyan, size: 1.7,
  });
  motes.position.set(0, 6, 0);
  scene.add(motes);

  return {
    id: "ask",
    scene,
    camera,
    update(_dt, t) {
      flowMat.uniforms.uTime!.value = t;
      // Pulses fire every ~5.5s and sweep the full length. The gap matters: a
      // continuous stream is decoration, an intermittent one is a signal.
      flowMat.uniforms.uPulse!.value = (t % 5.5) / 5.5;
      (terrain.material as ShaderMaterial).uniforms.uTime!.value = t;
      (air.material as ShaderMaterial).uniforms.uTime!.value = t;
      (motes.material as ShaderMaterial).uniforms.uTime!.value = t;

      // The whole world turns slowly beneath a near-fixed camera — the reference's
      // aerial does this, and it is what makes a top-down shot feel surveyed rather
      // than flown.
      const y = t * 0.017;
      flow.rotation.y = y; walls.rotation.y = y; terrain.rotation.z = y;

      camera.position.set(
        baseCam.x + Math.sin(t * 0.04) * 3.0,
        baseCam.y + Math.sin(t * 0.03) * 1.4,
        baseCam.z + Math.cos(t * 0.045) * 2.2,
      );
      camera.lookAt(0, 0, -2);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      (air.material as ShaderMaterial).uniforms.uAspect!.value = w / h;
    },
    dispose() {
      geo.dispose(); flowMat.dispose();
      wallGeo.dispose(); wallMat.dispose();
      terrain.geometry.dispose(); (terrain.material as ShaderMaterial).dispose();
      air.geometry.dispose(); (air.material as ShaderMaterial).dispose();
      motes.geometry.dispose(); (motes.material as ShaderMaterial).dispose();
    },
  };
}
