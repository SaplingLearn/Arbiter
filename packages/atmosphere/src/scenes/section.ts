import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  GLSL3,
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
 * READ — "SECTION"
 *
 * A stained tissue section held in depth, with a focal plane travelling slowly through
 * it. Where the plane passes, structures resolve: small, sharp, bright. Ahead of it and
 * behind it they swell into soft discs and sink back toward the ground. A minority of
 * bodies hold a hotter colour and stay faintly lit even out of focus, so the eye catches
 * them coming before the plane arrives.
 *
 * WHY THIS FOR THIS PAGE. Read & mark is where somebody goes through a 288-page
 * regulatory review looking for the few passages that decide the case. That is this
 * image exactly - a dense body of material, most of it out of focus at any moment, a
 * narrow band where things become legible, and a small number of features worth
 * stopping on. The findings the tab draws over the page are the bodies already lit.
 *
 * It is also literal rather than metaphorical, which is the bar the other scenes are
 * held to. Preclinical hepatotoxicity is read off stained sections under exactly this
 * kind of pass; the reviewer on this page is looking at a document about someone doing
 * this to a liver. And the word carries the page in both directions: a section of
 * tissue, a section of a document.
 *
 * THE DEPTH OF FIELD IS THE WHOLE SCENE, and it is why the bodies are points rather
 * than geometry. A shallow focal plane is what a microscope gives you and what reading
 * feels like; both bury almost everything at any one moment. Out of focus a point grows
 * and dims into a soft disc - the bokeh that says "optical" rather than "faded" - and
 * in focus it tightens to a hard core. One attribute drives both.
 *
 * NO INSTRUMENT IS DRAWN, and one was tried. A ruled graticule rode the focal plane, on
 * the argument that something has to say where the focus IS or the sweep reads as the
 * whole field pulsing. Rendered, it never read as a plane - edge-on and additive over
 * the ground glow, it only thickened the glow, and at an alpha where the lines resolved
 * it competed with the headline. The bodies say where the plane is by coming into focus,
 * which was always the stronger signal. Removed rather than left at an alpha that did
 * nothing, because geometry whose comment claims more than it delivers is worse than no
 * geometry.
 *
 * FROM THE REFERENCE: the depth-racking passage, where the subject is still and the
 * camera's focus moves through it rather than the other way round.
 */

export function createSection(ctx: SceneContext): AtmosphereScene {
  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 220);
  const baseCam = new Vector3(0, 0, 25);
  camera.position.copy(baseCam);

  const rnd = mulberry32(0x5ec7);

  /** Half-depth of the slab. The focal plane travels between -SPAN and +SPAN. */
  const SPAN = 15;
  /** How much of the depth is legible at once. Small on purpose - see the header. */
  const FOCAL_DEPTH = 2.1;
  const COUNT = Math.round(5200 * ctx.quality) + 900;

  // ---- the section itself.
  //
  // Bodies are laid out in loose LAMINAE rather than uniformly through the volume,
  // because tissue is layered and because a uniform cloud gives the focal plane nothing
  // to arrive at. Each lamina is a slightly warped sheet; the plane crossing one is the
  // moment the scene is for.
  const LAMINAE = 11;
  const pos = new Float32Array(COUNT * 3);
  const par = new Float32Array(COUNT * 3); // jitter, isFinding, lamina phase

  for (let i = 0; i < COUNT; i++) {
    const lam = Math.floor(rnd() * LAMINAE);
    const z = -SPAN + (lam / (LAMINAE - 1)) * SPAN * 2;

    // Polar rather than cartesian scatter: a rectangular field reads as a grid the
    // moment it is in focus, and a section has no edges in frame.
    const a = rnd() * Math.PI * 2;
    // NARROWER THAN THE FIRST PASS (was 21). A slab as wide as the frame spreads the
    // bodies until each is a couple of pixels and the section reads as noise; the
    // subject is a specimen under an instrument, which is a bounded thing.
    const r = Math.sqrt(rnd()) * 13;

    // The sheet warps, so a lamina never comes into focus all at once - which is the
    // difference between a slide and a stack of glass.
    const warp = Math.sin(r * 0.28 + lam * 1.7) * 1.35 + Math.cos(a * 2.0 + lam) * 0.7;

    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r * 0.72;
    pos[i * 3 + 2] = z + warp + (rnd() - 0.5) * 0.9;

    par[i * 3] = rnd();
    // ~7%. Few enough that they are findings rather than texture - a field where most
    // things are worth stopping on says nothing about the few that are.
    par[i * 3 + 1] = rnd() < 0.07 ? 1 : 0;
    par[i * 3 + 2] = rnd() * Math.PI * 2;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("aPar", new BufferAttribute(par, 3));

  const mat = new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uFocus: { value: 0 },
      uDepth: { value: FOCAL_DEPTH },
      // OUT OF FOCUS IS NOT INVISIBLE. The first pass used PALETTE.reflex as the cool
      // end, which the palette file describes as a silhouette value "barely above
      // ground" - correct for structure that should read as shape, wrong here, because
      // out-of-focus bodies are most of this scene at any moment and they vanished
      // completely. The cool end has to sit far enough above the ground to read as
      // haze; the contrast with the focal plane comes from alpha and size, not from
      // taking the base to black.
      uCool: { value: PALETTE.azure },
      uWarm: { value: PALETTE.sky },
      uHot: { value: PALETTE.white },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      in vec3 aPar;
      out float vFocus; out float vFinding; out float vJitter; out float vFade;
      uniform float uTime, uFocus, uDepth, uPixelRatio;
      void main(){
        vJitter = aPar.x;
        vFinding = aPar.y;

        vec3 p = position;
        // A slow lateral drift, per-body, so the section is alive without anything in
        // it appearing to travel. Reading is still; the specimen is not dead.
        p.x += sin(uTime * 0.11 + aPar.z) * 0.16;
        p.y += cos(uTime * 0.09 + aPar.z * 1.3) * 0.13;

        // FOCUS IS MEASURED IN OBJECT SPACE, not from the camera. The plane belongs to
        // the specimen and sweeps through it; tying it to camera distance would make
        // the drift below rack the focus, which is a different and wrong idea.
        vFocus = 1.0 - smoothstep(0.0, uDepth, abs(p.z - uFocus));

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;

        vFade = 1.0 - smoothstep(46.0, 96.0, -mv.z);

        // Out of focus a body is LARGER and dimmer - that is the whole optical tell.
        // In focus it tightens to a core. Findings sit slightly above the rest at every
        // depth so they can be seen coming.
        float blur = mix(5.4, 1.5, vFocus);
        gl_PointSize = (blur + vJitter * 1.2 + vFinding * 1.1)
                     * uPixelRatio * (34.0 / max(-mv.z, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in float vFocus; in float vFinding; in float vJitter; in float vFade;
      out vec4 fragColor;
      uniform vec3 uCool, uWarm, uHot;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;

        // Two profiles across one sprite. In focus: a tight core with a hard falloff.
        // Out of focus: a broad, nearly flat disc with a soft edge, which is what an
        // out-of-focus point light actually looks like through a lens.
        float core = pow(1.0 - d * 4.0, 2.6);
        float disc = smoothstep(0.25, 0.14, d) * 0.55;
        float a = mix(disc, core, vFocus);

        vec3 col = mix(uCool, uWarm, vFocus);
        col = mix(col, uHot, vFinding * (0.35 + 0.65 * vFocus));

        float alpha = a * vFade * (0.34 + vFocus * 0.80 + vFinding * 0.30);
        fragColor = vec4(col * alpha, alpha);
      }
    `,
  });
  const section = new Points(geo, mat);
  section.frustumCulled = false;
  scene.add(section);

  const air = makeAirdrop({
    inner: new Color().copy(PALETTE.electric).multiplyScalar(0.26),
    outer: PALETTE.abyss,
    centre: [0.5, 0.52],
    scale: 1.35,
    speed: 0.018,
  });
  scene.add(air);

  const motes = makeMotes(Math.round(420 * ctx.quality), 26, 0x5ec7, {
    colorA: PALETTE.sky, colorB: PALETTE.reflex, size: 1.3,
  });
  scene.add(motes);

  return {
    id: "read",
    scene,
    camera,

    update(dt, t) {
      // A 34-SECOND PASS, WITH A HOLD AT EACH END, and it ping-pongs rather than
      // cutting back. This is the slowest sweep in the set after the Helix, because the
      // page it stands behind is the one where somebody is expected to stay a while. A
      // hard reset to the top would be a page-turn, and nobody reading a 288-page review
      // snaps back to page one.
      const cycle = 34;
      // PHASE-SHIFTED so t=0 is a quarter into the pass rather than at the far edge.
      // A viewer arriving on the page should find the plane inside the specimen with
      // something already resolved, not parked behind it waiting to start.
      const u = ((t + cycle * 0.28) % cycle) / cycle;
      const hold = 0.12;
      let tri: number;
      if (u < hold) tri = 0;
      else if (u < 0.5 - hold * 0.5) tri = (u - hold) / (0.5 - hold * 1.5);
      else if (u < 0.5 + hold * 0.5) tri = 1;
      else if (u < 1 - hold) tri = 1 - (u - (0.5 + hold * 0.5)) / (0.5 - hold * 1.5);
      else tri = 0;
      // Eased, so the plane settles into a lamina rather than passing at constant rate.
      const eased = tri * tri * (3 - 2 * tri);
      const focus = -SPAN + eased * SPAN * 2;

      mat.uniforms.uFocus!.value = focus;
      mat.uniforms.uTime!.value = t;
      (air.material as ShaderMaterial).uniforms.uTime!.value = t;
      (motes.material as ShaderMaterial).uniforms.uTime!.value = t;

      // The graticule rides the focal plane, because it IS the focal plane.

      // The specimen turns barely at all. Enough that the laminae are not edge-on
      // rectangles, not enough to become the subject.
      section.rotation.y = Math.sin(t * 0.035) * 0.16;
      section.rotation.x = Math.cos(t * 0.028) * 0.09;

      camera.position.set(
        Math.sin(t * 0.021) * 2.6,
        Math.cos(t * 0.017) * 1.9,
        baseCam.z + Math.sin(t * 0.013) * 2.4,
      );
      camera.lookAt(0, 0, focus * 0.25);

      void dt;
    },

    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      (air.material as ShaderMaterial).uniforms.uAspect!.value = w / h;
    },

    dispose() {
      geo.dispose(); mat.dispose();
      air.geometry.dispose(); (air.material as ShaderMaterial).dispose();
      motes.geometry.dispose(); (motes.material as ShaderMaterial).dispose();
    },
  };
}
