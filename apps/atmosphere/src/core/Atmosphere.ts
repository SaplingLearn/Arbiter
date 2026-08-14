import {
  BufferGeometry,
  Clock,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import gsap from "gsap";
import {
  BLUR_FRAG,
  BRIGHT_FRAG,
  FINAL_FRAG,
  FULLSCREEN_VERT,
  TRANSITION_FRAG,
} from "./shaders.js";
import type { AtmosphereScene, SceneContext, SceneFactory } from "./types.js";

/**
 * THE ENGINE.
 *
 * One WebGL context for the lifetime of the session. Scenes are built and destroyed;
 * the context, the render targets and the post chain never are. Losing and re-taking
 * a context on every navigation is the single most common way a background like this
 * ends up janky, and it is entirely avoidable.
 *
 * PIPELINE
 *   idle:        active -> rtA
 *   transition:  from -> rtA, to -> rtB, then displacement composite -> rtC
 *   always:      rtC -> bright -> blur chain (1/2, 1/4, 1/8) -> final -> screen
 *
 * The transition needs both scenes resolved as textures before it can tear them
 * against each other, which is exactly why this is not a cross-fade and why the
 * render targets are not optional.
 */

const BLOOM_LEVELS = 3;

interface Registered {
  id: string;
  factory: SceneFactory;
}

export class Atmosphere {
  readonly renderer: WebGLRenderer;
  private readonly clock = new Clock();

  private readonly registry = new Map<string, Registered>();
  private current: AtmosphereScene | null = null;
  private outgoing: AtmosphereScene | null = null;
  private currentId = "";

  /** Seconds since the CURRENT scene mounted. Reset on every swap so a scene always
   *  starts its own motion at zero, however late it arrives. */
  private elapsed = 0;
  private outgoingElapsed = 0;

  private rtA!: WebGLRenderTarget;
  private rtB!: WebGLRenderTarget;
  private rtC!: WebGLRenderTarget;
  private bloomA: WebGLRenderTarget[] = [];
  private bloomB: WebGLRenderTarget[] = [];

  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh<BufferGeometry, ShaderMaterial>;

  private readonly matTransition: ShaderMaterial;
  private readonly matBright: ShaderMaterial;
  private readonly matBlur: ShaderMaterial;
  private readonly matFinal: ShaderMaterial;

  private readonly ctx: SceneContext;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private running = false;
  private raf = 0;

  /** 0 = fully on the outgoing scene, 1 = fully arrived. Driven by GSAP. */
  private progress = { value: 0 };
  private transitioning = false;

  /** Global fade, used by the intro. Separate from progress so the overture can hold
   *  the scene at black while it is already running and warm. */
  readonly fade = { value: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });

    // Output conversion is disabled because FINAL_FRAG does the tonemap and the
    // linear->sRGB encode itself. Leaving it on would encode twice and wash the
    // shadows, which on a near-black palette is the entire image.
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.autoClear = false;

    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this.dpr);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.ctx = { renderer: this.renderer, quality: probeQuality(), reducedMotion };

    const geo = new PlaneGeometry(2, 2);
    this.matTransition = fsMaterial(TRANSITION_FRAG, {
      uFrom: { value: null }, uTo: { value: null },
      uProgress: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 },
    });
    this.matBright = fsMaterial(BRIGHT_FRAG, {
      uTex: { value: null }, uThreshold: { value: 0.42 }, uKnee: { value: 0.28 },
    });
    this.matBlur = fsMaterial(BLUR_FRAG, {
      uTex: { value: null }, uDirection: { value: new Vector2() },
    });
    this.matFinal = fsMaterial(FINAL_FRAG, {
      uScene: { value: null },
      uBloom1: { value: null }, uBloom2: { value: null }, uBloom3: { value: null },
      uBloomStrength: { value: 1.15 },
      uTime: { value: 0 },
      uGrain: { value: 0.028 },
      uVignette: { value: 1.05 },
      uFade: { value: 0 },
    });

    this.quad = new Mesh(geo, this.matFinal);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.allocate(window.innerWidth, window.innerHeight);
  }

  get quality(): number { return this.ctx.quality; }
  get reducedMotion(): boolean { return this.ctx.reducedMotion; }
  get activeId(): string { return this.currentId; }
  get isTransitioning(): boolean { return this.transitioning; }

  register(id: string, factory: SceneFactory): void {
    this.registry.set(id, { id, factory });
  }

  /** Mount a scene with no transition. For the first scene only. */
  mount(id: string): void {
    const entry = this.registry.get(id);
    if (entry === undefined) throw new Error(`atmosphere: unknown scene "${id}"`);
    this.current?.dispose();
    this.current = entry.factory(this.ctx);
    this.current.resize(this.width, this.height);
    this.currentId = id;
    this.elapsed = 0;
  }

  /**
   * Swap to another scene through the displacement transition.
   *
   * Building the incoming scene BEFORE the tween starts is deliberate: geometry
   * upload can cost several frames, and a hitch at the start of a transition is far
   * more visible than the same hitch while nothing is moving. The cost is one frame
   * where both scenes exist, which is cheap next to a stutter the eye is watching for.
   */
  transitionTo(id: string, duration = 1.35): void {
    if (id === this.currentId || this.transitioning) return;
    const entry = this.registry.get(id);
    if (entry === undefined) throw new Error(`atmosphere: unknown scene "${id}"`);

    if (this.ctx.reducedMotion) { this.mount(id); return; }

    const next = entry.factory(this.ctx);
    next.resize(this.width, this.height);

    this.outgoing = this.current;
    this.outgoingElapsed = this.elapsed;
    this.current = next;
    this.currentId = id;
    this.elapsed = 0;
    this.transitioning = true;
    this.progress.value = 0;

    gsap.to(this.progress, {
      value: 1,
      duration,
      // A hard ease-in-out would make the tear symmetrical. power2.inOut biases the
      // energy slightly late, so the incoming scene is already moving when the bands
      // resolve — the reference never lands on a static frame.
      ease: "power2.inOut",
      onComplete: () => {
        this.outgoing?.dispose();
        this.outgoing = null;
        this.transitioning = false;
        this.progress.value = 0;
      },
    });
  }

  /** Fade the whole composite up from black. Used once, by the overture. */
  reveal(duration = 1.6): gsap.core.Tween {
    return gsap.to(this.fade, { value: 1, duration, ease: "power2.out" });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resize(width: number, height: number): void {
    this.allocate(width, height);
    this.current?.resize(width, height);
    this.outgoing?.resize(width, height);
  }

  dispose(): void {
    this.stop();
    this.current?.dispose();
    this.outgoing?.dispose();
    this.rtA.dispose(); this.rtB.dispose(); this.rtC.dispose();
    for (const t of [...this.bloomA, ...this.bloomB]) t.dispose();
    this.quad.geometry.dispose();
    for (const m of [this.matTransition, this.matBright, this.matBlur, this.matFinal]) m.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ internals

  private allocate(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);

    const w = Math.ceil(this.width * this.dpr);
    const h = Math.ceil(this.height * this.dpr);

    // Half-float, not byte. The whole look depends on values above 1.0 surviving as
    // far as the bright-pass; an 8-bit target clamps them and the bloom loses every
    // hot core it was supposed to find.
    const opts = {
      type: HalfFloatType, format: RGBAFormat,
      minFilter: LinearFilter, magFilter: LinearFilter,
      depthBuffer: true, stencilBuffer: false,
    } as const;

    if (this.rtA === undefined) {
      this.rtA = new WebGLRenderTarget(w, h, opts);
      this.rtB = new WebGLRenderTarget(w, h, opts);
      this.rtC = new WebGLRenderTarget(w, h, { ...opts, depthBuffer: false });
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        const d = 2 << i; // 1/2, 1/4, 1/8
        const bo = { ...opts, depthBuffer: false };
        this.bloomA.push(new WebGLRenderTarget(Math.ceil(w / d), Math.ceil(h / d), bo));
        this.bloomB.push(new WebGLRenderTarget(Math.ceil(w / d), Math.ceil(h / d), bo));
      }
    } else {
      this.rtA.setSize(w, h); this.rtB.setSize(w, h); this.rtC.setSize(w, h);
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        const d = 2 << i;
        this.bloomA[i]!.setSize(Math.ceil(w / d), Math.ceil(h / d));
        this.bloomB[i]!.setSize(Math.ceil(w / d), Math.ceil(h / d));
      }
    }

    this.matTransition.uniforms.uAspect!.value = this.width / this.height;
  }

  private blit(material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  private frame(): void {
    // Clamped so a backgrounded tab does not resume with a multi-second dt and fling
    // every particle to infinity.
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const t = this.clock.getElapsedTime();
    this.elapsed += dt;

    const r = this.renderer;

    if (this.transitioning && this.outgoing !== null && this.current !== null) {
      this.outgoingElapsed += dt;
      this.outgoing.update(dt, this.outgoingElapsed);
      this.current.update(dt, this.elapsed);

      r.setRenderTarget(this.rtA);
      r.clear();
      r.render(this.outgoing.scene, this.outgoing.camera);

      r.setRenderTarget(this.rtB);
      r.clear();
      r.render(this.current.scene, this.current.camera);

      this.matTransition.uniforms.uFrom!.value = this.rtA.texture;
      this.matTransition.uniforms.uTo!.value = this.rtB.texture;
      this.matTransition.uniforms.uProgress!.value = this.progress.value;
      this.matTransition.uniforms.uTime!.value = t;
      this.blit(this.matTransition, this.rtC);
    } else if (this.current !== null) {
      this.current.update(dt, this.elapsed);
      r.setRenderTarget(this.rtC);
      r.clear();
      r.render(this.current.scene, this.current.camera);
    }

    // ---- bloom: bright pass at half res, then a separable blur per level, each
    // level fed from the previous so the widest tap is genuinely wide without a
    // 30-tap kernel.
    this.matBright.uniforms.uTex!.value = this.rtC.texture;
    this.blit(this.matBright, this.bloomA[0]!);

    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const src = i === 0 ? this.bloomA[0]! : this.bloomA[i - 1]!;
      if (i > 0) {
        this.matBlur.uniforms.uTex!.value = src.texture;
        (this.matBlur.uniforms.uDirection!.value as Vector2).set(0, 0);
        this.blit(this.matBlur, this.bloomA[i]!);
      }
      const target = this.bloomA[i]!;
      const w = target.width, h = target.height;

      this.matBlur.uniforms.uTex!.value = target.texture;
      (this.matBlur.uniforms.uDirection!.value as Vector2).set(1 / w, 0);
      this.blit(this.matBlur, this.bloomB[i]!);

      this.matBlur.uniforms.uTex!.value = this.bloomB[i]!.texture;
      (this.matBlur.uniforms.uDirection!.value as Vector2).set(0, 1 / h);
      this.blit(this.matBlur, target);
    }

    this.matFinal.uniforms.uScene!.value = this.rtC.texture;
    this.matFinal.uniforms.uBloom1!.value = this.bloomA[0]!.texture;
    this.matFinal.uniforms.uBloom2!.value = this.bloomA[1]!.texture;
    this.matFinal.uniforms.uBloom3!.value = this.bloomA[2]!.texture;
    this.matFinal.uniforms.uTime!.value = t;
    this.matFinal.uniforms.uFade!.value = this.fade.value;
    this.blit(this.matFinal, null);
    r.setRenderTarget(null);
  }
}

function fsMaterial(fragmentShader: string, uniforms: Record<string, { value: unknown }>): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms: uniforms as ShaderMaterial["uniforms"],
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
}

/**
 * Boot-time quality probe.
 *
 * Deliberately crude — a renderer-string sniff and a core count, not a benchmark.
 * A real benchmark costs a visible pause on first load, which is a certain cost paid
 * to avoid an uncertain one. Scenes read this as a particle-count multiplier.
 */
function probeQuality(): number {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) return 0.35;
  if (cores <= 4) return 0.55;
  if (cores <= 8) return 0.8;
  return 1.0;
}
