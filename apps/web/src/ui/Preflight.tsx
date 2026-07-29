import { useEffect, useState, type ReactNode } from "react";
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

/**
 * The marker word. A pass and a failure are told apart by READING first - the
 * colour only agrees with what the word already said - because a red dot and a
 * green dot are the same dot to a colour-blind judge and to a compressed
 * screen-share.
 */
type Tone = "pass" | "fail" | "pending" | "note" | "info";
const MARK: Record<Tone, string> = {
  pass: "PASS",
  fail: "FAIL",
  pending: "…",
  note: "NOTE",
  info: "—",
};

/**
 * `data-ok` is the contract the tests read and it is passed through untouched,
 * including its "pending" and "error" states. `data-tone` is presentation only:
 * it exists so that check-edits can render as a note while still reporting
 * data-ok="false", which is exactly what a live edit is - not a failure.
 */
function Check(
  { id, ok, tone, children }: { id: string; ok?: string; tone: Tone; children: ReactNode },
) {
  return (
    <li className="check" data-testid={id} data-ok={ok} data-tone={tone}>
      <span className="check-mark" aria-hidden="true">{MARK[tone]}</span>
      <span>{children}</span>
    </li>
  );
}

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

  return (
    // The one genuinely floating surface in the app, and so the only user of
    // .floating: it is summoned with ? over whatever is already on screen.
    <aside data-testid="preflight" className="panel floating preflight">
      <h3 className="label">Pre-flight</h3>
      <ul className="check-list">
        {/* "pending" while the digest is in flight, NOT "false". hashOk compares a
            null hash before Web Crypto resolves, so String(hashOk) rendered
            data-ok="false" on the very first paint - the panel reporting a FAILED
            pre-registration check before it had run one, in red. Caught by CI as a
            flaky test, which is how a real state bug usually presents. */}
        <Check
          id="check-ruleset"
          ok={hashError ? "error" : hash === null ? "pending" : String(hashOk)}
          tone={hashError ? "fail" : hash === null ? "pending" : hashOk ? "pass" : "fail"}
        >
          {hashError !== null
            ? `Could not compute the ruleset hash: ${hashError}`
            : hash === null
              ? "Hashing the ruleset…"
              : hashOk
                ? `Ruleset ${data.ruleset.version} — ${hash.slice(0, 8)}… matches the pre-registered hash`
                : `Ruleset ${data.ruleset.version} hashes to ${hash.slice(0, 8)}… but ${PRE_REGISTERED_HASH.slice(0, 8)}… was pre-registered — do not present these numbers as pre-registered`}
        </Check>

        <Check
          id="check-manifest"
          ok={String(mismatches.length === 0)}
          tone={mismatches.length === 0 ? "pass" : "fail"}
        >
          {mismatches.length === 0
            ? `Live recomputation agrees with the committed manifest on all ${data.testSplit.length} compounds`
            : `${mismatches.length} of ${data.testSplit.length} compounds disagree with the committed manifest (${mismatches.slice(0, 3).join(", ")}…) — investigate before presenting`}
        </Check>

        <Check
          id="check-errors"
          ok={String(errored.length === 0)}
          tone={errored.length === 0 ? "pass" : "fail"}
        >
          {errored.length === 0
            ? "No compound threw during recomputation"
            : `${errored.length} compounds threw and are being shown as abstain — ${errored.slice(0, 3).join(", ")}`}
        </Check>

        {/* Not a failure. Editing the ruleset is the product - but saying so out
            loud stops someone quoting a number that came from a dragged slider. */}
        <Check id="check-edits" ok={String(!edited)} tone={edited ? "note" : "pass"}>
          {edited
            ? "The ruleset on screen has live edits — press Reset on the Ruleset tab before quoting a metric"
            : "No live edits: the ruleset on screen is the registered one"}
        </Check>

        <Check id="check-evidence" tone="info">
          Evidence: {data.claimsByCompound.size} compounds with claims, {data.testSplit.length} scored;
          fixture citations {data.fixture.citationStatus}
        </Check>

        <Check id="check-network" tone="info">
          All data is bundled into this page. No network call is made at any point, so
          losing the connection mid-demo changes nothing.
        </Check>
      </ul>
      <p className="small muted">? to close</p>
    </aside>
  );
}
