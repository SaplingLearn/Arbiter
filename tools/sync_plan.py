"""Splice verified source files into the plan's fenced code blocks, then prove equality.

Written because three of this project's plan-originated defects were transcription
drift between the plan and the code, and because a hand-splice already corrupted the
document once (a README containing its own ``` closed the outer three-backtick fence
early and silently shifted every boundary after it).

Usage:
    python sync_plan.py                 # verify only, exit 1 on any drift
    python sync_plan.py --write         # splice sources into the plan, then verify

A file is matched to its block by a marker that must appear in exactly ONE block.
Ambiguity is reported, never guessed at.
"""
import io
import sys

PLAN = "docs/superpowers/plans/2026-07-26-arbiter-phase1-engine-and-numbers.md"

# path -> marker that uniquely identifies its fenced block in the plan
TARGETS = {
    "packages/engine/src/types.ts": "export interface Reasoning",
    "packages/engine/src/schema.ts": "export const EvidenceClaimSchema",
    "packages/engine/src/fuse.ts": "export interface Mass {",
    "packages/engine/src/rules.ts": "export function conflictsWith(",
    "packages/engine/src/argue.ts": "export function argue(",
    "packages/engine/src/abstain.ts": "export function shouldAbstain(",
    "packages/engine/src/conflict.ts": "export function detectConflict(",
    "packages/engine/src/counterfactual.ts": "export function findCounterfactual(",
    "packages/engine/test/counterfactual.test.ts": 'describe("findCounterfactual"',
    "packages/engine/src/index.ts": 'import { shouldAbstain } from "./abstain.js";',
    "packages/engine/test/fuse.test.ts": 'describe("claimToMass"',
    "packages/engine/test/rules.test.ts": 'describe("conflictsWith"',
    "packages/engine/test/argue.test.ts": 'describe("argue"',
    "packages/engine/test/abstain.test.ts": 'describe("shouldAbstain"',
    "packages/engine/test/conflict.test.ts": 'describe("detectConflict"',
    "packages/engine/test/reason.test.ts": 'it("reads the verdict off the fused mass',
    "packages/engine/test/determinism.test.ts": 'describe("determinism"',
    "data/prep/spike_conflict_count.py": "Task-zero spike",
    "data/prep/README.md": "DILIrank (manual download",
}


def read_lines(path):
    s = io.open(path, encoding="utf-8").read().split("\n")
    return s[:-1] if s and s[-1] == "" else s


def blocks(lines):
    """Every fenced block, fence-length aware so a nested ``` cannot close a ````."""
    out, i = [], 0
    while i < len(lines):
        st = lines[i].lstrip()
        if st.startswith("```"):
            fence = "`" * (len(st) - len(st.lstrip("`")))
            j = i + 1
            while j < len(lines) and lines[j].strip() != fence:
                j += 1
            out.append((i, j, j >= len(lines)))
            i = j + 1
        else:
            i += 1
    return out


def check_fences(lines):
    bs = blocks(lines)
    unclosed = [b[0] + 1 for b in bs if b[2]]
    return len(bs), unclosed


def locate(lines, marker):
    hits = []
    for s, e, bad in blocks(lines):
        if bad:
            continue
        if marker in "\n".join(lines[s + 1:e]):
            hits.append((s, e))
    return hits


def main():
    write = "--write" in sys.argv
    lines = read_lines(PLAN)

    n, unclosed = check_fences(lines)
    print(f"fence integrity: {n} blocks, {len(unclosed)} unclosed {unclosed}")
    if unclosed:
        print("*** ABORT: unclosed fence. A block containing ``` needs a ```` fence.")
        return 1

    present = {p: m for p, m in TARGETS.items() if io.open(p, encoding="utf-8", errors="ignore")}
    plan_targets = []
    for path, marker in TARGETS.items():
        try:
            io.open(path, encoding="utf-8").read()
        except OSError:
            print(f"  skip (no such file): {path}")
            continue
        hits = locate(lines, marker)
        if len(hits) != 1:
            print(f"  *** AMBIGUOUS ({len(hits)} blocks) for {path} via marker {marker!r} - handle manually")
            continue
        plan_targets.append((hits[0][0], hits[0][1], path))

    if write:
        for s, e, path in sorted(plan_targets, reverse=True):
            src = read_lines(path)
            lines[s + 1:e] = src
        io.open(PLAN, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
        lines = read_lines(PLAN)
        n, unclosed = check_fences(lines)
        print(f"after write: {n} blocks, {len(unclosed)} unclosed {unclosed}")
        if unclosed:
            print("*** ABORT: writing introduced an unclosed fence.")
            return 1

    bad = 0
    for path, marker in TARGETS.items():
        try:
            src = io.open(path, encoding="utf-8").read()
        except OSError:
            continue
        hits = locate(lines, marker)
        if len(hits) != 1:
            bad += 1
            continue
        s, e = hits[0]
        block = "\n".join(lines[s + 1:e]) + "\n"
        if block == src:
            print(f"  ok   {path}  -> plan {s + 2}-{e}")
        else:
            bad += 1
            bl, sl = block.split("\n"), src.split("\n")
            d = next((k for k in range(max(len(bl), len(sl)))
                      if (bl[k] if k < len(bl) else None) != (sl[k] if k < len(sl) else None)), None)
            print(f"  DRIFT {path}  -> plan {s + 2}-{e}: plan {len(bl)}L vs src {len(sl)}L, first diff line {d}")
            if d is not None:
                print(f"        plan: {(bl[d] if d < len(bl) else '<eof>')!r}")
                print(f"        src : {(sl[d] if d < len(sl) else '<eof>')!r}")
    print("DRIFT-FREE" if bad == 0 else f"*** {bad} file(s) drifted")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
