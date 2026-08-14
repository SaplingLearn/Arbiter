import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  GLSL3,
  IcosahedronGeometry,
  LineSegments,
  Mesh,
  PerspectiveCamera,
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
 * NEW CASE — "GENESIS"
 *
 * One luminous body at the centre of an empty volume, with a crystalline lattice
 * nucleating outward from it.
 *
 * WHY THIS FOR THIS PAGE. New case is the only page in the product that starts from
 * nothing. Every other surface shows something that already exists. So this is the
 * only scene with a single subject and an empty frame around it, and the only one
 * whose structure is still being built while you watch.
 *
 * FROM THE REFERENCE: the hero shot — subject centred and slowly rotating, a mirror
 * plane beneath it, fine particulate rising through the frame. The lattice growth is
 * the one addition, and it is timed as a long loop (~24s) so it is never seen to
 * restart.
 */

export function createGenesis(ctx: SceneContext): AtmosphereScene {
  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 200);
  const baseCam = new Vector3(0, 1.1, 15.5);
  camera.position.copy(baseCam);

  const rnd = mulberry32(0x9e5);

  // ---- the nucleus: a faceted body whose surface displaces on noise, so it reads as
  // something forming rather than as a manufactured solid.
  const coreGeo = new IcosahedronGeometry(1.55, 5);
  const coreMat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uInner: { value: PALETTE.white },
      uRim: { value: PALETTE.cyan },
      uDeep: { value: PALETTE.electric },
    },
    vertexShader: /* glsl */ `
      out vec3 vNormal;
      out vec3 vView;
      out float vNoise;
      uniform float uTime;
      ${SIMPLEX3}
      void main(){
        vec3 n = normalize(normal);
        // Two frequencies: a slow lobe that changes the silhouette, and a fine ripple
        // that only shows in the rim term.
        float slow = snoise(n * 1.15 + vec3(0.0, 0.0, uTime * 0.14));
        float fine = snoise(n * 4.4 + vec3(uTime * 0.22, 0.0, 0.0));
        vNoise = slow;
        vec3 p = position + n * (slow * 0.30 + fine * 0.07);
        vNormal = normalize(normalMatrix * n);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vNormal; in vec3 vView; in float vNoise;
      out vec4 fragColor;
      uniform vec3 uInner, uRim, uDeep;
      uniform float uTime;
      void main(){
        vec3 n = normalize(vNormal);
        vec3 v = normalize(vView);
        float f = 1.0 - clamp(dot(n, v), 0.0, 1.0);

        // Inverted-fresnel core plus a hard rim. The body is brightest where it is
        // thinnest, which is how a translucent organism actually looks.
        float rim = pow(f, 2.6);
        float body = pow(1.0 - f, 1.6) * 0.32;
        float veins = smoothstep(0.35, 0.75, vNoise) * 0.5;

        vec3 col = uRim * rim * 1.5 + uInner * body + uDeep * veins;
        float a = clamp(rim * 1.2 + body + veins * 0.6, 0.0, 1.0);
        fragColor = vec4(col, a);
      }
    `,
  });
  const core = new Mesh(coreGeo, coreMat);
  scene.add(core);

  // ---- nucleating lattice
  // Points are placed on shells at increasing radius; an edge is drawn between near
  // neighbours. Each edge carries the radius at which it should appear, and a single
  // growth uniform sweeps outward — so the structure assembles from the centre out
  // rather than fading in as a whole.
  const shellCount = 5;
  const perShell = Math.round(26 * ctx.quality) + 8;
  const pts: Vector3[] = [];
  for (let s = 0; s < shellCount; s++) {
    const r = 2.6 + s * 1.5;
    for (let i = 0; i < perShell; i++) {
      // Fibonacci sphere, jittered. An exact Fibonacci layout is too regular and
      // reads as a wireframe globe.
      const y = 1 - (i / (perShell - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = i * 2.399963 + s * 1.3;
      pts.push(new Vector3(
        Math.cos(theta) * rad * r * (0.85 + rnd() * 0.3),
        y * r * (0.85 + rnd() * 0.3) * 0.8,
        Math.sin(theta) * rad * r * (0.85 + rnd() * 0.3),
      ));
    }
  }

  const lp: number[] = [];
  const lr: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i]!, b = pts[j]!;
      if (a.distanceTo(b) < 2.5) {
        const rMax = Math.max(a.length(), b.length());
        lp.push(a.x, a.y, a.z, b.x, b.y, b.z);
        lr.push(rMax, rMax);
      }
    }
  }

  const latGeo = new BufferGeometry();
  latGeo.setAttribute("position", new BufferAttribute(new Float32Array(lp), 3));
  latGeo.setAttribute("aRadius", new BufferAttribute(new Float32Array(lr), 1));

  const latMat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uGrowth: { value: 0 },
      uColor: { value: PALETTE.cyan },
      uEdge: { value: PALETTE.white },
    },
    vertexShader: /* glsl */ `
      in float aRadius;
      out float vR; out float vFade;
      void main(){
        vR = aRadius;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = 1.0 - smoothstep(14.0, 30.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in float vR; in float vFade;
      out vec4 fragColor;
      uniform float uGrowth, uTime;
      uniform vec3 uColor, uEdge;
      void main(){
        // Not yet reached: invisible. At the growth front: white hot. Behind it:
        // settles to the working blue. The front is the whole point of the effect.
        float appear = smoothstep(uGrowth + 0.6, uGrowth - 0.2, vR);
        float front = smoothstep(1.4, 0.0, abs(vR - uGrowth));
        vec3 col = mix(uColor, uEdge, front * 0.85);
        float a = appear * vFade * (0.16 + front * 0.7);
        if (a < 0.002) discard;
        fragColor = vec4(col * a, a);
      }
    `,
  });
  const lattice = new LineSegments(latGeo, latMat);
  lattice.frustumCulled = false;
  scene.add(lattice);

  // ---- vertices of the lattice, as bright nodes
  const nodePos = new Float32Array(pts.length * 3);
  const nodeRad = new Float32Array(pts.length);
  pts.forEach((p, i) => {
    nodePos[i * 3] = p.x; nodePos[i * 3 + 1] = p.y; nodePos[i * 3 + 2] = p.z;
    nodeRad[i] = p.length();
  });
  const nodeGeo = new BufferGeometry();
  nodeGeo.setAttribute("position", new BufferAttribute(nodePos, 3));
  nodeGeo.setAttribute("aRadius", new BufferAttribute(nodeRad, 1));
  const nodeMat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uGrowth: { value: 0 }, uTime: { value: 0 },
      uColor: { value: PALETTE.sky },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      in float aRadius;
      out float vA;
      uniform float uGrowth, uTime, uPixelRatio;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float appear = smoothstep(uGrowth + 0.6, uGrowth - 0.2, aRadius);
        float front = smoothstep(1.2, 0.0, abs(aRadius - uGrowth));
        vA = appear * (0.35 + front) * (1.0 - smoothstep(14.0, 30.0, -mv.z));
        gl_PointSize = (2.4 + front * 5.0) * uPixelRatio * (10.0 / max(-mv.z, 1.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in float vA; out vec4 fragColor;
      uniform vec3 uColor;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        float a = (1.0 - d * 4.0); a *= a * vA;
        fragColor = vec4(uColor * a, a);
      }
    `,
  });
  const nodes = new Points(nodeGeo, nodeMat);
  nodes.frustumCulled = false;
  scene.add(nodes);

  const air = makeAirdrop({
    inner: new Color().copy(PALETTE.violet).multiplyScalar(0.5),
    outer: PALETTE.abyss,
    centre: [0.5, 0.52],
    scale: 1.35,
  });
  scene.add(air);

  const motes = makeMotes(Math.round(1100 * ctx.quality), 16, 0x1f0, {
    colorA: PALETTE.sky, colorB: PALETTE.white, size: 1.9, rise: 0.5,
  });
  scene.add(motes);

  return {
    id: "new",
    scene,
    camera,
    update(_dt, t) {
      coreMat.uniforms.uTime!.value = t;
      (air.material as ShaderMaterial).uniforms.uTime!.value = t;
      (motes.material as ShaderMaterial).uniforms.uTime!.value = t;

      // 24-second growth cycle with a long hold at full extent, so the reset happens
      // rarely and off the beat of anything else on screen.
      const cycle = 24;
      const u = (t % cycle) / cycle;
      const growth = u < 0.62
        ? Math.pow(u / 0.62, 0.75) * 10.4
        : 10.4 + (u - 0.62) * 2.0;
      latMat.uniforms.uGrowth!.value = growth;
      latMat.uniforms.uTime!.value = t;
      nodeMat.uniforms.uGrowth!.value = growth;
      nodeMat.uniforms.uTime!.value = t;

      core.rotation.y = t * 0.09;
      core.rotation.x = Math.sin(t * 0.06) * 0.16;
      lattice.rotation.y = -t * 0.035;
      nodes.rotation.y = -t * 0.035;

      camera.position.set(
        baseCam.x + Math.sin(t * 0.055) * 1.5,
        baseCam.y + Math.sin(t * 0.04) * 0.5,
        baseCam.z + Math.cos(t * 0.03) * 1.0,
      );
      camera.lookAt(0, 0.2, 0);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      (air.material as ShaderMaterial).uniforms.uAspect!.value = w / h;
    },
    dispose() {
      coreGeo.dispose(); coreMat.dispose();
      latGeo.dispose(); latMat.dispose();
      nodeGeo.dispose(); nodeMat.dispose();
      air.geometry.dispose(); (air.material as ShaderMaterial).dispose();
      motes.geometry.dispose(); (motes.material as ShaderMaterial).dispose();
    },
  };
}
