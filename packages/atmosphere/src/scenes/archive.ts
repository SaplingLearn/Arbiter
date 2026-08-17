import gsap from "gsap";
import {
  BoxGeometry,
  Color,
  DoubleSide,
  GLSL3,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
} from "three";
import { PALETTE } from "../core/palette.js";
import { makeAirdrop, makeMotes, mulberry32, smoothstep } from "./common.js";
import { APPEAR_IN, makeInterior } from "./interior.js";
import { MAX_TERRAIN_LIGHTS, makeTerrain } from "./terrain.js";
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
 *
 * AND THE BODIES HAVE AN INSIDE NOW. Opening a case still flies the camera into that
 * case's body; what it arrives in is no longer the inside of a box. `interior.ts` builds
 * a plain of cubes at varying height running out to a fog line with more of them hanging
 * above it, standing on the entered body's own centre, and the two worlds crossfade
 * through the ground colour off the single value the camera is already tweening. A
 * refused case lands in the red grade of the same place - the body you flew at and the
 * ground you land on are one fact read twice.
 *
 * AND THEY STAND ON SOMETHING NOW. The floor was an additive plane of light bands with
 * no depth write, which over a near-black ground is very nearly nothing: the bodies had
 * a surface under them in the code and none in the frame, so a rank of standing volumes
 * read as a rank of floating ones. It is a heightfield now, LIT BY THE BODIES - each
 * case throws a pool on the ground it is standing in, azure if it is usable and a smaller
 * red one if it was refused. Ported from the landing page's own library frame, which
 * does exactly this and for the same reason: an object glowing over nothing is a shape,
 * and the same object with ground catching its light is a place. See `terrain.ts`.
 */

/** FNV-1a. Two callers now: which body a stray case lands on, and which plain is inside
 *  the body it lands on. Both need the same case to give the same answer forever. */
function hash32(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function createArchive(ctx: SceneContext): AtmosphereScene {
  const scene = new Scene();
  /* Far plane out from 260, and the ground is why. A surface that runs to a horizon has
     to reach past the point where the haze has finished eating it, or the far plane cuts
     a hard arc across ground that is still visibly ground. Nothing else in this scene
     goes beyond 100 units, so the cost is depth precision on geometry that does not
     exist. */
  const camera = new PerspectiveCamera(50, 1, 0.1, 420);
  const baseCam = new Vector3(0, 3.4, 26);
  camera.position.copy(baseCam);

  /**
   * Where the ground sits, and where every body's base goes. EXACTLY on it, not a
   * fraction under it.
   *
   * A foot sunk into the surface is the better-looking arrangement and it is not
   * available here: THE STEADY-STATE RENDER TARGET HAS NO DEPTH BUFFER. `Atmosphere`
   * builds `rtC` with `depthBuffer: false` and renders straight into it whenever a
   * transition is not running, so outside of a scene swap nothing in this file is depth
   * tested — the frame is composited in draw order and an object cannot be hidden by a
   * surface in front of it. Which is exactly why the thing this ground replaced was an
   * additive plane: additive does not need to be occluded.
   *
   * So a buried foot would simply be DRAWN, hanging below the ground it is supposed to be
   * in, and the bodies stand on the surface instead. The ground's near field is flat to
   * the millimetre (see the `flat` option below), so "on the surface" is exact rather
   * than approximate, and the contact holds all the way across the field.
   */
  const GROUND_Y = -1.05;

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
      /* The body being flown into is drawn twice: once here, opaque, in the field, and
         once as `ghost` below, translucent, so the camera can pass through its wall.
         This is the index the field leaves out - without it the opaque copy is still
         there and the camera arrives inside a solid box. -1 means nothing skipped. */
      uSkip: { value: -1 },
      /* 1 in the field. The ghost drives this down as it is entered, which is what
         lets the rest of the archive stay visible through the walls. */
      uAlpha: { value: 1 },
      /* Distance goes to the ground colour rather than to alpha. Fading a solid body
         out by opacity puts the floor's light bands back through it, which is the exact
         smear this scene stopped doing when the boxes went opaque. */
      uFog: { value: PALETTE.abyss.clone() },
      /* THE FIELD GIVING WAY TO THE INTERIOR. 0 is the archive; 1 is the archive gone.
         For the same reason as the line above it, this is a mix to `uFog` and not a
         drop in alpha — a see-through field would put the floor's bands through the
         bodies for the whole length of the flight, and the point is that the outside
         stops existing, not that it turns to glass.

         The ghost shares this shader and keeps its own copy at 0. The wall you pass
         through is not supposed to dissolve; it thins, on `uAlpha`. */
      uDissolve: { value: 0 },
    },
    vertexShader: /* glsl */ `
      in vec3 aState;    // usable (0/1), phase, seed
      uniform float uSkip;
      out vec3 vObj;
      out vec3 vNormal;
      out vec3 vView;
      out vec3 vState;
      out vec3 vScale;
      out float vDepth;
      out float vSkip;
      void main(){
        /* Constant across the primitive, so interpolating it is harmless and a flat
           qualifier would buy nothing. Compared with a tolerance rather than equality
           because it arrives as a float uniform. */
        vSkip = abs(float(gl_InstanceID) - uSkip) < 0.5 ? 1.0 : 0.0;
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
      in float vDepth; in float vSkip;
      out vec4 fragColor;
      uniform vec3 uBody, uDeep, uPanel, uHot, uRefused, uFog;
      uniform float uTime, uAlpha, uDissolve;

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
        // The body the ghost is drawing. Leaving it in would put a solid wall where
        // the camera is about to be.
        if (vSkip > 0.5) discard;

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
        /* Out through the same door distance already uses. The interior fades UP from
           this exact value over the same stretch of the flight, so the two worlds meet
           at one colour and neither opens a hole in the frame. */
        col = mix(col, uFog, uDissolve);
        fragColor = vec4(col, uAlpha);
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
   * ---- THE GROUND ----------------------------------------------------------------
   *
   * A heightfield the bodies stand IN, lit by the bodies themselves.
   *
   * WAS AN ADDITIVE PLANE with sweeping light bands and no depth write, which is a
   * lighting effect rather than a surface: additive over near-black is near-black, so
   * there was nothing under the field and a rank of standing volumes read as a rank of
   * floating ones. The bands survive — they are what carries the lateral motion when the
   * bodies themselves are static — but they are a term in this shader now rather than a
   * second plane, so the light runs OVER the landform instead of through it.
   *
   * FLAT WHERE THE ARCHIVE STANDS, rolling behind it. Relief under a body either buries a
   * foot or lifts one off the ground, and the topography is not doing its work down there
   * anyway: the camera sits four units above the surface, so what reads is the swell in
   * the mid-distance breaking the horizon. Bodies live between z = -8 and -40, so the
   * height ramps in from -46 and is at full amplitude by -118.
   *
   * THE FAR EDGE GOES TO THE AIR'S OWN COLOUR. A plane this size seen from this low is
   * looked down the whole length of, and any ground colour left at the end of it draws
   * the plane's own edge across the frame as a horizontal line.
   *
   * Built HERE, above the ghost and the interior, for the same reason they are built
   * before the prewarm render below: a material that is not in the scene when that render
   * runs compiles its program on the first real frame instead, which is the hitch the
   * prewarm exists to prevent.
   */
  const ground = makeTerrain({
    width: 560,
    depth: 460,
    segments: Math.max(56, Math.round(150 * ctx.quality)),
    amp: 4.2,
    scale: 74,
    seed: 5.1,
    flat: { until: 46, over: 72 },
    body: PALETTE.abyss.clone().lerp(PALETTE.violet, 0.07),
    haze: PALETTE.abyss.clone().lerp(PALETTE.navy, 0.45),
    /* PAST THE FIELD, not through it. The default range starts hazing a fifth of the way
       in, which here is z = -23 - in among the bodies, washing the pools of the furthest
       three toward the horizon colour before the eye has read them as pools at all. The
       archive ends at z = -40, so the atmosphere starts at -90. */
    hazeAt: { from: 90, to: 210 },
    /* Up from the landing plain's 0.42, and the camera is the reason. That one looks down
       at its ground from twenty-two units; this one sits four and a half above it, so the
       same pool is seen at a grazing angle and squeezed into a few degrees of screen. The
       light has to be stronger per unit of ground to survive the compression. */
    gain: 0.85,
    /* Enough to break the pools into a surface, well short of gravel. The near field is
       flat by construction, so this is the only thing making the ground read as ground
       where the bodies actually stand.

       OFF ON A WEAK GPU, at zero rather than reduced. It is three noise samples per
       fragment across most of the lower frame, and the shader branches on the uniform —
       one value for the whole draw, so a machine that cannot afford it skips the samples
       outright instead of paying for a quieter version of them. What it loses is texture
       in the pools; what it keeps is the ground. */
    bump: ctx.quality < 0.6 ? 0 : 0.85,
    // The same value the bodies fade to, so the ground and the field leave through one
    // door rather than two.
    fog: PALETTE.abyss.clone(),
    bands: { color: PALETTE.azure.clone(), deep: PALETTE.reflex.clone(), freq: 0.05, speed: 0.2 },
  });
  ground.mesh.position.y = GROUND_Y;
  ground.mesh.frustumCulled = false;
  /* FIRST, after the air. With no depth buffer in the steady state (see `GROUND_Y`), draw
     order IS the depth order, and the ground is behind everything in this scene without
     exception: the bodies stand on it, the motes hang over it, the interior only ever
     appears once the camera is inside a body. Painting it before all of them is not a
     workaround for the missing buffer, it is the correct answer for a scene whose one
     opaque surface is the backmost thing in the frame. -100 is the air; this sits just
     in front of it. */
  ground.mesh.renderOrder = -50;
  scene.add(ground.mesh);

  /** What a body lights the ground with. Azure toward sky is the landing plain's own lit
   *  value; a refusal gets the palette's stop red, well down, because it is a body with
   *  the light off and the pool has to look like a body with the light off. */
  const POOL_LIVE = PALETTE.azure.clone().lerp(PALETTE.sky, 0.36);
  const POOL_DEAD = PALETTE.stop.clone().multiplyScalar(0.35);

  /**
   * THE BODY YOU GO INSIDE, drawn as a second copy of the one you are flying at.
   *
   * A solid body cannot be entered - the camera arrives and the near plane clips into
   * a wall, or worse, the wall is simply there. But the field must stay solid, because
   * opaque bodies occluding each other is where the whole scene gets its depth. So the
   * chosen body leaves the field (`uSkip`) and is redrawn here translucent and
   * double-sided, and it is the ONE object in this scene that is neither.
   *
   * Still an InstancedMesh, with a count of one. It looks odd next to a plain Mesh
   * until you notice the shader: it reads `instanceMatrix` and the `aState` attribute,
   * both of which only exist under instancing. A Mesh would need a second copy of the
   * whole material with those two inputs swapped for uniforms, which is two shaders to
   * keep identical forever. A count of one costs a draw call and keeps one shader.
   */
  const ghostBox = new BoxGeometry(1, 1, 1);
  const ghostState = new Float32Array(3);
  const ghostAState = new InstancedBufferAttribute(ghostState, 3);
  ghostBox.setAttribute("aState", ghostAState);

  const ghostMat = new ShaderMaterial({
    glslVersion: GLSL3,
    // Source shared with the field rather than copied. Three keeps the strings on the
    // material, so the two can never drift.
    vertexShader: vitMat.vertexShader,
    fragmentShader: vitMat.fragmentShader,
    transparent: true,
    /* No depth write. It is entered from outside and then surrounds the camera, so
       there is no ordering against the field that a depth buffer could get right - what
       is wanted is for the field to show THROUGH it, which is the definition of not
       writing depth. */
    depthWrite: false,
    /* The inside faces are the entire point. `abs()` in the fresnel term already means
       the material does not care which way a face is turned. */
    side: DoubleSide,
    uniforms: {
      ...Object.fromEntries(
        Object.entries(vitMat.uniforms).map(([k, v]) => [k, { value: v.value }]),
      ),
      // Never skips: this mesh exists only to draw the body the field left out.
      uSkip: { value: -1 },
      uAlpha: { value: 1 },
    },
  });

  const ghost = new InstancedMesh(ghostBox, ghostMat, 1);
  ghost.frustumCulled = false;
  ghost.visible = false;
  ghost.renderOrder = 1;
  scene.add(ghost);

  /**
   * WHAT IS ACTUALLY IN THERE.
   *
   * The flight used to end in the inside of a box — the same panelling from the wrong
   * side, the rest of the archive showing through the walls. That is a camera position
   * rather than a place, and a reader sits in this shot for the length of a review.
   *
   * The body is bigger on the inside now: a plain of cubes at varying height running out
   * to a fog line, with more of them hanging free above it. See `interior.ts` for why the
   * light is on the caps, why it occupies the far half-space, and why it fades up out of
   * the fog colour rather than out of nothing.
   */
  const interior = makeInterior(ctx.quality);
  scene.add(interior.group);

  /**
   * PAY FOR THE INTERIOR NOW, not a second into the flight.
   *
   * Measured, not guessed: sampling the camera every frame through a dashboard-to-case
   * transition showed the browser dropping five frames about 940ms in - and 940ms is
   * where `flight.k` crosses `APPEAR_IN` and the interior draws for the first time.
   * Twelve hundred instanced cubes, two hundred and forty floaters and four shader
   * programs, all meeting the GPU in the middle of a camera move. Shader compilation
   * alone is usually the multi-frame part.
   *
   * The engine already builds an incoming scene before starting the tween because
   * "geometry upload can cost several frames" and a hitch is least visible when nothing
   * is moving. Hidden geometry is how a scene skips that and pays in the worst place
   * instead. One 1x1 render at build time puts the cost back where the engine intended
   * it - the ghost included, because it is hidden at build too and its material is a
   * different program from the field's.
   */
  const warmTarget = new WebGLRenderTarget(1, 1);
  {
    const ghostWas = ghost.visible;
    ghost.visible = true;
    interior.prewarm(() => {
      const prev = ctx.renderer.getRenderTarget();
      ctx.renderer.setRenderTarget(warmTarget);
      ctx.renderer.render(scene, camera);
      ctx.renderer.setRenderTarget(prev);
    });
    ghost.visible = ghostWas;
  }

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
  /** Populated bodies, in the consumer's order. `focus` resolves a key against these. */
  const keys: string[] = [];
  /** Each body's world centre and half-height, kept for the flight to aim at. */
  const centres: Vector3[] = [];

  function populate(subjects: readonly { key: string; usable: boolean }[]): void {
    const n = Math.min(subjects.length, MAX_BODIES);
    const rnd = mulberry32(0xa2c8);
    keys.length = 0;
    centres.length = 0;
    /* Wide enough that the lateral dolly still travels PAST things rather than orbiting
       one clump, and it has to grow with the count or a longer catalogue would stack. */
    const span = Math.max(30, n * 8.5);

    /* Each body as a light on the ground, parallel to `centres` and deliberately not the
       same point. `centres` is where the camera flies to; an emitter belongs where the
       light comes FROM, which for a body lit through its whole facade is up around
       two-thirds of its height. Hung at the centre, a short body lights a tight disc round
       its own feet and stops; raised, the pool spreads far enough to reach the ground
       between one body and the next. */
    const emitters: Vector3[] = [];
    const reaches: number[] = [];

    for (let i = 0; i < n; i++) {
      const s = subjects[i]!;
      const t = n === 1 ? 0.5 : i / (n - 1);
      const h = 2.6 + rnd() * rnd() * 5.2;
      dummy.position.set(
        (t - 0.5) * span + (rnd() - 0.5) * 4.0,
        GROUND_Y + h / 2,
        // Staggered rather than ordered, so the sweep moves them past each other at
        // different rates. A line at one depth is a bar chart.
        -8 - rnd() * 32,
      );
      dummy.scale.set(2.6 + rnd() * 1.4, h, 2.6 + rnd() * 1.4);
      dummy.rotation.y = (rnd() - 0.5) * 0.16;
      dummy.updateMatrix();
      vitrines.setMatrixAt(i, dummy.matrix);
      keys.push(s.key);
      centres.push(dummy.position.clone());
      emitters.push(new Vector3(dummy.position.x, GROUND_Y + h * 0.62, dummy.position.z));
      /* Reach off HEIGHT rather than footprint. The footprint barely varies — every body
         is between 2.6 and 4.0 across — so a reach taken from it gives eight pools of the
         same size under bodies of wildly different mass. Height is what the eye is already
         reading as how much of a case there is, and a tall body throwing a wider pool is
         the ground agreeing with it. */
      reaches.push(9.0 + h * 2.4);

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

    /* ---- AND THE GROUND LEARNS WHERE THE LIGHT IS ---------------------------------
       Eight emitter slots against a catalogue with no ceiling, so a library longer than
       eight has to choose. STRIDED ACROSS THE FIELD rather than the head of the list:
       bodies are laid out left to right in list order, so lighting the first eight would
       put every pool at one end of the archive and leave the other end standing on unlit
       ground. The bodies that miss out still stand IN the surface and still catch the
       bands sweeping past — what they do not do is light it back.

       Cleared first. A shorter list than last time would otherwise leave the tail of the
       previous population still burning a hole in the ground where nothing stands. */
    ground.clearLights();
    const pools = Math.min(n, MAX_TERRAIN_LIGHTS);
    for (let slot = 0; slot < pools; slot++) {
      const i = n <= MAX_TERRAIN_LIGHTS
        ? slot
        : Math.round((slot * (n - 1)) / (MAX_TERRAIN_LIGHTS - 1));
      /* A REFUSAL LIGHTS THE GROUND TOO, red and at under half the reach. It could as
         easily cast nothing - a body with no interior has no light to throw - but a dark
         gap in a rank of pools reads as a body the renderer forgot, where a small red one
         reads as a case that failed. The colour is the tell either way; this way the tell
         is on the ground as well as in the object. */
      const live = state[i * 3]! > 0.5;
      ground.setLight(
        slot,
        emitters[i]!,
        reaches[i]! * (live ? 1 : 0.45),
        live ? POOL_LIVE : POOL_DEAD,
      );
    }

    if (heldKey !== null) {
      // A re-populate can land while a body is being flown into, and the index it was
      // holding may now be a different case or gone. Re-resolve against the new list.
      const hadBody = heldIndex !== -1;
      applyFocus(heldKey);

      /* AND THIS IS WHERE A COLD LOAD ON A CASE URL ACTUALLY STARTS FLYING.
         `focus` is announced long before the catalogue fetch returns - the backdrop
         says so itself - so `resolve` found nothing, `heldIndex` stayed -1 and no
         tween was ever created. The key was remembered and the body was found here,
         but nothing started the move: the camera sat in the wide shot for the whole
         session while `applyFocus` had already pulled that body out of the field and
         drawn it as a translucent ghost. One body visibly wrong, and the flight the
         gesture promises never happening at all.

         Only when the body did not exist a moment ago. A re-populate during a flight,
         or while already inside, must not restart it. */
      if (!hadBody && heldIndex !== -1) enter();
    }
  }

  /* ---- the flight into one body -------------------------------------------------
     `k` is how far in we are: 0 is the wide sweep, 1 is standing inside the chosen
     body. Everything the camera does is a blend between those two, so the sweep never
     stops - it is still drifting when you arrive, which is what keeps the interior
     from reading as a still photograph of a box. */
  const flight = { k: 0 };
  let heldKey: string | null = null;
  let heldIndex = -1;
  /** Whether the body being entered is a refusal — read off the same bit the field uses. */
  let heldDead = false;
  const held = new Vector3();
  const eye = new Vector3();
  const aim = new Vector3();
  // Scratch, allocated once. A new Vector3 per frame is sixty allocations a second for
  // the length of a session, and this runs inside the render loop.
  const _tmpEye = new Vector3();
  const _tmpAim = new Vector3();
  const _mat = new Matrix4();

  /**
   * Which body a case is.
   *
   * EXACT, THEN PREFIX, THEN A HASH, and the order is the whole point.
   *
   * A prepared case opened from the library gets a caseId built from the case file's
   * own id and the opener's account - `nipocalimab-imaavy--<userId>` for the catalogue
   * entry named `nipocalimab`. So the route's key is neither the catalogue name nor
   * equal between two people who opened the same case. Cutting at `--` and matching the
   * remainder by prefix lands both of them on the same body, which is the behaviour a
   * reader would expect and the reason this is not a plain lookup.
   *
   * THE HASH IS FOR CASES THAT ARE NOT IN THE LIBRARY AT ALL. A case somebody opened
   * themselves has no entry in the catalogue and therefore no body of its own - there
   * is nothing here to fly into, and the honest options are to stay wide or to pick one
   * deterministically. Picking one keeps the gesture consistent for every case; it is
   * also the one place in this scene where the environment is showing something it does
   * not know, and it is worth saying so out loud.
   */
  function resolve(key: string): number {
    if (keys.length === 0) return -1;
    const exact = keys.indexOf(key);
    if (exact !== -1) return exact;

    const stem = key.split("--")[0] ?? key;
    const byPrefix = keys.findIndex((k) => stem === k || stem.startsWith(`${k}-`));
    if (byPrefix !== -1) return byPrefix;

    return hash32(key) % keys.length;
  }

  /** Point the ghost at a body, hide the field's copy of it, and stand the interior in it. */
  function applyFocus(key: string): void {
    const index = resolve(key);
    heldIndex = index;
    if (index === -1) return;

    vitrines.getMatrixAt(index, _mat);
    ghost.setMatrixAt(0, _mat);
    ghost.instanceMatrix.needsUpdate = true;
    ghostState[0] = state[index * 3]!;
    ghostState[1] = state[index * 3 + 1]!;
    ghostState[2] = state[index * 3 + 2]!;
    ghostAState.needsUpdate = true;
    ghost.visible = true;
    vitMat.uniforms.uSkip!.value = index;
    held.copy(centres[index] ?? held);

    /* The interior stands on THIS body's centre, and it is graded by the same bit the
       field paints the body with — so the red you are flying at and the red you land in
       are one fact read twice, and they cannot disagree. Set here rather than during the
       flight because a re-populate can land mid-flight and change which case this is. */
    heldDead = state[index * 3]! < 0.5;
    interior.place(held);
    interior.setDead(heldDead);

    /* THIS CASE'S OWN PLAIN. Seeded off the BODY's key rather than the route's, so the
       two route keys that mean one case - `nipocalimab` and
       `nipocalimab-imaavy--<userId>` - open onto the same landscape, exactly as they
       already fly to the same body. Seeding off the raw route key would give two people
       looking at one case two different insides.

       And a case with no entry in the library, which borrows a body by hash, borrows
       that body's interior with it. The alternative is a body belonging to one case with
       another case's landscape inside it, which is a worse lie than the one this scene
       already admits to. */
    interior.setSeed(hash32(keys[index] ?? key));
  }

  /**
   * Start the flight in.
   *
   * `overwrite` on every tween of `flight.k`, and it is not defensive tidying. On a
   * swap INTO this scene the engine builds the scene and hands it the key it is
   * holding - which, coming from the dashboard, is still null - so this scene's own
   * `focus(null)` runs first and starts a release tween. The consumer's focus effect
   * then lands a microsecond later with the real case and starts an entry tween. Two
   * live tweens on one number, and which one you saw depended on the order GSAP
   * happened to render them in. Whichever lost, the result was the camera pinned at
   * the wide shot and then jumping most of the way inside when the loser completed.
   *
   * Slower than the dashboard's 1.6s. That one crosses open water to a colony; this
   * one ends with the camera passing through a surface, and a wall arriving fast is a
   * collision rather than an arrival.
   */
  function enter(): void {
    if (heldIndex === -1) return;
    gsap.to(flight, { k: 1, duration: 2.1, ease: "power2.inOut", overwrite: true });
  }

  /**
   * Go to a body, from wherever the camera currently is.
   *
   * LEAVING BEFORE ENTERING, when it is already inside a different one. Both ends of
   * the tween are `flight.k`, so re-aiming while inside meant tweening 1 to 1 - a
   * no-op - and the camera cut from the middle of one case's interior to the middle of
   * another's on a single frame, with the plain regenerating under it. Reachable from
   * any link or typed URL that goes case-to-case without passing through a list.
   *
   * So it flies out first and enters on arrival at the wide shot. Three seconds rather
   * than none, and it is the only reading of "you are somewhere else now" that does not
   * teleport.
   */
  function fly(key: string): void {
    const next = resolve(key);
    if (heldIndex !== -1 && next !== heldIndex && flight.k > 0.001) {
      gsap.to(flight, {
        k: 0,
        duration: 0.9,
        ease: "power2.in",
        overwrite: true,
        onComplete: () => {
          // Released, or re-aimed again, while this was running: that decision is newer
          // than this one and has already started its own move.
          if (heldKey !== key) return;
          applyFocus(key);
          enter();
        },
      });
      return;
    }
    applyFocus(key);
    enter();
  }

  /**
   * The air goes red with the interior, and it has to.
   *
   * A refused chamber of red blocks sitting inside a navy bloom is two light sources in
   * one room, and the eye reads the mismatch long before it can say what is wrong. The
   * gradient the entire frame sits in is part of the same decision as the geometry.
   *
   * Lerped on the way IN rather than switched when the case is named, so the shift
   * happens under the flight instead of announcing itself over the wide shot.
   *
   * VERY DARK, and darker than the navy it replaces. This is a full-frame radial and the
   * camera inside the interior has geometry across most of the viewport, so the gradient
   * is being read as the sky behind a plain rather than as a bloom behind a few bodies.
   * At the navy's own strength the red version came back as a lit red sky, and a refusal
   * that floods the frame is a colour that has stopped meaning anything.
   */
  const AIR_LIVE = new Color().copy(PALETTE.navy).multiplyScalar(1.25);
  const AIR_DEAD = PALETTE.stop.clone().lerp(PALETTE.abyss, 0.9).multiplyScalar(0.85);
  // Mutated in place each frame; `makeAirdrop` holds this instance as its uniform.
  const airInner = AIR_LIVE.clone();

  const air = makeAirdrop({
    inner: airInner,
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

    /**
     * Fly inside the body this case is.
     *
     * `null` on the way out, and the ghost is kept until the camera has actually left -
     * dropping it on release would put a solid wall back where the camera is standing,
     * for the whole length of the flight out.
     */
    focus(key) {
      heldKey = key;
      if (key === null) {
        gsap.to(flight, {
          k: 0,
          duration: 1.2,
          ease: "power2.inOut",
          overwrite: true,
          onComplete: () => {
            // Only once the camera is clear. Guarded on the tween's own value rather
            // than on nothing, because a second focus can land mid-flight and this
            // completion belongs to a tween that is no longer the current one.
            if (flight.k > 0.001) return;
            ghost.visible = false;
            vitMat.uniforms.uSkip!.value = -1;
            heldIndex = -1;
          },
        });
        return;
      }
      fly(key);
    },

    update(_dt, t) {
      vitMat.uniforms.uTime!.value = t;
      ghostMat.uniforms.uTime!.value = t;
      ground.update(t);
      (air.material as ShaderMaterial).uniforms.uTime!.value = t;
      (motes.material as ShaderMaterial).uniforms.uTime!.value = t;
      interior.update(t);

      /* ---- the crossfade, from one value ------------------------------------------
         The archive going to ground colour and the interior coming up out of it are the
         same event seen from two sides. Two timelines here is how they drift apart into
         a visible seam, so there is one: `flight.k`, the tween the camera is already on.

         The archive leads. It is most of the way out by the time the interior's opaque
         cubes start drawing, which is what keeps them from ever being seen punching a
         hole through a body that is still lit. `APPEAR_IN` is imported rather than
         copied for exactly that reason - the two ends of a crossfade tuned in separate
         files stop overlapping the first time one of them is touched. */
      const inside = heldIndex !== -1 ? flight.k : 0;
      const dissolve = smoothstep(0.2, APPEAR_IN + 0.26, inside);
      vitMat.uniforms.uDissolve!.value = dissolve;
      interior.setProgress(inside);

      /* The ground goes out on the field's own curve — it is part of the field, and the
         plain the camera lands on has ground of its own. Then the mesh is skipped
         outright: a full-screen surface that is already 100% fog colour costs a quarter
         of a million triangles to draw and changes nothing. */
      ground.setDissolve(dissolve);
      ground.mesh.visible = dissolve < 0.999;

      airInner.copy(AIR_LIVE).lerp(AIR_DEAD, heldDead ? dissolve : 0);
      /* The motes go with the field. This layer is a sphere centred on the middle of the
         wide shot, and the camera now ENDS inside it - eight hundred additive points at
         close range read as fog on the lens rather than as depth, and only for the cases
         whose body happens to sit near the cloud's centre. The interior carries its own,
         placed ahead of the camera instead of around it. */
      (motes.material as ShaderMaterial).uniforms.uFade!.value = 1 - dissolve;

      // Lateral dolly with a slow push-in. Travelling ACROSS the field rather than into
      // it is what keeps the archive feeling wider than the frame.
      eye.set(
        baseCam.x + Math.sin(t * 0.045) * 9.5,
        baseCam.y + Math.sin(t * 0.035) * 0.9,
        baseCam.z + Math.sin(t * 0.021) * 4.0,
      );
      aim.set(Math.sin(t * 0.045) * 3.2, 2.0, -22);

      if (heldIndex !== -1 && flight.k > 0.001) {
        const k = flight.k;
        /* INSIDE, not in front of. The eye ends at the body's own centre, keeping a
           twentieth of the sweep's width so the shot is still alive on arrival.

           THE AIM IS WHAT CHANGED. It used to go straight out through the far wall,
           because what was in there was the far wall. It now looks DOWN and much further
           out - the eye sits `GROUND_DROP` above the interior's ground with blocks
           rising to about eye height, so the shot is across the tops of a plain rather
           than level at a surface. A lateral term on the aim as well as the eye, because
           a camera that only slides keeps a fixed heading and reads as a dolly on rails;
           turning slightly as it drifts is what makes the plain feel wider than the
           frame. */
        eye.lerp(_tmpEye.set(held.x + Math.sin(t * 0.045) * 0.45, held.y, held.z), k);

        /* AND A REFUSAL IS AIMED LEVEL, because there is no plain in there to look down
           across. The tilt above exists to spend the frame on a terrain receding to a fog
           line; pointed into the solitary composition it puts the cube at the top of the
           frame and fills the rest with empty fog. Two compositions, two headings - the
           camera cannot be neutral between a landscape and a single object. */
        aim.lerp(
          heldDead
            ? _tmpAim.set(held.x + Math.sin(t * 0.037) * 0.9, held.y + 0.1, held.z - 14)
            : _tmpAim.set(held.x + Math.sin(t * 0.031) * 1.6, held.y - 4.2, held.z - 22),
          k,
        );

        /* The wall thins as it is entered rather than on arrival. Approaching a solid
           box that turns translucent at the last moment reads as the box giving up;
           thinning the whole way in reads as the camera passing into something. Never
           to zero - at zero there is nothing to have gone inside of.

           TO A FORTIETH, from the old 0.26, and the number is small because of where the
           camera is rather than because the wall is unimportant. From inside, this box
           covers the ENTIRE viewport - so its alpha is not the opacity of an object in
           the frame, it is a tint over every pixel of the frame. At a tenth it laid a
           flat blue veil across the whole interior and lifted the empty sky above the
           plain to the same value as the plain itself, which read as haze and cost the
           scene all of its contrast. It also only did it to USABLE cases: a refused body
           draws the dark branch of the same shader, so the veil was blue for some cases
           and invisible for others.

           What is wanted at the end is a trace that says you are standing in something,
           and a trace is worth about a fortieth. The wall still does its real work on
           the way in, where it is a surface being approached rather than a filter. */
        ghostMat.uniforms.uAlpha!.value = 1 - 0.975 * k;
      }

      camera.position.copy(eye);
      camera.lookAt(aim);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      (air.material as ShaderMaterial).uniforms.uAspect!.value = w / h;
    },
    dispose() {
      gsap.killTweensOf(flight);
      box.dispose(); vitMat.dispose(); vitrines.dispose();
      ghostBox.dispose(); ghostMat.dispose(); ghost.dispose();
      interior.dispose();
      warmTarget.dispose();
      ground.dispose();
      air.geometry.dispose(); (air.material as ShaderMaterial).dispose();
      motes.geometry.dispose(); (motes.material as ShaderMaterial).dispose();
    },
  };
}
