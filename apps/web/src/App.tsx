import { useEffect, useState } from "react";
import { parseHash, TAB_IDS, type TabId } from "./router.js";
import { loadData, type LoadedData } from "./data/load.js";
import { StoreProvider, useAppState } from "./state/store.js";
import { CaseTab } from "./tabs/Case/index.js";
import { CompoundsTab } from "./tabs/Compounds.js";
import { RulesetTab } from "./tabs/Ruleset.js";
import { ValidationTab } from "./tabs/Validation.js";
import { RecordTab } from "./tabs/Record.js";
import { TourFooter } from "./tour/TourFooter.js";
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

function AppShell({ tab }: { tab: TabId }) {
  const { motion } = useAppState();
  const [preflight, setPreflight] = useState(false);

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
    <div data-motion={motion ? "on" : "off"}>
      <nav style={{ background: "var(--deep)", padding: "10px 20px", display: "flex", gap: 18 }}>
        {TAB_IDS.map((t) => (
          <a key={t} href={`#/${t}`} aria-current={t === tab ? "page" : undefined}
             style={{ color: "#fff", textDecoration: t === tab ? "underline" : "none", textTransform: "capitalize" }}>
            {t}
          </a>
        ))}
      </nav>
      {tab === "case" ? <CaseTab />
        : tab === "compounds" ? <CompoundsTab />
        : tab === "ruleset" ? <RulesetTab />
        : tab === "validation" ? <ValidationTab />
        : <RecordTab />}
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
