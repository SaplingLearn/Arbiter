import { useEffect, useState, type ReactNode } from "react";
import { useAppState, workingClaims } from "../state/store.js";
import { useLibraryVerdicts } from "../engine/useLibraryVerdicts.js";
import { browserRulesetHash, PRE_REGISTERED_HASH } from "../data/rulesetHash.js";
import { browserEvidenceDigest } from "../data/evidenceDigest.js";
import { ANCHORS } from "../ai/anchors.js";
import { interpret } from "../ai/interpret.js";
import { navigate } from "../ai/navigate.js";
import type { Source } from "../ai/resolve.js";

/**
 * What a presenter needs to confirm ninety seconds before going live.
 *
 * Every line here is a CHECK, computed now, not a caption. The distinction is the
 * whole point: printing the pre-registered hash next to the words "as registered"
 * would read exactly the same on a ruleset that had silently drifted, which is the
 * failure it claims to rule out. So the hash is recomputed in the browser from the
 * bundled ruleset and compared, the verdicts are recomputed and compared to the
 * committed manifest, the evidence is digested and compared to the registered
 * evidence, and BOTH AI LADDERS ARE ACTUALLY RUN so the panel reports which rung
 * answered rather than asserting one. A failure appears in red and says what to do.
 *
 * The line this phase deleted said "No network call is made at any point". True in
 * Phase 2, false on a served build with a live surface (spec §10, correction 6). It
 * is replaced by per-surface reporting driven by the same `source` value the
 * resolvers return - which on the static ZIP reads `cache` for every surface, both
 * honest and exactly the state the artifact is supposed to be in.
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
 *
 * `data-source` is a second, independent contract for the two AI-ladder lines:
 * which rung actually answered ("live" | "cache" | "local" | "none"), or
 * "pending" before the ladder has resolved. It is optional and orthogonal to
 * data-ok - a surface reporting "cache" is not a pass/fail outcome, it is a fact.
 */
function Check(
  { id, ok, tone, source, children }:
    { id: string; ok?: string; tone: Tone; source?: string; children: ReactNode },
) {
  return (
    <li className="check" data-testid={id} data-ok={ok} data-tone={tone} data-source={source}>
      <span className="check-mark" aria-hidden="true">{MARK[tone]}</span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Probe inputs. The panel needs a resolution to report, and a resolution needs an
 * input; these are ordinary questions of the kind the demo answers, drawn from the
 * §12b prepared Q&A the caches were authored from.
 *
 * They are not asserted to hit any particular rung. If the authored cache drifts
 * away from them the panel reports a lower rung and says so, which is the correct
 * behaviour for a panel whose rule is that every line is computed now.
 *
 * The interpret probe passes NO CLAIMS. Rungs 2-5 match on challenge text alone,
 * and a pre-flight panel is the last place that should be assembling an evidence
 * payload.
 */
const PROBE_CHALLENGE = "The rat study should not carry this much weight";
const PROBE_QUESTION = "Which rule discounted the murine study?";

interface Reported { rung: number; source: Source }

export function Preflight() {
  const state = useAppState();
  const { data, ruleset, evidenceEdits } = state;
  // Deliberately the REGISTERED ruleset, not the working copy - see the override
  // comment in useLibraryVerdicts.
  const live = useLibraryVerdicts(data.ruleset);

  const [hash, setHash] = useState<string | null>(null);
  const [workingHash, setWorkingHash] = useState<string | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ registered: string; working: string } | null>(null);
  const [surface1, setSurface1] = useState<Reported | null>(null);
  const [surface3, setSurface3] = useState<Reported | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([browserRulesetHash(data.ruleset), browserRulesetHash(ruleset)])
      .then(([registered, working]) => {
        if (cancelled) return;
        setHash(registered);
        setWorkingHash(working);
      })
      // Web Crypto is unavailable in an insecure context. Saying so beats an
      // empty line that reads as a passing check.
      .catch((e: Error) => { if (!cancelled) setHashError(e.message); });
    return () => { cancelled = true; };
  }, [data.ruleset, ruleset]);

  useEffect(() => {
    let cancelled = false;
    // The whole corpus, not just the selected compound: an edit anywhere must show
    // up here. workingClaims is the ONE definition of "apply the overrides" (spec
    // §9), routed through rather than reimplemented.
    const compoundIds = [...data.claimsByCompound.keys()];
    const registeredClaims = compoundIds.flatMap((id) => data.claimsByCompound.get(id) ?? []);
    const working = compoundIds.flatMap((id) => workingClaims(state, id));
    Promise.all([browserEvidenceDigest(registeredClaims), browserEvidenceDigest(working)])
      .then(([registered, workingDigest]) => {
        if (!cancelled) setEvidence({ registered, working: workingDigest });
      })
      .catch((e: Error) => { if (!cancelled) setHashError(e.message); });
    return () => { cancelled = true; };
    // Deliberately NOT depending on the whole `state` object, which is a new
    // reference on every dispatch (selecting a compound, moving the as-of date,
    // a tour beat). Only evidenceEdits can move what this effect computes -
    // data.claimsByCompound is immutable exactly as data.ruleset is - so that is
    // the one piece of state this effect actually needs to react to. When it
    // fires, `state` is read fresh from this render's closure, which already
    // carries the evidenceEdits that triggered it.
  }, [data.claimsByCompound, evidenceEdits]);

  useEffect(() => {
    let cancelled = false;
    void interpret({
      challenge: PROBE_CHALLENGE,
      rules: data.ruleset.rules.map((r) => ({ id: r.id, enabled: r.enabled, strength: r.strength })),
      claims: [],
    }).then((r) => { if (!cancelled) setSurface1({ rung: r.rung, source: r.source }); });

    void navigate({
      question: PROBE_QUESTION,
      anchors: Object.entries(ANCHORS).map(([id, a]) => ({ id, label: a.label })),
    }).then((r) => { if (!cancelled) setSurface3({ rung: r.rung, source: r.source }); });

    return () => { cancelled = true; };
  }, [data.ruleset]);

  const hashOk = hash === PRE_REGISTERED_HASH;
  const mismatches = data.testSplit.filter(
    (id) => live.get(id)?.verdict !== data.manifest.get(id)?.verdict,
  );
  const errored = data.testSplit.filter((id) => live.get(id)?.error !== undefined);

  // §9.3: Preflight tested "edited" by reference while Ruleset.tsx deep-compared, so
  // dragging a slider and dragging it back left the panel warning about live edits
  // the MODIFIED badge had already cleared. Task 3 fixed that with one value-compare
  // predicate shared by both. This supersedes the pre-flight side of that fix with
  // the digest comparison check-ruleset already proved out: a content comparison,
  // so a drag-and-return clears the warning exactly as it clears the MODIFIED badge.
  // Ruleset.tsx keeps the value-compare predicate for its own badge - unchanged.
  const rulesetEdited = hash !== null && workingHash !== null && hash !== workingHash;
  const evidenceEdited = evidence !== null && evidence.registered !== evidence.working;

  const surfaceLine = (r: Reported | null, what: string): string => {
    if (r === null) return `${what}: Checking which rung answers…`;
    if (r.source === "live") {
      return `${what}: answered live (rung ${r.rung}). If the connection drops it falls back to the bundled cache.`;
    }
    return `${what}: answered from the bundled cache (rung ${r.rung}, source ${r.source}), so losing the connection changes nothing.`;
  };

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
        <Check
          id="check-edits"
          ok={workingHash === null ? "pending" : String(!rulesetEdited)}
          tone={workingHash === null ? "pending" : rulesetEdited ? "note" : "pass"}
        >
          {workingHash === null
            ? "Hashing the ruleset on screen…"
            : rulesetEdited
              ? `The ruleset on screen hashes to ${workingHash.slice(0, 8)}… and has live edits — press Reset on the Ruleset tab before quoting a metric`
              : "No live edits: the ruleset on screen is the registered one"}
        </Check>

        {/* The honesty constraint, spec §9.2. The line above can say "the registered
            one" BECAUSE check-ruleset proved it. There is no analogous
            pre-registered digest over evidence, so this one recomputes both sides
            and compares - a check, with the digest on screen, rather than a
            reassuring sentence that would read identically on drifted evidence. */}
        <Check
          id="check-evidence-edits"
          ok={evidence === null ? "pending" : String(!evidenceEdited)}
          tone={evidence === null ? "pending" : evidenceEdited ? "note" : "pass"}
        >
          {evidence === null
            ? "Digesting the evidence on screen…"
            : evidenceEdited
              ? `The evidence on screen has live edits — ${evidence.working.slice(0, 8)}… against registered ${evidence.registered.slice(0, 8)}… — press Reset on the Case tab before quoting a metric`
              : `No live edits: the evidence on screen digests to ${evidence.registered.slice(0, 8)}…, the registered value`}
        </Check>

        <Check id="check-evidence" tone="info">
          Evidence: {data.claimsByCompound.size} compounds with claims, {data.testSplit.length} scored;
          fixture citations {data.fixture.citationStatus}
        </Check>

        <Check
          id="check-surface-1"
          tone={surface1 === null ? "pending" : "info"}
          source={surface1?.source ?? "pending"}
        >
          {surfaceLine(surface1, "Challenge interpreter")}
        </Check>

        <Check
          id="check-surface-3"
          tone={surface3 === null ? "pending" : "info"}
          source={surface3?.source ?? "pending"}
        >
          {surfaceLine(surface3, "Navigator")}
        </Check>

        <Check id="check-bundle" tone="info">
          Every number on screen is recomputed in this browser from data compiled into this page.
          A live surface is one optional rung on top of that, never underneath it.
        </Check>
      </ul>
      <p className="small muted">? to close</p>
    </aside>
  );
}
