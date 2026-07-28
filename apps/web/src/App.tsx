import { useEffect, useState } from "react";
import { parseHash, TAB_IDS, type TabId } from "./router.js";
import { loadData } from "./data/load.js";
import { StoreProvider } from "./state/store.js";
import { CaseTab } from "./tabs/Case/index.js";
import { CompoundsTab } from "./tabs/Compounds.js";
import { RulesetTab } from "./tabs/Ruleset.js";
import { ValidationTab } from "./tabs/Validation.js";
import { RecordTab } from "./tabs/Record.js";

const data = loadData();

export function App() {
  const [tab, setTab] = useState<TabId>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setTab(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <StoreProvider data={data}>
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
    </StoreProvider>
  );
}
