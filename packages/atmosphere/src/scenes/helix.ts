import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  GLSL3,
  LineSegments,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
} from "three";
import { PALETTE } from "../core/palette.js";
import { makeAirdrop, makeMotes, mulberry32 } from "./common.js";
import type { AtmosphereScene, SceneContext } from "../core/types.js";

/**
 * METHOD — "HELIX"
 *
 * A double helix running the height of the frame, its two strands bound by rungs.
 * A seal travels the structure; behind the seal the rungs are locked and cool, ahead
 * of it they are still open.
 *
 * WHY THIS FOR THIS PAGE. Method explains what the record proves: positions are
 * hashed on submission, and at reveal the published answer must match the hash. That
 * is a chain of sealed links, and the honest visual for it is a structure where you
 * can see which parts are closed and which are not. It is the slowest and most formal
 * scene in the set because the page is the one making a claim about rigour.
 *
 * The helix is also the one place the Pfizer twist can be acknowledged without
 * copying it: two ribbons crossing is the oldest shape in molecular biology, and it
 * belongs to the subject long before it belonged to any brand.
 *
 * FROM THE REFERENCE: the ribbon section — long filaments sweeping through empty
 * space with nothing else in frame, unfurling rather than travelling.
 */

export function createHelix(ctx: SceneContext): AtmosphereScene {
  const scene = new Scene();
  const camera = new PerspectiveCamera(44, 1, 0.1, 200);
  const baseCam = new Vector3(0, 0, 21);
  camera.position.copy(baseCam);

  const rnd = mulberry32(0x4e11);

  const TURNS = 7;
  const HEIGHT = 46;
  const RADIUS = 4.3;
  const perTurn = Math.round(90 * ctx.quality) + 30;
  const steps = TURNS * perTurn;

  // ---- strands, as dense point runs. Points rather than tubes because the strand
  // should read as a chain of discrete units, which is also what the record is.
  const strandPos = new Float32Array(steps * 2 * 3);
  const strandPar = new Float32Array(steps * 2 * 3); // v (0..1), strandIdx, jitter

  const at = (v: number, strand: number): Vector3 => {
    const a = v * Math.PI * 2 * TURNS + strand * Math.PI;
    return new Vector3(
      Math.cos(a) * RADIUS,
      (v - 0.5) * HEIGHT,
      Math.sin(a) * RADIUS,
    );
  };

  let k = 0;
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < steps; i++, k++) {
      const v = i / (steps - 1);
      const p = at(v, s);
      strandPos.set([p.x, p.y, p.z], k * 3);
      strandPar[k * 3] = v;
      strandPar[k * 3 + 1] = s;
      strandPar[k * 3 + 2] = rnd();
    }
  }

  const strandGeo = new BufferGeometry();
  strandGeo.setAttribute("position", new BufferAttribute(strandPos, 3));
  strandGeo.setAttribute("aPar", new BufferAttribute(strandPar, 3));

  const strandMat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSeal: { value: 0 },
      uA: { value: PALETTE.cyan },
      uB: { value: PALETTE.electric },
      uHot: { value: PALETTE.white },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      in vec3 aPar;
      out float vSealed; out float vFront; out float vStrand; out float vFade;
      uniform float uTime, uSeal, uPixelRatio;
      void main(){
        float v = aPar.x;
        vStrand = aPar.y;

        vec3 p = position;
        // A slight breathing of the radius keeps the strand from looking extruded.
        float r = 1.0 + sin(uTime * 0.5 + v * 24.0) * 0.012;
        p.xz *= r;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        vSealed = smoothstep(uSeal + 0.02, uSeal - 0.02, v);
        vFront = smoothstep(0.05, 0.0, abs(v - uSeal));
        vFade = 1.0 - smoothstep(24.0, 56.0, -mv.z);
        gl_PointSize = (1.7 + aPar.z * 1.1 + vFront * 4.0) * uPixelRatio * (13.0 / max(-mv.z, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in float vSealed; in float vFront; in float vStrand; in float vFade;
      out vec4 fragColor;
      uniform vec3 uA, uB, uHot;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        float a = 1.0 - d * 4.0; a *= a;

        // The two strands are NOT the same colour. One runs cyan, one runs violet —
        // which is the palette's whole thesis stated in a single object.
        vec3 col = mix(uA, uB, vStrand);
        col = mix(col * 0.45, col, vSealed);
        col = mix(col, uHot, vFront * 0.9);

        float alpha = a * vFade * (0.30 + vSealed * 0.45 + vFront * 0.9);
        fragColor = vec4(col * alpha, alpha);
      }
    `,
  });
  const strands = new Points(strandGeo, strandMat);
  strands.frustumCulled = false;
  scene.add(strands);

  // ---- rungs
  const rungCount = TURNS * 16;
  const rp = new Float32Array(rungCount * 2 * 3);
  const rv = new Float32Array(rungCount * 2);
  for (let i = 0; i < rungCount; i++) {
    const v = i / (rungCount - 1);
    const a = at(v, 0), b = at(v, 1);
    rp.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    rv[i * 2] = v; rv[i * 2 + 1] = v;
  }
  const rungGeo = new BufferGeometry();
  rungGeo.setAttribute("position", new BufferAttribute(rp, 3));
  rungGeo.setAttribute("aV", new BufferAttribute(rv, 1));

  const rungMat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uSeal: { value: 0 }, uTime: { value: 0 },
      uOpen: { value: PALETTE.violet },
      uLocked: { value: PALETTE.azure },
      uHot: { value: PALETTE.white },
    },
    vertexShader: `
      in float aV;
      out float vSealed; out float vFront; out float vFade;
      uniform float uSeal;
      void main(){
        vSealed = smoothstep(uSeal + 0.02, uSeal - 0.02, aV);
        vFront = smoothstep(0.04, 0.0, abs(aV - uSeal));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFade = 1.0 - smoothstep(24.0, 56.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision highp float;
      in float vSealed; in float vFront; in float vFade;
      out vec4 fragColor;
      uniform vec3 uOpen, uLocked, uHot;
      void main(){
        vec3 col = mix(uOpen, uLocked, vSealed);
        col = mix(col, uHot, vFront);
        float a = vFade * (0.06 + vSealed * 0.20 + vFront * 0.85);
        fragColor = vec4(col * a, a);
      }`,
  });
  const rungs = new LineSegments(rungGeo, rungMat);
  rungs.frustumCulled = false;
  scene.add(rungs);

  const air = makeAirdrop({
    inner: new Color().copy(PALETTE.violet).multiplyScalar(0.42),
    outer: PALETTE.abyss,
    centre: [0.5, 0.5],
    scale: 1.25,
    speed: 0.025,
  });
  scene.add(air);

  const motes = makeMotes(Math.round(650 * ctx.quality), 22, 0xd7a1, {
    colorA: PALETTE.sky, colorB: PALETTE.electric, size: 1.6,
  });
  scene.add(motes);

  const group = { rot: 0 };

  return {
    id: "record",
    scene,
    camera,
    update(dt, t) {
      // 18-second seal sweep with a hold at the top. The hold matters — the page's
      // claim is that things STAY sealed, and a loop that immediately re-opens would
      // say the opposite.
      const cycle = 18;
      const u = (t % cycle) / cycle;
      const seal = u < 0.72 ? (u / 0.72) : 1.0;

      strandMat.uniforms.uSeal!.value = seal;
      strandMat.uniforms.uTime!.value = t;
      rungMat.uniforms.uSeal!.value = seal;
      rungMat.uniforms.uTime!.value = t;
      (air.material as ShaderMaterial).uniforms.uTime!.value = t;
      (motes.material as ShaderMaterial).uniforms.uTime!.value = t;

      group.rot += dt * 0.085;
      strands.rotation.y = group.rot;
      rungs.rotation.y = group.rot;

      // Camera rises very slowly along the structure, so the frame is never twice the
      // same even though the object is periodic.
      camera.position.set(
        Math.sin(t * 0.03) * 2.2,
        Math.sin(t * 0.022) * 5.0,
        baseCam.z + Math.cos(t * 0.026) * 2.0,
      );
      camera.lookAt(0, Math.sin(t * 0.022) * 3.4, 0);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      (air.material as ShaderMaterial).uniforms.uAspect!.value = w / h;
    },
    dispose() {
      strandGeo.dispose(); strandMat.dispose();
      rungGeo.dispose(); rungMat.dispose();
      air.geometry.dispose(); (air.material as ShaderMaterial).dispose();
      motes.geometry.dispose(); (motes.material as ShaderMaterial).dispose();
    },
  };
}
