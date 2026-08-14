import gsap from "gsap";
import { Atmosphere } from "./core/Atmosphere.js";
import { STATES } from "./scenes/registry.js";

/**
 * DEMO SHELL.
 *
 * Drives the Atmosphere and provides just enough chrome to prove the backgrounds can
 * carry type and UI. Everything here is stagecraft; none of it is the product.
 *
 * NAVIGATION, as agreed: the reference's model. Scroll moves through the states in
 * order, the rail and the tab strip jump directly, and both routes fire the same
 * transition. Wheel events are consumed rather than scrolling a document, because the
 * states are not a document — they are a sequence, and a half-scrolled state is not a
 * thing that should be able to exist.
 */

const canvas = document.getElementById("atmosphere") as HTMLCanvasElement;
const shell = document.getElementById("shell") as HTMLDivElement;

const atmo = new Atmosphere(canvas);
for (const s of STATES) atmo.register(s.id, s.factory);

let index = 0;
let locked = true; // released by the overture

// --------------------------------------------------------------------- markup
shell.innerHTML = `
  <div class="topbar">
    <div class="brand">
      <span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span>Arbiter</span>
    </div>
    <nav class="tabs" id="tabs" aria-label="Sections"></nav>
    <div class="mono" style="color:var(--mist)">Preclinical safety review</div>
  </div>

  <nav class="rail" id="rail" aria-label="Environments"></nav>

  <div class="stage">
    <h1 class="headline" id="headline"></h1>
    <p class="lede mono" id="lede" style="letter-spacing:.06em;text-transform:none;font-family:'Inter Tight',sans-serif;font-size:13.5px"></p>
  </div>

  <div class="corner left mono"><span id="quality"></span></div>
  <div class="corner right mono"><span id="counter"></span></div>
  <div class="hint mono" id="hint"><i></i><span>Scroll to explore</span></div>
  <div class="progress"><i id="bar"></i></div>
`;

const railEl = document.getElementById("rail") as HTMLElement;
const tabsEl = document.getElementById("tabs") as HTMLElement;
const headlineEl = document.getElementById("headline") as HTMLElement;
const ledeEl = document.getElementById("lede") as HTMLElement;
const barEl = document.getElementById("bar") as HTMLElement;
const counterEl = document.getElementById("counter") as HTMLElement;
const hintEl = document.getElementById("hint") as HTMLElement;

railEl.innerHTML = STATES.map((s, i) => `
  <button class="rail-item" data-i="${i}">
    <span class="mono">${s.label}</span>
    <span class="rail-code mono">${s.codename}</span>
  </button>
`).join("");

tabsEl.innerHTML = STATES.map((s, i) => `
  <button class="tab mono" data-i="${i}">${s.label}</button>
`).join("");

(document.getElementById("quality") as HTMLElement).textContent =
  `GPU tier ${Math.round(atmo.quality * 100)}%`;

// ------------------------------------------------------------------ headline
/**
 * Character-scramble resolve, as in the reference: letters cycle through random
 * glyphs and settle at staggered times.
 *
 * The glyph pool is deliberately restricted to shapes that share the display face's
 * width class. A pool containing `i` and `M` makes the line jitter horizontally while
 * it resolves, which reads as broken rather than as decoding.
 */
const POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/\\<>";

function setHeadline(lines: [string, string]): void {
  headlineEl.innerHTML = lines.map((line) => `
    <span class="line">${[...line].map((c) =>
      c === " " ? `<span class="ch">&nbsp;</span>` : `<span class="ch">${c}</span>`,
    ).join("")}</span>
  `).join("");

  const chars = [...headlineEl.querySelectorAll<HTMLElement>(".ch")];

  chars.forEach((el, i) => {
    const final = el.textContent ?? "";
    if (final.trim() === "") return;

    // Rise + scramble together. The rise is what gives it weight; the scramble alone
    // reads as a gimmick.
    gsap.fromTo(el,
      { yPercent: 105, opacity: 0 },
      {
        yPercent: 0, opacity: 1,
        duration: 0.85,
        ease: "power3.out",
        delay: 0.16 + i * 0.014,
      },
    );

    if (atmo.reducedMotion) return;

    const state = { n: 0 };
    gsap.to(state, {
      n: 1,
      duration: 0.42 + Math.random() * 0.35,
      delay: 0.16 + i * 0.014,
      ease: "none",
      onUpdate: () => {
        el.textContent = state.n < 1
          ? POOL[Math.floor(Math.random() * POOL.length)]!
          : final;
      },
      onComplete: () => { el.textContent = final; },
    });
  });
}

// ------------------------------------------------------------------ activate
function activate(next: number, initial = false): void {
  if (next === index && !initial) return;
  if (atmo.isTransitioning) return;

  index = (next + STATES.length) % STATES.length;
  const state = STATES[index]!;

  for (const el of railEl.querySelectorAll(".rail-item")) {
    el.classList.toggle("active", Number((el as HTMLElement).dataset.i) === index);
  }
  for (const el of tabsEl.querySelectorAll(".tab")) {
    el.classList.toggle("active", Number((el as HTMLElement).dataset.i) === index);
  }

  barEl.style.width = `${((index + 1) / STATES.length) * 100}%`;
  counterEl.textContent = `${String(index + 1).padStart(2, "0")} / ${String(STATES.length).padStart(2, "0")}`;

  // The lede drops out fast and returns slow — text should never still be leaving
  // while the next headline is arriving.
  ledeEl.classList.remove("in");
  window.setTimeout(() => {
    ledeEl.textContent = state.lede;
    ledeEl.classList.add("in");
  }, initial ? 420 : 520);

  setHeadline(state.headline);

  if (initial) atmo.mount(state.id);
  else atmo.transitionTo(state.id);
}

// ------------------------------------------------------------------- input
let wheelLock = 0;
window.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (locked) return;
  const now = performance.now();
  // A trackpad emits a long tail of small deltas after a flick; without a cooldown a
  // single gesture would skip three states.
  if (now - wheelLock < 900) return;
  if (Math.abs(e.deltaY) < 12) return;
  wheelLock = now;
  activate(index + (e.deltaY > 0 ? 1 : -1));
  hintEl.style.opacity = "0";
}, { passive: false });

window.addEventListener("keydown", (e) => {
  if (locked) return;
  if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "PageDown") activate(index + 1);
  if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp") activate(index - 1);
  const n = Number(e.key);
  if (n >= 1 && n <= STATES.length) activate(n - 1);
});

let touchY = 0;
window.addEventListener("touchstart", (e) => { touchY = e.touches[0]?.clientY ?? 0; }, { passive: true });
window.addEventListener("touchend", (e) => {
  if (locked) return;
  const dy = touchY - (e.changedTouches[0]?.clientY ?? touchY);
  if (Math.abs(dy) < 48) return;
  activate(index + (dy > 0 ? 1 : -1));
  hintEl.style.opacity = "0";
}, { passive: true });

for (const el of [...railEl.querySelectorAll(".rail-item"), ...tabsEl.querySelectorAll(".tab")]) {
  el.addEventListener("click", () => {
    if (locked) return;
    activate(Number((el as HTMLElement).dataset.i));
    hintEl.style.opacity = "0";
  });
}

window.addEventListener("resize", () => atmo.resize(window.innerWidth, window.innerHeight));

// ----------------------------------------------------------------- overture
/**
 * The load sequence, from the reference: a row of cells filling to a percentage, then
 * the wordmark, then the scene fades up UNDERNEATH — already running and warm.
 *
 * The scene is mounted and the render loop started before the overture finishes, so
 * the first visible frame is a frame of a scene in motion. Mounting after the fade
 * would show a static first frame, which is exactly the thing the overture exists to
 * prevent.
 */
function overture(): void {
  const ov = document.createElement("div");
  ov.id = "overture";
  ov.innerHTML = `
    <div class="ov-inner">
      <div class="ov-bar" id="ovbar">${"<i></i>".repeat(16)}</div>
      <div class="ov-meta mono" style="width:100%">
        <span>Loading environment</span><b id="ovpct">0%</b>
      </div>
      <div class="ov-mark" id="ovmark">Arbiter</div>
      <div class="ov-sub mono" id="ovsub">Ready to explore</div>
    </div>
  `;
  document.body.appendChild(ov);

  const cellEls = [...ov.querySelectorAll<HTMLElement>("#ovbar i")];
  const pct = ov.querySelector("#ovpct") as HTMLElement;
  const mark = ov.querySelector("#ovmark") as HTMLElement;
  const sub = ov.querySelector("#ovsub") as HTMLElement;

  activate(0, true);
  atmo.start();

  const p = { v: 0 };
  gsap.to(p, {
    v: 1,
    duration: atmo.reducedMotion ? 0.3 : 2.1,
    ease: "power1.inOut",
    onUpdate: () => {
      const n = Math.floor(p.v * cellEls.length);
      cellEls.forEach((c, i) => c.classList.toggle("on", i < n));
      pct.textContent = `${Math.round(p.v * 100)}%`;
    },
    onComplete: () => {
      mark.classList.add("in");
      sub.classList.add("in");
      atmo.reveal(1.5);
      window.setTimeout(() => {
        ov.classList.add("done");
        locked = false;
        // Re-run the headline so its arrival is seen, not spent behind the overture.
        setHeadline(STATES[0]!.headline);
        ledeEl.classList.add("in");
      }, atmo.reducedMotion ? 100 : 900);
    },
  });
}

atmo.resize(window.innerWidth, window.innerHeight);
overture();

// Handy for tuning from the console.
(window as unknown as { atmo: Atmosphere }).atmo = atmo;
