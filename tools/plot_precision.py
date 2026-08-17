"""What sample size buys, and what it would cost to buy more.

THE QUESTION THIS ANSWERS. The scoreboard shows ten rates between 83% and 95%, and the
first serious question about any of them is "how much do you actually know?" A rate of
87.5% from 14 of 16 and a rate of 95.2% from 99 of 104 look comparable on a bar chart and
are not: the first is consistent with a true rate anywhere from 64% upward, the second
narrows it to 89%. That difference is not a matter of opinion, it is a property of the
sample size, and it is worth showing rather than asserting.

THE MATHS, and why this form of it.

  A rate here is a binomial proportion: k successes in n independent trials. The
  uncertainty is summarised with a WILSON SCORE INTERVAL rather than the normal
  approximation, because the normal one is degenerate exactly where these results live -
  at p = 1.0 it returns a zero-width interval, claiming a rate measured on 8 cases is
  known perfectly. Wilson inverts the score test instead of the Wald test, is asymmetric
  near the boundaries, and never produces a zero width (Wilson 1927; Brown, Cai &
  DasGupta 2001, Statistical Science 16(2), which recommends it over Wald for essentially
  all n).

  LEFT PANEL - the precision frontier. Interval half-width against n, for three true
  rates. The curve falls as 1/sqrt(n), which is the whole reason small samples are
  expensive: halving the width costs roughly FOUR TIMES the sample. Each benchmark is
  plotted at its own (n, half-width), so the chart shows where each one sits on that
  frontier rather than asserting that some are better powered than others.

  RIGHT PANEL - what more would cost. For an observed rate near the verdict metrics'
  87.5%, the n required to reach a given half-width. It answers the question that follows
  from the left panel - "so how many more cases do we need?" - with a number instead of a
  shrug. Solved by search rather than by the Wald closed form, because the Wald formula
  understates the requirement near the boundary, which is again where these results live.

WHAT IT DOES NOT SAY. Nothing here is about whether a rate is good. It is about how much
of the rate is knowledge and how much is sampling noise.

Run:  python tools/plot_precision.py [outdir]
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

INK = "#0F1013"
CYAN = "#0077CC"
VIOLET = "#22009B"
AMBER = "#A8641C"
MUTED = "#8A8AA5"
GRID = "#E3E3EC"

RESULTS = Path("results")
MODEL = "gemini-3.5-flash"


def wilson(k: float, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = k / n
    d = 1 + z * z / n
    centre = p + z * z / (2 * n)
    spread = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, (centre - spread) / d), min(1.0, (centre + spread) / d)


def half_width(k: float, n: int) -> float:
    lo, hi = wilson(k, n)
    return (hi - lo) / 2


def n_for(target_half: float, p: float, cap: int = 4000) -> int | None:
    """Smallest n whose Wilson half-width is within target, at the observed rate p.

    Searched rather than solved: the Wald closed form n = (z/w)^2 p(1-p) understates the
    requirement near p = 1, which is where every metric on this scoreboard sits.
    """
    for n in range(4, cap + 1):
        if half_width(round(p * n), n) <= target_half:
            return n
    return None


def load() -> list[tuple[str, int, int, str]]:
    ask = json.loads((RESULTS / "model-comparison" / f"ask-eval-{MODEL}.json").read_text(encoding="utf-8"))
    retrieval = json.loads((RESULTS / "retrieval-eval.json").read_text(encoding="utf-8"))
    five = json.loads((RESULTS / "model-comparison" / f"verdict-five-{MODEL}.json").read_text(encoding="utf-8"))
    cf = json.loads((RESULTS / "model-comparison" / f"counterfactual-{MODEL}.json").read_text(encoding="utf-8"))
    fixture = json.loads(Path("data/retrieval-eval.json").read_text(encoding="utf-8"))

    answerable = [i for i in ask["items"] if i.get("kind") == "answerable"]
    unanswerable = [i for i in ask["items"] if i.get("kind") == "unanswerable"]
    judged = [i for i in answerable if i.get("judged") is not None]
    hit_of = {i["id"]: i.get("hit") is True for i in retrieval["items"]}
    groups: dict[str, list[str]] = {}
    for it in fixture["items"]:
        if it["kind"] == "answerable":
            groups.setdefault(it["group"], []).append(it["id"])
    multi = [ids for ids in groups.values() if len(ids) > 1]

    s, n5, t5 = five["score"], len(five["rows"]), five["tested"]
    return [
        ("Ask 1 finds the passage", round(retrieval["hitRate"] * retrieval["answerable"]), retrieval["answerable"], "ask"),
        ("Ask 2 gets the fact right", sum(1 for i in judged if i["judged"] is True), len(judged), "ask"),
        ("Ask 3 points to a page", sum(1 for i in answerable if (i.get("citationRecall") or 0) > 0), len(answerable), "ask"),
        ("Ask 4 says when it cannot", sum(1 for i in unanswerable if i.get("refused") is True), len(unanswerable), "ask"),
        ("Ask 5 same answer asked twice", sum(1 for ids in multi if all(hit_of.get(i) for i in ids)), len(multi), "ask"),
        ("Verdict 1 verdict is right", s["verdict"], n5, "verdict"),
        ("Verdict 2 prose in evidence", s["prose"], t5["prose"], "verdict"),
        ("Verdict 3 names the rule", s["rule"], t5["rule"], "verdict"),
        ("Verdict 4 runs agree", s["stable"], n5, "verdict"),
        ("Verdict 5 tracks a change", cf["passed"], len(cf["rows"]), "verdict"),
    ]


def style(ax) -> None:
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.tick_params(colors=INK, length=0)
    ax.set_axisbelow(True)
    ax.grid(color=GRID, lw=0.8)


def main(outdir: Path) -> None:
    rows = load()
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13.4, 5.9))

    # ---- Left: the precision frontier.
    ns = list(range(4, 400))
    for p, colour, label in ((0.875, VIOLET, "true rate 87.5%"),
                             (0.95, CYAN, "true rate 95%"),
                             (0.70, MUTED, "true rate 70%")):
        a1.plot(ns, [half_width(round(p * n), n) * 100 for n in ns], color=colour, lw=1.8,
                label=label, zorder=2)

    for label, k, n, kind in rows:
        hw = half_width(k, n) * 100
        a1.scatter([n], [hw], s=46, color=CYAN if kind == "ask" else VIOLET,
                   edgecolor="white", linewidth=1.1, zorder=4)
    # Label only the extremes; ten labels would be unreadable and the point is the spread.
    widest = max(rows, key=lambda r: half_width(r[1], r[2]))
    tightest = min(rows, key=lambda r: half_width(r[1], r[2]))
    for label, k, n, _kind in (widest, tightest):
        a1.annotate(f"{label}\n{k}/{n},  ±{half_width(k, n) * 100:.0f} pts",
                    xy=(n, half_width(k, n) * 100),
                    xytext=(n * 1.5, half_width(k, n) * 100 + 3),
                    fontsize=8.4, color=INK,
                    arrowprops={"arrowstyle": "-", "color": MUTED, "lw": 0.9})

    a1.set_xscale("log")
    a1.set_xlabel("n  (log scale)", fontsize=9.5, color=MUTED)
    a1.set_ylabel("95% Wilson interval half-width, percentage points", fontsize=9.5, color=MUTED)
    a1.set_title("What each benchmark's sample size buys", fontsize=12.5, color=INK, loc="left", pad=10)
    a1.legend(frameon=False, fontsize=8.6, loc="upper right")
    a1.set_ylim(0, 32)
    style(a1)
    a1.text(0.98, 0.42, "width falls as 1/√n\nhalving it costs 4× the sample",
            transform=a1.transAxes, ha="right", va="top", fontsize=9, color=AMBER, style="italic")

    # ---- Right: what more would cost, at the verdict metrics' observed rate.
    targets = [15, 10, 7.5, 5, 3, 2]
    needed = [n_for(t / 100, 0.875) for t in targets]
    xs = range(len(targets))
    bars = a2.bar(xs, [n or 0 for n in needed], width=0.6, color=VIOLET, zorder=2)
    for x, n in zip(xs, needed):
        a2.text(x, (n or 0) + 12, f"{n}", ha="center", fontsize=10, color=INK, weight="bold")
    a2.set_xticks(list(xs))
    a2.set_xticklabels([f"±{t:g}" for t in targets], fontsize=10)
    a2.set_xlabel("target interval half-width, percentage points", fontsize=9.5, color=MUTED)
    a2.set_ylabel("cases required", fontsize=9.5, color=MUTED)
    a2.set_title("What it would cost to know the verdict rate better", fontsize=12.5, color=INK, loc="left", pad=10)
    style(a2)

    here = half_width(14, 16) * 100
    bars[0].set_color(AMBER)
    a2.text(0.5, 0.88,
            f"the verdict fixture is 16 cases, giving ±{here:.0f} points.\n"
            f"±5 needs {n_for(0.05, 0.875)} cases — and every one has to be\nwritten and keyed by hand.",
            transform=a2.transAxes, ha="center", va="top", fontsize=9.2, color=INK, linespacing=1.6)

    fig.suptitle("How much of each number is knowledge, and how much is sample size",
                 x=0.012, ha="left", fontsize=15.5, color=INK, weight="bold")
    fig.text(0.012, 0.915,
             "Wilson score intervals, 95%. Blue = Ask, violet = Verdict. "
             "Nothing here says whether a rate is good — only how well it is pinned down.",
             ha="left", fontsize=9, color=MUTED)
    fig.text(0.012, 0.025,
             "Wilson inverts the score test rather than the Wald test, so it stays asymmetric near 0 and 1 and never returns a zero-width\n"
             "interval — the normal approximation reports ±0 for a perfect score, which is why a 100% result needs it most "
             "(Wilson 1927; Brown, Cai & DasGupta 2001).",
             ha="left", fontsize=8.4, color=MUTED, linespacing=1.6)
    fig.subplots_adjust(left=0.075, right=0.98, top=0.83, bottom=0.19, wspace=0.24)

    out = outdir / "benchmarks-precision.png"
    fig.savefig(out, dpi=200, facecolor="white")
    plt.close(fig)
    print(f"  wrote {out}")
    print(f"  verdict fixture n=16 gives +/-{here:.1f} points; +/-5 would need {n_for(0.05, 0.875)} cases")
    for label, k, n, _ in rows:
        print(f"    {label:<30} {k}/{n}  half-width {half_width(k, n) * 100:.1f} pts")


if __name__ == "__main__":
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "results/figures")
    outdir.mkdir(parents=True, exist_ok=True)
    main(outdir)
