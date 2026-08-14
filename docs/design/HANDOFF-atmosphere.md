# Handoff — Atmosphere backgrounds

**From:** pairing session, 2026-08-14
**To:** Jose
**Branch:** `feat/atmosphere-backgrounds`

Read this first, then `atmosphere-backgrounds-brief.md` for the frame-by-frame
analysis of the reference video.

---

## ⚠️ Status: written, never rendered

**Not one line of this has been seen running.** The dev server starts and serves 200,
but the session ended before a single frame was captured. Treat every visual claim in
the code comments as intent, not as observed fact.

What is known to be true:
- It compiles as far as Vite's transform step (the server starts and serves the module
  graph without erroring).
- Nothing has type-checked. `apps/atmosphere` is **not** in the root `typecheck`
  script — that was deliberate for speed, and it should be added.
- No screenshot, no FPS number, no shader-compile confirmation.

**First thing to do:** run it and look at it.

```bash
npx vite --config apps/atmosphere/vite.config.ts
# then open http://127.0.0.1:5180/  (NOT localhost — see "Gotchas")

# or capture stills + an FPS probe:
node apps/atmosphere/shot.mjs apps/atmosphere/shots
```

Expect shader compile errors on first run. Several fragment shaders were written
straight through without a compile cycle, and the GLSL3 `in`/`out` conventions are easy
to get subtly wrong against three's injected prefix.

---

## What this is

Five WebGL background environments for the Arbiter redesign's five tabs, plus a
transition system, plus a thin demo shell to show them off. **Backgrounds only — this
is explicitly not a frontend.**

The brief was: take the *look and motion* from a Hubtown Limited site recording, the
*subject matter* from sci-fi biology, and the *palette* from Pfizer's brand.

## The five scenes

| Tab | Scene | File | Concept |
|-----|-------|------|---------|
| Dashboard | Culture | `scenes/culture.ts` | Bioluminescent cell colonies over a dark field, joined by filaments. A minority pulse — those are the cases waiting on you. |
| New case | Genesis | `scenes/genesis.ts` | One luminous nucleus, a crystalline lattice nucleating outward from it. The only scene that starts from nothing. |
| Library | Archive | `scenes/archive.ts` | Ranks of specimen vitrines receding into dark. ~26% are dead and fractured — the library shows its refusals on purpose. |
| Ask | Synapse | `scenes/synapse.ts` | Branching vascular network, aerial view. Pulses travel the branches and light nodes as they pass — retrieval, depicted literally. |
| Method | Helix | `scenes/helix.ts` | A double helix with a seal travelling up it. Behind the seal, rungs are locked. Slowest, most formal scene. |

Each scene's header comment explains *why that image for that page* and *which Hubtown
shot its camera move came from*. That reasoning is the valuable part — if a scene gets
replaced, keep the argument.

## Palette — the one rule that matters

`src/core/palette.ts`. Values are Pfizer's, read off the palette card in their brand
film (`#00004E`, `#000484`, `#22009B`, `#2B00C2`, `#0077CC`, `#0095FF`) and corroborated
against the slideshow deck.

> **Deep tones go violet. Emissive goes cyan. Never the reverse.**

`#22009B` and `#2B00C2` contain zero green. That violet-deep/cyan-hot ramp is the whole
reason this shouldn't look like every other generated sci-fi background, which are all
cyan-to-teal. If you let the violets emit, it drifts purple and stops reading as the
reference. Everything colour lives in that one file — retheming is a one-file change.

## Architecture

- `core/Atmosphere.ts` — one `WebGLRenderer` for the session's life. Scenes are built
  and destroyed; the context never is.
- Pipeline: active scene → `rtC` → bright pass → 3-level blur chain → final composite
  (ACES tonemap, grain, vignette, sRGB encode) → screen.
- **Transitions render both scenes to separate targets**, then composite through a
  displacement shader (`TRANSITION_FRAG`). This is why it isn't a cross-fade — the
  signature move is a horizontal block-glitch that tears the frame into ~9 uneven bands
  with chromatic fringing at the edges, lifted from the reference. GSAP owns the single
  0→1 progress uniform and nothing else.
- Scenes implement `AtmosphereScene` (`core/types.ts`): `update` / `resize` / `dispose`.
  A scene knows nothing about routing or about the other scenes. Keep that boundary.
- `prefers-reduced-motion` short-circuits transitions to instant swaps.

## Gotchas already hit

- **Use `127.0.0.1`, not `localhost`.** Vite was binding `::1` only; Playwright and
  Chrome resolve IPv4 first, so it looked like a dead server while `curl localhost`
  returned 200. `vite.config.ts` now pins `host: "127.0.0.1"`.
- **ffmpeg 9.x dropped `-vsync`.** The `/watch` skill's frame extractor fails on it;
  use `-fps_mode passthrough`.
- The Claude-in-Chrome extension has no permission for localhost, hence the Playwright
  harness (`shot.mjs`) instead.

## Open items

1. **Verify it renders.** Above all else.
2. **Add `apps/atmosphere` to the root `typecheck` script.**
3. Scene-to-scene tuning has never been done. Bloom threshold (`0.42`), strength
   (`1.15`), grain (`0.028`) and vignette (`1.05`) are all first guesses in
   `Atmosphere.ts`.
4. Particle counts scale off a crude `probeQuality()` (core count + UA sniff). Needs a
   real check on a low-end machine.
5. The demo shell (`main.ts`, `shell.css`) is stagecraft, not product. If these get
   wired into `apps/deliberation`, only `core/` and `scenes/` should travel.

## Context worth knowing

- The reference video is a screen recording of hubtown.co.in, at
  `~/Videos/Captures/Hubtown Limited … 15-35-01.mp4`. It is **one scrolling page with
  six cross-dissolving background states**, plus separate routed pages — not five pages.
  Our five-state click-driven model is an adaptation, not a copy of its structure.
- The existing `apps/deliberation` design system ("BLUEPRINT") is **light** — near-white
  surfaces, one electric blue, explicitly no gradients or shadows. These backgrounds are
  its opposite. That collision was raised and the call was made to proceed with the
  ground-up dark redesign and ignore BLUEPRINT. Worth knowing before anyone tries to
  merge the two.
- BLUEPRINT also reserves red and green for verdict semantics (stop/advance on a safety
  call). These scenes stay entirely in the blue/violet wedge, which sidesteps that.
