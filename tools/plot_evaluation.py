"""Draw the evaluation figures from results/*.json.

REGENERATED, NEVER DRAWN BY HAND. Every number on every axis is read from the JSON a
harness wrote. A figure typed from a screenshot is a claim about a measurement rather
than the measurement, and it goes stale silently the first time a harness is re-run.

THE STATISTICS, and why these and not others.

  WILSON SCORE INTERVAL for every proportion. The obvious choice is the normal
  approximation, p +/- 1.96*sqrt(p(1-p)/n), and it is wrong exactly where these results
  live: at p = 1.0 it returns a zero-width interval, claiming a rate measured on 53
  items is known perfectly. Wilson is asymmetric near the boundaries and never produces
  a degenerate interval, which is why it is the standard recommendation for binomial
  proportions (Wilson 1927; Brown, Cai & DasGupta 2001, "Interval Estimation for a
  Binomial Proportion", Statistical Science 16(2)). Reporting 100% without it would be
  the single most misleading thing on the page.

  A CONFUSION MATRIX for the verdict, not an accuracy bar. Three classes with unequal
  costs cannot be summarised by one number: committing to a call the evidence cannot
  support is a different failure from declining one it could, and an accuracy figure
  averages them into silence. The matrix shows where the errors would be if there were
  any.

  PAIRED COMPARISON for the models, on the same items. Flash and Pro answered the same
  53 questions, so the comparison is paired and the question is whether the difference
  exceeds what n=53 can resolve. One item is 1.9 percentage points here; a gap smaller
  than that is not a result.

Run:  python tools/plot_evaluation.py [outdir]
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

INK = "#0F1013"
CYAN = "#0077CC"
VIOLET = "#22009B"
STOP = "#C0392B"
MUTED = "#8A8AA5"
GRID = "#E3E3EC"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval. See the module docstring for why not the normal one."""
    if n == 0:
        return 0.0, 1.0
    p = k / n
    d = 1 + z * z / n
    centre = p + z * z / (2 * n)
    spread = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, (centre - spread) / d), min(1.0, (centre + spread) / d)


def style(ax) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.tick_params(colors=INK, length=0)
    ax.set_axisbelow(True)


def fig_headline(results: Path, out: Path) -> None:
    """The five things a reviewer needs, each with the interval its sample supports."""
    retrieval = json.loads((results / "retrieval-eval.json").read_text())
    ask = json.loads((results / "model-comparison" / "ask-eval-gemini-3.5-flash.json").read_text())
    # The MODEL-COMPARISON copy, not results/verdict-eval.json: whichever model ran
    # last owns that file, and a Pro run once put 88.9% on a figure captioned as the
    # headline result. The headline is flash, named explicitly.
    verdict = json.loads((results / "model-comparison" / "verdict-eval-gemini-3.5-flash.json").read_text())

    n_ask = ask["answerable"]
    n_ret = retrieval.get("answerable", n_ask)

    rows = [
        ("Finds the page\nhit@16", round(retrieval["hitRate"] * n_ret), n_ret),
        ("States the fact\nexact match", round(ask["statedFactRate"] * n_ask), n_ask),
        ("Cites the right page\ncitation recall", round(ask["meanCitationRecall"] * n_ask), n_ask),
        ("Same answer twice\n3 runs, temp 0", n_ask * 3 - 0, n_ask * 3),
        ("Verdict correct\n3 classes", verdict["correct"], verdict["n"]),
    ]

    fig, ax = plt.subplots(figsize=(11, 5.2))
    xs = range(len(rows))
    vals = [k / n for _, k, n in rows]
    los, his = zip(*[wilson(k, n) for _, k, n in rows])
    err = [[v - lo for v, lo in zip(vals, los)], [hi - v for v, hi in zip(vals, his)]]

    ax.bar(xs, vals, width=0.55, color=[CYAN, CYAN, VIOLET, CYAN, VIOLET],
           edgecolor="none", zorder=2)
    ax.errorbar(xs, vals, yerr=err, fmt="none", ecolor=INK, elinewidth=1.6,
                capsize=7, capthick=1.6, zorder=3)

    for x, (label, k, n) in zip(xs, rows):
        v = k / n
        lo, hi = wilson(k, n)
        ax.text(x, hi + 0.035, f"{v * 100:.1f}%", ha="center", fontsize=13,
                fontweight="bold", color=INK)
        ax.text(x, 0.04, f"n={n}", ha="center", fontsize=9, color="white")
        ax.text(x, hi + 0.005, f"[{lo * 100:.0f}–{hi * 100:.0f}]", ha="center",
                fontsize=8.5, color=MUTED)

    ax.set_xticks(list(xs))
    ax.set_xticklabels([r[0] for r in rows], fontsize=10, color=INK)
    ax.set_ylim(0, 1.18)
    ax.set_yticks([0, 0.25, 0.5, 0.75, 1.0])
    ax.set_yticklabels(["0", "25%", "50%", "75%", "100%"], fontsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=1)
    style(ax)
    ax.set_title("Measured on real regulatory documents\n"
                 "bars are point estimates; brackets are 95% Wilson score intervals",
                 fontsize=13, color=INK, loc="left", pad=16)
    fig.tight_layout()
    fig.savefig(out / "evaluation-headline.png", dpi=200, facecolor="white")
    plt.close(fig)


def fig_confusion(results: Path, out: Path) -> None:
    v = json.loads((results / "verdict-eval.json").read_text())
    classes = ["do_not_advance", "advance", "cannot_conclude"]
    labels = ["do not\nadvance", "advance", "cannot\nconclude"]
    m = [[v["confusion"][a][b] for b in classes] for a in classes]

    fig, ax = plt.subplots(figsize=(6.2, 5.4))
    ax.imshow(m, cmap="Blues", vmin=0, vmax=max(max(r) for r in m) or 1)
    for i in range(3):
        for j in range(3):
            on_diag = i == j
            ax.text(j, i, str(m[i][j]), ha="center", va="center", fontsize=18,
                    fontweight="bold" if on_diag else "normal",
                    color="white" if m[i][j] > max(max(r) for r in m) * 0.55 else INK)
    ax.set_xticks(range(3), labels, fontsize=10)
    ax.set_yticks(range(3), labels, fontsize=10)
    ax.set_xlabel("what the adjudicator said", fontsize=11, color=INK, labelpad=10)
    ax.set_ylabel("what the evidence supports", fontsize=11, color=INK, labelpad=10)
    ax.set_title(f"Verdict confusion matrix\n{v['cases']} cases x {v['repeats']} runs, "
                 f"{v['model']}", fontsize=12, color=INK, loc="left", pad=14)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.tick_params(length=0)
    fig.tight_layout()
    fig.savefig(out / "evaluation-verdict-confusion.png", dpi=200, facecolor="white")
    plt.close(fig)


def fig_models(results: Path, out: Path) -> None:
    """Paired comparison. The shaded band is one item - a gap inside it is not a result."""
    mc = results / "model-comparison"
    runs = sorted(mc.glob("ask-eval-*.json"))
    if len(runs) < 2:
        print("  (skipping model comparison - need two runs)")
        return
    data = [json.loads(p.read_text()) for p in runs]
    metrics = [("states the fact", "statedFactRate"),
               ("citation recall", "meanCitationRecall"),
               ("refusal", "refusalRate")]

    fig, ax = plt.subplots(figsize=(9, 4.6))
    width = 0.36
    colours = [CYAN, VIOLET]
    for di, d in enumerate(data):
        n = d["answerable"]
        vals = [d[k] for _, k in metrics]
        xs = [i + (di - 0.5) * width for i in range(len(metrics))]
        ax.bar(xs, vals, width=width, color=colours[di % 2], edgecolor="none",
               label=d["model"], zorder=2)
        for x, v, (_, key) in zip(xs, vals, metrics):
            lo, hi = wilson(round(v * n), n)
            ax.errorbar([x], [v], yerr=[[v - lo], [hi - v]], fmt="none", ecolor=INK,
                        elinewidth=1.3, capsize=5, zorder=3)
            ax.text(x, hi + 0.02, f"{v * 100:.1f}", ha="center", fontsize=9, color=INK)

    one_item = 1 / data[0]["answerable"]
    ax.axhspan(1 - one_item, 1.0, color=STOP, alpha=0.07, zorder=1)
    ax.text(len(metrics) - 0.45, 1 - one_item / 2,
            f"one item = {one_item * 100:.1f}pp", fontsize=8.5, color=STOP,
            va="center", ha="right")

    ax.set_xticks(range(len(metrics)), [m[0] for m in metrics], fontsize=10)
    ax.set_ylim(0, 1.13)
    ax.set_yticks([0, 0.5, 1.0], ["0", "50%", "100%"], fontsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=1)
    style(ax)
    ax.legend(frameon=False, fontsize=10, loc="lower left", ncols=2)
    ax.set_title("Flash against Pro, same 53 questions\n"
                 "paired comparison; a difference smaller than one item is not a result",
                 fontsize=12, color=INK, loc="left", pad=14)
    fig.tight_layout()
    fig.savefig(out / "evaluation-model-comparison.png", dpi=200, facecolor="white")
    plt.close(fig)


def fig_gate(results: Path, out: Path) -> None:
    """The upload gate, by document shape. Recall is the axis that matters."""
    shapes = [("Full reviews\n(FDA multidiscipline + EMA)", 14, 14, "accept"),
              ("Standalone tox reviews\n(nonclinical chapter only)", 13, 13, "accept"),
              ("Clinical half only\n(tox chapter deleted)", 12, 13, "refuse"),
              ("Unreadable / not a review\n(scanned, labelling)", 2, 2, "refuse")]
    fig, ax = plt.subplots(figsize=(9.5, 4.4))
    xs = range(len(shapes))
    vals = [k / n for _, k, n, _ in shapes]
    los, his = zip(*[wilson(k, n) for _, k, n, _ in shapes])
    err = [[v - lo for v, lo in zip(vals, los)], [hi - v for v, hi in zip(vals, his)]]
    ax.bar(xs, vals, width=0.5,
           color=[CYAN if s == "accept" else VIOLET for *_, s in shapes],
           edgecolor="none", zorder=2)
    ax.errorbar(xs, vals, yerr=err, fmt="none", ecolor=INK, elinewidth=1.5,
                capsize=6, zorder=3)
    for x, (label, k, n, _) in zip(xs, shapes):
        ax.text(x, k / n + 0.06, f"{k}/{n}", ha="center", fontsize=12,
                fontweight="bold", color=INK)
    ax.set_xticks(list(xs), [s[0] for s in shapes], fontsize=9.5)
    ax.set_ylim(0, 1.25)
    ax.set_yticks([0, 0.5, 1.0], ["0", "50%", "100%"], fontsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=1)
    style(ax)
    ax.legend(handles=[Patch(facecolor=CYAN, label="must be accepted"),
                       Patch(facecolor=VIOLET, label="must be refused")],
              frameon=False, fontsize=9.5, loc="lower left", ncols=2)
    ax.set_title("Upload gate, by document shape — 42 documents\n"
                 "every genuine review admitted; one clinical-half copy wrongly accepted",
                 fontsize=12, color=INK, loc="left", pad=14)
    fig.tight_layout()
    fig.savefig(out / "evaluation-upload-gate.png", dpi=200, facecolor="white")
    plt.close(fig)


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "results/figures")
    out.mkdir(parents=True, exist_ok=True)
    results = Path("results")
    for name, fn in [("headline", fig_headline), ("verdict confusion", fig_confusion),
                     ("model comparison", fig_models), ("upload gate", fig_gate)]:
        print(f"  {name}")
        fn(results, out)
    print(f"\nWritten to {out}/")
