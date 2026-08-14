# Inventory: apps/landing (the marketing site)

Written 2026-08-13. Every line number in this document was produced by opening the file
and reading it. Every absence claim names the search terms that produced zero matches.

`apps/landing` has never been inventoried before this document. It is not mentioned in
`README.md`, not mentioned in `HANDOVER.md`, and does not appear in either document's repo
map (verified: `grep -n "apps/landing\|landing page\|landing/" HANDOVER.md README.md`
returns zero lines). It is the only surface in the repo with no prose describing it
anywhere outside its own source comments.

---

## 0. Executive orientation

| | |
|---|---|
| **What it is** | Vite + React 18 marketing site, one hash-free single-page document, twelve section components, eleven numbered sections |
| **Package** | `@arbiter/landing`, `apps/landing/package.json:2` |
| **Deps** | `react ^18.3.1`, `react-dom ^18.3.1`, `three ^0.185.1` (`apps/landing/package.json:11-15`) |
| **Entry** | `apps/landing/index.html` -> `src/main.tsx:5` -> `src/Landing.tsx:51` |
| **Also** | The unified dev entry. `npm run dev` fronts every other surface behind this app's Vite server |
| **Source size** | 3,611 lines across 21 source files, of which `src/landing.css` is 2,435 |
| **Test file** | one, `apps/landing/test/landing.test.tsx`, 396 lines, 25 cases |
| **Test status** | **CURRENTLY RED. 1 failed, 24 passed.** See section 10.2 |
| **Lint** | clean (`npx eslint apps/landing --ext .ts,.tsx` exits 0) |
| **Typecheck** | clean (`npx tsc -p apps/landing --noEmit` exits 0) |
| **CI** | `npm test` runs its tests, but **`npm run landing:build` is never run in CI** (`.github/workflows/ci.yml` builds only `web:build`) |
| **Renders the retired 0.750** | **Yes, in four places.** See section 6.1 |

---

## 1. File census

| Path | Lines | What it is |
|---|---|---|
| `apps/landing/index.html` | 29 | Document shell. Title, description, two Google Fonts preconnects, one stylesheet link |
| `apps/landing/package.json` | 16 | Workspace manifest |
| `apps/landing/tsconfig.json` | 13 | Extends `tsconfig.base.json`, `jsx: react-jsx`, `types: ["vite/client"]` |
| `apps/landing/vite.config.ts` | 42 | Dev server port 5175 + the unified-dev proxy table |
| `apps/landing/.env.development` | 13 | `VITE_APP_URL="/app/#/case"` |
| `apps/landing/src/main.tsx` | 9 | `createRoot(...).render(<StrictMode><Landing/></StrictMode>)` |
| `apps/landing/src/Landing.tsx` | 102 | Composition root, `DEFAULT_ACCENT`, four props |
| `apps/landing/src/links.ts` | 40 | Every off-page destination |
| `apps/landing/src/landing.css` | 2,435 | The whole BLUEPRINT design system |
| `apps/landing/src/motion/reducedMotion.ts` | 16 | `prefersReducedMotion()` |
| `apps/landing/src/motion/useReveals.ts` | 152 | Scroll reveals, tick fades, stat count-ups, `formatCount` |
| `apps/landing/src/motion/useDitherField.ts` | 130 | Seeded canvas bitmap dither behind the hero figure |
| `apps/landing/src/ui/primitives.tsx` | 199 | `Tick`, `TopTicks`, `Hatch`, `Counter`, `Eyebrow`, `Cta`, `Marquee`, `Mark`, `Stat` |
| `apps/landing/src/ui/GooglyEyes.tsx` | 233 | Cursor-tracking SVG eyes, transcribed from a Framer component |
| `apps/landing/src/ui/InteractiveGrid.tsx` | 270 | Three.js shader dot grid, transcribed from a Framer component |
| `apps/landing/src/sections/OpeningScene.tsx` | 255 | Full-screen loader overlay |
| `apps/landing/src/sections/Header.tsx` | 105 | Sticky header, nav rail, hamburger panel |
| `apps/landing/src/sections/Hero.tsx` | 202 | Wordmark, eyes, two CTAs, app mockup |
| `apps/landing/src/sections/Standards.tsx` | 54 | Marquee of eight evidence bodies |
| `apps/landing/src/sections/Metrics.tsx` | 92 | Four headline numbers |
| `apps/landing/src/sections/Features.tsx` | 236 | Six feature cells with interface vignettes |
| `apps/landing/src/sections/Capabilities.tsx` | 85 | Six CAP.0n cells, prints the ruleset hash |
| `apps/landing/src/sections/CaseView.tsx` | 124 | Two worked cases side by side |
| `apps/landing/src/sections/HowItWorks.tsx` | 149 | Five steps + the six-rule table |
| `apps/landing/src/sections/Result.tsx` | 93 | Baseline comparison table + three findings |
| `apps/landing/src/sections/UseCases.tsx` | 263 | Three personas + the comparison grid |
| `apps/landing/src/sections/RecordSpeaks.tsx` | 135 | Two marquees of engine-output "quotes" |
| `apps/landing/src/sections/Faq.tsx` | 89 | Eight `<details>` in two columns |
| `apps/landing/src/sections/GetStarted.tsx` | 38 | Closing CTA |
| `apps/landing/src/sections/Footer.tsx` | 102 | Four columns + colophon |
| `apps/landing/test/landing.test.tsx` | 396 | The only test file |
| `apps/landing/dist/**` | (built) | Stale local build dated Aug 10. `dist/` is gitignored (`.gitignore:79`) |

There is **no `public/` directory** in `apps/landing` or in any other app (verified:
`ls apps/*/public` returns no matches).

---

## 2. Page composition

`src/Landing.tsx:60-101` is the entire page. In render order:

```
OpeningScene            (conditional, props.opening, default true)
Header
Hatch id="top" short    <- the #top anchor lives on the hatch band, not on the header
main
  Hero
  Standards
  Hatch
  Metrics               [ 01 of 11 ]
  Hatch
  Features              [ 02 of 11 ]
  Hatch
  Capabilities          [ 03 of 11 ]   id="method"
  Hatch
  CaseView              [ 04 of 11 ]   id="product"
  Hatch
  HowItWorks            [ 05 of 11 ]   id="ruleset" (on an inner div, HowItWorks.tsx:105)
  Hatch
  Result                [ 06 of 11 ]   id="result"
  Hatch
  UseCases              [ 07 of 11 ] and [ 08 of 11 ]  (two counters, one section)
  Hatch
  RecordSpeaks          [ 09 of 11 ]
  Hatch
  Faq                   [ 10 of 11 ]
  Hatch
  GetStarted            [ 11 of 11 ]   id="record"
  Hatch
Footer
```

### 2.1 The `LandingProps` contract (`Landing.tsx:24-40`)

| Prop | Default | Effect |
|---|---|---|
| `accent` | `DEFAULT_ACCENT = "#2B2BF0"` (`Landing.tsx:22`) | Set as the inline custom property `--blue` on `.landing` (`Landing.tsx:61`) |
| `dither` | `true` | Mounts the hero's `<canvas className="hero-dither">` (`Hero.tsx:122`) |
| `reveals` | `true` | Passed to `useReveals(rootRef, reveals)` (`Landing.tsx:58`) |
| `opening` | `true` | Mounts `<OpeningScene/>` (`Landing.tsx:65`) |

`main.tsx:7` renders `<Landing />` with no props, so production gets all four defaults.
Only the test suite ever passes props.

### 2.2 Counter arithmetic

`Counter` (`primitives.tsx:60-76`) defaults `of = 11` and every call site takes the
default. There are exactly eleven `<Counter>` calls, so the derived-total test at
`landing.test.tsx:141-153` passes. Note that `Landing.tsx`'s own doc comment at line 45
says "Twelve numbered sections", which counts section *components* (Hero and Standards are
unnumbered, UseCases carries two numbers), not counters. Cosmetic discrepancy in a comment
only.

### 2.3 Landmarks and headings

Verified by `grep -rniE "<form|<input|<button|<main|<footer|<header|<nav|role=" src`:

- `<header>` at `Header.tsx:47`, `<main>` at `Landing.tsx:73`, `<footer>` at `Footer.tsx:45`.
- Two `<nav>` elements: `aria-label="Sections"` (`Header.tsx:55`) and
  `aria-label="Sections menu"` (`Header.tsx:94`).
- Exactly **one** `<button>` on the entire page: the hamburger toggle (`Header.tsx:76`).
- **No forms, no inputs, no email capture, no contact affordance of any kind.**
- **No skip link.** Searched `skip.to`, `skip-link`, `skipnav`: zero matches.
- One `<h1>`: `Hero.tsx:88`, text "Arbiter". `h2` per section; the footer uses `h2` for its
  three column labels (`Footer.tsx:62,73,84`).

---

## 3. Section-by-section inventory

### 3.1 `OpeningScene.tsx` (255 lines)

A full-screen overlay: the four-square mark, the word "Arbiter", a counter running 000 to
100, a progress bar, then a wipe. It is **not** a Framer import. `OpeningScene.tsx:8-22`
records the measurement that the requested Framer module
(`framer.com/m/Animation-loader-eHagKV.js`) imports `ComponentViewportProvider`,
`SmartComponentScopedContainer` and `useComponentViewport`, none of which the public
`framer` npm package exports.

Constants (`OpeningScene.tsx:46-50`): `DURATION_MS = 3000`, `EASE = [0.12, 0.23, 0.5, 1]`,
`EXIT_MS = 620`, `SESSION_KEY = "arbiter.openingScene.played"`.

Play precedence, implemented at `OpeningScene.tsx:125-131`:

| Condition | Result |
|---|---|
| `?intro=0` or `?intro=false` | never plays |
| `prefers-reduced-motion: reduce` | never plays (beats `?intro=1` on purpose) |
| `?intro=1` | always plays |
| `import.meta.env.MODE === "development"` | always plays (`ALWAYS_REPLAY`, line 106) |
| otherwise | once per session, gated on `sessionStorage` |

`MODE` and not `DEV` at line 106, because vitest also sets `DEV`. Three hardening details
worth naming for anyone touching it: `plays` is a ref (line 153) so StrictMode's
double-invoke cannot freeze the overlay at 000; a `setTimeout` backstop at line 168 fires at
`duration + 1000` because `requestAnimationFrame` is paused in a background tab; and
`document.body.style.overflow` is saved and restored rather than set to `"auto"` (lines
208-215).

The overlay is `aria-hidden="true"` (line 225) with the whole page rendered underneath it.

Rendered strings: `"Arbiter"` (line 234), `"Adjudicates Conflicting Evidence"` (line 242),
the zero-padded counter (line 243), `"Click or press any key to skip"` (line 250).

### 3.2 `Header.tsx` (105 lines)

`NAV_LINKS` (`Header.tsx:19-29`), six entries:

| Label | href | Target |
|---|---|---|
| Method | `#method` | Capabilities section (`Capabilities.tsx:59`) |
| Case View | `#product` | CaseView section (`CaseView.tsx:54`) |
| Ruleset | `#ruleset` | the ruleset-table label div (`HowItWorks.tsx:105`) |
| Result | `#result` | Result section (`Result.tsx:46`) |
| Record | `#record` | **GetStarted section** (`GetStarted.tsx:14`) |
| Deliberation | `DELIBERATION_URL` = `/deliberation/` | the deliberation client, a different app |

Plus the wordmark at `Header.tsx:50` linking to `#top`, and one `<Cta href={APP_URL}
variant="primary" compact>Open The App</Cta>` at `Header.tsx:68`.

Two behaviours: Escape closes the panel (`Header.tsx:37-44`); the hamburger renders a second
copy of the same `NAV_LINKS` list (`Header.tsx:93-101`). The comment at `Header.tsx:71-75`
records that the design source drew the hamburger and wired nothing to it.

**Naming mismatch worth flagging:** the nav item labelled "Record" lands on the section
titled "Get Started" (headline "The Committee Decides. ARBITER Shows Its Work."). The
section actually about the record, `RecordSpeaks` [ 09 of 11 ], carries **no id at all** and
cannot be linked.

### 3.3 `Hero.tsx` (202 lines)

Renders, in order: the Three.js `InteractiveGrid` as a full-bleed ground (lazily imported at
`Hero.tsx:13-15`, suppressed entirely under reduced motion at `Hero.tsx:51`), `TopTicks`, the
`<h1>Arbiter</h1>` plus `GooglyEyes`, two CTAs, and a large aria-hidden div-drawn mockup of
the product app.

Grid props passed at `Hero.tsx:64-74`: `dotColor="#2B2BF0"`, `lineColor="#C9C9C4"`,
`dotSize={2}`, `lineOpacity={0.5}`, `gridSize={3000}`, `density={80}`, `radius={260}`,
`strength={90}`, `interactionStyle="Lens"`.

Eyes props at `Hero.tsx:90-102`: `eyeRadius={120}`, `pupilRadius={46}`, `gap={270}`
(centre-to-centre, so anything under 240 would overlap the sclerae).

CTAs: `Read The Method` -> `HANDOVER_URL` (`Hero.tsx:107`), `Open The Record` -> `REPO_URL`
(`Hero.tsx:110`).

`SIDE_NAV` (`Hero.tsx:35`) is `["Case", "Compounds", "Ruleset", "Validation", "Record",
"About"]` with `Intake` shown separately under "Others" (`Hero.tsx:145-148`). That is exactly
the seven real tabs in `apps/web/src/App.tsx:49-57` (`about, compounds, case, ruleset,
validation, record, intake`). **Correct.**

`ROWS` (`Hero.tsx:26-33`) is the six-row mock table. See section 6.3: the comment above it
claims these are real run numbers and three of the six are not.

### 3.4 `Standards.tsx` (54 lines)

A `Marquee` of eight names, each in a different typographic treatment
(`Standards.tsx:11-20`): ICH M3(R2), OECD AOP, Klimisch 1997, Tox21, DILIrank, AOP-Wiki,
OECD QSAR, FDA Roadmap. The label reads "Grounded in **8+** evidence standards /
peer-reviewed & regulatory" (`Standards.tsx:36-39`).

The comment at `Standards.tsx:4-10` is explicit that this is not a logo wall and that there
are no customers to display.

### 3.5 `Metrics.tsx` (92 lines), [ 01 of 11 ]

Four `Stat` cells driven by `METRICS` (`Metrics.tsx:19-52`):

| Value | Suffix | Label | Note (verbatim) | Source line |
|---|---|---|---|---|
| `97.4` | `%` | Compounds Abstained | "260 of 267 declined; 254 could not commit at any evidence values." | 20-24 |
| `0.75` | | Balanced Accuracy | "On the conflict subset (n=61). It ties a single stream, exactly." | 27-31 |
| `7` | `/267` | Positions Committed | "Seven across the whole split. Four of them fall in the conflict subset, each resting on a transporter claim." | 38-42 |
| `0.992` | | Planner Robustness | "Recommendation held under +/-50% perturbation of every prior." | 45-50 |

Lede at `Metrics.tsx:69-70`: "Measured on the test split only, 267 compounds scored, 61 in
the pre-registered conflict subset. Read the reason, not the headline."

The comment at `Metrics.tsx:34-37` records a fixed bug: the page previously said "4/267",
mixing metric1's numerator with metric4's denominator.

### 3.6 `Features.tsx` (236 lines), [ 02 of 11 ]

Six cells, each with a hand-drawn vignette instead of an icon.

| Name | Copy (verbatim) | Vignette |
|---|---|---|
| Conflict Detection | "Surface which streams agree, which are defeated, and which are merely discounted." | three rows: `transporter · toxic 0.88` "+ drives position", `invivo · negative 0.00` "- defeated by R3", `qsar · positive 0.12` "discounted by R2" (lines 89-112) |
| Belief Fusion | "Dempster-Shafer fusion resolves which rule is doing the defeating, and by how much." | `FUSION_BARS`, six bars R1-R6 (lines 44-51) |
| Counterfactual | "The smallest change in evidence that would move the position, on every case." | minimal-flip search, three bars (lines 138-158) |
| Robustness Check | "Perturb every prior by +/-50% and watch whether the recommendation holds." | `ROBUSTNESS_BARS` + `Stable 0.992` / `Draws 2,000` (lines 53, 170-185) |
| Evidence Streams | "QSAR, cytotoxicity, transporter, and in vivo claims keyed to one endpoint." | `STREAM_GLYPHS` = `Q C T V R A K D P M`, ten letters, `T` highlighted (line 56) |
| Sign-Off Record | "Every position and its owner in a hash-chained, tamper-evident log." | `SIGNOFF_ROWS` mini table (lines 58-63) |

`SIGNOFF_ROWS`: Cyclosporine / Do not adv. / **0.122**; TAK-994 / Abstain / 0.000;
Troglitazone / Abstain / 0.000; Isoniazid / Abstain / 0.000.

### 3.7 `Capabilities.tsx` (85 lines), [ 03 of 11 ], `id="method"`

Six cells `CAP.01` to `CAP.06` (`Capabilities.tsx:11-55`). `CAP.02` is the only place on the
page a hash is rendered at full weight: `"ed073a8a7f6d…0b5db136"` (`Capabilities.tsx:21`),
which is the correct head-12 / tail-8 truncation of
`ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136`.

The comment at `Capabilities.tsx:33-44` records that CAP.05 and CAP.06 were rewritten from
"Counterfactual On Every Position" and "Hash-Chained Sign-Off" (both already stated
elsewhere on the page) to "A Ruleset You Can Move" and "Evidence, As Of A Date", both of
which are real `apps/web` features.

### 3.8 `CaseView.tsx` (124 lines), [ 04 of 11 ], `id="product"`, `section--surface`

Two case cards side by side in a `cells--2 cells--ink` grid.

| | TAK-994 | Cyclosporine |
|---|---|---|
| Verdict | Abstain | Do Not Advance (`verdict--bad`) |
| Belief | 0.090 | 0.886 (filled cell) |
| Gap | 0.910 (filled cell) | 0.098 |
| Conflict | 0.000 | **0.122** (accent blue) |
| Trace line 1 | "**R3** defeats invivo_rodent(neg) x4, exposure margin untested" | "**transporter:toxic** drives the position, BSEP inhibition" |
| Trace line 2 | "**R2** discounts qsar(pos), structure correlation only" | "**R4** downweights an out-of-domain read" |
| Trace line 3 | "*gap rule* fires before the engine reads a value" | "*committed*, conflict mass non-zero, contested" |

Figcaption (`CaseView.tsx:117-120`): "Fig. B · Case view · both hero cases resolve through
one evidence array, Case and Compounds read the same source."

### 3.9 `HowItWorks.tsx` (149 lines), [ 05 of 11 ], `id="ruleset"` on the inner label

`STEPS` (`HowItWorks.tsx:3-29`): 01 Assemble, 02 Discount & Fuse, 03 Argue, 04 Position,
05 Sign. Step 05 reads "The committee decides. The position and its owner enter the
hash-chained audit log." That is house-rule-correct vocabulary.

`RULES` (`HowItWorks.tsx:38-79`) is a verbatim transcription of `rules/ruleset-v1.0.json`.
Verified statement-by-statement against the file:

| ID | Name | Strength on page | Strength in file | Statement |
|---|---|---|---|---|
| R1 | Human relevance | 0.90 | 0.9 | byte-identical |
| R2 | Mechanistic proximity | 0.85 | 0.85 | byte-identical |
| R3 | Exposure relevance | 0.85 | 0.85 | byte-identical |
| R4 | Applicability domain | 0.50 | 0.5 | byte-identical |
| R5 | Study reliability | 0.60 | 0.6 | byte-identical |
| R6 | Concordance | 0.40 | 0.4 | byte-identical |

Figcaption (`HowItWorks.tsx:143-144`): "Precedence R3 › R1 › R2 › R5 · ruleset v1.0 · hash
ed073a8a… · registered 2026-07-26 · never edited after a result." `precedenceOrder` in the
file is `["R3","R1","R2","R5"]` and `registeredAt` is `"2026-07-26"`. **All correct for
v1.0.** The page never mentions that `rules/ruleset-v2.0.json` exists.

### 3.10 `Result.tsx` (93 lines), [ 06 of 11 ], `id="result"`, `section--surface`

Headline (`Result.tsx:51-53`): "It Does Not Beat The Baseline. / It Ties One Stream,
Exactly."

`BASELINES` table (`Result.tsx:19-22`):

| Pipeline | Bal. acc. | Coverage | Committed |
|---|---|---|---|
| ARBITER (`is-ours`, blue fill) | 0.750 | 6.6% | 4 |
| single:transporter | 0.750 | 6.6% | 4 |
| majorityVote | 0.750 | 4.9% | 3 |
| weightedAverage (`is-muted`) | 0.547 | 100% | 61 |

`FINDINGS` (`Result.tsx:25-42`), three cells: "The tie", "The finding", "Lead with this".

### 3.11 `UseCases.tsx` (263 lines), [ 07 of 11 ] and [ 08 of 11 ]

Three personas plus the comparison grid, in one section.

- Persona 01 Safety Lead, art = a Compounds queue panel: `267` total, `In conflict 61`,
  `Declined 260` (`UseCases.tsx:134,148-153`), rows TAK-994/Cyclosporine/Troglitazone/Isoniazid.
- Persona 02 Toxicologist, art = a Case-tab panel with tabs `Evidence | Argument | Table`
  and the six rules with their real registered strengths (`TRACE_ROWS`, lines 73-80).
- Persona 03 Reviewer, art = a perturbation panel, `0.992`, `2,000 draws` (lines 204-207).

The comment at `UseCases.tsx:51-62` is important context: two vignettes were removed because
they drew screens `apps/web` does not have, and one carried an invented figure ("Coverage
-2.6%").

`COMPARISON` (lines 93-99), five pairs, "Reconciling By Hand" against "Arbiter".

### 3.12 `RecordSpeaks.tsx` (135 lines), [ 09 of 11 ], no id

Two full-bleed marquees of eight `<figure>` quotes. The section's own argument
(`RecordSpeaks.tsx:4-11`, headline at line 105-107) is "We Will Not Quote Customers We Do
Not Have", so the quotes are engine output rather than testimonials.

`ROW_ONE` (lines 20-46): TAK-994 abstain quote; Cyclosporine "Conflict mass 0.122, non-zero
and contested"; R3 exposure relevance; the counterfactual.
`ROW_TWO` (lines 48-74): robustness 0.992; determinism; "Ruleset hashed ed073a8a";
**"Balanced acc. 0.750" / "Conflict subset n=61"** (lines 68-73).

### 3.13 `Faq.tsx` (89 lines), [ 10 of 11 ], no id

Native `<details>`, eight questions in two columns. Left (`Faq.tsx:11-28`): what is Arbiter,
determinism, pre-registration, does it replace the committee. Right (`Faq.tsx:30-47`): who
it is for, what abstain means, tamper-evidence, endpoints beyond hepatotoxicity.

`Faq.tsx:26` reads "No. The committee decides; Arbiter shows its work." That is correct
house vocabulary. Nothing in the FAQ mentions counts, tallies or majorities.

### 3.14 `GetStarted.tsx` (38 lines), [ 11 of 11 ], `id="record"`

Headline "The Committee Decides. / ARBITER Shows Its Work." Two CTAs: `Read The Handover`
-> `HANDOVER_URL`, `Clone The Repo` -> `REPO_URL`. The comment at `GetStarted.tsx:9-11`
notes both go to the repository because "there is nothing to sign up for".

### 3.15 `Footer.tsx` (102 lines)

Four columns.

1. Wordmark + "A reasoning layer that adjudicates conflicting preclinical toxicity
   evidence. An internal capability, not a product for sale." + "DILI · Ruleset v1.0 ·
   ed073a8a…" (`Footer.tsx:51-58`).
2. **Repo**: `packages/engine`, `apps/web`, `apps/harness`, `rules/ruleset-v1.0`
   (`Footer.tsx:22-27`).
3. **Read**: README, HANDOVER, Specs & plans, `results/` (`Footer.tsx:29-34`).
4. **Provenance**: "Endpoint · Hepatotoxicity (DILI)", "Split seed · 20260726",
   "Perturbation · +/-50%", "Due · 16 August 2026" (`Footer.tsx:36-41`).

Colophon (`Footer.tsx:96-97`): "© 2026 Arbiter · Pfizer Digital & Technology Hackathon ·
Problem Statement 3" and "Team BU 1 · He · Lopez · Cruz-Lopez".

Note the Repo column omits `apps/deliberation`, `apps/landing` and `services/api`, and the
ruleset link points only at v1.0.

---

## 4. The link graph

### 4.1 `src/links.ts` in full (40 lines)

| Export | Value | Line |
|---|---|---|
| `APP_URL` | `import.meta.env["VITE_APP_URL"] ?? "/app/"` | 21 |
| `DELIBERATION_URL` | `"/deliberation/"` | 28 |
| `REPO` (private) | `https://github.com/SaplingLearn/Arbiter` | 30 |
| `REPO_URL` | `${REPO}` | 32 |
| `HANDOVER_URL` | `${REPO}/blob/main/HANDOVER.md` | 33 |
| `README_URL` | `${REPO}/blob/main/README.md` | 34 |
| `SPECS_URL` | `${REPO}/tree/main/docs/superpowers` | 35 |
| `RESULTS_URL` | `${REPO}/tree/main/results` | 36 |
| `RULESET_URL` | `${REPO}/blob/main/rules/ruleset-v1.0.json` | 37 |
| `ENGINE_URL` | `${REPO}/tree/main/packages/engine` | 38 |
| `WEB_URL` | `${REPO}/tree/main/apps/web` | 39 |
| `HARNESS_URL` | `${REPO}/tree/main/apps/harness` | 40 |

`.env.development:13` sets `VITE_APP_URL="/app/#/case"`, quoted deliberately: dotenv would
treat an unquoted `#` as a comment and silently drop the fragment.

The remote is confirmed: `git remote -v` gives
`https://github.com/SaplingLearn/Arbiter.git`. Every path a footer link points at exists on
`origin/main` (verified with `git ls-tree --name-only origin/main`): `HANDOVER.md`,
`README.md`, `docs/superpowers/` (contains `plans/` and `specs/`), `results/`,
`rules/ruleset-v1.0.json`, `packages/engine`, `apps/web`, `apps/harness`. Whether the repo
is public was not verifiable offline.

### 4.2 Every link on the page

| # | Where | href | Kind | Resolves |
|---|---|---|---|---|
| 1 | `Header.tsx:50` wordmark | `#top` | fragment | yes, `Landing.tsx:71` |
| 2-6 | `Header.tsx:20-24` nav rail | `#method`, `#product`, `#ruleset`, `#result`, `#record` | fragment | yes, all five |
| 7 | `Header.tsx:28` nav rail | `/deliberation/` | cross-surface | only under `npm run dev` or a side-by-side deployment |
| 8 | `Header.tsx:68` "Open The App" | `APP_URL` | cross-surface | `/app/#/case` in dev, `/app/` in a build |
| 9-13 | `Header.tsx:94-100` hamburger panel | same six as 2-7 | duplicate | yes |
| 14 | `Hero.tsx:107` "Read The Method" | `HANDOVER_URL` | external | yes |
| 15 | `Hero.tsx:110` "Open The Record" | `REPO_URL` | external | yes |
| 16 | `GetStarted.tsx:28` "Read The Handover" | `HANDOVER_URL` | external | yes, duplicate of 14 |
| 17 | `GetStarted.tsx:31` "Clone The Repo" | `REPO_URL` | external | yes, duplicate of 15 |
| 18-21 | `Footer.tsx:22-27` Repo column | engine, web, harness, ruleset-v1.0 | external | yes |
| 22-25 | `Footer.tsx:29-34` Read column | README, HANDOVER, specs, results | external | yes |

Total: 25 anchors, of which 11 point off-page and 10 of those to the same repository, which
is exactly what the `links.ts:1-7` doc comment claims.

### 4.3 Anchor targets that exist

| id | Element | File:line |
|---|---|---|
| `top` | `<Hatch id="top" short />` band | `Landing.tsx:71` via `primitives.tsx:46` |
| `method` | Capabilities `<section>` | `Capabilities.tsx:59` |
| `product` | CaseView `<section>` | `CaseView.tsx:54` |
| `ruleset` | the ruleset-table label `<div>` | `HowItWorks.tsx:105` |
| `result` | Result `<section>` | `Result.tsx:46` |
| `record` | GetStarted `<section>` | `GetStarted.tsx:14` |

Six ids total. `.landing [id] { scroll-margin-top: 88px }` at `landing.css:150-152` keeps a
jump clear of the sticky header.

**Sections with no anchor at all**, so unlinkable: Hero, Standards, Metrics, Features,
UseCases, Comparison, RecordSpeaks, Faq, Footer.

### 4.4 Cross-surface graph

```
landing  --/app/#/case-->  apps/web       (Header "Open The App")
landing  --/deliberation/-> apps/deliberation  (nav rail, uncommitted)
apps/web --"/"---------->  landing        (apps/web/src/links.ts:21-28, landingHref())
apps/deliberation ------>  NOTHING
```

`apps/web/src/links.ts:21-28` returns `VITE_LANDING_URL` if set, `null` under `file://`, and
`"/"` otherwise, so the product app links back.

`apps/deliberation` has **no outbound link to the landing page or to apps/web**. Verified by
`grep -rnE "<a |href=" apps/deliberation/src/`: all thirteen anchors call the internal route
builder `href({ name: ... })` (`pages.tsx:199,224,225,247,293,359`, `App.tsx:212,257,326`,
`Layout.tsx:35,47,79,146`). The deliberation client is a one-way destination.

---

## 5. Motion directory (`src/motion/`)

### 5.1 `reducedMotion.ts` (16 lines)

One export, `prefersReducedMotion(): boolean` (line 13). Guarded on
`typeof window === "undefined" || typeof window.matchMedia !== "function"` because jsdom does
not provide `matchMedia`. Returns `false` when the API is absent, which means "animate".

### 5.2 `useReveals.ts` (152 lines)

`useReveals(rootRef, enabled)` (line 50) runs one `IntersectionObserver` over the page root
rather than one per component, and a second one for registration ticks.

- `STAGGER_MS = 70`, `COUNT_MS = 900` (lines 22-23).
- Stagger index is read from `parentElement.querySelectorAll(":scope > [data-reveal]")`
  (lines 99-102), so reordering cells cannot desynchronise a hardcoded index.
- Three skip conditions, one behaviour (line 62): `!enabled`, no `IntersectionObserver`, or
  reduced motion. In all three the counters are written to their final value immediately and
  `.marquee-window` gets `overflowX: auto` so a stopped marquee stays reachable (lines 63-68).
- `formatCount(value, decimals, suffix)` is **exported for the test** (line 37). Decimals are
  fixed, integers grouped with `toLocaleString("en-US")`.
- Count-up easing is cubic ease-out (line 86).
- Tick observer groups ticks by their closest `section, footer, header` so a whole set fades
  together (lines 124-143).
- Cleanup disconnects both observers, cancels every tracked frame and removes `.is-armed`
  (lines 145-150).

### 5.3 `useDitherField.ts` (130 lines)

`useDitherField(canvasRef, accent)` (line 102) paints the bitmap dither behind the hero
figure.

- `seededRandom` is mulberry32 (line 19), seeded `SEED = 424242` (line 30), so the field is
  byte-identical on every load at a given size. The comment at lines 13-16 says this is
  precisely so a screenshot diff stays useful.
- `CELL = 3`, `PALE = "#DDE2FF"`, `MID = "#5A66F7"` (lines 29-33).
- DPR capped at 2 (line 45). Bails out under 4px in either dimension (line 41).
- Paint probability ramps as `p²` above the halfway line (lines 60-63); edge cells get more
  pale and mid speckle (lines 65-69).
- `twinkle()` (line 80) blinks seven cells per 320ms tick in the bottom 42%. **This is the
  one place on the page that calls `Math.random`** (lines 89-90, 97). It is suppressed under
  reduced motion (line 121); the static field is not.
- Resize is debounced at 120ms (lines 111-115) because a full redraw is roughly 150k
  `fillRect` calls at rail width.

---

## 6. Factual claims audit

Every number and assertion the copy makes, and whether the repo supports it.

### 6.1 THE BLOCKING ONE: the retired 0.750 is on the marketing page in four places

| Where | Exact text | File:line |
|---|---|---|
| Metrics stat | `to: 0.75, decimals: 3` renders `0.750`, labelled "Balanced Accuracy" | `Metrics.tsx:27-31` |
| Result table, ARBITER row | `accuracy: "0.750"` | `Result.tsx:19` |
| Result table, single:transporter row | `accuracy: "0.750"` | `Result.tsx:20` |
| Result table, majorityVote row | `accuracy: "0.750"` | `Result.tsx:21` |
| RecordSpeaks marquee | `who: "Balanced acc. 0.750"`, `what: "Conflict subset n=61"` | `RecordSpeaks.tsx:71-72` |

All five are faithful to `results/metrics.json` as it stands today
(`metric1_conflictSubsetAccuracy.arbiter.balancedAccuracy = 0.75`,
`baselines["single:transporter"].balancedAccuracy = 0.75`,
`baselines.majorityVote.balancedAccuracy = 0.75`,
`baselines.weightedAverage.balancedAccuracy = 0.546969696969697` which rounds to the page's
`0.547`). All coverage and committed figures also match exactly:

| Pipeline | Page | metrics.json |
|---|---|---|
| ARBITER | 0.750 / 6.6% / 4 | 0.75 / 0.06557377049180328 / 4 |
| single:transporter | 0.750 / 6.6% / 4 | 0.75 / 0.06557377049180328 / 4 |
| majorityVote | 0.750 / 4.9% / 3 | 0.75 / 0.04918032786885246 / 3 |
| weightedAverage | 0.547 / 100% / 61 | 0.546969696969697 / 1 / 61 |

So the landing page is not wrong *against the file*. It is wrong against
`HANDOVER.md` section 13.1, which declares the v1.0 binarisation invalid, and against
`rules/ruleset-v2.0.json`, which re-registered the target on 2026-08-09.

**Under v2.0 (`results/rescore-v2.txt`, conflict subset n=61, positives 29.5%):**

| Pipeline | v1.0 bal. acc. | v2.0 bal. acc. | v2.0 confusion |
|---|---|---|---|
| ARBITER | 0.750 | **0.500** | tp 1 / fp 3 / tn 0 / fn 0 |
| single:transporter | 0.750 | 0.500 | tp 1 / fp 3 / tn 0 / fn 0 |
| majorityVote | 0.750 | **0.250** | tp 0 / fp 3 / tn 0 / fn 0 |
| single:cytotox | 0.500 | 0.500 | tp 0 / fp 0 / tn 43 / fn 18 |
| single:qsar | 0.500 | 0.500 | tp 17 / fp 43 / tn 0 / fn 0 |
| weightedAverage | 0.547 | **0.519** | tp 17 / fp 39 / tn 4 / fn 1 |

On the full split under v2.0: ARBITER 0.500 (tp 2 / fp 5), majorityVote 0.471,
single:cytotox 0.507, single:qsar 0.601, weightedAverage 0.516.

The four numbers that do **not** move under v2.0, because v2.0 changes only the target
definition (`ruleset-v2.0.json` `scopeNote`: "R1-R6 are byte-identical to v1.0"): coverage
6.6%, committed 4 (subset) and 7 (full split), decline rate 97.4%, robustness 0.992.

### 6.2 Claims the repo fully supports

| Claim | File:line | Evidence |
|---|---|---|
| 97.4% abstained | `Metrics.tsx:20` | `metric4_abstentionQuality.declineRate = 0.9737827715355806` |
| 260 of 267 declined | `Metrics.tsx:24`, `Result.tsx:34`, `UseCases.tsx:152` | `nDeclined: 260`, `sampleSizes.scored: 267` |
| 254 could not commit at any evidence values | `Metrics.tsx:24`, `Result.tsx:34`, `Faq.tsx:37` | `nStructurallyForced: 254`, with the metrics file's own note that it is a floor |
| 7/267 committed | `Metrics.tsx:38-40` | `metric4.nCommitted: 7` |
| 61 in the conflict subset | `Metrics.tsx:69`, `Result.tsx:56`, `UseCases.tsx:150` | `sampleSizes.conflictSubset: 61` |
| Robustness 0.992 | `Metrics.tsx:45`, `Features.tsx:178`, `UseCases.tsx:207`, `Result.tsx:39`, `RecordSpeaks.tsx:52` | `metric5.meanUnchangedFraction = 0.9917704918032786` |
| 2,000 draws per compound | `Features.tsx:182`, `UseCases.tsx:204`, `Result.tsx:39` | `metric5.samplesPerCompound: 2000` |
| +/-50% perturbation of every prior | `Result.tsx:39`, `Footer.tsx:39` | `metric5.perturbation: "+/-50% on every expert-elicited priorToxic"` |
| Split seed 20260726 | `Footer.tsx:38` | `provenance.splitSeed: 20260726` |
| "only four transporter claims in the split" | `Result.tsx:29` | `sampleSizes.streamCoverage.transporter.claims: 4` |
| "140 compounds carry one claim" | `Result.tsx:34` | `HANDOVER.md:229` "140 of 267 compounds carry exactly one claim"; `HANDOVER.md:249` "qsar only 140" |
| Deterministic to one hash across 1,000 runs | `Capabilities.tsx:26`, `Faq.tsx:18`, `UseCases.tsx:197`, `RecordSpeaks.tsx:56` | `packages/engine/test/determinism.test.ts:17-19` |
| "The harness refuses to run if the computed hash differs" | `Capabilities.tsx:20`, `Faq.tsx:22`, `RecordSpeaks.tsx:63` | `apps/harness/src/preregistration.ts:49` states exactly this |
| Ruleset hash `ed073a8a7f6d…0b5db136` | `Capabilities.tsx:21` | `metrics.json provenance.rulesetHash` |
| Ruleset v1.0 registered 2026-07-26 | `HowItWorks.tsx:143`, `Footer.tsx:57` | `ruleset-v1.0.json registeredAt: "2026-07-26"` |
| Precedence R3 › R1 › R2 › R5 | `HowItWorks.tsx:143` | `ruleset-v1.0.json precedenceOrder: ["R3","R1","R2","R5"]` |
| The six rules and their strengths, verbatim | `HowItWorks.tsx:38-79`, `UseCases.tsx:73-80` | byte-identical to `ruleset-v1.0.json`, checked statement by statement |
| Tamper-evidence "tested, not asserted" | `Faq.tsx:41`, `UseCases.tsx:98`, `GetStarted.tsx:24` | `apps/web/test/chain.test.ts:232` "end-to-end: tampering with an earlier entry breaks the chain to later entries"; also `services/api/test/store.test.ts` |
| Golden-file CI catches a moved number | `Capabilities.tsx:26`, `Faq.tsx:18` | `results/golden/metrics.golden.json` + `.github/workflows/ci.yml` runs `golden.test.ts` and `git diff --exit-code results/verdict-manifest.json` |
| The seven app tabs in the mockup | `Hero.tsx:35,145-148` | `apps/web/src/App.tsx:49-57` |
| Cyclosporine belief 0.886 / gap 0.098 / conflict 0.122, contested | `CaseView.tsx:99-101`, `Features.tsx:59`, `RecordSpeaks.tsx:28` | `results/results.json`: belief 0.8862, plausibility 0.9846 (gap 0.0985), conflictMass 0.1215, `conflicting: true` |
| Cyclosporine drives on transporter, R4 downweights an out-of-domain read | `CaseView.tsx:106-109` | its trace: `:transporter admitted`, `:qsar downweighted "Prediction falls outside the model's applicability domain"` |
| Cyclosporine "all three" streams | `Hero.tsx:28` | its trace carries cytotox, qsar and transporter claims |
| TAK-994 belief 0.090 / gap 0.910 / conflict 0.000 | `Hero.tsx:27`, `CaseView.tsx:75-77`, `RecordSpeaks.tsx:22` | `apps/web/src/data/heroCases.ts:61-63` states 0.886 against 0.090 and 0.098 against 0.910 |
| Team and event | `Footer.tsx:96-97` | `README.md:5-6` "Pfizer Digital & Technology Hackathon 2026 · Problem Statement 3", "Team BU 1 - Jack He, Andres Lopez, Jose Cruz-Lopez" |
| "8+ evidence standards" | `Standards.tsx:36` | The six rules' `framework.name` fields cite FDA Roadmap / FDA Modernization Act 2.0, OECD AOP + AOP-Wiki, ICH M3(R2), OECD QSAR validation principles, Klimisch et al. 1997, OECD weight-of-evidence and IATA. Tox21 and DILIrank are not cited in `framework` but are real data sources: `packages/engine/src/types.ts:19`, `packages/engine/src/rules.ts:300-304`, `data/prep/assemble_evidence.py:27`. Eight named bodies, all real, though two are datasets rather than rule-citations |

### 6.3 Claims the repo does NOT support

**A. The hero mock table asserts it is real and three of six rows are not.**

`Hero.tsx:22-25` says verbatim: "These are the run's actual numbers, not filler." Checked
every row against `results/results.json` (267 rows, keyed by InChIKey, resolved through
`data/out/compounds.json`) and `data/out/splits.json`:

| Row | Page belief / gap | Reality | Verdict |
|---|---|---|---|
| TAK-994 | 0.090 / 0.910 | fixture case; matches `heroCases.ts:61-62` | supported |
| Cyclosporine | 0.886 / 0.098 | 0.8862 / 0.0985, `PMATZTZNYRCHOR-CGLBZJNRSA-N` | supported |
| Troglitazone | 0.120 / 0.880 | `GXPHKUHSUJUWKP-UHFFFAOYSA-N` is in the **train** split, not scored, absent from `results.json` | **unsourced** |
| Acetaminophen | 0.210 / 0.790 | `RZVAJINKPMORJF-UHFFFAOYSA-N` is in the **calibration** split, absent from `results.json` | **unsourced** |
| Isoniazid | 0.070 / 0.930, "qsar only", "single claim" | `QRXWMOHMRWLFEY-UHFFFAOYSA-N` IS in the test split: belief **0.0000**, plausibility 0.8650, **gap 0.8650**, and it carries **two** claims (cytotox + qsar), not one | **wrong on three counts** |
| Valproate | 0.160 / 0.840 | no compound named "valproate" in the corpus; "valproic acid" `NIJJYAXOARWZEE-UHFFFAOYSA-N` is in the **train** split | **unsourced** |

The mock is `aria-hidden="true"` (`Hero.tsx:128`) and reads visually as an illustration, so
nothing here is announced to a screen reader. The problem is the source comment's claim, and
the fact that Isoniazid is a real scored compound whose real numbers are printed wrong.

`UseCases.tsx:65-70` `QUEUE_ROWS` repeats Troglitazone and Isoniazid as "Abstain" with no
figures. Isoniazid's real verdict IS abstain, so that row is fine; Troglitazone is simply
not in the scored split.

`Features.tsx:58-63` `SIGNOFF_ROWS` gives Troglitazone conflict 0.000 (not scored) and
Isoniazid conflict 0.000 (real value is indeed 0.0000, so that one is correct).

**B. The ten-glyph stream row implies ten streams; there are six.**

`Features.tsx:55-56`: `STREAM_GLYPHS = ["Q","C","T","V","R","A","K","D","P","M"]`, with the
comment "the stream keys. T, transporter, is the one that is live." `packages/engine/src/types.ts:7-13`
defines exactly six: `qsar | cytotox | toxicogenomics | transporter | invivo_rodent |
invivo_nonrodent`. The feature's own copy at `Features.tsx:205` names four. The row is
decoration presented as a key.

**C. `FUSION_BARS` implies a measurement that does not exist.**

`Features.tsx:43-51`: the comment reads "R3 is the one at full strength; the rest fade by how
little they moved the result", and the widths are R1 34%, R2 48%, R3 82%, R4 40%, R5 52%,
R6 30%. Those are not the registered strengths (R1 is 0.90, the highest) and correspond to no
quantity in `results/metrics.json` or `results/results.json`. Same for `ROBUSTNESS_BARS`
(`Features.tsx:53`) and `SPREAD_BARS` (`UseCases.tsx:82-91`), though those two carry no
explanatory comment claiming a source.

**D. No number on the page states its class balance.**

Searched `90.2`, `60.3`, `positive rate`, `positiveRate`, `class balance`, `prevalence`,
`base rate`, `single.class`, `singleClass`, `confidence interval` and `\bCI\b` across
`apps/landing/src`. Zero matches (the only "CI" hits are "golden-file CI", meaning
continuous integration). The page therefore never discloses that the conflict subset is
90.2% positive under v1.0, that `singleClass: true`, or that `balancedAccuracyCi: null`.
`HANDOVER.md:1554-1556` calls out that those are exactly the fields "nobody read". Denominators
ARE stated everywhere (`Metrics.tsx:69`, `Result.tsx:56`, `RecordSpeaks.tsx:72`).

**E. The page presents ruleset v1.0 as the current registration.**

`HowItWorks.tsx:143`, `Footer.tsx:26,57`, `RecordSpeaks.tsx:66`, `links.ts:37`. `rules/ruleset-v2.0.json`
exists, is registered `2026-08-09`, `supersedes: "1.0"`, and is on `origin/main`. The landing
page mentions v2.0 nowhere. Searched `v2.0`, `ruleset-v2`, `2026-08-09`, `re-register`,
`supersede`: zero matches in `apps/landing/src`.

### 6.4 Claims specifically hunted for and NOT found (good news)

Each searched with at least three plausible spellings across `apps/landing/src`,
`apps/landing/index.html` and `apps/landing/test`.

| Hunted | Terms searched | Result |
|---|---|---|
| Superior-accuracy claims | `beats`, `beat`, `outperform`, `outperforms`, `superior`, `state-of-the-art`, `best-in-class`, `better than` | **Zero overclaims.** The only hits are `Result.tsx:51` "It Does Not Beat The Baseline.", `GooglyEyes.tsx:52` and `landing.css:2305` (the word "beat" meaning a unit of timing), and `landing.test.tsx:268` ("beat ?intro=1") |
| A fourteen-rule claim | `fourteen`, `14 rules`, `rules.{0,6}14` | **Zero matches.** The page consistently says six, and six is correct |
| A blindness guarantee | `blind`, `blindness`, `leakage`, `leak`, `holdout`, `held-out`, `unseen`, `nonclinical`, `non-clinical` | **Zero matches.** The page makes no claim about the nonclinical/clinical cut at all |
| Counts-decide vocabulary | `majority`, `minority`, `vote`, `voting`, `tally`, `quorum`, `consensus`, `outvoted`, `unanimous` | Two hits, neither a governance claim: `Result.tsx:21` `"majorityVote"` is the literal baseline-pipeline identifier from `metrics.json`, and `landing.css:535` is a **code comment** describing the logo ("so it reads as a quorum that is not unanimous"). Nothing rendered to a reader |
| Banned framings | `regulator`, `dossier`, `blockchain`, `ledger` | One hit: `Standards.tsx:39` "peer-reviewed & regulatory", which is a description of the evidence bodies, not "regulator-ready dossier". The page correctly says "hash-chained audit log" (`HowItWorks.tsx:27`) and "hash-chained record" (`GetStarted.tsx:24`) |
| Em dashes | `—` | **Zero.** Three en dashes exist, all inside the proper noun "Dempster–Shafer" (`HowItWorks.tsx:12`, `CaseView.tsx:65`, `Features.tsx:132`). The rest of the repo is inconsistent here: `README.md:28,42,71` and `HANDOVER.md:38` also use the en dash, while `README.md:220` and `HANDOVER.md:927` use a plain hyphen |

---

## 7. UI directory (`src/ui/`)

### 7.1 `primitives.tsx` (199 lines)

Nine exports, described by the file's own comment as "the five structural signatures
BLUEPRINT calls non-negotiable, defined once each" instead of inline at roughly 90 call sites.

| Export | Line | Signature | Notes |
|---|---|---|---|
| `TickAt` (type) | 14 | `"tl" \| "tr" \| "bl" \| "br" \| "tc"` | |
| `Tick` | 23 | `({ at, small })` | Renders a literal `+`, `aria-hidden` |
| `TopTicks` | 28 | `({ small })` | The common `tl` + `tr` pair |
| `Hatch` | 44 | `({ id, short })` | The 45-degree hairline band. Carries the optional page anchor |
| `Counter` | 60 | `({ n, of = 11, name, className })` | `[ 03 of 11 ] · Capabilities` |
| `Eyebrow` | 81 | `({ children })` | Mono chip with a blue square before it |
| `Cta` | 99 | `({ href, variant, compact, children })` | `variant: "primary" \| "secondary"`, four aria-hidden corner brackets |
| `Marquee` | 130 | `({ children, slow, reverse, className })` | Renders children twice, second copy `aria-hidden` |
| `Mark` | 160 | `({ ink, small })` | Four squares, one at 40% opacity, bottom-right inset 2px |
| `Stat` | 181 | `({ to, decimals = 0, suffix = "", className })` | **Renders the final value in the markup** and exposes `data-count`, `data-to`, `data-decimals`, `data-suffix` for `useReveals` to animate |

`Stat`'s "render the final value, animate over it" design (documented at
`primitives.tsx:172-179`) is why a reader with JavaScript off never sees 0.000 where the page
means 0.992.

### 7.2 `GooglyEyes.tsx` (233 lines)

Transcribed from `framer.com/m/GooglyEyes-e7CN.js@UjrCcF3EZr0JYBl5R4rI`
(`GooglyEyes.tsx:7`). Twelve props (`GooglyEyesProps`, lines 33-50). Two deliberate
deviations from the original, both recorded at lines 21-31:

1. The pointer is a `useRef` written straight to the SVG via `setAttribute`
   (lines 76, 147-150) rather than React state, so mouse movement does not re-render the page
   sixty times a second.
2. Blinking stops under reduced motion; cursor tracking does not, because tracking is a
   response to the reader's own input (lines 158-162).

Requires `ResizeObserver` (line 82). Where it is absent, `metrics` stays `null` and the
component renders an empty measuring div instead of throwing, which
`landing.test.tsx:130-137` asserts.

Blink timing: `BLINK_BEAT_MS = 120`, `BLINK_SQUASH = 0.18` (lines 53-55), double-blink
sequence at lines 166-178.

### 7.3 `InteractiveGrid.tsx` (270 lines)

Transcribed from `framer.com/m/Interactive-Grid-eYMeUf.js@7mMtAh3TW7ebk5DN8y9P`
(internal name `Dot_Background`), per `InteractiveGrid.tsx:7`. This is the **only reason
`three` is a dependency**, and the reason `Hero.tsx:13-15` lazy-imports it: roughly 170KB
gzipped, over twice the rest of the page.

- Ten props (`InteractiveGridProps`, lines 28-42). Defaults are the original's dark-hero
  values (`gridSize = 8000`, `density = 160`, `radius = 600`, `strength = 200`); the hero
  overrides all four.
- Four interaction styles as a shader branch: Pull 0, Push 1, Twist 2, Lens 3
  (`STYLE_INDEX`, line 44; shader lines 119-136).
- Falloff is `exp(-pow(dist / (u_radius * 0.4), 2.0))` (line 117).
- Two `ShaderMaterial`s share one `BufferGeometry`, one drawn as `LineSegments` and one as
  `Points` with `#define IS_POINT` prepended (lines 166-182).
- An invisible `PlaneGeometry` inside the tilting group gives the raycaster a target that
  tilts with it (lines 187-190).
- Full teardown including `renderer.dispose()` (lines 249-264), with the comment noting that
  StrictMode's mount/unmount/mount would otherwise burn two WebGL contexts.
- Exports both a named `InteractiveGrid` and a `default` (line 270).

Never mounted under reduced motion, gated in the hero **before** the lazy import
(`Hero.tsx:51`), so the chunk is never fetched. Asserted at `landing.test.tsx:111-128`.

---

## 8. The CSS system (`src/landing.css`, 2,435 lines)

One file, no preprocessor, no framework, no CSS modules. Every rule is scoped under
`.landing` or a class the page owns. The header comment (lines 1-25) records that the design
source carried everything inline and selected breakpoints on the style attribute itself
(`[style*="grid-template-columns:repeat(4,1fr)"]`), which is why this is a stylesheet.

### 8.1 Design tokens (`landing.css:29-60`, defined on `.landing`)

| Token | Value | Role |
|---|---|---|
| `--paper` | `#f2f2ef` | page ground |
| `--surface` | `#f7f7f4` | `section--surface` fill |
| `--surface-2` | `#ececE9` | `cell--fill`, secondary CTA |
| `--ink` | `#0e0e0e` | body text, heavy rules |
| `--ink-2` | `#5b5b60` | lede, secondary text |
| `--ink-3` | `#74747b` | captions, labels, counters |
| `--line` | `#dededa` | every hairline |
| `--tick` | `rgba(14,14,14,0.35)` | registration marks, ink at low alpha rather than a grey |
| `--blue` | `#2b2bf0` | the single accent, overridable via the `accent` prop |
| `--blue-soft` | `#e6e8fc` | the ARBITER row fill in the baselines table |
| `--good` | `#1ca64c` | paired with a word, never alone |
| `--bad` | `#e5484d` | paired with a word, never alone |
| `--white` | `#ffffff` | case-card ground |
| `--mono` | `"IBM Plex Mono", ui-monospace, monospace` | every number and label |
| `--sans` | `"Inter Tight", system-ui, sans-serif` | everything else |
| `--column` | `1680px` | the content column; every structural measure hangs off it |
| `--gutter` | `40px` | drops to `20px` under 767px (`landing.css:2356`) |

`--blue` is the theming knob: `Landing.tsx:61` sets it inline from the `accent` prop, and
`landing.test.tsx:390-396` asserts that path.

`.landing` also sets `overflow-x: hidden` (line 59) because the marquee rows are wider than
the viewport by construction.

`font-variant-numeric: tabular-nums` is applied to `.mono` and any class containing "num"
(lines 94-97).

### 8.2 Structure map

| Block | Lines | Contents |
|---|---|---|
| tokens | 27-60 | as above |
| reset | 62-97 | `box-sizing`, link colours, `::selection`, `:focus-visible` (2px solid `--blue`, offset 2px), tabular numerals |
| 1 rails | 99-152 | `.rails` (max-width `--column`, 1px left and right borders), four padding variants `--relative / --padded / --padded-full / --padded-short / --bleed`, `.section`, `.section--surface`, and `.landing [id] { scroll-margin-top: 88px }` |
| 2 registration ticks | 154-192 | `.tick` and the five positional modifiers, each translated 50% so the glyph sits on the crossing |
| 3 hatched bands | 194-209 | `repeating-linear-gradient(45deg, ...)` at 110px, 72px (`--top`) and 24px (`--strip`) |
| 4 section counters | 211-232 | `.counter`, `--tight`, `--inset` |
| 5 corner-bracket CTAs | 234-355 | `.cta`, `.cta-fill`, `--primary`/`--secondary`/`--compact`, the four `.cta-bracket--*` |
| 6 cells, not cards | 356-397 | the shared-hairline grid: container draws top and left, each cell draws right and bottom. `--2/--3/--4/--5`, `--ink` (heavier weight), `.cell--fill` |
| type | 399-503 | `.eyebrow`, `.h1` `clamp(56px, 7.5vw, 96px)`, `.h2` `clamp(40px, 5vw, 64px)`, `.h3` 24px, `.lede` 17px/1.6, `.figcaption`, `.t-accent/.t-muted/.t-good/.t-bad`, `.tail` (88px) |
| header | 505-673 | sticky, `z-index: 60`, `.brand`, `.mark`, `.navrail` with a left-origin underline grow, `.menu-toggle` (rotates into an X via `[aria-expanded="true"]`), `.menu-panel` |
| hero | 674-770 | `.hero-section { isolation: isolate }`, `.hero-grid` absolute inset 0 `pointer-events: none`, `.hero-title` `clamp(64px, 11vw, 150px)`, `.hero-eyes` `clamp(190px, 24vw, 340px)`, plus a 767px block |
| hero app mockup | 771-967 | `.hero-app`, `.mock-side`, `.mock-grid`, `.mock-row`, `.mock-chip`, `.mock-avatar` and friends |
| marquee | 968-1090 | `@keyframes arb-marquee` 0 to `-50%`, 35s linear infinite, 55s when `--slow`, `animation-direction: reverse` when `--reverse`, paused on `:hover`. `.marquee-half { display: contents }`. Plus `.standards` and the eight `.wm--*` wordmark treatments |
| 01 metrics | 1091-1124 | `.metric-value` `clamp(48px, 4.4vw, 72px)` mono |
| 02 features | 1125-1367 | `.feature-art` and variants, `.vignette`, `.rule-bars`, `.column-chart`, `.stat-pair`, `.glyphs`, `.mini-table` |
| 03 capabilities | 1368-1399 | `.capability`, `.id`, `.hash` |
| 04 case view | 1400-1493 | `.case-card`, `.verdict` (word in a bordered box with a square marker), `.verdict--bad`, `.case-figures` (three columns that deliberately do NOT collapse at the tablet breakpoint), `.case-trace` |
| 05 how it works | 1494-1599 | `.steps`, `.ruleset-label`, `.ruleset` table with `table-layout: fixed` and a `<colgroup>` |
| 06 the result | 1600-1678 | `.baselines` table, `.is-ours` filled with `--blue-soft`, `.is-muted`, `.findings` capped at 1200px |
| 07 use cases | 1679-1892 | `.persona`, `--reversed`, `--last`, `.checks`, `.panel`, `.spread` |
| 08 comparison | 1893-1972 | `.compare`, `.compare-head`, `.compare-rows` |
| 09 the record speaks | 1973-2029 | `.quote`, `.quote--fill`, `.quote-rail`, `.quote-avatar` |
| 10 faq | 2030-2077 | `.faq`, `.faq-column`, `details`/`summary` styling |
| 11 get started | 2078-2097 | `.cta-section` |
| footer | 2098-2175 | `.footer-grid`, `.footer-cell`, `.footer-word`, `.footer-links`, `.footer-provenance`, `.footer-colophon` |
| opening scene | 2176-2288 | `.opening` overlay, `.opening-mark`, `.opening-count`, `.opening-bar`, `.opening-skip`, exit wipe keyed off `[data-exiting]`, plus a 767px block at 2283 |
| motion | 2289-2331 | `.landing.is-armed [data-reveal]` starts hidden (opacity 0, `translateY(14px)`), `.is-in` reveals it. Tick fades. A `prefers-reduced-motion` block that stops marquees and neutralises reveals |
| responsive | 2332-2435 | two breakpoints, below |

### 8.3 Breakpoints

Three media blocks total, at two widths.

**`max-width: 1279px` (`landing.css:2337-2352`)**: hides `.navrail` (so the hamburger becomes
the only navigation), collapses `cells--4` and `cells--3` to two columns and `cells--5` to
three, reduces persona padding.

**`max-width: 767px` (`landing.css:2354-2435`, plus 726-735 for the hero and 2283-2288 for the
opening scene)**: `--gutter` to 20px, rails become 20px margins, `.h1` fixed at 46px, every
grid to one column, several border corrections for the stacked state, CTAs go full-width,
`.hero-app` becomes an 820px slab bleeding off the right edge with `.mock-side` hidden, and
`.ruleset` switches to `table-layout: auto`.

There is **no** breakpoint between 768px and 1279px other than the tablet collapse, and no
container queries (searched `@container`: zero matches).

### 8.4 Reduced-motion posture

The design honours `prefers-reduced-motion: reduce` in five separate places, which is unusual
enough to be worth listing:

1. The opening scene never mounts (`OpeningScene.tsx:128`).
2. The Three.js grid never mounts, before the lazy import (`Hero.tsx:51`).
3. Dither twinkling stops; the static field stays (`useDitherField.ts:121`).
4. Eye blinking stops; cursor tracking stays (`GooglyEyes.tsx:159`).
5. Reveals and count-ups resolve instantly, and marquee windows become manually scrollable
   so stopped content stays reachable (`useReveals.ts:62-69` plus `landing.css:2314-2330`).

### 8.5 Dead CSS

Compared every `.class` selector in `landing.css` against every identifier in the TS and TSX
sources. Twelve appear unreferenced, but eleven are composed at runtime from template
literals: `cta--primary`, `cta--secondary` (`primitives.tsx:111`), the four `cta-bracket--*`
(`primitives.tsx:115`), and the five `tick--*` (`primitives.tsx:24`).

The one genuinely dead rule: **`.t-bad`** at `landing.css:495-497`. `t-good`, `t-muted` and
`t-accent` are all used; `t-bad` is applied nowhere.

---

## 9. Fonts and the document shell

`index.html:18-23` loads Inter Tight (400, 500, 600) and IBM Plex Mono (400, 500) from Google
Fonts, with `preconnect` to both `fonts.googleapis.com` and `fonts.gstatic.com`, the latter
`crossorigin` because a font is fetched in CORS mode.

This is the explicit reason `vite.config.ts:4-16` does NOT copy `apps/web`'s
`inlineEverything` plugin: `apps/web` is opened over `file://` and its
`e2e/static-file.spec.ts` fails on an attempted subresource request, whereas this page is
served over http and asks for two webfonts by design.

**Consequence for offline demo:** the landing page requires network access for its
typography. Under `npm run dev` with no internet, both faces fall back to `system-ui` and
`ui-monospace`. Nothing breaks, but the page does not look like the design.

`index.html` contains, in full: charset, viewport, title, description, two preconnects, one
stylesheet link, `<div id="root">`, one module script. That is everything.

---

## 10. Test coverage

### 10.1 What `apps/landing/test/landing.test.tsx` covers (396 lines, 25 cases)

Rendered via `renderLanding()` (line 19) with `dither={false}` and `opening={false}`, for the
reasons at lines 10-18: jsdom cannot do the canvas, and the opening scene writes a
sessionStorage flag that would make the first test in the file see an overlay and every later
one see none.

| Block | Cases | What it asserts |
|---|---|---|
| `fragment nav` | 2 | Every `a[href^="#"]` resolves to an element that exists (lines 24-38). The hamburger opens, exposes the same href list as the rail, and closes (lines 40-63) |
| `hero` | 4 | h1 plus both CTAs (83-88); the two sclerae do not intersect, asserted on rendered geometry not on the prop (90-109); the WebGL grid never mounts under reduced motion (111-128); the eyes degrade to an empty box without `ResizeObserver` (130-137) |
| `counters` | 1 | Section counters run 01..N in order and the total is derived from the rendered count, not hardcoded (141-153) |
| `stat count-ups` | 3 | The final figure is in the markup (157-166); **the figures are read off `results/metrics.json` from disk** (168-189); `formatCount` fixes decimals and groups only integers (191-198) |
| `honesty` | 3 | "It Ties One Stream, Exactly." and "ARBITER abstains on 260 of 267" and "We Will Not Quote" are present (202-210); every position is a word, never a colour alone (212-216); the ruleset table prints exactly `["R1".."R6"]` (218-222) |
| `marquees` | 1 | Exactly half of `.marquee-half` elements carry `aria-hidden` (226-235) |
| `opening scene` | 10 | `?intro=0` suppresses; `?intro=1` replays; reduced motion beats `?intro=1`; plays once per session; never mounts under reduced motion; `aria-hidden` with the page readable behind; counter starts at `000`; **the counter and bar actually advance inside `<StrictMode>`** (323-357); it still leaves when rAF never fires (359-380); any key skips (382-387) |
| `theming` | 1 | `accent` reaches `--blue` on the root (390-396) |

### 10.2 The suite is currently RED

```
$ npx vitest run apps/landing
FAIL  apps/landing/test/landing.test.tsx > fragment nav >
      opens the same links from the hamburger, which the design source left inert
AssertionError: expected [ '#method', '#product', …(4) ] to deeply equal [ '#method', '#product', …(3) ]
+   "/deliberation/"
 ❯ apps/landing/test/landing.test.tsx:56:19

Test Files  1 failed (1)
     Tests  1 failed | 24 passed (25)
```

`landing.test.tsx:56` hardcodes five hrefs. The uncommitted change to `Header.tsx:28` added a
sixth (`/deliberation/`). Because `.github/workflows/ci.yml` runs `npm run lint`, `npm run
typecheck` and then `npm test`, **CI would go red on this alone**, before any of the harness
steps ran.

### 10.3 The tripwire a build prompt must know about

`landing.test.tsx:168-189` reads `results/metrics.json` off disk with
`readFileSync(resolve(__dirname, "../../../results/metrics.json"))` and asserts the page
matches it:

```js
const balanced: number = metrics.metric1_conflictSubsetAccuracy.arbiter.balancedAccuracy;
...
expect(screen.getAllByText(balanced.toFixed(3)).length).toBeGreaterThan(0);
```

Also asserted from the same file: `declineRate * 100` to one decimal, `committed/scored`, and
`meanUnchangedFraction.toFixed(3)`.

So **regenerating `results/metrics.json` under v2.0 will fail this test** unless
`Metrics.tsx:27` is changed at the same time. Under v2.0 only `balancedAccuracy` moves
(0.75 to 0.500); `declineRate`, `nCommitted`, `scored` and `meanUnchangedFraction` are all
unaffected by a target-definition change, per `ruleset-v2.0.json`'s `scopeNote`. The other
three literal `"0.750"` strings in `Result.tsx:19-21` and the one in `RecordSpeaks.tsx:71`
are NOT covered by any test and would silently survive.

### 10.4 What is not covered

- **No Playwright coverage.** `playwright.config.ts` and `apps/web/e2e/` cover `apps/web`
  only.
- **No visual or snapshot test.** The seeded dither (`useDitherField.ts:30`) was written to
  make a screenshot diff meaningful, and no screenshot diff exists.
- **`useDitherField` has no test at all.** It is disabled in every rendered test via
  `dither={false}`.
- **`InteractiveGrid` has no test** beyond "it does not mount under reduced motion". The
  shader, the raycast and the disposal path are untested.
- **`links.ts` has no test.** Nothing asserts that `APP_URL` or `DELIBERATION_URL` point
  anywhere real; the fragment-nav test explicitly filters to `a[href^="#"]`
  (`landing.test.tsx:30`), so the eleven external links and the two cross-surface links are
  never checked.
- **No build test.** `npm run landing:build` is absent from CI.
- **No accessibility assertion beyond aria-hidden counts.** No axe run, no colour-contrast
  check, no focus-order test.

---

## 11. Build, dev server and the unified proxy

### 11.1 `apps/landing/vite.config.ts` (42 lines)

```ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      "/app":          { target: "http://127.0.0.1:5273", ws: true },
      "/deliberation": { target: "http://127.0.0.1:5274", ws: true },
      "/api":          { target: `http://127.0.0.1:${process.env["API_PORT"] ?? 8787}`,
                         changeOrigin: false },
    },
  },
  build: { outDir: "dist" },
});
```

`ws: true` on the first two carries the proxied apps' HMR websockets. `changeOrigin: false`
on `/api` matters because `services/api` binds `127.0.0.1` and validates the Host header
path.

The `port: 5175` in this config is only used by standalone `npm run landing:dev`. Under
`npm run dev` it is overridden on the command line.

### 11.2 `tools/dev-all.mjs` (untracked, 88 lines)

`npm run dev` (`package.json:11`, also uncommitted) runs this script. It spawns four
children and fronts them all behind the landing dev server:

| name | command | port |
|---|---|---|
| `api` | `npm run api` (`tsx services/api/server.ts`) | 8787 |
| `web` | `npm run dev -w @arbiter/web -- --host 127.0.0.1 --port 5273 --strictPort --base /app/` | 5273 |
| `delib` | `npm run dev -w @arbiter/deliberation -- --host 127.0.0.1 --port 5274 --strictPort --base /deliberation/` | 5274 |
| `entry` | `npm run dev -w @arbiter/landing -- --host 127.0.0.1 --port 5173 --strictPort` | **5173** |

Resulting public surface, all one origin:

```
http://localhost:5173/                landing
http://localhost:5173/app/            apps/web (hash-routed)
http://localhost:5173/deliberation/   apps/deliberation
http://localhost:5173/api/...         services/api
```

Two behaviours worth naming: every child gets `--strictPort` so a taken port dies loudly
rather than sliding to the next one and detaching from the proxy table
(`dev-all.mjs:19-20`), and any child exiting takes the whole group down with a message naming
which one started it (`dev-all.mjs:70-77`).

Note the `--base` flags: `apps/web` and `apps/deliberation` are served under a path prefix in
dev, which the landing proxy then strips nothing from (no `rewrite`), so the two child Vite
servers must be told their base. That coupling is invisible from `vite.config.ts` alone.

### 11.3 Build output

`npm run landing:build` writes `apps/landing/dist/` with a split chunk for
`InteractiveGrid`. The current stale local build (Aug 10, gitignored per `.gitignore:79`) is:

| Asset | Size |
|---|---|
| `index.html` | 1.4 KB |
| `assets/index-CF28GO5-.css` | 31 KB |
| `assets/index-CRpkx-Y2.js` | 190 KB |
| `assets/InteractiveGrid-BJ84Y51B.js` | **503 KB** (three.js, uncompressed) |

The code split works: a reader with reduced motion set never fetches the 503 KB chunk,
because `Hero.tsx:51` gates before `lazy()` resolves.

There is **no deployment configuration anywhere in the repo**. Searched for `vercel.json`,
`netlify.toml`, `CNAME`, `.nojekyll` and any root-level `*.toml`: zero matches. No GitHub
Pages workflow. `.github/workflows/ci.yml` is the only workflow file and it deploys nothing.

---

## 12. Uncommitted working-tree state

The git status snapshot taken at session start said "clean". It is not. As of this
inventory:

```
 M apps/landing/.env.development
 M apps/landing/src/links.ts
 M apps/landing/src/sections/Header.tsx
 M apps/landing/vite.config.ts
 M apps/web/.env.development
 M package.json
?? tools/dev-all.mjs
?? docs/superpowers/plans/2026-08-13-arbiter-research-convergence.md
```

Everything that makes the unified dev server work is uncommitted:

| File | Change |
|---|---|
| `package.json` | adds `"dev": "node tools/dev-all.mjs"` |
| `tools/dev-all.mjs` | new file, the four-process launcher |
| `apps/landing/vite.config.ts` | `server: { port: 5175 }` becomes `server: { port: 5175, proxy: {...} }` |
| `apps/landing/src/links.ts` | adds `DELIBERATION_URL = "/deliberation/"` |
| `apps/landing/src/sections/Header.tsx` | adds the sixth nav entry, which is what broke the test |
| `apps/landing/.env.development` | `VITE_APP_URL` moves from `http://localhost:5173/#/case` to `/app/#/case` |
| `apps/web/.env.development` | `VITE_LANDING_URL="http://localhost:5175/"` is commented out entirely, so `landingHref()` falls through to `"/"` |

`git log --all -S"DELIBERATION_URL" --oneline` returns nothing, confirming the symbol has
never been committed on any branch.

**Implication for a build prompt:** any prompt that says "run `npm run dev`" depends on
uncommitted work. Any prompt that says "run the tests and watch them pass" will see one
pre-existing failure that is not the prompt's fault. Both need naming up front.

---

## 13. What a complete website would still need

### 13.1 Pages linked but not existing

**None.** All six fragment targets resolve (asserted by `landing.test.tsx:24-38`) and all
eleven external links point at paths that exist on `origin/main`. This is the one category
where the site is complete.

The two cross-surface links (`/app/`, `/deliberation/`) resolve only when something is
serving those paths. Under a plain `npm run landing:dev` on 5175 with nothing else running,
both 502. Under `npm run dev` both work. In a static deployment of `apps/landing/dist` alone,
both 404. Nothing on the page warns a reader about this and no test covers it.

### 13.2 Document-shell essentials that are absent

Verified by `grep -rn "og:\|twitter:\|favicon\|icon" apps/*/index.html` (zero matches) and
`ls apps/*/public` (no such directories).

| Missing | Consequence |
|---|---|
| **Favicon** | The browser requests `/favicon.ico` and gets a 404. The tab shows a blank page icon. On a shared screen during a demo this is the first thing visible |
| **Open Graph tags** (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`) | A link pasted into Slack, Teams or a submission form renders as a bare URL with no card |
| **Twitter card tags** | same |
| **Canonical URL** | no `<link rel="canonical">` |
| **`theme-color`** | no browser-chrome tint |
| **`robots.txt`, `sitemap.xml`** | absent, and arguably correct for an internal capability, but absent |
| **Structured data** (JSON-LD) | absent. Consistent with the rest of the repo: a separate search confirmed there is no PROV-O, RDF or JSON-LD anywhere |
| **404 page** | none. A deep path under a static host falls to the host's default |
| **Deployment config** | none. Nobody can deploy this without inventing the configuration |

### 13.3 Sections the playbook narrative implies but the site lacks

Comparing the four surviving claims in the playbook against what the page argues:

| Playbook claim | On the landing page? |
|---|---|
| 1. Determinism, measured. 1000 runs one hash, plus the in-browser cross-check against a committed manifest and a canonical-JSON ruleset digest | **Half.** The 1,000-run hash is stated four times (`Capabilities.tsx:26`, `Faq.tsx:18`, `UseCases.tsx:197`, `RecordSpeaks.tsx:56`). The **in-browser cross-check is never mentioned**. Searched `verdict-manifest`, `manifest`, `cross-check`, `crosscheck`, `recompute`, `digest`, `canonical`: zero matches in `apps/landing/src` |
| 2. Calibrated refusal, 260 of 267, with a structurally-forced subset that could not have committed at any evidence values | **Yes, and well.** `Metrics.tsx:24`, `Result.tsx:34`, `Faq.tsx:37`. This is the page's strongest section |
| 3. Mechanism detection is real; all five Less-concern commitments are genuine BSEP inhibitors; the gap is a missing severity axis | **Barely.** BSEP appears twice, both times about Cyclosporine specifically (`Hero.tsx:28`, `CaseView.tsx:106`, `RecordSpeaks.tsx:28`). The finding that **five of seven commitments are Less-DILI-Concern approved drugs, and that the ruleset has no vocabulary for severity, is nowhere on the page.** Searched `severity`, `Less-DILI`, `vLess`, `Most-DILI`, `approved`, `marketed`: zero matches. This is the single largest narrative gap |
| 4. Traceable adjudicated decisions: rule-cited trace plus counterfactual, hash-chained sign-off, overrides require a stated reason enforced client and server side | **Mostly.** Trace (`CaseView.tsx:81-113`), counterfactual (`Features.tsx:136-162`), hash-chained sign-off (`Features.tsx:228`, `HowItWorks.tsx:27`, `Faq.tsx:41`). **The override-with-stated-reason requirement is never mentioned.** Searched `override`, `reason`, `justif`, `sign-off reason`: only `Features.tsx` "Sign-Off Record" and generic prose |

Additional narrative gaps against the playbook:

- **The v2.0 re-registration is invisible.** The page presents v1.0 as current and never
  states that the target was corrected on 2026-08-09 or why. Given that the whole pitch is
  "we published a correction against ourselves", omitting it from the marketing surface is
  the opposite of the argument the page is making.
- **The "nothing works" reframe is absent.** The playbook thesis is that under an honest
  target no method tested clears the bar, which is what makes calibrated refusal the correct
  design. The page's Result section instead argues "we tie one stream exactly", which is the
  v1.0 framing.
- **No section about the deliberation workflow.** `apps/deliberation` is a whole second
  surface with blind submission, sign-off and a hash-chained log. It appears on the page as
  one word in the nav rail, added uncommitted, with no explanatory copy anywhere. A reader
  who does not hover the rail will never learn it exists.
- **No mention of `conflictMass` as a product capability in the abstract**, though the number
  itself is rendered (see 13.5).
- **Gate 0 / the consistency probe is not mentioned**, correctly, since it has never been run.

### 13.4 Dead affordances

| Affordance | Where | Status |
|---|---|---|
| The whole hero app mockup: `Search compound`, `⌘ K`, `Filter`, `Test split ▾`, `Open Case`, the per-row `⋮` | `Hero.tsx:132-193` | Non-interactive `div`s inside an `aria-hidden` container. They look like controls and are not. Defensible as a picture of the product; a reader on a large screen may still try to click `Open Case` |
| Persona panel tabs `Evidence | Argument | Table` | `UseCases.tsx:173-177` | same, inside `aria-hidden` |
| Vignette tabs `Streams | Conflict` | `Features.tsx:90-93` | same, but **not** `aria-hidden`, so a screen reader walks them as plain text |
| `.t-bad` CSS class | `landing.css:495-497` | Defined, never applied |
| Nav item "Record" | `Header.tsx:24` | Not dead, but lands on the "Get Started" section, not on anything about the record |
| Standards marquee items | `Standards.tsx:44-47` | Non-clickable by design. Eight named standards bodies and not one links to the body's own page or to the rule that cites it |

No genuinely broken affordance exists: there is no button that does nothing (the hamburger
was the one, and `Header.tsx:71-86` fixed it), and no anchor that goes nowhere (asserted).

### 13.5 The irony worth putting in front of a build-prompt author

`conflictMass` is rendered **three times on the marketing page** and **zero times in the
product**.

| Surface | Occurrences | Evidence |
|---|---|---|
| `apps/landing` | 3 | `CaseView.tsx:101` (`Conflict 0.122`, accent blue), `Features.tsx:59` (sign-off table column), `RecordSpeaks.tsx:28` ("Conflict mass 0.122, non-zero and contested") |
| `apps/web` | **0** | `grep -rn "conflictMass" apps/web/src` returns nothing |

`CaseView.tsx:63-66` even makes it the section's thesis: "Cyclosporine commits to do not
advance, with non-zero Dempster-Shafer conflict mass, right for the right reason." A judge who
reads the landing page and then opens the app at `/app/#/case` will look for that number and
not find it.

---

## 14. House-rule compliance

| Rule | Status in `apps/landing` |
|---|---|
| "review-ready evidence package", not "regulator-ready dossier" | Compliant. No `dossier`, no `regulator-ready`. `Standards.tsx:39` says "peer-reviewed & regulatory" of the evidence bodies |
| "positions / sign-off / decision owner", not "voting / tally / majority" | Compliant in rendered copy. "Position" is used throughout (`Metrics.tsx:41` "Positions Committed", `CaseView.tsx:59`, `Features.tsx:228`). `"majorityVote"` at `Result.tsx:21` is a baseline identifier from `metrics.json`, not governance vocabulary. One CSS **comment** at `landing.css:535` uses "quorum" and "unanimous" |
| "hash-chained audit log", not "blockchain" | Compliant. `HowItWorks.tsx:27` says "hash-chained audit log" exactly; `Features.tsx:228` and `GetStarted.tsx:24` say "hash-chained". Zero occurrences of `blockchain` or `ledger` |
| No em dashes | Compliant. Zero. Three en dashes, all in "Dempster–Shafer" |
| Counts never decide | Compliant. Nothing on the page suggests a tally gates anything. `Faq.tsx:26` and `HowItWorks.tsx:27` and `GetStarted.tsx:19` all say the committee decides |
| Registered rulesets are never edited | Compliant. `HowItWorks.tsx:31-37` explains that the six statements are quoted from the hashed file rather than reworded for the page, "Rewording one to read better on a landing page would make the printed hash a lie" |
| Pre-registration before measurement | Stated as a claim (`Capabilities.tsx:18-21`) and correct |
| Every reported number names its denominator, its class balance, and the prompt hash | **Partially violated.** Denominators are stated everywhere. **Class balance is stated nowhere** (see 6.3-D). No LLM-produced figure appears on the page, so the prompt hash is not applicable |
| A correct verdict on incorrect reasoning is a failure | Honoured in spirit: `CaseView.tsx:66` and the Cyclosporine card make "right for the right reason" the explicit argument |
| Retire the 0.750 figure | **Violated in four places.** See 6.1 |

---

## 15. Appendix: every hardcoded number on the page

For a build prompt that needs to change figures, this is the complete list of literal numeric
claims and where they live.

| Value | File:line | Source of truth |
|---|---|---|
| `97.4` | `Metrics.tsx:20` | `metrics.json metric4.declineRate` |
| `0.75` -> `0.750` | `Metrics.tsx:27` | `metrics.json metric1...balancedAccuracy` (test-enforced) |
| `7`, `/267` | `Metrics.tsx:38,40` | `metric4.nCommitted`, `sampleSizes.scored` (test-enforced) |
| `0.992` | `Metrics.tsx:45` | `metric5.meanUnchangedFraction` (test-enforced) |
| `260 of 267`, `254` | `Metrics.tsx:24` | `metric4.nDeclined`, `nStructurallyForced` |
| `n=61` | `Metrics.tsx:31` | `sampleSizes.conflictSubset` |
| `267`, `61` | `Metrics.tsx:69`, `Result.tsx:56` | as above |
| `0.88`, `0.00`, `0.12` | `Features.tsx:96,102,108` | illustrative vignette, no source |
| `34% 48% 82% 40% 52% 30%` | `Features.tsx:45-50` | decorative, no source |
| `58% 74% 64% 92% 80% 70%` | `Features.tsx:53` | decorative, no source |
| `0.992`, `2,000` | `Features.tsx:178,182` | `metric5` |
| `0.122`, `0.000 x3` | `Features.tsx:59-62` | `results.json` for Cyclosporine and Isoniazid; Troglitazone is not scored |
| `16%`, `88%`, `22%` | `Features.tsx:144,150,156` | decorative, no source |
| `ed073a8a7f6d…0b5db136` | `Capabilities.tsx:21` | `metrics.json provenance.rulesetHash` |
| `0.090 / 0.910 / 0.000` | `CaseView.tsx:75-77` | `heroCases.ts:61-63` |
| `0.886 / 0.098 / 0.122` | `CaseView.tsx:99-101` | `results.json` Cyclosporine |
| `0.90 0.85 0.85 0.50 0.60 0.40` | `HowItWorks.tsx:38-79` | `ruleset-v1.0.json` |
| `ed073a8a`, `2026-07-26` | `HowItWorks.tsx:143` | `ruleset-v1.0.json` |
| `0.750 / 6.6% / 4` (ARBITER) | `Result.tsx:19` | `metrics.json` |
| `0.750 / 6.6% / 4` (transporter) | `Result.tsx:20` | `metrics.json` |
| `0.750 / 4.9% / 3` (majorityVote) | `Result.tsx:21` | `metrics.json` |
| `0.547 / 100% / 61` (weightedAverage) | `Result.tsx:22` | `metrics.json` |
| `260 of 267`, `254`, `140` | `Result.tsx:34` | `metrics.json` + `HANDOVER.md:229` |
| `0.992`, `2,000`, `+/-50%` | `Result.tsx:39` | `metric5` |
| `267`, `61`, `260` | `UseCases.tsx:134,150,152` | `metrics.json` |
| `0.85 0.90 0.85 0.60 0.50 0.40` | `UseCases.tsx:74-79` | `ruleset-v1.0.json` |
| `0.992`, `2,000 draws` | `UseCases.tsx:204,207` | `metric5` |
| `0.090 / 0.910 / 0.50` | `RecordSpeaks.tsx:22` | `heroCases.ts` + `abstentionGapThreshold: 0.5` |
| `0.122` | `RecordSpeaks.tsx:28` | `results.json` |
| `0.85` (R3 strength) | `RecordSpeaks.tsx:38` | `ruleset-v1.0.json` |
| `2,000`, `+/-50%`, `0.992` | `RecordSpeaks.tsx:50,52` | `metric5` |
| `1,000 runs` | `RecordSpeaks.tsx:56`, `Capabilities.tsx:26`, `Faq.tsx:18`, `UseCases.tsx:197` | `determinism.test.ts:19` |
| `ed073a8a`, `v1.0` | `RecordSpeaks.tsx:63,66`, `Faq.tsx:22` | `ruleset-v1.0.json` |
| `0.750`, `n=61` | `RecordSpeaks.tsx:71-72` | `metrics.json` |
| `254 of 267` | `Faq.tsx:37` | `metric4.nStructurallyForced` |
| `20260726` | `Footer.tsx:38` | `provenance.splitSeed` |
| `+/-50%` | `Footer.tsx:39` | `metric5.perturbation` |
| `16 August 2026` | `Footer.tsx:40` | the submission deadline |
| `8+` | `Standards.tsx:36` | the eight bodies at `Standards.tsx:11-20` |
| `0.090 0.886 0.120 0.210 0.070 0.160` and gaps | `Hero.tsx:27-32` | **three of six unsourced, one wrong.** See 6.3-A |

---

## 16. Notes on documents referenced but absent from the repo

`ARBITER_Evidence_Integrated_Playbook.pdf`, described as the governing document that
supersedes the prior full-system spec, is **not in the repository**. It is at
`/Users/josegaelcruzlopez/Downloads/ARBITER_Evidence_Integrated_Playbook.pdf`.

`documents/` in the repo contains a different and older set:
`ARBITER_Round1_Master_Playbook.pdf`, `ARBITER_Pitch_Bible.pdf`,
`ARBITER - Next Steps and Differentiator.pdf`, `ARBITER - What Was Added.pdf`, the three
Pfizer hackathon PDFs and `2026 Hackathon Round 1 Guidelines.docx`. Several landing-page
source comments cite "master spec section 9a" (`landing.test.tsx:203`) and "BLUEPRINT"
(`landing.css:1`, `primitives.tsx:4`, `Landing.tsx:21`); BLUEPRINT is the landing page's own
design-system name and appears in no committed document.
