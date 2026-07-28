import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider, useAppState } from "../src/state/store.js";
import { RecordTab } from "../src/tabs/Record.js";
import { recordHash } from "../src/record/chain.js";
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

function readPositions(): Array<{ prevRecordHash: string; evidenceSnapshotHash: string; [k: string]: unknown }> {
  return JSON.parse(screen.getByTestId("positions-json").textContent ?? "[]");
}

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
