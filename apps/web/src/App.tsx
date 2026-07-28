import { useEffect, useState } from "react";
import { parseHash, type TabId } from "./router.js";

export function App() {
  const [tab, setTab] = useState<TabId>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setTab(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return <main><h1>ARBITER</h1><p>tab: {tab}</p></main>;
}
