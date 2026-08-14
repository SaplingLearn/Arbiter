import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  GLSL3,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  Object3D,
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
 * LIBRARY — "ARCHIVE"
 *
 * Ranks of specimen vitrines receding into the dark, each holding a faintly lit
 * sample. Some are dark and fractured.
 *
 * WHY THIS FOR THIS PAGE. The library is a catalogue, and it is a catalogue that
 * deliberately shows its failures — the prepared cases include documents that could
 * not be used, because the ratio is the finding. So this is the one scene built on a
 * grid rather than on organic distribution, and the one where some of the subjects
 * are deliberately dead. A perfect archive would misrepresent the page.
 *
 * FROM THE REFERENCE: the plain of standing volumes — discrete translucent bodies at
 * varying scale in the mid-distance, lateral camera travel, light sweeping past along
 * the ground.
 */

export function createArchive(ctx: SceneContext): AtmosphereScene {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 260);
  const baseCam = new Vector3(0, 3.4, 26);
  camera.position.copy(baseCam);

  const rnd = mulberry32(0xa2c8);

  // ---- the vitrines
  const cols = 7;
  const rows = 6;
  const count = cols * rows;

  const box = new BoxGeometry(1, 1, 1);
  const vitMat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uGlass: { value: PALETTE.azure },
      uSample: { value: PALETTE.cyan },
      uDead: { value: PALETTE.violet },
      uHot: { value: PALETTE.white },
    },
    vertexShader: /* glsl */ `
      in vec3 aState;    // usable (0/1), phase, height
      out vec3 vLocal;
      out vec3 vNormal;
      out vec3 vView;
      out vec3 vState;
      out float vFade;
      void main(){
        vLocal = position;
        vState = aState;
        vec4 world = instanceMatrix * vec4(position, 1.0);
        vec4 mv = modelViewMatrix * world;
        vNormal = normalize(mat3(instanceMatrix) * normal);
        vView = -mv.xyz;
        vFade = 1.0 - smoothstep(34.0, 82.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vLocal; in vec3 vNormal; in vec3 vView; in vec3 vState; in float vFade;
      out vec4 fragColor;
      uniform vec3 uGlass, uSample, uDead, uHot;
      uniform float uTime;
      void main(){
        float usable = vState.x;
        float ph = vState.y;

        vec3 n = normalize(vNormal);
        vec3 v = normalize(vView);
        float f = 1.0 - clamp(dot(n, v), 0.0, 1.0);

        // Edges. A vitrine is read almost entirely from its edges — that is what makes
        // glass look like glass without refraction.
        vec3 a = abs(vLocal);
        float edge = smoothstep(0.42, 0.5, max(max(a.x, a.y), a.z));
        // Two-axis proximity gives corners, not just faces.
        float e2 = smoothstep(0.40, 0.5, a.x) * smoothstep(0.40, 0.5, a.y)
                 + smoothstep(0.40, 0.5, a.y) * smoothstep(0.40, 0.5, a.z)
                 + smoothstep(0.40, 0.5, a.z) * smoothstep(0.40, 0.5, a.x);
        e2 = clamp(e2, 0.0, 1.0);

        float fres = pow(f, 2.2);

        // The specimen: a soft volume floating in the lower half of the vitrine.
        float sy = vLocal.y + 0.10;
        float samp = pow(1.0 - clamp(length(vec3(vLocal.x, sy * 1.5, vLocal.z)) * 2.6, 0.0, 1.0), 2.2);
        samp *= 0.55 + 0.45 * sin(uTime * 0.8 + ph * 6.2831);

        vec3 col = uGlass * (edge * 0.30 + fres * 0.22) + uHot * e2 * 0.55;
        col += mix(uDead * 0.35, uSample, usable) * samp * mix(0.5, 1.7, usable);

        float alpha = (edge * 0.34 + fres * 0.22 + e2 * 0.5 + samp * 0.7) * vFade;
        // Refused specimens keep their frame but lose their contents, so the grid
        // still reads as complete while the gaps are unmistakable.
        alpha *= mix(0.55, 1.0, usable);
        fragColor = vec4(col * vFade, alpha);
      }
    `,
  });

  const vitrines = new InstancedMesh(box, vitMat, count);
  vitrines.frustumCulled = false;
  const dummy = new Object3D();
  const state = new Float32Array(count * 3);

  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++, i++) {
      const jitterX = (rnd() - 0.5) * 1.1;
      const jitterZ = (rnd() - 0.5) * 1.1;
      const h = 2.2 + rnd() * rnd() * 5.0;
      dummy.position.set(
        (c - (cols - 1) / 2) * 7.4 + jitterX,
        h / 2 - 1.0,
        -r * 9.5 - 4 + jitterZ,
      );
      dummy.scale.set(2.5 + rnd() * 1.0, h, 2.5 + rnd() * 1.0);
      dummy.rotation.y = (rnd() - 0.5) * 0.12;
      dummy.updateMatrix();
      vitrines.setMatrixAt(i, dummy.matrix);
      // Roughly the library's own ratio: a real minority are unusable, and that is
      // the point of the page.
      state[i * 3] = rnd() < 0.26 ? 0 : 1;
      state[i * 3 + 1] = rnd();
      state[i * 3 + 2] = h;
    }
  }
  vitrines.instanceMatrix.needsUpdate = true;
  box.setAttribute("aState", new InstancedBufferAttribute(state, 3));
  scene.add(vitrines);

  // ---- floor: a dark reflective-ish plane with sweeping light bands, which is what
  // carries the lateral motion when the vitrines themselves are static.
  const floor = new Mesh(
    new PlaneGeometry(420, 420),
    new ShaderMaterial({
      glslVersion: GLSL3,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: PALETTE.azure },
        uDeep: { value: PALETTE.reflex },
      },
      vertexShader: `out vec2 vUv; out float vD;
        void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0);
        vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vUv; in float vD; out vec4 fragColor;
        uniform float uTime; uniform vec3 uColor, uDeep;
        ${SIMPLEX3}
        void main(){
          vec2 p = (vUv - 0.5) * 420.0;
          // Long bands running with the aisles, drifting sideways.
          float band = sin(p.x * 0.05 + uTime * 0.20 + snoise(vec3(p * 0.004, uTime * 0.05)) * 2.2);
          band = pow(max(band, 0.0), 7.0);
          float grid = smoothstep(0.96, 1.0, abs(sin(p.y * 0.13)));
          float fade = 1.0 - smoothstep(20.0, 150.0, vD);
          float a = (band * 0.30 + grid * 0.05) * fade;
          fragColor = vec4(mix(uDeep, uColor, band) * a, a);
        }
      `,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.05;
  floor.frustumCulled = false;
  scene.add(floor);

  const air = makeAirdrop({
    inner: new Color().copy(PALETTE.navy).multiplyScalar(1.25),
    outer: PALETTE.abyss,
    centre: [0.5, 0.48],
    scale: 1.0,
    speed: 0.03,
  });
  scene.add(air);

  const motes = makeMotes(Math.round(800 * ctx.quality), 30, 0xa11c, {
    colorA: PALETTE.sky, colorB: PALETTE.azure, size: 1.6,
  });
  motes.position.set(0, 4, -14);
  scene.add(motes);

  return {
    id: "library",
    scene,
    camera,
    update(_dt, t) {
      vitMat.uniforms.uTime!.value = t;
      (floor.material as ShaderMaterial).uniforms.uTime!.value = t;
      (air.material as ShaderMaterial).uniforms.uTime!.value = t;
      (motes.material as ShaderMaterial).uniforms.uTime!.value = t;

      // Lateral dolly with a slow push-in. Travelling ACROSS ranks rather than down
      // them is what makes an archive feel large — you never reach the end of a row.
      camera.position.set(
        baseCam.x + Math.sin(t * 0.045) * 9.5,
        baseCam.y + Math.sin(t * 0.035) * 0.9,
        baseCam.z + Math.sin(t * 0.021) * 4.0,
      );
      camera.lookAt(Math.sin(t * 0.045) * 3.2, 2.0, -22);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      (air.material as ShaderMaterial).uniforms.uAspect!.value = w / h;
    },
    dispose() {
      box.dispose(); vitMat.dispose(); vitrines.dispose();
      floor.geometry.dispose(); (floor.material as ShaderMaterial).dispose();
      air.geometry.dispose(); (air.material as ShaderMaterial).dispose();
      motes.geometry.dispose(); (motes.material as ShaderMaterial).dispose();
    },
  };
}
