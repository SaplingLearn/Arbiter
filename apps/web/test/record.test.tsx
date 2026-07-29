import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider, useAppState } from "../src/state/store.js";
import { RecordTab } from "../src/tabs/Record.js";
import { RulesetTab } from "../src/tabs/Ruleset.js";
import { recordHash } from "../src/record/chain.js";
import { browserRulesetHash, PRE_REGISTERED_HASH } from "../src/data/rulesetHash.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

/** Test-only harness: dumps the raw positions array (full hashes, not the
 *  12-char slices Record.tsx renders) so tests can assert on exact values. */
function PositionsDump() {
  const { positions } = useAppState();
  return <div data-testid="positions-json">{JSON.stringify(positions)}</div>;
}

const renderTab = () =>
  render(
    <StoreProvider data={data}>
      <RecordTab />
      <PositionsDump />
    </StoreProvider>,
  );

/** Both tabs over ONE store, so the ruleset edit a test makes is the same edit a
 *  toxicologist makes with the slider - not a test-only dispatch that could drift
 *  from the control the app actually ships. */
const renderTabWithRulesetEditor = () =>
  render(
    <StoreProvider data={data}>
      <RecordTab />
      <RulesetTab />
      <PositionsDump />
    </StoreProvider>,
  );

function readPositions(): Array<{
  prevRecordHash: string;
  evidenceSnapshotHash: string;
  rulesetHash: string;
  [k: string]: unknown;
}> {
  return JSON.parse(screen.getByTestId("positions-json").textContent ?? "[]");
}

const clickSign = () => fireEvent.click(screen.getByRole("button", { name: /^sign$/i }));

describe("RecordTab chaining (end-to-end guard)", () => {
  it("chains prevRecordHash to the FULL hash of the previous entry, not its evidenceSnapshotHash", async () => {
    // This is the guard for the critical defect: `prevRecordHash` must equal
    // recordHash(previous entry), which covers reviewerId/displayName/position/
    // rationale/prevRecordHash too - not just re-expose evidenceSnapshotHash,
    // which is blind to all of that.
    renderTab();

    fireEvent.change(screen.getByLabelText("Reviewer"), { target: { value: "Reviewer A" } });
    fireEvent.change(screen.getByLabelText("Rationale"), { target: { value: "A's rationale" } });
    fireEvent.click(screen.getByRole("button", { name: /sign/i }));
    await waitFor(() => expect(readPositions()).toHaveLength(1));

    fireEvent.change(screen.getByLabelText("Reviewer"), { target: { value: "Reviewer B" } });
    fireEvent.change(screen.getByLabelText("Rationale"), { target: { value: "B's rationale" } });
    fireEvent.click(screen.getByRole("button", { name: /sign/i }));
    await waitFor(() => expect(readPositions()).toHaveLength(2));

    const [first, second] = readPositions();
    const expectedPrev = await recordHash(first as never);

    expect(second!.prevRecordHash).toBe(expectedPrev);
    // The defect this guards against: prevRecordHash silently re-exposing the
    // evidence snapshot hash instead of chaining to the full prior record.
    expect(second!.prevRecordHash).not.toBe(first!.evidenceSnapshotHash);
  });
});

describe("RecordTab ruleset binding", () => {
  it("records the HASH of the ruleset on screen, not its version string", async () => {
    // A version string is not a hash. "1.0" is byte-identical across every edit a
    // toxicologist can make, so a record carrying it cannot tell a position signed
    // under the registered ruleset from one signed under a ruleset with R1 dragged
    // to 0.05 - which falsifies the tamper-evidence claim outright.
    renderTab();
    clickSign();
    await waitFor(() => expect(readPositions()).toHaveLength(1));

    const [signed] = readPositions();
    expect(signed!.rulesetHash).toBe(await browserRulesetHash(data.ruleset));
    // Unedited, that is the pre-registered hash - so a reader can check the record
    // against the registration without re-deriving anything.
    expect(signed!.rulesetHash).toBe(PRE_REGISTERED_HASH);
  });

  it("records a DIFFERENT hash once a rule strength has been edited on screen", async () => {
    renderTabWithRulesetEditor();

    clickSign();
    await waitFor(() => expect(readPositions()).toHaveLength(1));

    // R1, not R3: R1 is the rule that actually moves this fixture (see
    // apps/web/e2e/demo.spec.ts). The hash must move for ANY edit, but using the
    // rule that visibly changes the case keeps the test honest about the scenario.
    fireEvent.change(screen.getByTestId("strength-R1"), { target: { value: "0.05" } });
    expect(screen.getByTestId("modified-badge")).toBeTruthy();

    clickSign();
    await waitFor(() => expect(readPositions()).toHaveLength(2));

    const [before, after] = readPositions();
    expect(after!.rulesetHash).not.toBe(before!.rulesetHash);
    expect(after!.rulesetHash).toBe(await browserRulesetHash({
      ...data.ruleset,
      rules: data.ruleset.rules.map((r) => (r.id === "R1" ? { ...r, strength: 0.05 } : r)),
    }));
    expect(after!.rulesetHash).not.toBe(PRE_REGISTERED_HASH);
  });
});
