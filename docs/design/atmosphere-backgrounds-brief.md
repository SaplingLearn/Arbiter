# Arbiter — Atmosphere Backgrounds Brief

**Status:** draft for review. Two decisions are blocked on the reader (see [Open questions](#open-questions)).
**Scope:** the WebGL background layer only. Not the frontend, not the components, not the layout.
**Reference:** `Hubtown Limited … 2026-08-14 15-35-01.mp4` (1:55, 1920×1080@60), analysed frame by frame.

---

## 1. Why this document exists

The reference video is the whole art direction argument, and video does not survive a
handoff. This file is the durable form of it: what the reference actually does,
mechanically, and what the Arbiter equivalent should be. It is written so that someone
who has never seen the video can build from it.

Everything in §2 is observed from the recording. Everything in §4 onward is proposal.

---

## 2. The reference, decoded

### 2.1 Load sequence (0:00–0:09)

Before any 3D appears there is a deliberate, unskippable overture on flat near-black:

1. A row of ~14 small squares, left to right, filling one at a time as assets load.
   A numeric percentage sits above the right end of the row. Label beneath, mono,
   letterspaced wide: `LOADING CONTENT`.
2. At 100% the squares and label clear, leaving only the row briefly.
3. The wordmark resolves centre-screen with `100% LOADED / READY TO EXPLORE` beneath it
   in mono.
4. Only then does the 3D scene fade up underneath.

The point of this is not the loading. It is that the first 3D frame is never a
half-loaded 3D frame. The scene arrives complete, and it arrives as an event.

### 2.2 The background system

This is the single most important thing to get right, and it is the thing most likely
to be misread from a casual viewing:

> **The homepage is one continuous scroll with six named background states that
> cross-dissolve into one another. It is not six pages.**

Evidence: a fixed vertical rail sits at the left edge listing all six state names
(`FUTURE`, `INNOVATION`, `COLLABORATION`, `EXCELLENCE`, `PURPOSE`, `LEGACY`). The active
one is bright with a leading dot; the rest are dimmed to roughly 25% opacity. Scrolling
promotes the next name and demotes the last. A thin progress bar runs along the bottom
edge across the whole sequence. The top navigation never changes and never reloads.

Separately, there **are** real routed pages — Newsroom, About, Projects, Contact — and
those do a full black-out and rebuild. So the reference contains two distinct transition
mechanics, and they look and feel different. Both are described in §2.4.

The background is full-bleed, sits behind everything, and is never scrolled past — it is
fixed to the viewport while content moves over it.

### 2.3 The six states

Each is a distinct 3D scene, but they share a grammar: near-black ground, dark
low-frequency terrain silhouette, and one emissive blue element carrying all the
brightness. Nothing else in the frame glows.

| # | State | Scene | Motion |
|---|-------|-------|--------|
| 1 | **Future** | A single large translucent cube, edge-lit and internally glowing, hovering over dark water between two mountain ridges. Sharp reflection on the water. Fine particulate suspended in the air, drifting up. | Cube rotates slowly on Y. Water surface ripples continuously. Camera drifts almost imperceptibly. |
| 2 | **Innovation** | Top-down aerial of a dark canyon. A river of dense luminous particles snakes through it, brightest at its core, feathering at the banks. | The river *flows* — particles advance along the spline. The whole terrain rotates very slowly beneath the camera. |
| 3 | **Collaboration** | No terrain. Two clusters of long light ribbons sweep vertically through empty dark space, each cluster made of many parallel filaments of varying brightness. | The ribbons unfurl and coil, like a slow bloom. Individual filaments separate and rejoin. |
| 4 | **Excellence** | A dark plain at night with three translucent glowing cubes of different sizes standing on it, mid-distance. Light-trail "roads" sweep across the ground toward the horizon. | Trails run along the roads. Cubes pulse very gently. |
| 5 | **Purpose** | Camera low over dark terrain, four to six thick light-trails arcing over hills and converging toward a vanishing point. Closest to a "flying over a landscape at night" feel. | Continuous forward camera motion. Trails stream past. |
| 6 | **Legacy** | The wide reveal: a whole valley seen from above, floor covered with dozens of small glowing markers laid out on a faint road network — a city of projects. Ridges on both sides rimmed with light. | Slow pull-back and slight descent. Markers twinkle. |

The sequence has an intentional arc: **one object → a flow → abstraction → several
objects → travel → the whole territory.** It opens tight and ends wide. That arc is
doing narrative work and should be preserved in any adaptation.

### 2.4 Transition mechanics

**Scroll-driven, state to state (~1.2–1.6s).** Measured across frames at 5fps through
the Future→Innovation change:

- The outgoing scene does *not* fade to black. It is **displaced** — a horizontal
  block-glitch tears the frame into ~8 uneven vertical bands that offset and smear
  sideways, while the incoming scene is already resolving underneath.
- Through the middle of the transition both scenes are simultaneously present at
  partial opacity, with chromatic fringing (visible red/green separation at band edges).
- The outgoing headline breaks apart before the background does — text goes first,
  background follows.
- It resolves by the bands snapping back into alignment. The incoming scene is already
  in motion when it lands; it never starts from a static frame.

This reads as a *signal* transition — a channel being retuned — not a cross-fade. That
is the signature move of the whole site.

**Route change, page to page (~0.8s).** Much blunter: full fade to near-black, a beat of
nothing, then the new page builds in. Used for Newsroom, About, Projects, Contact. The
contrast is deliberate — scrolling feels continuous, navigating feels like a cut.

### 2.5 Typography and text motion

- Display: a tight, wide, heavy grotesque. All-caps for headlines, very large
  (approaching 1/5 of viewport height on the big statements), tight leading, centred on
  the scroll sections and left-aligned on the routed pages.
- Utility: monospace, uppercase, heavily letterspaced, small, low opacity. Used for
  every label, eyebrow, counter, and nav item.
- **Headlines resolve by character scramble.** Letters cycle through random glyphs and
  settle into place at staggered times — clearly visible mid-animation as
  `WELA TH I / L E` before it becomes `WE LEAD THE WAY IN DEVELOPMENT`, and
  `AD FN / RR WS NS P` before `AND DEFINE TOMORROW'S LANDSCAPE`. Subheads fade up
  normally beneath.
- Body copy under a headline is small, centred, and quiet — deliberately low contrast
  against the display type.

### 2.6 Palette

Sampled from frames, approximate:

| Role | Value | Notes |
|------|-------|-------|
| Ground | `#050A14` – `#070D18` | Near-black, always blue-shifted. Never neutral black. |
| Terrain | `#0B1626` – `#152B45` | Barely above ground. Reads as silhouette. |
| Primary emissive | `#1E88E5` – `#29B6F6` | The workhorse blue. |
| Hot core | `#7FD4FF` – `#FFFFFF` | Only at the brightest centre of a trail or cube. |
| Secondary | `#3DDC97` (sparse) | A green-cyan that appears only in later sections' trails. |

There is **no warm colour anywhere in the video.** No orange, no amber, no red. The
entire 115 seconds live in a 60° wedge of the colour wheel. That discipline is most of
why it looks expensive.

Bloom is heavy but tightly scoped: only genuinely emissive geometry blooms, and the
falloff is short. There is visible film grain and a faint vignette over everything.

### 2.7 Other details worth keeping

- Persistent bottom-left `SOUND ON/OFF` toggle — the site is scored, and it asks first.
- Persistent bottom-right chat affordance.
- A `SCROLL TO EXPLORE` hint, bottom-centre, that disappears after first scroll.
- The Projects page is a different beast entirely: a glowing vector map of Mumbai, roads
  as luminous filaments on dark ground, with a compass rose, zoom control, and a city
  switcher. It is the one screen that is a *tool* rather than a *mood*, and it proves the
  language survives contact with real UI.

---

## 3. What Arbiter actually is

From `apps/deliberation` — this is the redesign, and the five tabs are real:

| Tab | Route | Purpose |
|-----|-------|---------|
| Dashboard | `#/dashboard` | Cases you're named on, bucketed by what they need from you. Four counter tiles. |
| New case | `#/new` | Open a case for a compound: label, context, modality, panel selection, document upload. |
| Library | `#/library` | Prepared cases built from real regulatory reviews. Some marked *Refused* — unusable documents shown on purpose. |
| Ask | `#/ask` | Retrieval over library documents. A threaded conversation where every claim must cite a passage. |
| Method | `#/method` | How the product works — blind submission, hash-chained record, and an explicit list of what is *not* built. |

The product is **preclinical drug safety review**. A panel reads the same neutral
evidence, everyone writes their position blind, positions are sealed and hashed, then
revealed together. The core value is *not influencing the room before it has spoken*.

That matters for the art direction. The reference video sells ambition and scale. Arbiter
sells **restraint, sequence, and proof**. The visual language should be adapted toward
rigour, not grandeur.

---

## 4. Proposed mapping — five states

Following the reference's arc principle (tight → wide), each background is derived from
what its page is *for*:

**1. Dashboard — "The Panel"**
Suspended nodes in dark space, one per case, connected by faint lines. Nodes carrying an
action pulse slowly; settled ones are dim and still. Camera drifts. The composition
answers "what is waiting for me" before you read a word.

**2. New case — "Formation"**
Near-empty frame. A single point of light at centre, from which a lattice crystallises
outward as structure accumulates — the visual of a case being constituted from nothing.
Sparsest scene in the set, on purpose: this page is a form, and the background must stay
out of its way.

**3. Library — "The Archive"**
A deep receding grid of translucent slabs, each a prepared case, lit from within. Some
are dark and fractured — the refused documents. Slow lateral dolly past them. This is the
one scene that should feel *catalogued* rather than organic.

**4. Ask — "Retrieval"**
Closest to the reference's Innovation river. A dense particle current flows through dark
volume; when a question is asked, a bright pulse travels the current and a few particles
brighten and hold — the cited passages. The only background that reacts to app state.

**5. Method — "The Chain"**
A single luminous chain of linked blocks receding into the dark, each link sealed and
unbreakable. Slowest, most static, most formal scene in the set. This page explains what
the record proves; the background should feel like evidence, not atmosphere.

Transition between tabs uses the reference's **block-glitch displacement** (§2.4), not a
cross-fade — it is the signature move and it is what makes the set feel like one system.

---

## 5. Two constraints from the existing codebase

These are real and they are not negotiable without a decision from you.

**5.1 The current design system is light, not dark.**
`apps/deliberation/src/app.css` defines BLUEPRINT explicitly: `--app: #F2F2EF`,
`--paper: #FFFFFF`, `--ink: #0E0E0E`, accent `#2B2BF0`. Its own header comment states:
*"Swiss-minimal, flat, precise. No shadows, no gradients, no rounded cards, no decorative
colour, one electric blue."*

A near-black volumetric glowing background is the direct opposite of that on every axis.
These two cannot both be in force. Either the app chrome moves dark alongside the
backgrounds, or the backgrounds are heavily restrained to sit behind light UI. This is
the single biggest open decision and it changes everything downstream.

**5.2 Red and green are reserved.**
BLUEPRINT deliberately spends no colour on decoration because red (`--stop: #E5484D`) and
green (`--go: #1CA64C`) carry verdict semantics — stop/advance on a drug safety call.
The comment is explicit that the accent "never competes with them."

The reference video uses a green-cyan (`#3DDC97`) in its later trails. **Arbiter's
backgrounds should drop that entirely** and stay in the blue/cyan wedge only. A glowing
green background element on a page where green means "safe to advance" is a genuine
misread risk, not a stylistic quibble.

---

## 6. Technical approach

- **Three.js**, one persistent `WebGLRenderer` and one canvas for the lifetime of the
  session. Scenes are swapped, the context never is.
- **One module per state**, each exposing `mount()` / `update(dt)` / `dispose()` and a
  `progress` uniform. The controller owns which is active; a scene knows nothing about
  routing.
- **Transitions render both scenes to render targets** and composite through a
  displacement shader driven by a single 0→1 uniform. GSAP owns that uniform's timeline
  and nothing else. This is what makes the block-glitch possible — a cross-fade would not
  need the targets.
- **Post chain:** selective bloom (emissive only), film grain, vignette. In that order.
- **Budget:** 60fps at 1080p on integrated graphics. Particle counts driven by a quality
  tier detected at boot.
- **`prefers-reduced-motion` is mandatory** — this is a regulated-industry tool. Reduced
  motion gets a static gradient per route and instant swaps. Not an afterthought;
  designed in from the first commit.
- Backgrounds mount behind the existing app with `pointer-events: none` and must be
  removable in one line. They cannot become load-bearing for the product.

---

## Open questions

1. **Dark or light?** (§5.1) Does the app chrome go dark to meet these backgrounds, or do
   the backgrounds stay subdued behind the existing light BLUEPRINT? Everything else
   depends on this answer.
2. **The brand guide.** Not in the repo, not yet provided. The palette in §2.6 is sampled
   from the video. If the intended blues differ, they need to land before shader work
   starts — retuning emissive colour across five scenes afterward is expensive.
