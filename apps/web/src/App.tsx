import { useEffect, useState } from "react";
import { parseHash, TAB_IDS, type TabId } from "./router.js";
import { loadData, type LoadedData } from "./data/load.js";
import { StoreProvider, useAppState } from "./state/store.js";
import { AboutTab } from "./tabs/About.js";
import { CaseTab } from "./tabs/Case/index.js";
import { CompoundsTab } from "./tabs/Compounds.js";
import { RulesetTab } from "./tabs/Ruleset.js";
import { ValidationTab } from "./tabs/Validation.js";
import { RecordTab } from "./tabs/Record.js";
import { IntakeTab } from "./tabs/Intake.js";
import { TourFooter } from "./tour/TourFooter.js";
import { NavigatorBar } from "./ai/NavigatorBar.js";
import { useAnchorScroll } from "./ai/useAnchorScroll.js";
import { Preflight } from "./ui/Preflight.js";
import { isTypingTarget } from "./ui/isTypingTarget.js";
import "./ui/motion.css";

/**
 * Load once, but INSIDE a render.
 *
 * This was `const data = loadData()` at module scope, which is the one place a
 * throw cannot be seen: module evaluation happens before React mounts, so the
 * ErrorBoundary in main.tsx never got the chance to catch it and
 * `createRoot(...).render(...)` never ran at all. The result was a blank page -
 * the same failure as HANDOVER 6.1, and the exact opposite of what load.ts
 * promises when it says a malformed file "must fail HERE, naming itself". An
 * error message nobody can see does not name itself.
 *
 * Called from App's render instead, the same throw is a render-phase error, which
 * the boundary catches and prints. Memoised rather than re-run per render because
 * loadData parses every bundled claim through zod, and StrictMode renders twice.
 */
let loaded: LoadedData | null = null;
function loadDataOnce(): LoadedData {
  if (loaded === null) loaded = loadData();
  return loaded;
}

/**
 * Nav labels, written out rather than capitalised from the id.
 *
 * Typed as a total Record<TabId, string>, so adding a tab to TAB_IDS without
 * deciding what it is called in the nav fails the typecheck instead of quietly
 * rendering a lowercase route name.
 */
const TAB_LABEL: Record<TabId, string> = {
  about: "About",
  compounds: "Compounds",
  case: "Case",
  ruleset: "Ruleset",
  validation: "Validation",
  record: "Record",
  intake: "Intake",
};

function AppShell({ tab }: { tab: TabId }) {
  const { motion } = useAppState();
  const [preflight, setPreflight] = useState(false);

  // Here rather than inside NavigatorBar: the hook needs the tab that is
  // actually rendered, which is what tells it the deferred hashchange has
  // landed (spec section 8).
  useAnchorScroll(tab);

  // `?` rather than a visible button: it is for the presenter in the ninety
  // seconds before going live, not part of the story a judge is shown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || isTypingTarget(e.target)) return;
      setPreflight((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="shell" data-motion={motion ? "on" : "off"}>
      {/* First thing in the tab order, off-screen until it is focused. The nav is
          sticky and six links long and is re-read on every tab change.

          The default is prevented because the fragment belongs to the ROUTER:
          letting `#main` reach the address bar fires hashchange, parseHash reads
          "main" as an unrecognised route, and the skip link silently throws the
          reader onto the case tab. Moving focus by hand is the whole behaviour
          anyway - the scroll comes free with focus() on a tabindex=-1 element. */}
      <a className="skip-link" href="#main"
         onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
        Skip to content
      </a>

      <nav className="nav">
        <a className="nav-brand" href="#/about">ARBITER<span> · evidence under conflict</span></a>
        {TAB_IDS.map((t) => (
          // aria-current, not only the underline: which tab you are on was
          // previously carried by a text-decoration and nothing else, so it was
          // invisible to a screen reader and to anyone reading a compressed
          // share. app.css pairs the attribute with a rule AND a colour change.
          <a key={t} href={`#/${t}`} aria-current={t === tab ? "page" : undefined}>
            {TAB_LABEL[t]}
          </a>
        ))}
        {/* The `?` pre-flight key is deliberately NOT advertised here: it is for
            the presenter before going live, not part of what a judge is shown.
            It is written down on the About tab, where the rest of the keys are. */}
        <div className="nav-right"><span className="nav-hint">←/→ beats · M motion</span></div>
      </nav>

      {/* Between the nav and the tab body, per spec section 7.3: a question is
          asked about whatever is on screen, so the bar belongs above it and
          outside it - the same reasoning that keeps TourFooter outside <main>. */}
      <NavigatorBar />

      {/* tabIndex -1 so the skip link can actually move focus here; a plain
          fragment jump scrolls without moving the caret in some browsers. */}
      <main className="main" id="main" tabIndex={-1}>
        <div className="container">
          {tab === "about" ? <AboutTab />
            : tab === "case" ? <CaseTab />
            : tab === "compounds" ? <CompoundsTab />
            : tab === "ruleset" ? <RulesetTab />
            : tab === "validation" ? <ValidationTab />
            : tab === "intake" ? <IntakeTab />
            : <RecordTab />}
        </div>
      </main>

      {preflight ? <Preflight /> : null}
      <TourFooter />
    </div>
  );
}

export function App() {
  const data = loadDataOnce();
  const [tab, setTab] = useState<TabId>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setTab(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <StoreProvider data={data}>
      <AppShell tab={tab} />
    </StoreProvider>
  );
}
