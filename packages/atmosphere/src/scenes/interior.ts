import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  GLSL3,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from "three";
import { PALETTE } from "../core/palette.js";
import { makeMotes, mulberry32, smoothstep } from "./common.js";

/**
 * THE INSIDE OF A CASE — what the Archive's flight actually arrives in.
 *
 * The flight was already here: the camera picks the body a case is and goes INSIDE it.
 * What it used to arrive in was the inside of a box — the same panelling seen from the
 * wrong side, with the rest of the archive showing through the walls. That is a camera
 * position, not a place. A reader who has just opened a case is going to sit in this
 * shot for the length of a review, and "you are in a box" runs out in about four
 * seconds.
 *
 * SO THE BODY IS BIGGER ON THE INSIDE. Passing through the wall lands you in a plain of
 * cubes standing on open ground at wildly varying height, running out to a fog line,
 * with a few more hanging free above it. Lit caps, black flanks, one hue travelling from
 * violet in the low blocks to cyan in the tall ones. It is the same vocabulary as the
 * body you entered — a cube, lit from inside, in the dark — turned into a landscape
 * rather than a room.
 *
 * WHY THE LIGHT IS ON TOP, which is the one decision that makes this read as terrain.
 * Everything else in this package lights the whole body and lets the fresnel decide what
 * the silhouette does. Here the emission is on the CAPS and the vertical faces fall to
 * near-black, so what the eye gets is a field of lit rectangles at different heights with
 * darkness between them. That is depth read off the tops rather than off the outlines,
 * and it is why a thousand cubes stay legible where a thousand fully-lit ones would be
 * a bright smear.
 *
 * IT OCCUPIES THE FAR HALF-SPACE, and that is load-bearing rather than an art choice.
 * These cubes are opaque and write depth — they have to, or the terrain reads through
 * itself — so anything they stand in front of is gone. The camera approaches the body
 * from +Z, so the plain is laid out from the body's own plane AWAY from the camera: on
 * the way in it materialises around and behind the body being entered rather than in
 * front of it, and there is never a frame where a black cube is covering the thing you
 * are flying at.
 *
 * AND IT FADES UP FROM THE FOG COLOUR, not from black and not from nothing. The Archive
 * outside is dissolving toward `uFog` over the same stretch of the flight. Both worlds
 * are crossfading through one shared colour, so there is no moment where a hole opens in
 * the frame — the field goes to ground colour, the plain comes up out of it.
 */

/** Where the ground sits below the body's centre, which is where the camera ends up. */
const GROUND_DROP = 7.6;

/** The refused interior's light, in the interior's own space. One constant, because the
 *  cube shades itself against it and the glow is drawn at it — two copies of this number
 *  is a cube lit from somewhere the light visibly is not. */
const CORE = new Vector3(1.5, GROUND_DROP + 0.3, -17.0);

export interface Interior {
  readonly group: Group;
  /**
   * Where the flight is: 0 outside, 1 standing in it. The only input that drives what
   * this looks like — there is no second timeline here to keep in sync with the
   * camera's.
   */
  setProgress(k: number): void;
  /**
   * Refused subject. Not a hue on this composition — a DIFFERENT one: the plain stops
   * drawing and a single cube in fog takes its place. Decided before the flight starts.
   */
  setDead(dead: boolean): void;
  /**
   * Generate this case's own plain. Deterministic in `seed`, so the same case is the
   * same landscape on every visit; a no-op when the seed has not changed.
   */
  setSeed(seed: number): void;
  /** Stand it on a body's centre. */
  place(centre: Vector3): void;
  /**
   * Show every part for one off-screen render, then put the visibility back.
   *
   * Nothing in here draws until the flight is a third of the way in, so its buffers and
   * its four shader programs met the GPU for the first time in the middle of a camera
   * move — a multi-frame stall exactly where the eye is following something. The engine
   * builds an incoming scene before starting the tween for this precise reason; hidden
   * geometry is how a scene gets to skip that and pay later.
   */
  prewarm(draw: () => void): void;
  update(t: number): void;
  dispose(): void;
}

/**
 * WHERE THE INTERIOR COMES UP, and it is deliberately behind the Archive's own dissolve.
 *
 * Exported because `archive.ts` schedules the other half of the same crossfade against
 * it. These cubes are opaque and hide whatever stands behind them, so they may not draw
 * until the field they would hide has already gone to ground colour — a constant one
 * file can tune while the other silently keeps the old value is a seam waiting to open.
 */
export const APPEAR_IN = 0.36;
export const APPEAR_OUT = 0.9;

export function makeInterior(quality: number): Interior {
  const group = new Group();
  group.visible = false;

  /* Coverage is fixed and DENSITY is what gives way on a weak machine. The alternative
     — same cell size, fewer cells — shrinks the plain, and a plain that stops short of
     the fog line is a stage set with the edge showing. A coarser lattice still runs to
     the horizon. */
  const CELL = 2.5 + (1 - quality) * 1.4;
  const HALF_X = 40;
  const Z_NEAR = 8;
  const Z_FAR = -84;

  const nx = Math.floor((HALF_X * 2) / CELL) + 1;
  const nz = Math.floor((Z_NEAR - Z_FAR) / CELL) + 1;

  const dummy = new Object3D();
  /** Where `build` put the refused pair, so the bob has something to be relative to. */
  const bigBase = new Vector3();
  const smallBase = new Vector3();

  const latGeo = new BoxGeometry(1, 1, 1);
  const cubeState = new Float32Array(nx * nz * 3);
  const latMesh = new InstancedMesh(latGeo, makeLatticeMaterial(), nx * nz);
  latMesh.count = nx * nz;
  const latAttr = new InstancedBufferAttribute(cubeState, 3);
  latGeo.setAttribute("aCube", latAttr);
  latMesh.frustumCulled = false;
  group.add(latMesh);

  /**
   * THE ONES THAT ARE NOT STANDING ON ANYTHING.
   *
   * Same cube, unmoored, turning slowly at its own rate. This is the whole reason the
   * plain does not read as a city: a grid of blocks on the ground is architecture, and
   * the same blocks with a few of them hanging in the air above it is plainly not a
   * place that obeys gravity.
   *
   * Additive and depth-write off, unlike the lattice. They are suspended in the air
   * rather than standing in the scene, and something the light passes through is what
   * that looks like; it also means they can never punch a hole in the terrain behind
   * them, which is the failure mode the lattice's whole layout exists to avoid.
   *
   * Rotation and bob live in the vertex shader rather than in a per-frame loop over
   * instance matrices. Uniform scale only, so rotating in object space before the
   * instance transform cannot shear them.
   */
  /* FOUR TIMES WHAT IT WAS. Sixty cubes over a sky this wide is a handful of objects a
     reader can count, and a countable handful reads as decoration placed by someone. The
     PS2 menus this borrows from are not sparse - the air is BUSY, and the busyness is
     what makes the space feel occupied rather than staged. They are cheap: one instanced
     draw, additive, no depth write, spun in the vertex shader. */
  const FLOATERS = Math.round(190 * quality) + 50;
  const floGeo = new BoxGeometry(1, 1, 1);
  const floState = new Float32Array(FLOATERS * 3);
  const floMesh = new InstancedMesh(floGeo, makeFloaterMaterial(), FLOATERS);
  const floAttr = new InstancedBufferAttribute(floState, 3);
  floGeo.setAttribute("aFloat", floAttr);
  floMesh.frustumCulled = false;
  floMesh.renderOrder = 2;
  group.add(floMesh);

  /**
   * ONE PLAIN PER CASE, and it is the same argument the bodies outside are held to.
   *
   * A single generated interior means every case opens onto the identical landscape.
   * Six cases, six bodies, one inside - the environment would be saying "you are in a
   * case" where it could be saying "you are in THIS case", and a reader who opens two
   * of them learns in about four seconds that the place is wallpaper.
   *
   * DETERMINISTIC, from a hash of the case rather than from a counter or a clock. The
   * Archive holds itself to the rule that a body which moves between visits is scenery
   * pretending to be information, and an interior that reshuffles on every open is the
   * same failure one level down. The same case is the same plain, forever.
   *
   * Rebuilt in place: the grid dimensions do not depend on the seed, so the buffers are
   * allocated once and rewritten. It runs on `focus`, which is once per case opened -
   * not per frame - and it is guarded on the seed actually changing, because a
   * re-populate can re-resolve the same case and this is a thousand matrix writes.
   */
  let builtSeed = Number.NaN;

  function build(seed: number): void {
    if (seed === builtSeed) return;
    builtSeed = seed;
    const rnd = mulberry32(seed);

    /* The low-frequency term gets its phases from the seed too. Left as constants, every
       interior would carry the SAME broad ridges under differently-shuffled noise - the
       structure the eye actually reads at distance would be identical from case to case
       while the details changed, which is the most expensive way to look repetitive. */
    const px = 1.3 + rnd() * 6.2831;
    const pz = -0.7 + rnd() * 6.2831;

    let n = 0;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const x = -HALF_X + ix * CELL;
        const z = Z_NEAR - iz * CELL;

        /* Two terms, and the second one alone would be static. Pure per-cell randomness
           gives a field with no shape to it — every cube is as likely to be tall as its
           neighbour, and the eye finds no ridges to follow into the distance. The low
           frequency term is what puts broad rises and troughs under the noise. */
        const broad = 0.5 + 0.5 * Math.sin(x * 0.13 + px) * Math.cos(z * 0.1 + pz);
        let h = 0.55 + (0.42 * broad + 0.58 * Math.pow(rnd(), 1.5)) * 8.6;

        /* A CLEARING, because the camera stops at the origin and would otherwise be
           standing inside a block. Radial and soft rather than a rectangle cut out of the
           grid: the cubes lie down toward the middle instead of stopping, which reads as
           an opening in the field rather than as geometry that was deleted.

           It also does the job the layout above only half does. The plain runs a little
           PAST the camera's own plane, so the ground does not end in mid-air behind it -
           which means there is lattice between the camera and the body on the way in. The
           clearing is what makes that harmless: nothing within ten units of the middle is
           tall enough to reach the sight line, so what stands in front of the body being
           entered is flat pads. And it is seed-INDEPENDENT for that reason: every case's
           plain has to keep the same opening in the middle, or some of them put a wall
           where the camera is about to be. */
        h *= Math.max(0.06, smoothstep(3.6, 11.0, Math.hypot(x, z)));

        dummy.position.set(x, h / 2, z);
        dummy.scale.set(CELL * 0.92, h, CELL * 0.92);
        dummy.updateMatrix();
        latMesh.setMatrixAt(n, dummy.matrix);

        cubeState[n * 3] = Math.min(1, h / 9.15); // height, normalised — drives the hue
        cubeState[n * 3 + 1] = rnd();             // per-cube shift along the ramp
        cubeState[n * 3 + 2] = rnd();             // breath phase
        n++;
      }
    }

    for (let i = 0; i < FLOATERS; i++) {
      /* Ahead of the camera and above it, on both counts so that none of them can pass
         through the lens - a cube crossing the near plane is a glitch rather than an
         object. Uniform scale, because the vertex shader spins these in object space and
         a non-uniform scale applied after that would shear them. */
      /* Spread wider and deeper than the lattice, so they read as air the plain is
         standing in rather than as a second layer sitting on top of it. The vertical
         range starts above the tallest blocks and runs well past the top of frame - the
         ones overhead are only ever caught at the edge of the eye, which is the point of
         them.

         HELD BACK FROM THE LENS on both axes, and the reason is what these are made of.
         A floater is a rim and a thin face; at eighteen units that reads as a cube
         catching light on its edges, and at six it is a large flat angular shape with no
         volume in it - the geometry is right and the material stops selling it. The near
         limit is where the cube stops being a cube. */
      dummy.position.set(
        (rnd() - 0.5) * 96,
        11 + rnd() * 28,
        -24 - rnd() * 84,
      );
      dummy.scale.setScalar(0.7 + rnd() * rnd() * 3.2);
      dummy.updateMatrix();
      floMesh.setMatrixAt(i, dummy.matrix);

      floState[i * 3] = rnd();                    // ramp position
      floState[i * 3 + 1] = 0.05 + rnd() * 0.16;  // turn rate
      floState[i * 3 + 2] = rnd();                // bob phase
    }

    latMesh.instanceMatrix.needsUpdate = true;
    latAttr.needsUpdate = true;
    floMesh.instanceMatrix.needsUpdate = true;
    floAttr.needsUpdate = true;

    /* AND THE REFUSED ARRANGEMENT, from the same stream. The plain is per-case and this
       would not have been: both refused documents in the catalogue would have opened
       onto the identical two cubes in the identical places, which is the exact failure
       `setSeed` exists to fix, surviving in the one composition that skipped it.

       Moved rather than rebuilt. The reading is "one object in a void" and a seed that
       could turn it into three, or put it somewhere the core does not light it, would be
       varying the argument instead of the arrangement. */
    bigBase.set(-4.6 + rnd() * 2.0, GROUND_DROP + 0.4 + rnd() * 1.5, -16.8 + rnd() * 2.2);
    smallBase.set(1.8 + rnd() * 1.6, GROUND_DROP - 2.1 + rnd() * 1.4, -12.2 + rnd() * 2.2);
    bigCube.position.copy(bigBase);
    bigCube.scale.setScalar(3.1 + rnd() * 0.7);
    smallCube.position.copy(smallBase);
    smallCube.scale.setScalar(1.15 + rnd() * 0.5);
  }

  /**
   * PARTICULATE, AND WHERE IT IS PUT.
   *
   * The Archive has its own layer and it cannot serve here: it is a sphere centred on
   * the middle of the wide shot, and the camera now ENDS somewhere inside it. Eight
   * hundred additive points at four to twenty-six units is a haze in every direction,
   * and it flooded the frame in exactly the cases whose body happened to sit near the
   * cloud's centre - a wash that appeared for some cases and not others. That one goes
   * out with the rest of the Archive.
   *
   * This one sits AHEAD of the lens rather than around it, so the points are between the
   * camera and the plain and read as depth cues instead of as fog on the lens. Thin, and
   * a third of the Archive's count: there is a thousand-cube terrain doing most of that
   * job here already.
   */
  const motes = makeMotes(Math.round(260 * quality), 26, 0x51ce, {
    colorA: PALETTE.sky, colorB: PALETTE.azure, size: 1.3,
  });
  motes.position.set(0, 10, -30);
  group.add(motes);

  /**
   * WHAT A REFUSED CASE OPENS ONTO, and it is the inverse of everything above.
   *
   * It used to be this same plain in a red grade. That was wrong in the one way that
   * matters: it said a refused case is a case with the colour changed. It is not. The
   * splitter refused the document because there was nothing in it to build a case FROM -
   * and a landscape of a thousand structures, however red, is a picture of a great deal
   * having been built.
   *
   * So the plain does not draw at all. What is in there instead is fog, a hot core, and
   * ONE cube turning slowly, with a single small companion. A usable case opens onto a
   * landscape of structure; a refused one opens onto a void with an object in it. That
   * inversion is the whole argument, and it is the same thing the splitter's reason says
   * in the panel over the top of it.
   *
   * THE CUBE IS SEEN THROUGH, double-sided and part-transparent, so its far walls read
   * behind its near ones. A solid dark cube against a bright fog is a hole in the frame;
   * one you can see the inside of is an object that failed to be filled.
   */
  const solitary = new Group();
  solitary.visible = false;
  group.add(solitary);

  const solMat = makeSolitaryMaterial();
  const solGeo = new BoxGeometry(1, 1, 1);

  /* Placed in the group's own space, where the camera sits at (0, GROUND_DROP, 0)
     looking down -Z. Large body up and to the left, small one down and to the right,
     the core between and behind them - the reference's own arrangement, and it works
     because the eye finds the bright thing first and the cubes second. */
  const bigCube = new Mesh(solGeo, solMat);
  bigCube.renderOrder = 3;
  solitary.add(bigCube);

  const smallCube = new Mesh(solGeo, solMat);
  smallCube.renderOrder = 3;
  solitary.add(smallCube);

  /* The core, and it is doing two jobs. It is the light the cubes are read against, and
     because it is enormous and soft it is also the fog - the bloom chain spreads it
     across the frame, which is cheaper and more controllable than a volumetric pass and
     lands in the same place. Billboarded in view space so it is a disc from anywhere. */
  const core = new Mesh(new PlaneGeometry(1, 1), makeCoreMaterial());
  core.position.copy(CORE);
  core.frustumCulled = false;
  core.renderOrder = 1;
  solitary.add(core);

  // Something has to be in the buffers, and the cubes somewhere, before the first
  // focus lands. After the solitary meshes exist, because `build` places those too.
  build(0x5c1e);

  const latMat = latMesh.material as ShaderMaterial;
  const floMat = floMesh.material as ShaderMaterial;
  const moteMat = motes.material as ShaderMaterial;
  const coreMat = core.material as ShaderMaterial;

  return {
    group,

    setProgress(k) {
      /* By the time this term leaves zero the outside is most of the way to `uFog`,
         which is the colour this fades up FROM — so the frame shows one world coming up
         out of the other rather than a cut between them. See APPEAR_IN. */
      const appear = smoothstep(APPEAR_IN, APPEAR_OUT, k);
      group.visible = appear > 0.0005;
      latMat.uniforms.uAppear!.value = appear;
      floMat.uniforms.uAppear!.value = appear;
      moteMat.uniforms.uFade!.value = appear;
      solMat.uniforms.uAppear!.value = appear;
      coreMat.uniforms.uAppear!.value = appear;
    },

    /**
     * TWO COMPOSITIONS, not one composition with a hue swap. A refused case draws the
     * solitary cube in fog and NOTHING of the plain - no lattice, no floaters, no
     * particulate. See the note on `solitary` for why the environment has to say
     * "nothing was built here" rather than "this is red".
     */
    setDead(dead) {
      latMesh.visible = !dead;
      floMesh.visible = !dead;
      motes.visible = !dead;
      solitary.visible = dead;
    },

    setSeed: build,

    /* Everything, including the branch this case will not take. A refused case compiles
       the solitary pair and a usable one compiles the plain, so warming only what is
       about to be shown would leave half the file to stall on its first refusal. */
    prewarm(draw) {
      const was = [group, solitary, latMesh, floMesh, motes].map((o) => o.visible);
      for (const o of [group, solitary, latMesh, floMesh, motes]) o.visible = true;
      draw();
      [group, solitary, latMesh, floMesh, motes].forEach((o, i) => { o.visible = was[i]!; });
    },

    place(centre) {
      group.position.set(centre.x, centre.y - GROUND_DROP, centre.z);
    },

    update(t) {
      latMat.uniforms.uTime!.value = t;
      floMat.uniforms.uTime!.value = t;
      moteMat.uniforms.uTime!.value = t;
      solMat.uniforms.uTime!.value = t;
      coreMat.uniforms.uTime!.value = t;

      /* Turned on the CPU rather than in the shader, unlike the floaters. There are two
         of these and they are plain meshes, so a per-frame rotation is four trig calls;
         the floaters do it in the vertex shader because there are two hundred and forty
         of them sharing one instanced draw and there is nowhere on the CPU to put it. */
      bigCube.rotation.set(t * 0.048, t * 0.071, t * 0.021);
      bigCube.position.y = bigBase.y + Math.sin(t * 0.21) * 0.5;
      smallCube.rotation.set(-t * 0.089, t * 0.13, t * 0.037);
      smallCube.position.y = smallBase.y + Math.sin(t * 0.27 + 2.1) * 0.4;
    },

    dispose() {
      latGeo.dispose(); latMat.dispose(); latMesh.dispose();
      floGeo.dispose(); floMat.dispose(); floMesh.dispose();
      motes.geometry.dispose(); moteMat.dispose();
      solGeo.dispose(); solMat.dispose();
      core.geometry.dispose(); coreMat.dispose();
    },
  };
}

/**
 * The plain's palette — the house ramp, violet in the deep tones and cyan in the hot
 * ones, which is the one rule `palette.ts` asks every scene to keep. Here it is mapped
 * to HEIGHT, so the plain gets colder as it rises and the tall blocks are the bright
 * ones.
 *
 * NO RED IN IT ANY MORE. There was, when a refused case was this same plain in a red
 * grade; a refused case draws the solitary cube now and none of this, so a dead branch
 * in these two shaders is a branch that can never be taken and would sit there looking
 * like a supported mode.
 */
function ramp(): { uDeep: { value: Color }; uHot: { value: Color }; uFog: { value: Color } } {
  /* The deep end is not scaled UP. It was, and the plain came back a single flooded
     azure with no violet anywhere in it - a hot violet and a hot cyan a few hundred
     cubes deep average into one blue. Deep has to be genuinely dark for the ramp to
     read as a ramp; the hue only shows once the value is low enough to sit under the
     bloom threshold. */
  return {
    /* Violet NEAT, not lerped toward electric. Both are violets, but the red fraction is
       what survives to the screen as purple and `violet` carries nearly twice as much of
       it - a blend toward electric costs the only channel that separates this end of the
       ramp from the other one. */
    uDeep: { value: PALETTE.violet.clone().multiplyScalar(0.55) },
    uHot: { value: PALETTE.cyan.clone().multiplyScalar(0.62) },
    uFog: { value: PALETTE.abyss.clone() },
  };
}

/**
 * THE REFUSED BODY, and the palette rule it is held to.
 *
 * `palette.ts` is strict that red is only ever spent on a subject that failed, never as
 * a second accent. It holds here because of where the camera is standing: you are inside
 * the refused body, so everything in frame is the subject and none of it is decoration
 * wearing the subject's colour.
 *
 * The cube is DARK and lit from outside itself, which is the opposite of every other
 * object in this package. The landing page's cube, the Archive's bodies and the plain
 * above are all lit from within - that is what an object with something in it looks
 * like. This one has nothing in it, so it takes what the core gives it and no more.
 */
function makeSolitaryMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    /* Its own far walls have to show behind its near ones - that read is what makes it
       an object which failed to be filled rather than a hole cut in a bright fog. Which
       means no depth write, or the near faces would occlude the far ones of the same
       cube. */
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uAppear: { value: 0 },
      uDark: { value: PALETTE.stop.clone().lerp(PALETTE.abyss, 0.88) },
      uLit: { value: PALETTE.stop.clone().multiplyScalar(0.22) },
      uEdge: { value: PALETTE.stop.clone().multiplyScalar(0.55) },
      /* Where the light is, in this group's space. Passed rather than derived so the
         cube and the core cannot disagree about which way the shadows fall. */
      uCore: { value: CORE.clone() },
    },
    vertexShader: /* glsl */ `
      out vec3 vN;
      out vec3 vView;
      out vec3 vLocal;
      void main(){
        vLocal = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vN; in vec3 vView; in vec3 vLocal;
      out vec4 fragColor;
      uniform vec3 uDark, uLit, uEdge, uCore;
      uniform float uTime, uAppear;

      void main(){
        vec3 n = normalize(vN);
        vec3 v = normalize(vView);

        /* One light, at the core. Absolute value, because the material is double-sided
           and the inside of the far wall is lit by the same source as the outside of the
           near one - signed, the interior goes black and the cube reads solid again. */
        vec3 l = normalize(uCore - vLocal);
        float lit = abs(dot(n, l));

        // Grazing faces catch the fog behind them. This is the only bright thing on the
        // cube, and it is what draws the silhouette.
        float f = 1.0 - abs(dot(n, v));
        float edge = smoothstep(0.45, 1.0, f);

        vec3 col = mix(uDark, uLit, pow(lit, 2.2) * 0.70) + uEdge * edge * 0.40;

        /* Thin where it faces you and dense at the silhouette, so the walls you look
           straight through are the ones that let the far side show. */
        float a = (0.34 + edge * 0.46) * uAppear;
        fragColor = vec4(col, a);
      }
    `,
  });
}

/**
 * THE CORE — the light the cubes are read against, and the fog, in one object.
 *
 * A real volumetric pass would be the honest way to get the reference's atmosphere and
 * it is not worth a second render target here: an enormous, very soft additive disc put
 * through a bloom chain that is already running lands in the same place, and it stays a
 * single number to art-direct.
 *
 * Billboarded in view space rather than by a lookAt on the CPU, so it is a disc from
 * every angle including the ones the drift puts the camera at, and so nothing has to run
 * per frame to keep it facing.
 */
function makeCoreMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uAppear: { value: 0 },
      uSize: { value: 30 },
      uHot: { value: PALETTE.stop.clone().lerp(PALETTE.white, 0.45) },
      uOuter: { value: PALETTE.stop.clone().multiplyScalar(0.55) },
    },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      uniform float uSize;
      void main(){
        vUv = uv;
        // The mesh's own origin in view space, then expanded along the view axes.
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * uSize;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec2 vUv;
      out vec4 fragColor;
      uniform vec3 uHot, uOuter;
      uniform float uTime, uAppear;

      void main(){
        float d = length(vUv - 0.5) * 2.0;

        /* TWO falloffs summed, and the wide one is the whole reason this reads as fog
           rather than as a lamp. A single curve either gives a tight core with dead air
           around it or a flat wash with no source in it; a hard centre plus a long tail
           gives both, which is what light in a dense medium actually looks like. */
        float hot = pow(max(1.0 - d, 0.0), 5.0);
        float haze = pow(max(1.0 - d, 0.0), 1.4);

        // Slow, shallow, and never a pulse - a light that throbs is an alarm.
        float breath = 0.92 + 0.08 * sin(uTime * 0.33);

        vec3 col = uHot * hot * 0.85 + uOuter * haze * 0.16;
        float a = (hot * 0.60 + haze * 0.14) * breath * uAppear;
        fragColor = vec4(col * a, a);
      }
    `,
  });
}

function makeLatticeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    uniforms: {
      uTime: { value: 0 },
      uAppear: { value: 0 },
      ...ramp(),
    },
    vertexShader: /* glsl */ `
      in vec3 aCube;   // height (normalised), ramp shift, breath phase
      out vec3 vObj;
      out vec3 vN;
      out vec3 vCube;
      out float vDepth;
      void main(){
        vObj = position;    // -0.5 .. 0.5
        vCube = aCube;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        /* Axis-aligned box faces under an axis-aligned scale: each normal only changes
           length and the normalize puts it back, so no inverse-transpose is needed. */
        vN = normalize(mat3(instanceMatrix) * normal);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vObj; in vec3 vN; in vec3 vCube; in float vDepth;
      out vec4 fragColor;
      uniform vec3 uDeep, uHot, uFog;
      uniform float uTime, uAppear;

      void main(){
        /* THE CAP CARRIES THE LIGHT. Not a lighting model — there is no light in this
           scene — but the same result: a plain read off its lit tops with black between
           them, which stays legible at a thousand bodies where fully-lit cubes would
           merge into one bright mass. */
        float top = smoothstep(0.55, 0.90, vN.y);

        /* And a band of it spills a little way down the flanks. Without this the cap is
           a decal sitting on a black shape; with it the cube reads as something whose
           top is glowing. Excluded from the cap itself so it does not double up. Kept
           NARROW - a wide one lights the whole flank and the plain goes back to being
           solid blocks rather than lit tops with darkness between them. */
        float lip = smoothstep(0.40, 0.50, vObj.y) * (1.0 - top);

        /* HEIGHT-DOMINATED, and biased low. An even spread puts most of the plain in the
           middle of the ramp, which averages to one blue across a few hundred cubes;
           weighting height and pulling the whole distribution down leaves the cyan end
           to the tall blocks only, so the bright ones are a minority and the field they
           stand in is violet. */
        float t = clamp(vCube.x * 0.78 + vCube.y * 0.30 - 0.10, 0.0, 1.0);
        vec3 hue = mix(uDeep, uHot, t);

        // A gradient ACROSS each cap, so a top face is a surface and not a swatch.
        vec2 fl = vObj.xz + 0.5;
        float g = mix(0.70, 1.24, clamp(fl.x * 0.6 + fl.y * 0.4, 0.0, 1.0));

        // Per-cube phase. A plain breathing in unison is a pulse, and a pulse is an alarm.
        float breath = 0.93 + 0.07 * sin(uTime * 0.5 + vCube.z * 6.2831);

        vec3 col = hue * top * g * breath * 0.95;
        col += hue * lip * 0.30;
        col += hue * 0.018;    // the flanks are dark, not empty

        col = mix(col, uFog, smoothstep(26.0, 78.0, vDepth));
        /* UP OUT OF THE GROUND COLOUR. uFog is what the Archive outside is dissolving
           INTO over the same stretch of flight, so the two worlds meet at one value and
           neither ever opens a hole in the frame. */
        fragColor = vec4(mix(uFog, col, uAppear), 1.0);
      }
    `,
  });
}

function makeFloaterMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uAppear: { value: 0 },
      ...ramp(),
    },
    vertexShader: /* glsl */ `
      in vec3 aFloat;  // ramp position, turn rate, bob phase
      out vec3 vN;
      out vec3 vView;
      out vec3 vFloat;
      out float vDepth;
      uniform float uTime;

      mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
      mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }

      void main(){
        vFloat = aFloat;
        float a = uTime * aFloat.y;
        mat3 spin = rotY(a) * rotX(a * 0.63 + aFloat.z * 6.2831);

        vec4 wp = instanceMatrix * vec4(spin * position, 1.0);

        /* THEY TRAVEL, they do not only turn. A cube spinning on the spot is a display
           stand; the whole reason these are here is that the air is not still, and a
           reader watching this behind a case for twenty minutes reads "nothing is
           moving" long before they could say why.

           A slow bounded wander rather than a velocity, because a velocity needs
           wrapping and a wrap is a cube teleporting across the frame. Each one traces
           its own ellipse of a few units around where it was placed - three
           decorrelated periods so the set never returns to formation, and per-instance
           phases so they are not a shoal.

           Applied after the instance transform, in world units, so it does not pick up
           the instance's scale - a large cube would otherwise wander proportionally
           further and the field would sort itself by size. */
        float s1 = aFloat.z * 6.2831;
        float s2 = aFloat.x * 6.2831;
        float rate = 0.045 + aFloat.y * 0.35;
        wp.x += sin(uTime * rate * 0.60 + s1) * (3.0 + aFloat.x * 7.0);
        wp.y += sin(uTime * 0.24 + s1) * 1.3 + sin(uTime * rate * 0.40 + s2) * 2.2;
        wp.z += cos(uTime * rate * 0.45 + s2) * (2.5 + aFloat.z * 4.5);

        vec4 mv = modelViewMatrix * wp;
        vN = normalize(mat3(instanceMatrix) * (spin * normal));
        vView = -mv.xyz;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vN; in vec3 vView; in vec3 vFloat; in float vDepth;
      out vec4 fragColor;
      uniform vec3 uDeep, uHot;
      uniform float uTime, uAppear;

      void main(){
        float t = clamp(vFloat.x, 0.0, 1.0);
        vec3 hue = mix(uDeep, uHot, t);

        /* A CONVENTIONAL fresnel, and the only one in this file. The lattice is lit from
           its own caps because it is the ground; these are hanging in the air with
           nothing to light them from inside, so they catch the room at their edges and
           the faces stay thin. It is also what separates them from the terrain at a
           glance — edges against tops. */
        float f = 1.0 - abs(dot(normalize(vN), normalize(vView)));
        float rim = smoothstep(0.25, 1.0, f);
        /* Dimmer per cube than when there were sixty of them, and the falloff reaches
           much further. Additive brightness ACCUMULATES, so quadrupling the count at the
           old alpha would have turned the sky into a haze; the depth range had to grow
           at the same time, or the far two thirds of the new spread would simply not
           draw and the extra cubes would all pile into the near air. */
        float a = (0.06 + rim * 0.30) * uAppear * (1.0 - smoothstep(34.0, 120.0, vDepth));

        vec3 col = hue * (0.10 + rim * 0.55);
        fragColor = vec4(col * a, a);
      }
    `,
  });
}
