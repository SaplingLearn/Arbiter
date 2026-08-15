import {
  AdditiveBlending,
  BoxGeometry,
  Color,
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
 * Standing volumes on open ground — ONE PER CASE IN THE LIBRARY, at varying scale and
 * staggered in depth. Some are dark.
 *
 * WHY THIS FOR THIS PAGE. The library is a catalogue, and it is a catalogue that
 * deliberately shows its failures — the prepared cases include documents that could
 * not be used, because the ratio is the finding. So this is the one scene where some of
 * the subjects are deliberately dead, and the one whose population is DATA rather than
 * composition. A perfect archive would misrepresent the page, and so would a large one.
 *
 * FROM THE REFERENCE: the plain of standing volumes — discrete bodies at varying scale
 * in the mid-distance, lateral camera travel, light sweeping past along the ground.
 *
 * THE VOLUMES ARE THE LANDING PAGE'S CUBE. Same material, ported from
 * `apps/landing/src/overture/lib/cube.ts`: a vertical value ramp, irregular panelling
 * at two scales, seam lines, and an INVERTED fresnel so the faces are hot and the
 * silhouette cools — an object lit from within rather than a glass shell catching a
 * rim. A stranger meets that object on the landing page before they are told what any
 * of this is; meeting a field of them in the library should read as "more of these
 * exist", and that only works if it is literally the same material. The cube's third
 * feature, the recessed wedge, is the one thing not ported; see the shader.
 *
 * WHICH MEANS THEY ARE SOLID NOW, and that is the substantive change rather than a
 * side effect. The old vitrines were additive glass shells with depth-write off, so a
 * field of them layered into haze and read as fog with edges in it. Opaque bodies that
 * write depth occlude each other, the floor's light bands stop shining through the ones
 * in front of them, and the motes pass behind. The archive gets its depth from geometry
 * now instead of from accumulated alpha.
 *
 * THE REFUSALS SURVIVE THE PORT, because they are the page's argument. A usable
 * specimen is lit from inside. A refused one is the same constructed object with the
 * light off, and it is RED - the one hue this palette carries outside its blue wedge,
 * the same value the table underneath uses for a refusal. The colour is the tell and it
 * is legible at a glance across the whole field.
 */

export function createArchive(ctx: SceneContext): AtmosphereScene {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 260);
  const baseCam = new Vector3(0, 3.4, 26);
  camera.position.copy(baseCam);

  /**
   * Headroom, not a population. The field is built by `populate` from the real case
   * list and nothing is drawn until that arrives - `InstancedMesh` has to be allocated
   * with a ceiling, so this is the ceiling and `mesh.count` is the truth.
   */
  const MAX_BODIES = 64;

  /**
   * The landing page carries ONE of these and can afford to run it at full gain. A
   * library of a few is closer to that than to a crowd, but it is still several bodies
   * against a bloom chain whose bright pass wants the top few percent of the image, so
   * the material comes down a little. One lever.
   */
  const GAIN = 0.55;

  /* Panels sized in WORLD units, not as a count per face. The landing cube is a cube,
     so seven-across works on every side of it; these are slabs from 2.5 to 7 units, and
     a fixed count would give the tall ones tall panels and stretch the facade with the
     geometry. A constant panel size is what makes the whole rank read as one build. */
  const PANEL_A = 0.55;
  const PANEL_B = 0.19;

  const box = new BoxGeometry(1, 1, 1);
  const vitMat = new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: {
      uTime: { value: 0 },
      /* Straight from the landing cube: body cyan, foot of the ramp azure pulled 30%
         toward electric so the object's own gradient obeys the palette's rule that deep
         is violet and hot is cyan. */
      uBody: { value: PALETTE.cyan.clone().multiplyScalar(3.1 * GAIN) },
      uDeep: { value: PALETTE.azure.clone().lerp(PALETTE.electric, 0.3).multiplyScalar(1.5 * GAIN) },
      uPanel: { value: PALETTE.sky.clone() },
      uHot: { value: PALETTE.pale.clone() },
      /* Refused bodies are RED, the one hue in this palette outside the blue wedge and
         the same value the table underneath uses for a refusal. Was violet, which is a
         deep tone of the wedge - it made a refused case read as a body further away
         rather than as a body that failed. */
      uRefused: { value: PALETTE.stop.clone() },
      /* Distance goes to the ground colour rather than to alpha. Fading a solid body
         out by opacity puts the floor's light bands back through it, which is the exact
         smear this scene stopped doing when the boxes went opaque. */
      uFog: { value: PALETTE.abyss.clone() },
    },
    vertexShader: /* glsl */ `
      in vec3 aState;    // usable (0/1), phase, seed
      out vec3 vObj;
      out vec3 vNormal;
      out vec3 vView;
      out vec3 vState;
      out vec3 vScale;
      out float vDepth;
      void main(){
        vObj = position;             // -0.5 .. 0.5, before the instance's scale
        vState = aState;
        /* The instance's world scale, read off the matrix columns. The panel grid is
           in world units, so it needs to know how big this particular slab is; passing
           it as another attribute would be a second copy of a number already here. */
        vScale = vec3(
          length(instanceMatrix[0].xyz),
          length(instanceMatrix[1].xyz),
          length(instanceMatrix[2].xyz)
        );
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        /* Non-uniform scale skews normals in general. These are axis-aligned box faces
           and the scale is axis-aligned, so each normal only changes LENGTH and the
           normalize puts it back - no inverse-transpose needed for this geometry. */
        vNormal = normalize(mat3(instanceMatrix) * normal);
        vView = -mv.xyz;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vObj; in vec3 vNormal; in vec3 vView; in vec3 vState; in vec3 vScale;
      in float vDepth;
      out vec4 fragColor;
      uniform vec3 uBody, uDeep, uPanel, uHot, uRefused, uFog;
      uniform float uTime;

      float cell(vec2 id){ return fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453); }

      /* Planar coordinates for whichever face this fragment is on, plus a per-face seed
         so the six sides do not carry the same panel layout. Returns LOCAL -0.5..0.5;
         the caller scales it into world units. */
      vec2 faceLocal(vec3 n, vec3 p, vec3 s, out float seed, out vec2 fs){
        vec3 a = abs(n);
        if (a.x > a.y && a.x > a.z) { seed = n.x > 0.0 ? 1.0 : 2.0; fs = vec2(s.z, s.y); return p.zy; }
        if (a.y > a.z)              { seed = n.y > 0.0 ? 3.0 : 4.0; fs = vec2(s.x, s.z); return p.xz; }
                                      seed = n.z > 0.0 ? 5.0 : 6.0; fs = vec2(s.x, s.y); return p.xy;
      }

      void main(){
        float live = vState.x;
        float ph   = vState.y;

        float seed; vec2 fs;
        vec2 fl = faceLocal(normalize(vNormal), vObj, vScale, seed, fs);
        vec2 wq = fl * fs;           // world units, for panelling and seams
        seed += vState.z;            // per-instance shift, so no two slabs share a facade

        vec2 gA = floor(wq / ${PANEL_A} + seed * 13.0);
        vec2 gB = floor(wq / ${PANEL_B} + seed * 7.3 + 3.7);
        float a = cell(gA);
        float b = cell(gB);

        float panel = mix(0.80, 1.20, a) * mix(0.93, 1.07, b);
        float bright = smoothstep(0.87, 0.99, a) * 0.60;

        /* The ramp runs through the WHOLE object rather than through the face, so it is
           continuous across the silhouette and the top cap sits at the hot end of it. */
        float ramp = pow(clamp(vObj.y + 0.5, 0.0, 1.0), 0.85);

        /* NO CUT. The landing cube's third feature is a wedge recessed into one face,
           and it is deliberately not ported. There it is one object holding a frame on
           its own and the notch is what the eye returns to on a second look; here the
           hypotenuse reads as a triangle drawn ON the face rather than as geometry taken
           out of it, and repeated down a rank it becomes a motif the scene never earned.
           The panelling and the ramp carry the material without it. */

        /* A slow inhale, one cycle, no harmonics. Per-instance phase: a field breathing
           in unison is a pulse, and a pulse is an alarm. */
        float breath = 0.94 + 0.06 * sin(uTime * 0.55 + ph * 6.2831);

        float f = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));

        /* Fresnel, INVERTED. The faces are hot and the silhouette cools, which is what
           an object lit from within does. A conventional rim light would make it a glass
           shell, and a glass shell is what this scene just stopped being. */
        float core = 1.0 - smoothstep(0.15, 0.85, f);

        vec3 col = mix(uDeep, uBody, ramp) * panel * breath;
        col = mix(col, uPanel, bright * ramp);
        /* 0.40 where the landing page uses 0.85. It carries one cube against empty
           ground; several sets of face centres is more frame than the brightest value
           in the palette should be holding at once. */
        col += uHot * core * 0.40 * ramp;

        vec2 seam = abs(fract(wq / ${PANEL_A}) - 0.5);
        col *= mix(1.0, 0.80, 1.0 - smoothstep(0.45, 0.5, max(seam.x, seam.y)));

        /* THE REFUSED, IN RED. Same construction, same panelling, and none of the light
           that comes from inside a usable one - a refused document is a body that failed,
           not a body further away, so it keeps its structure and loses its interior.

           Red enough to be named as red at a glance across the field, and dim enough
           that it is plainly not lit the way its neighbours are. The rim is the one
           conventional fresnel in this file: a body with nothing lit inside can only
           catch what the room gives it, so the edge is where most of the colour lands.
           The ramp survives at reduced range, so a refused body still stands upright in
           the same light as the rest rather than going flat. */
        vec3 dead = uRefused * (0.10 + panel * 0.10) * (0.45 + 0.55 * ramp)
                  + uRefused * smoothstep(0.30, 1.0, f) * 0.45;
        col = mix(dead, col, live);

        col = mix(uFog, col, 1.0 - smoothstep(30.0, 95.0, vDepth));
        fragColor = vec4(col, 1.0);
      }
    `,
  });

  const vitrines = new InstancedMesh(box, vitMat, MAX_BODIES);
  vitrines.frustumCulled = false;
  /* Nothing until the real list arrives. An archive that shows six bodies for six cases
     is a second reading of the table; one that shows a decorative field until the fetch
     lands and then snaps to six has told the reader, once, that it was making it up. */
  vitrines.count = 0;
  const dummy = new Object3D();
  const state = new Float32Array(MAX_BODIES * 3);
  const aState = new InstancedBufferAttribute(state, 3);
  box.setAttribute("aState", aState);
  scene.add(vitrines);

  /**
   * ONE BODY PER CASE.
   *
   * Was a fixed 7x6 grid of forty-two. The library holds six.
   *
   * OPEN GROUND, NOT RANKS, and the count is what forced it. Ranks receding into the
   * dark are how you make six hundred of something feel like six hundred; six objects
   * in ranks is two short rows with nothing behind them, and the scene spends its depth
   * on empty floor. Six spread across the ground at different sizes and staggered in
   * depth is the landing page's own fourth frame - "more of these exist" - which is the
   * composition this material was drawn for anyway.
   *
   * Seeded fresh from one constant on every call, so the same case list always builds
   * the same field. The camera has not moved and the floor has not changed; only the
   * population is now the truth.
   */
  function populate(subjects: readonly { key: string; usable: boolean }[]): void {
    const n = Math.min(subjects.length, MAX_BODIES);
    const rnd = mulberry32(0xa2c8);
    /* Wide enough that the lateral dolly still travels PAST things rather than orbiting
       one clump, and it has to grow with the count or a longer catalogue would stack. */
    const span = Math.max(30, n * 8.5);

    for (let i = 0; i < n; i++) {
      const s = subjects[i]!;
      const t = n === 1 ? 0.5 : i / (n - 1);
      const h = 2.6 + rnd() * rnd() * 5.2;
      dummy.position.set(
        (t - 0.5) * span + (rnd() - 0.5) * 4.0,
        h / 2 - 1.0,
        // Staggered rather than ordered, so the sweep moves them past each other at
        // different rates. A line at one depth is a bar chart.
        -8 - rnd() * 32,
      );
      dummy.scale.set(2.6 + rnd() * 1.4, h, 2.6 + rnd() * 1.4);
      dummy.rotation.y = (rnd() - 0.5) * 0.16;
      dummy.updateMatrix();
      vitrines.setMatrixAt(i, dummy.matrix);

      // The refusals are DATA now. They were a 26% dice roll, which happened to be
      // about the library's real ratio - but the two refused cases are named, and the
      // reader can count the dark ones against the two REFUSED rows in the table.
      state[i * 3] = s.usable ? 1 : 0;
      state[i * 3 + 1] = rnd();
      // Facade seed. Scaled well past the per-face 1..6 so a shifted instance lands on
      // a genuinely different cell lattice rather than on its neighbour's other side.
      state[i * 3 + 2] = rnd() * 40.0;
    }

    vitrines.count = n;
    vitrines.instanceMatrix.needsUpdate = true;
    aState.needsUpdate = true;
  }

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
    populate,
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
