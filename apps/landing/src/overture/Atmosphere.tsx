import { useEffect, useRef } from "react";
import {
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { SCENES } from "./scenes/registry.js";
import type { ScrollEngine } from "./useScrollEngine.js";
import type { SceneHandle } from "./lib/types.js";

/**
 * ONE CANVAS, SIX SCENES.
 *
 * Fixed behind the whole page. The sections scroll over it and tell it which scene is
 * current; it swaps with a tear and keeps rendering.
 *
 * WHY ONE CANVAS AND NOT SIX. Six WebGL contexts is not a tuning problem, it is a
 * cliff: browsers cap simultaneous contexts at around sixteen and start silently
 * dropping the oldest well before that, so a six-canvas page loses its first scene by
 * the time you reach the last. One context also means one post chain, which is what
 * makes a transition between two scenes possible at all.
 *
 * SCENES ARE BUILT ON FIRST USE and then kept. Building all six up front costs several
 * hundred thousand vertices before the first frame; disposing on the way past means
 * rebuilding them every time the reader scrolls back up, which is worse — these are
 * heightfields and tube geometries, and the rebuild is visible as a hitch.
 */

const FULLSCREEN_VERT = /* glsl */ `
out vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Bright-pass. Soft knee so geometry near threshold doesn't pop as it brightens. */
const BRIGHT_FRAG = /* glsl */ `
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

/** Separable gaussian, 5-tap with linear-sampling weights. */
const BLUR_FRAG = /* glsl */ `
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
 * THE TEAR — how one scene becomes the next.
 *
 * Not a cross-fade. A dissolve between two dark blue landscapes is nearly invisible:
 * both frames are 70% near-black, so the mid-point of a fade looks like either one of
 * them and the change reads as a glitch rather than as a move. The reference solves it
 * by tearing the frame into uneven horizontal bands that slide past each other, and
 * that is the single most recognisable thing it does.
 *
 * Three details carry it, and dropping any one of them flattens the effect:
 *
 *   UNEVEN BANDS. Nine, at heights driven by a hash. Equal bands read as a venetian
 *   blind — a UI transition. Unequal ones read as a signal breaking up.
 *
 *   STAGGERED TIMING. Each band starts and finishes at its own moment inside the
 *   window. In lockstep, the bands are just one wipe cut into strips.
 *
 *   CHROMATIC FRINGING at the moving edges, and only there. Red and blue sample at
 *   slightly different offsets, scaled by how fast that band is currently moving, so
 *   the colour separation appears during the slide and is gone by the time it lands.
 *   Applied uniformly it just looks like a broken render.
 */
const TEAR_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
uniform float uDir;

float hash11(float p){
  p = fract(p * 0.1031);
  p *= p + 33.33;
  return fract(p * (p + p));
}

void main(){
  const float BANDS = 9.0;
  float band = floor(vUv.y * BANDS);
  float r = hash11(band + 0.5);

  // Each band runs its own window inside the overall progress. The 0.42 spread leaves
  // every band a 58% slice to travel in, so the last one to start still finishes.
  float start = r * 0.42;
  float local = smoothstep(start, start + 0.58, uProgress);

  // Speed of this band right now. Peaks mid-slide, zero at both ends — this is what
  // gates the fringing to the moving part of the move.
  float speed = local * (1.0 - local) * 4.0;

  float push = (0.35 + r * 0.65) * uDir;
  vec2 offFrom = vec2(push * local, 0.0);
  vec2 offTo = vec2(-push * (1.0 - local), 0.0);

  float fringe = speed * 0.012 * (r - 0.5);

  vec3 a, b;
  a.r = texture(uFrom, vUv + offFrom + vec2(fringe, 0.0)).r;
  a.g = texture(uFrom, vUv + offFrom).g;
  a.b = texture(uFrom, vUv + offFrom - vec2(fringe, 0.0)).b;
  b.r = texture(uTo, vUv + offTo + vec2(fringe, 0.0)).r;
  b.g = texture(uTo, vUv + offTo).g;
  b.b = texture(uTo, vUv + offTo - vec2(fringe, 0.0)).b;

  fragColor = vec4(mix(a, b, local), 1.0);
}
`;

/**
 * Final composite: bloom add, ACES tonemap, vignette, grain, sRGB encode.
 *
 * Grain is added AFTER tonemapping on purpose. Grain in linear light gets crushed in
 * the shadows, which is exactly where it is doing its job — breaking up the banding a
 * near-black gradient across 1080p would otherwise show on an 8-bit display.
 */
const FINAL_FRAG = /* glsl */ `
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

  // Vignette, generous and soft. The reference never lets the corners reach the ground
  // value — they go slightly below it, which is what makes the frame feel lit.
  vec2 q = vUv - 0.5;
  float v = 1.0 - dot(q, q) * uVignette;
  col *= clamp(v, 0.0, 1.0);

  float g = hash21(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5;
  col += g * uGrain;

  // Linear -> sRGB, done here because the renderer's own output conversion is off.
  col = max(col, vec3(0.0));
  vec3 lo = col * 12.92;
  vec3 hi = 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055;
  fragColor = vec4(mix(hi, lo, step(col, vec3(0.0031308))), 1.0);
}
`;

/**
 * Core-count and pointer sniff.
 *
 * Crude, and knowingly so: there is no reliable way to ask a browser how fast its GPU
 * is before drawing with it. This only has to separate "a laptop" from "a phone" well
 * enough to pick a vertex budget, and it is checked against the frame loop below —
 * which drops quality on its own if frames actually come in slow.
 */
function probeQuality(): number {
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  if (coarse) return 0.45;
  if (cores >= 12) return 1;
  if (cores >= 8) return 0.85;
  if (cores >= 4) return 0.7;
  return 0.5;
}

export function Atmosphere({
  engine,
  reducedMotion,
  running,
  onReady,
}: {
  engine: ScrollEngine;
  reducedMotion: boolean;
  /** False while the boot screen is up — the camera must not fly during the load. */
  running: boolean;
  /** Fired once, after the first frame has actually been presented. */
  onReady: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Read inside the frame loop rather than closed over, so neither a scroll nor a boot
  // state change tears down and rebuilds the renderer.
  const runningRef = useRef(running);
  runningRef.current = running;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;height:100%";
    host.appendChild(canvas);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      });
      // Tone mapping off and the output left LINEAR, because the composite shader does
      // its own ACES and its own sRGB encode. Doing either twice is the classic
      // washed-out-render bug.
      //
      // It must be LinearSRGBColorSpace and not NoColorSpace: `NoColorSpace` is a
      // TEXTURE value, and assigning it to the renderer's output sends three looking for
      // a conversion config that does not exist for it — which throws, and unguarded
      // took the whole page down with it.
      renderer.toneMapping = NoToneMapping;
      renderer.outputColorSpace = LinearSRGBColorSpace;
    } catch {
      // No WebGL. The section's CSS ground is the whole fallback and it is the design's
      // own background, so there is nothing to do but leave it up.
      canvas.remove();
      return;
    }

    /* ---- pointer parallax ------------------------------------------------
       Applied to the camera's POSITION after the scene has finished its own update,
       not to its rotation. Two reasons: it composes with whatever camera move the
       scene is already performing without either fighting the other, and translating
       gives real parallax between near and far geometry where rotating only swings the
       frame. Heavy easing — the target moves with the cursor, the camera crawls after
       it, and the lag is what stops the shot feeling nailed to the mouse. */
    const pointer = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    let quality = probeQuality();
    const dpr = () => Math.min(window.devicePixelRatio, quality < 0.7 ? 1.25 : 1.6);

    /* ---- scenes, built on demand ---------------------------------------- */

    const built = new Map<number, SceneHandle>();
    const sceneAt = (i: number): SceneHandle => {
      let s = built.get(i);
      if (!s) {
        s = SCENES[i]!.create({ quality, reducedMotion });
        s.resize(width || 2, height || 2);
        built.set(i, s);
      }
      return s;
    };

    /* ---- post chain ------------------------------------------------------ */

    const quad = new PlaneGeometry(2, 2);
    const postScene = new Scene();
    const postCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postMesh = new Mesh(quad);
    postMesh.frustumCulled = false;
    postScene.add(postMesh);

    // Half-float, because the bright pass has to find values ABOVE 1.0 — on an 8-bit
    // target the emissive geometry clamps to white before the threshold ever sees it and
    // the bloom comes out as a flat halo with no falloff.
    const rt = (depth: boolean) =>
      new WebGLRenderTarget(2, 2, {
        type: HalfFloatType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: depth,
      });

    const sceneRT = rt(true);
    const fromRT = rt(true);
    const toRT = rt(true);
    const bloomA = [rt(false), rt(false), rt(false)];
    const bloomB = [rt(false), rt(false), rt(false)];

    const brightMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BRIGHT_FRAG,
      uniforms: { uTex: { value: null }, uThreshold: { value: 0.58 }, uKnee: { value: 0.25 } },
    });
    const blurMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { uTex: { value: null }, uDirection: { value: new Vector2() } },
    });
    const tearMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: TEAR_FRAG,
      uniforms: {
        uFrom: { value: null },
        uTo: { value: null },
        uProgress: { value: 0 },
        uDir: { value: 1 },
      },
    });
    const finalMat = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: FINAL_FRAG,
      uniforms: {
        uScene: { value: null },
        uBloom1: { value: null },
        uBloom2: { value: null },
        uBloom3: { value: null },
        uBloomStrength: { value: 0.72 },
        uTime: { value: 0 },
        uGrain: { value: 0.028 },
        uVignette: { value: 1.75 },
      },
    });

    const blit = (mat: ShaderMaterial, target: WebGLRenderTarget | null) => {
      postMesh.material = mat;
      renderer.setRenderTarget(target);
      renderer.render(postScene, postCam);
    };

    /* ---- sizing ---------------------------------------------------------- */

    let width = 0;
    let height = 0;

    const resize = () => {
      const r = host.getBoundingClientRect();
      width = Math.max(2, Math.round(r.width));
      height = Math.max(2, Math.round(r.height));

      renderer.setPixelRatio(dpr());
      renderer.setSize(width, height, false);
      for (const s of built.values()) s.resize(width, height);

      const pw = Math.round(width * dpr());
      const ph = Math.round(height * dpr());
      for (const t of [sceneRT, fromRT, toRT]) t.setSize(pw, ph);
      for (let i = 0; i < 3; i++) {
        const d = 2 << i; // 2, 4, 8
        const w = Math.max(2, Math.round(pw / d));
        const h = Math.max(2, Math.round(ph / d));
        bloomA[i]!.setSize(w, h);
        bloomB[i]!.setSize(w, h);
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    /* ---- frame loop ------------------------------------------------------ */

    let raf = 0;
    let running = true;
    const start = performance.now();
    let last = start;
    let held = 0;

    let announced = false;

    // Frame-time watchdog. If the machine cannot hold the budget the pixel ratio drops
    // once — the alternative is a background that janks the page's scroll.
    let slow = 0;
    let degraded = false;

    const frame = () => {
      if (!running) return;
      raf = requestAnimationFrame(frame);

      const now = performance.now();
      const dt = now - last;
      last = now;
      // Time stops while the boot screen is up. Letting it run means the reader arrives
      // to a scene several seconds into its own drift, with the cube already off-centre.
      const t = runningRef.current ? (now - start - held) / 1000 : 0;
      if (!runningRef.current) held = now - start;

      if (!degraded && dt > 32) {
        if (++slow > 45) {
          degraded = true;
          quality = 0.45;
          resize();
        }
      } else if (dt < 24) {
        slow = Math.max(0, slow - 1);
      }

      /* ---- where are we, and are we mid-flight? ------------------------
         The tear is not triggered by a chapter CHANGING — it is scrubbed by scroll
         across the whole flight between two text windows. The text is on screen for the
         middle 40% of a track, so the flight spans the last 30% of one chapter and the
         first 30% of the next: 60% of a track, with the chapter boundary exactly at its
         midpoint. Mapping the tear onto that window is what puts the cut at peak
         brightness mid-flight, where it is hidden, rather than at a moment the reader
         chose by stopping scrolling. */
      const st = engine.read();
      const LAST = SCENES.length - 1;

      let from = st.chapter;
      let to = st.chapter;
      let tear = -1;

      if (!reducedMotion) {
        if (st.local > 0.7 && st.chapter < LAST) {
          from = st.chapter;
          to = st.chapter + 1;
          tear = (st.local - 0.7) / 0.6;
        } else if (st.local < 0.3 && st.chapter > 0) {
          from = st.chapter - 1;
          to = st.chapter;
          tear = 0.5 + st.local / 0.6;
        }
      }

      const current = sceneAt(to);
      current.setProgress?.(st.local);
      current.update(t);

      // Parallax, after the scene has placed its own camera.
      eased.x += (pointer.x - eased.x) * 0.03;
      eased.y += (pointer.y - eased.y) * 0.03;
      const reach = reducedMotion ? 0 : 1;
      current.camera.position.x += eased.x * 1.2 * reach;
      current.camera.position.y += -eased.y * 0.7 * reach;
      current.camera.updateMatrixWorld();

      if (tear >= 0) {
        const prev = sceneAt(from);
        prev.setProgress?.(from === st.chapter ? st.local : 1);
        prev.update(t);
        prev.camera.position.x += eased.x * 1.2 * reach;
        prev.camera.position.y += -eased.y * 0.7 * reach;
        prev.camera.updateMatrixWorld();

        tearMat.uniforms["uDir"]!.value = to > from ? 1 : -1;

        renderer.setRenderTarget(fromRT);
        renderer.clear();
        renderer.render(prev.scene, prev.camera);

        renderer.setRenderTarget(toRT);
        renderer.clear();
        renderer.render(current.scene, current.camera);

        tearMat.uniforms["uFrom"]!.value = fromRT.texture;
        tearMat.uniforms["uTo"]!.value = toRT.texture;
        tearMat.uniforms["uProgress"]!.value = tear;
        blit(tearMat, sceneRT);
      } else {
        renderer.setRenderTarget(sceneRT);
        renderer.clear();
        renderer.render(current.scene, current.camera);
      }

      // Bright pass into level 1, then downsample-and-blur through the chain.
      brightMat.uniforms["uTex"]!.value = sceneRT.texture;
      blit(brightMat, bloomA[0]!);

      for (let i = 0; i < 3; i++) {
        if (i > 0) {
          // Level i seeds from the previous level's blurred result, which is what makes
          // the widest level genuinely wide rather than merely a bigger kernel.
          brightMat.uniforms["uTex"]!.value = bloomA[i - 1]!.texture;
          blit(brightMat, bloomA[i]!);
        }
        blurMat.uniforms["uTex"]!.value = bloomA[i]!.texture;
        blurMat.uniforms["uDirection"]!.value.set(1 / bloomA[i]!.width, 0);
        blit(blurMat, bloomB[i]!);
        blurMat.uniforms["uTex"]!.value = bloomB[i]!.texture;
        blurMat.uniforms["uDirection"]!.value.set(0, 1 / bloomA[i]!.height);
        blit(blurMat, bloomA[i]!);
      }

      finalMat.uniforms["uScene"]!.value = sceneRT.texture;
      finalMat.uniforms["uBloom1"]!.value = bloomA[0]!.texture;
      finalMat.uniforms["uBloom2"]!.value = bloomA[1]!.texture;
      finalMat.uniforms["uBloom3"]!.value = bloomA[2]!.texture;
      finalMat.uniforms["uTime"]!.value = t;
      blit(finalMat, null);

      // The boot screen's third milestone: a frame has actually been presented, not
      // merely a module imported. Announced once.
      if (!announced) {
        announced = true;
        onReadyRef.current();
      }
    };

    raf = requestAnimationFrame(frame);

    // Stop drawing when the page is hidden. A continuously rendering WebGL background in
    // a background tab is pure heat.
    const onVisibility = () => {
      if (document.hidden && running) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!document.hidden && !running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      ro.disconnect();
      for (const s of built.values()) s.dispose();
      for (const t of [sceneRT, fromRT, toRT, ...bloomA, ...bloomB]) t.dispose();
      quad.dispose();
      for (const m of [brightMat, blurMat, tearMat, finalMat]) m.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [reducedMotion, engine]);

  return (
    <div
      ref={hostRef}
      data-stage=""
      className="pointer-events-none absolute inset-0 z-0"
      aria-hidden="true"
    />
  );
}
