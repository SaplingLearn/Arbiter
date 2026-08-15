import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
} from "three";
import { PALETTE } from "../core/palette.js";
import { SIMPLEX3 } from "../core/shaders.js";
import { makeAirdrop, makeMotes, mulberry32 } from "./common.js";
import type { AtmosphereScene, SceneContext } from "../core/types.js";

/**
 * DASHBOARD — "CULTURE"
 *
 * A living culture seen across a dark medium: colonies of bioluminescent cells
 * suspended over a plain, joined by faint filaments.
 *
 * WHY THIS FOR THIS PAGE. The dashboard's job is "what is waiting for me, and how
 * much of it". A field of many discrete organisms answers that before a word is read —
 * you feel the count. The colonies that need attention pulse; the settled ones sit
 * dim and still, which is the page's bucketing rendered as behaviour rather than as
 * colour.
 *
 * Composition is lifted from the reference's widest shot: camera low, looking across a
 * shallow bowl, subject in the mid-distance, ridge silhouettes closing both edges.
 */

const CELL_VERT = /* glsl */ `
in vec3 aOffset;
in vec3 aParams;   // radius, phase, kind (0 = dormant, 1 = active)
out vec2 vUv;
out vec3 vParams;
out float vDepthFade;

uniform float uTime;
${SIMPLEX3}

void main(){
  vUv = uv;
  vParams = aParams;

  vec3 world = aOffset;

  // Slow buoyant drift. Each cell owns a phase so the field never pulses in unison —
  // synchronised motion is the tell that reads as computer-generated.
  float ph = aParams.y;
  world.x += snoise(vec3(aOffset.xz * 0.08, uTime * 0.05 + ph)) * 0.9;
  world.y += sin(uTime * 0.35 + ph * 6.2831) * 0.22;
  world.z += snoise(vec3(aOffset.zx * 0.08, uTime * 0.05 + ph + 11.0)) * 0.9;

  // Billboard: build the quad in view space so every cell faces the camera without a
  // per-instance matrix.
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  float r = aParams.x;
  // Active colonies breathe; dormant ones hold their size.
  r *= 1.0 + aParams.z * 0.10 * sin(uTime * 1.15 + ph * 6.2831);
  mv.xy += position.xy * r;

  vDepthFade = 1.0 - smoothstep(38.0, 84.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

/**
 * A cell, drawn analytically: a bright membrane rim, a dim cytoplasm, an off-centre
 * nucleus. Three concentric falloffs and no texture.
 *
 * The rim is what makes it read as biological rather than as a glowing ball. Real
 * microscopy has the brightest value at the boundary, not the middle, because that is
 * where the most material lies along the view ray.
 */
const CELL_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
in vec3 vParams;
in float vDepthFade;
out vec4 fragColor;

uniform vec3 uMembrane, uCyto, uNucleus;
uniform float uTime;

void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;

  float active = vParams.z;
  float ph = vParams.y;

  // Membrane: a thin annulus just inside the edge.
  float rim = smoothstep(0.98, 0.80, d) * smoothstep(0.62, 0.86, d);
  rim = pow(rim, 1.3);

  // Cytoplasm: broad, dim, falls off to nothing well before the rim.
  float cyto = pow(1.0 - smoothstep(0.0, 0.92, d), 2.4) * 0.5;

  // Nucleus: small, offset, and only present on active colonies. Its absence is what
  // makes a dormant cell read as dormant at a glance.
  vec2 nOff = vec2(cos(ph * 6.2831), sin(ph * 6.2831)) * 0.16;
  float nd = length(p - nOff);
  float nuc = pow(1.0 - smoothstep(0.0, 0.30, nd), 3.0) * active;
  nuc *= 0.65 + 0.35 * sin(uTime * 1.6 + ph * 6.2831);

  vec3 col = uMembrane * rim * (0.55 + 0.45 * active)
           + uCyto * cyto
           + uNucleus * nuc * 1.6;

  float a = (rim + cyto + nuc) * vDepthFade;
  fragColor = vec4(col * vDepthFade, a);
}
`;

export function createCulture(ctx: SceneContext): AtmosphereScene {
  const scene = new Scene();
  const camera = new PerspectiveCamera(46, 1, 0.1, 220);
  const baseCam = new Vector3(0, 5.4, 30);
  camera.position.copy(baseCam);

  const rnd = mulberry32(0xc01d);
  const count = Math.round(150 * ctx.quality);

  // ---- cells
  const geo = new InstancedBufferGeometry();
  const quad = new PlaneGeometry(1, 1);
  geo.setAttribute("position", quad.getAttribute("position"));
  geo.setAttribute("uv", quad.getAttribute("uv"));
  geo.setIndex(quad.getIndex());

  const offsets = new Float32Array(count * 3);
  const params = new Float32Array(count * 3);
  const nodes: Vector3[] = [];

  for (let i = 0; i < count; i++) {
    // Clustered, not scattered. Colonies grow in groups; an even spread is the other
    // classic tell. Cluster centres are few and each draws a tight cloud around it.
    const cluster = Math.floor(rnd() * 7);
    const cx = Math.sin(cluster * 2.4) * 17 + (rnd() - 0.5) * 9;
    const cz = Math.cos(cluster * 1.9) * 13 - 8 + (rnd() - 0.5) * 9;
    const x = cx + (rnd() - 0.5) * 7;
    const z = cz + (rnd() - 0.5) * 7;
    const y = 0.6 + rnd() * rnd() * 4.2;

    offsets[i * 3] = x; offsets[i * 3 + 1] = y; offsets[i * 3 + 2] = z;
    params[i * 3] = 0.30 + rnd() * rnd() * 1.15;
    params[i * 3 + 1] = rnd();
    // A minority are active. Most of a dashboard is not waiting on you, and a field
    // where everything pulses says nothing.
    params[i * 3 + 2] = rnd() < 0.26 ? 1 : 0;
    nodes.push(new Vector3(x, y, z));
  }

  geo.setAttribute("aOffset", new InstancedBufferAttribute(offsets, 3));
  geo.setAttribute("aParams", new InstancedBufferAttribute(params, 3));
  geo.instanceCount = count;

  const cellMat = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: CELL_VERT,
    fragmentShader: CELL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uMembrane: { value: PALETTE.cyan },
      uCyto: { value: new Color().copy(PALETTE.azure).multiplyScalar(0.55) },
      uNucleus: { value: PALETTE.pale },
    },
  });
  const cells = new Mesh(geo, cellMat);
  cells.frustumCulled = false;
  scene.add(cells);

  // ---- filaments between near neighbours
  const segs: number[] = [];
  const segPhase: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!, b = nodes[j]!;
      const d = a.distanceTo(b);
      if (d < 4.6 && rnd() < 0.28) {
        segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
        const ph = rnd();
        segPhase.push(ph, ph);
      }
    }
  }
  const linkGeo = new BufferGeometry();
  linkGeo.setAttribute("position", new BufferAttribute(new Float32Array(segs), 3));
  linkGeo.setAttribute("aPhase", new BufferAttribute(new Float32Array(segPhase), 1));

  const linkMat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: PALETTE.azure } },
    vertexShader: /* glsl */ `
      in float aPhase;
      out float vFade;
      out float vPhase;
      uniform float uTime;
      void main(){
        vPhase = aPhase;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = 1.0 - smoothstep(30.0, 70.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in float vFade; in float vPhase;
      out vec4 fragColor;
      uniform vec3 uColor; uniform float uTime;
      void main(){
        // Filaments idle very dim and occasionally carry a slow swell, so the network
        // reads as alive without ever competing with the cells.
        float pulse = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * 0.5 + vPhase * 6.2831), 4.0);
        float a = 0.13 * vFade * pulse;
        fragColor = vec4(uColor * a, a);
      }
    `,
  });
  const links = new LineSegments(linkGeo, linkMat);
  links.frustumCulled = false;
  scene.add(links);

  // ---- ground haze: a wide, very dim plane catching the colonies' light, which is
  // what gives the field a floor without modelling one.
  const floor = new Mesh(
    new PlaneGeometry(240, 160),
    new ShaderMaterial({
      glslVersion: GLSL3,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: PALETTE.reflex } },
      vertexShader: `out vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vUv; out vec4 fragColor;
        uniform vec3 uColor; uniform float uTime;
        ${SIMPLEX3}
        void main(){
          vec2 p = vUv - 0.5;
          float d = 1.0 - smoothstep(0.05, 0.42, length(p));
          float n = fbm(vec3(vUv * 5.0, uTime * 0.03)) * 0.5 + 0.5;
          float a = pow(d, 2.2) * (0.35 + 0.65 * n) * 0.55;
          fragColor = vec4(uColor * a, a);
        }
      `,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.4;
  floor.frustumCulled = false;
  scene.add(floor);

  // ---- air
  const air = makeAirdrop({
    inner: new Color().copy(PALETTE.reflex).multiplyScalar(0.42),
    outer: PALETTE.abyss,
    centre: [0.5, 0.46],
    scale: 1.15,
  });
  scene.add(air);

  const motes = makeMotes(Math.round(900 * ctx.quality), 34, 0x5eed, {
    colorA: PALETTE.cyan, colorB: PALETTE.sky, size: 2.0,
  });
  motes.position.set(0, 4, 4);
  scene.add(motes);

  return {
    id: "dashboard",
    scene,
    camera,
    update(_dt, t) {
      cellMat.uniforms.uTime!.value = t;
      linkMat.uniforms.uTime!.value = t;
      (floor.material as ShaderMaterial).uniforms.uTime!.value = t;
      (air.material as ShaderMaterial).uniforms.uTime!.value = t;
      (motes.material as ShaderMaterial).uniforms.uTime!.value = t;

      // A long, shallow orbit. The reference's camera is never still and never
      // obviously moving; the moment you can name the motion it has gone too far.
      const a = t * 0.035;
      camera.position.set(
        baseCam.x + Math.sin(a) * 4.2,
        baseCam.y + Math.sin(t * 0.05) * 0.8,
        baseCam.z + Math.cos(a) * 2.6,
      );
      camera.lookAt(0, 2.4, -4);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      (air.material as ShaderMaterial).uniforms.uAspect!.value = w / h;
    },
    dispose() {
      geo.dispose(); quad.dispose(); cellMat.dispose();
      linkGeo.dispose(); linkMat.dispose();
      floor.geometry.dispose(); (floor.material as ShaderMaterial).dispose();
      air.geometry.dispose(); (air.material as ShaderMaterial).dispose();
      motes.geometry.dispose(); (motes.material as ShaderMaterial).dispose();
    },
  };
}
