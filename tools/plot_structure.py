"""How many independent things do the ten benchmarks actually measure?

A scoreboard of ten bars invites the reading that ten distinct properties were
tested. That is a claim about the RANK of the evaluation, and it is checkable:
build the item x signal matrix, and look at how much of its variance lives in the
first few directions.

THE MATRIX. For every answerable Ask item, four binary outcomes are recorded by the
harness - did retrieval reach a gold page, did the judge call the answer correct,
did the answer cite a gold page, did the regex screen fire - plus one continuous
signal, citation precision. That is an n x 5 design matrix X with n = the number of
answerable items.

WHAT IS COMPUTED, and why each step is the standard one.

  1. Column-centre X. Correlation is defined on centred data; skipping this makes
     the first singular vector the mean vector and the "explained variance" a
     statement about the average score rather than about covariation.

  2. The correlation matrix R = D^-1 C D^-1, where C is the covariance and D the
     diagonal of standard deviations. For two binary columns this is exactly the phi
     coefficient, which is what makes the heatmap comparable cell to cell even
     though one column is continuous.

  3. The singular values of the standardised matrix, via SVD. sigma_i^2 / sum
     sigma^2 is the share of total variance along direction i - a principal
     component analysis on the correlation matrix, which is the scale-free version
     and the right one when the columns are not in the same units.

  4. The PARTICIPATION RATIO, (sum lambda)^2 / sum lambda^2, as the effective rank.
     It answers "how many directions carry real weight" without the arbitrary cut of
     a 90%-variance threshold: it equals k exactly when k eigenvalues are equal and
     the rest are zero, and degrades smoothly in between.

WHAT IT IS FOR. If the effective rank is close to 5, the signals are near-independent
and each metric earns its place on the slide. If it collapses toward 1, the metrics
are largely restatements of a single underlying "did this item go well", and the
scoreboard is narrower than it looks. Either answer is worth knowing before the
numbers are presented as ten separate claims.

NO SCIPY, NO SKLEARN. numpy ships with matplotlib's dependency tree here and the
whole computation is a centre, a divide and one SVD.

Run:  python tools/plot_structure.py [outdir]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

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

SIGNALS = [
    "retrieval\nreached a\ngold page",
    "judge called\nthe answer\ncorrect",
    "answer cited\na gold page",
    "regex screen\nfired",
    "citation\nprecision",
]


def design_matrix() -> tuple[np.ndarray, list[str]]:
    ask = json.loads((RESULTS / "model-comparison" / f"ask-eval-{MODEL}.json").read_text(encoding="utf-8"))
    retrieval = json.loads((RESULTS / "retrieval-eval.json").read_text(encoding="utf-8"))
    hit_of = {i["id"]: bool(i.get("hit")) for i in retrieval["items"]}

    rows, ids = [], []
    for it in ask["items"]:
        # kind, never `answerable`: that field records whether the model produced an
        # answer, so filtering on it drops a wrongly-answered unanswerable item into
        # the wrong population.
        if it.get("kind") != "answerable" or it.get("judged") is None:
            continue
        ids.append(it["id"])
        rows.append([
            1.0 if hit_of.get(it["id"], False) else 0.0,
            1.0 if it.get("judged") is True else 0.0,
            1.0 if (it.get("citationRecall") or 0) > 0 else 0.0,
            1.0 if it.get("statedFact") is True else 0.0,
            float(it.get("citationPrecision") or 0.0),
        ])
    return np.array(rows, dtype=float), ids


def analyse(x: np.ndarray) -> dict:
    keep = x.std(axis=0) > 1e-12          # a constant column has no direction
    dropped = [SIGNALS[i] for i in range(x.shape[1]) if not keep[i]]
    xk = x[:, keep]
    labels = [SIGNALS[i] for i in range(x.shape[1]) if keep[i]]

    centred = xk - xk.mean(axis=0)
    z = centred / xk.std(axis=0)
    n = z.shape[0]

    corr = (z.T @ z) / n
    # Eigenvalues of the correlation matrix are the squared singular values of the
    # standardised matrix over n; taking them from the SVD avoids forming R when n
    # is small and keeps the numbers consistent with the scree plot.
    sv = np.linalg.svd(z, compute_uv=False)
    lam = sv ** 2 / n
    share = lam / lam.sum()
    participation = (lam.sum() ** 2) / (lam ** 2).sum()

    return {
        "labels": labels, "dropped": dropped, "corr": corr, "share": share,
        "cum": np.cumsum(share), "participation": participation, "n": n,
    }


def fig_structure(out: Path) -> None:
    x, _ = design_matrix()
    a = analyse(x)
    labels, corr, share, cum = a["labels"], a["corr"], a["share"], a["cum"]
    k = len(labels)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13.2, 5.9),
                                   gridspec_kw={"width_ratios": [1.05, 1]})

    im = ax1.imshow(corr, cmap="RdBu_r", vmin=-1, vmax=1)
    ax1.set_xticks(range(k)); ax1.set_yticks(range(k))
    ax1.set_xticklabels(labels, fontsize=7.6)
    ax1.set_yticklabels(labels, fontsize=7.6)
    for i in range(k):
        for j in range(k):
            v = corr[i, j]
            ax1.text(j, i, f"{v:+.2f}", ha="center", va="center", fontsize=8.5,
                     color="white" if abs(v) > 0.55 else INK, family="monospace")
    ax1.set_title("Correlation between per-item signals", fontsize=12, color=INK, loc="left", pad=12)
    for s in ax1.spines.values():
        s.set_visible(False)
    ax1.tick_params(length=0)
    cb = fig.colorbar(im, ax=ax1, fraction=0.046, pad=0.03)
    cb.outline.set_visible(False)
    cb.ax.tick_params(length=0, labelsize=8)

    xs = np.arange(1, k + 1)
    ax2.bar(xs, share, width=0.55, color=CYAN, zorder=2)
    ax2.plot(xs, cum, color=VIOLET, marker="o", ms=5, lw=1.8, zorder=3)
    for xi, s, c in zip(xs, share, cum):
        ax2.text(xi, s + 0.02, f"{s * 100:.0f}%", ha="center", fontsize=8.5, color=INK)
        ax2.text(xi, c + 0.03, f"{c * 100:.0f}%", ha="center", fontsize=8.5, color=VIOLET)
    ax2.axhline(1.0, color=GRID, lw=1)
    ax2.set_ylim(0, 1.18)
    ax2.set_xticks(xs)
    ax2.set_xlabel("principal direction", fontsize=9.5, color=MUTED)
    ax2.set_ylabel("share of variance", fontsize=9.5, color=MUTED)
    ax2.set_title("Where the variance lives", fontsize=12, color=INK, loc="left", pad=12)
    ax2.grid(axis="y", color=GRID, lw=0.8)
    ax2.set_axisbelow(True)
    for s in ("top", "right"):
        ax2.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax2.spines[s].set_color(GRID)
    ax2.tick_params(colors=INK, length=0)

    ax2.text(0.98, 0.42, f"effective rank\n{a['participation']:.2f} of {k}",
             transform=ax2.transAxes, ha="right", va="center", fontsize=13,
             color=AMBER, weight="bold", linespacing=1.5)

    fig.suptitle("How many independent things do these benchmarks measure?",
                 x=0.012, ha="left", fontsize=15.5, color=INK, weight="bold")
    note = (f"n = {a['n']} answerable Ask items · correlation of binary outcomes is the phi coefficient · "
            f"variance shares are squared singular values of the standardised matrix")
    if a["dropped"]:
        note += " · dropped as constant: " + ", ".join(d.replace("\n", " ") for d in a["dropped"])
    fig.text(0.012, 0.915, note, ha="left", fontsize=8.6, color=MUTED)
    fig.text(0.012, 0.025,
             "Effective rank is the participation ratio (sum lambda)^2 / sum lambda^2 — how many directions carry real weight, "
             "without an arbitrary variance cut-off.\nA value well below the column count means the metrics are restatements "
             "of fewer underlying properties than the scoreboard implies.",
             ha="left", fontsize=8.6, color=MUTED, linespacing=1.6)

    fig.subplots_adjust(left=0.13, right=0.97, top=0.84, bottom=0.19, wspace=0.42)
    fig.savefig(out, dpi=200, facecolor="white")
    plt.close(fig)
    print(f"  wrote {out}")

    print(f"\n  n = {a['n']} answerable items, {k} non-constant signals")
    if a["dropped"]:
        print("  dropped as constant:", ", ".join(d.replace(chr(10), ' ') for d in a["dropped"]))
    print("  variance share: " + "  ".join(f"{s * 100:.1f}%" for s in share))
    print(f"  effective rank (participation ratio): {a['participation']:.2f} of {k}")
    print("\n  correlation matrix:")
    head = "".join(f"{l.replace(chr(10), ' ')[:14]:>16}" for l in labels)
    print("                  " + head)
    for i, l in enumerate(labels):
        print(f"  {l.replace(chr(10), ' ')[:14]:>14}  " + "".join(f"{corr[i, j]:>16.3f}" for j in range(k)))


if __name__ == "__main__":
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "results/figures")
    outdir.mkdir(parents=True, exist_ok=True)
    fig_structure(outdir / "benchmarks-structure.png")
