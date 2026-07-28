import { useEffect, useState } from "react";
import { useAppState } from "../state/store.js";
import { useLibraryVerdicts } from "../engine/useLibraryVerdicts.js";
import { browserRulesetHash, PRE_REGISTERED_HASH } from "../data/rulesetHash.js";

/**
 * What a presenter needs to confirm ninety seconds before going live.
 *
 * Every line here is a CHECK, computed now, not a caption. The distinction is the
 * whole point: printing the pre-registered hash next to the words "as registered"
 * would read exactly the same on a ruleset that had silently drifted, which is the
 * failure it claims to rule out. So the hash is recomputed in the browser from the
 * bundled ruleset and compared, and the verdicts are recomputed and compared to
 * the committed manifest. A failure appears in red and says what to do.
 */
export function Preflight() {
  const { data, ruleset } = useAppState();
  // Deliberately the REGISTERED ruleset, not the working copy - see the override
  // comment in useLibraryVerdicts.
  const live = useLibraryVerdicts(data.ruleset);

  const [hash, setHash] = useState<string | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    browserRulesetHash(data.ruleset)
      .then((h) => { if (!cancelled) setHash(h); })
      // Web Crypto is unavailable in an insecure context. Saying so beats an
      // empty line that reads as a passing check.
      .catch((e: Error) => { if (!cancelled) setHashError(e.message); });
    return () => { cancelled = true; };
  }, [data.ruleset]);

  const hashOk = hash === PRE_REGISTERED_HASH;
  const mismatches = data.testSplit.filter(
    (id) => live.get(id)?.verdict !== data.manifest.get(id)?.verdict,
  );
  const errored = data.testSplit.filter((id) => live.get(id)?.error !== undefined);
  const edited = ruleset !== data.ruleset;

  const bad = { color: "var(--toxic)", fontWeight: 600 };

  return (
    <aside data-testid="preflight"
           style={{ padding: 16, borderTop: "1px solid var(--hairline)", background: "var(--surface)" }}>
      <h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Pre-flight</h3>
      <ul style={{ fontSize: 13, lineHeight: 1.7 }}>
        <li data-testid="check-ruleset" data-ok={hashError ? "error" : String(hashOk)}
            style={hashOk ? undefined : bad}>
          {hashError !== null
            ? `Could not compute the ruleset hash: ${hashError}`
            : hash === null
              ? "Hashing the ruleset…"
              : hashOk
                ? `Ruleset ${data.ruleset.version} — ${hash.slice(0, 8)}… matches the pre-registered hash`
                : `Ruleset ${data.ruleset.version} hashes to ${hash.slice(0, 8)}… but ${PRE_REGISTERED_HASH.slice(0, 8)}… was pre-registered — do not present these numbers as pre-registered`}
        </li>

        <li data-testid="check-manifest" data-ok={String(mismatches.length === 0)}
            style={mismatches.length === 0 ? undefined : bad}>
          {mismatches.length === 0
            ? `Live recomputation agrees with the committed manifest on all ${data.testSplit.length} compounds`
            : `${mismatches.length} of ${data.testSplit.length} compounds disagree with the committed manifest (${mismatches.slice(0, 3).join(", ")}…) — investigate before presenting`}
        </li>

        <li data-testid="check-errors" data-ok={String(errored.length === 0)}
            style={errored.length === 0 ? undefined : bad}>
          {errored.length === 0
            ? "No compound threw during recomputation"
            : `${errored.length} compounds threw and are being shown as abstain — ${errored.slice(0, 3).join(", ")}`}
        </li>

        {/* Not a failure. Editing the ruleset is the product - but saying so out
            loud stops someone quoting a number that came from a dragged slider. */}
        <li data-testid="check-edits" data-ok={String(!edited)}
            style={edited ? { color: "var(--muted)", fontWeight: 600 } : undefined}>
          {edited
            ? "The ruleset on screen has live edits — press Reset on the Ruleset tab before quoting a metric"
            : "No live edits: the ruleset on screen is the registered one"}
        </li>

        <li data-testid="check-evidence">
          Evidence: {data.claimsByCompound.size} compounds with claims, {data.testSplit.length} scored;
          fixture citations {data.fixture.citationStatus}
        </li>

        <li data-testid="check-network">
          All data is bundled into this page. No network call is made at any point, so
          losing the connection mid-demo changes nothing.
        </li>
      </ul>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>? to close</p>
    </aside>
  );
}
