"""Draw the TEN benchmarks - five for Ask, five for Verdict - from results/*.json.

WHY THIS EXISTS BESIDE plot_evaluation.py. That script's headline figure is built on
two numbers this evaluation has since established should not carry a claim:

  `statedFactRate`, a `mustContain` regex over the gold quote. It sat at exactly 100%
  for two different models, which is the tell. 34 of 54 patterns are a single word, one
  shared by twelve items fires on the bare word "liver", and an answer stating the
  OPPOSITE passes - "the findings were NOT reversible" matches `reversib`. It measures
  vocabulary. `judgedCorrectRate` replaces it here; the regex stays in the JSON as a
  free deterministic floor.

  Three-class verdict accuracy on `data/verdict-eval.json`. One person wrote the nine
  cases AND the answer key, so it is not evidence, and docs/evaluation-dataset.md says
  so in its own words. This figure uses the five-metric adjudicator fixture and the
  counterfactual minimal pairs instead.

THE STATISTICS. Wilson score intervals throughout, for the reason plot_evaluation.py's
docstring sets out at length: the normal approximation returns a ZERO-WIDTH interval at
p = 1.0, which would claim a rate measured on 8 cases is known perfectly. Wilson is
asymmetric near the boundaries and never degenerate (Wilson 1927; Brown, Cai & DasGupta
2001, Statistical Science 16(2)). Three of these ten sit at or near 1.0, so this is not
a stylistic preference - without it the figure would be actively misleading.

WHAT THE INTERVAL IS FOR. It is the honest width of the estimate, and it is why n is
printed on every bar. 8/8 and 77/81 are both "high", and only one of them is a
measurement: 8/8 has a lower bound of 68%, 77/81 of 88%. A reader who cannot see n
cannot tell those apart.

Run:  python tools/plot_benchmarks.py [outdir]
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


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
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


def load(name: str) -> dict:
    return json.loads((RESULTS / name).read_text(encoding="utf-8"))


def gather() -> tuple[list[tuple[str, int, int]], list[tuple[str, int, int]], dict]:
    retrieval = load("retrieval-eval.json")
    ask = load(f"model-comparison/ask-eval-{MODEL}.json")
    five = load(f"model-comparison/verdict-five-{MODEL}.json")
    cf = load(f"model-comparison/counterfactual-{MODEL}.json")

    n_ans = retrieval["answerable"]
    hit = round(retrieval["hitRate"] * n_ans)

    # KEY OFF `kind`, NEVER `answerable`. They look interchangeable and are not:
    # ask-eval.ts line 186 sets `answerable` to whether the model PRODUCED AN ANSWER,
    # and `refused` to `kind === "unanswerable" ? !answerable : null`. So an
    # unanswerable item the model wrongly answered carries `answerable: true` - and
    # filtering on that field moves the failure out of the refusal denominator and into
    # the answerable one, inflating both rates at once. Exactly one item in this run
    # does that (reg-abuse-unanswerable), which is enough to turn 22/23 into 22/22 and
    # report a bare 100% refusal rate that is not true.
    answerable = [i for i in ask["items"] if i.get("kind") == "answerable"]
    unanswerable = [i for i in ask["items"] if i.get("kind") == "unanswerable"]
    judged = [i for i in answerable if i.get("judged") is not None]
    judged_ok = sum(1 for i in judged if i.get("judged") is True)
    cited = sum(1 for i in answerable if (i.get("citationRecall") or 0) > 0)
    refused = sum(1 for i in unanswerable if i.get("refused") is True)

    # Metric 5 is a GROUP-level property, not an item-level one: a question asked three
    # ways is stable when every phrasing reaches the answer, so the denominator is the
    # number of multi-phrasing groups and not the number of items.
    by_group: dict[str, list[bool]] = {}
    for it in retrieval["items"]:
        if it.get("kind") != "answerable":
            continue
        by_group.setdefault(it["group"], []).append(bool(it.get("hit")))
    multi = {g: hs for g, hs in by_group.items() if len(hs) > 1}
    all_hit = sum(1 for hs in multi.values() if all(hs))

    ask_rows = [
        ("1  Finds the passage\n     hit@16, retrieval only", hit, n_ans),
        ("2  Gets the fact right\n     judged against the quote", judged_ok, len(judged)),
        ("3  Points to a correct page\n     cited >=1 gold page", cited, len(answerable)),
        ("4  Says when it cannot answer\n     refusal on unanswerable", refused, len(unanswerable)),
        ("5  Same answer however asked\n     every phrasing finds it", all_hit, len(multi)),
    ]

    s, n5 = five["score"], len(five["rows"])
    # Denominators come from `tested`, not the case count: metrics 2 and 3 pass vacuously
    # on cases with nothing for them to check, and counting those inflates the SAMPLE
    # rather than the rate - the more misleading of the two.
    #
    # GAP RECALL IS DELIBERATELY ABSENT. It cannot fail: the absent fields and their
    # justifications are supplied in the prompt, `missing.field` is enum-constrained to
    # exactly that list so an invented gap is impossible, and a dropped one fails the
    # whole adjudication rather than that metric. Drawn as a bar it reads as a fifth
    # success and flatters the four beside it.
    # Counterfactual sensitivity is the FIFTH verdict benchmark, not a footnote. It was
    # relegated to one while gap recall occupied the slot, which had it exactly backwards:
    # gap recall cannot fail, and this is the only verdict result a system that ignores
    # the evidence cannot score well on - each pair edits one fact and requires the
    # verdict to move with it.
    t5 = five.get("tested", {"prose": n5, "rule": n5})
    verdict_rows = [
        ("1  Verdict is right", s["verdict"], n5),
        ("2  Prose stays in evidence", s["prose"], t5["prose"]),
        ("3  Names the deciding rule", s["rule"], t5["rule"]),
        ("4  Runs agree\n     consensus of 3", s["stable"], n5),
        ("5  Tracks a changed fact\n     counterfactual pairs", cf["passed"], len(cf["rows"])),
    ]
    return ask_rows, verdict_rows, cf


def fig_ten(out: Path) -> None:
    ask_rows, verdict_rows, cf = gather()
    rows = ask_rows + verdict_rows
    colours = [CYAN] * len(ask_rows) + [VIOLET] * len(verdict_rows)

    fig, ax = plt.subplots(figsize=(11.5, 8.4))
    ys = list(range(len(rows)))[::-1]
    vals = [k / n for _, k, n in rows]
    los, his = zip(*[wilson(k, n) for _, k, n in rows])
    err = [[v - lo for v, lo in zip(vals, los)], [hi - v for v, hi in zip(vals, his)]]

    ax.barh(ys, vals, height=0.6, color=colours, edgecolor="none", zorder=2)
    ax.errorbar(vals, ys, xerr=err, fmt="none", ecolor=INK, elinewidth=1.5,
                capsize=6, capthick=1.5, zorder=3)

    for y, (label, k, n), v, lo in zip(ys, rows, vals, los):
        ax.text(1.015, y, f"{v * 100:.1f}%   {k}/{n}   CI {lo * 100:.0f}–{his[len(rows) - 1 - y] * 100:.0f}",
                va="center", ha="left", fontsize=9, color=INK, family="monospace")

    ax.set_yticks(ys)
    ax.set_yticklabels([r[0] for r in rows], fontsize=9.5, linespacing=1.5)
    ax.set_xlim(0, 1.0)
    ax.set_xticks([0, 0.25, 0.5, 0.75, 1.0])
    ax.set_xticklabels(["0", "25%", "50%", "75%", "100%"])
    ax.axvline(1.0, color=GRID, lw=1, zorder=1)
    ax.grid(axis="x", color=GRID, lw=0.8)
    style(ax)

    # Separator and group labels. The two halves measure different surfaces on
    # different fixtures, and a reader who reads straight down ten bars without seeing
    # the break will compare an n=81 rate with an n=8 one as though they were the same
    # kind of claim.
    # y positions run HIGH to LOW, so the boundary sits above the last verdict row -
    # not at len(ask_rows), which put the line inside the Ask block once the counts
    # stopped being equal.
    split = len(verdict_rows) - 0.5
    ax.axhline(split, color=GRID, lw=1.2, zorder=1)
    # In FIGURE coordinates, outside the tick labels. Placed in axes coordinates they
    # sit on top of the metric names, which are long and left-extending here.
    top, bottom = 0.90, 0.13
    span = top - bottom
    n = len(rows)
    ask_mid = top - (len(ask_rows) / 2) / n * span
    verdict_mid = top - (len(ask_rows) + len(verdict_rows) / 2) / n * span
    fig.text(0.022, ask_mid, "ASK", ha="center", va="center", rotation=90,
             fontsize=11.5, color=CYAN, weight="bold")
    fig.text(0.022, verdict_mid, "VERDICT", ha="center", va="center", rotation=90,
             fontsize=11.5, color=VIOLET, weight="bold")
    # Counted, not typed. The board was "ten" until gap recall was removed for being
    # unfailable, and a hardcoded title would have gone on asserting it.
    fig.suptitle(f"Arbiter — the {len(rows)} benchmarks", x=0.012, ha="left", fontsize=16,
                 color=INK, weight="bold", y=0.985)
    fig.text(0.012, 0.935,
             f"{MODEL} · bars are point estimates, whiskers are 95% Wilson score intervals · "
             f"blue = Ask, violet = Verdict · gap recall excluded, it cannot fail",
             ha="left", fontsize=9.5, color=MUTED)
    # Computed, not typed. This sentence names two specific rates, and a hardcoded
    # pair goes stale the first time the fixture grows - which it did.
    v_k, v_n = verdict_rows[0][1], verdict_rows[0][2]
    a_k, a_n = ask_rows[0][1], ask_rows[0][2]
    v_lo = wilson(v_k, v_n)[0] * 100
    a_lo = wilson(a_k, a_n)[0] * 100
    fig.text(0.012, 0.022,
             f"Every rate carries its n. {v_k}/{v_n} and {a_k}/{a_n} are both 'high' and only one is a "
             f"measurement: the first has a lower bound of {v_lo:.0f}%, the second {a_lo:.0f}%.\n"
             f"Verdict 5 is the one a system ignoring the evidence cannot fake: each pair edits exactly one fact "
             f"and the verdict must move with it. {cf['stuck']} stuck — it never anchored on its first read.",
             ha="left", fontsize=8.6, color=MUTED, linespacing=1.6)

    fig.subplots_adjust(left=0.28, right=0.80, top=0.90, bottom=0.13)
    fig.savefig(out, dpi=200, facecolor="white")
    plt.close(fig)
    print(f"  wrote {out}")


def fig_surface(rows, title: str, subtitle: str, colour: str, footnote: str, out: Path) -> None:
    """One surface on its own, for a slide.

    The combined board is right for a document, where a reader can sit with ten rows and
    compare them. On a projector it is ten rows of small print, and the two halves are
    measured on different fixtures anyway - 104 questions against 16 constructed cases -
    so putting them on one axis invites exactly the comparison the denominators do not
    support. Split, each surface gets room for readable type and its own caveat.
    """
    fig, ax = plt.subplots(figsize=(12.4, 5.6))
    ys = list(range(len(rows)))[::-1]
    vals = [k / n for _, k, n in rows]
    los, his = zip(*[wilson(k, n) for _, k, n in rows])
    err = [[v - lo for v, lo in zip(vals, los)], [hi - v for v, hi in zip(vals, his)]]

    ax.barh(ys, vals, height=0.58, color=colour, edgecolor="none", zorder=2)
    ax.errorbar(vals, ys, xerr=err, fmt="none", ecolor=INK, elinewidth=1.7,
                capsize=7, capthick=1.7, zorder=3)

    for idx, (y, (_label, k, n), v) in enumerate(zip(ys, rows, vals)):
        ax.text(1.015, y, f"{v * 100:.1f}%   {k}/{n}   CI {los[idx] * 100:.0f}–{his[idx] * 100:.0f}",
                va="center", ha="left", fontsize=11.5, color=INK, family="monospace")

    ax.set_yticks(ys)
    ax.set_yticklabels([r[0] for r in rows], fontsize=12.5, linespacing=1.45)
    ax.set_xlim(0, 1.0)
    ax.set_xticks([0, 0.25, 0.5, 0.75, 1.0])
    ax.set_xticklabels(["0", "25%", "50%", "75%", "100%"], fontsize=11)
    ax.axvline(1.0, color=GRID, lw=1, zorder=1)
    ax.grid(axis="x", color=GRID, lw=0.9)
    style(ax)

    fig.suptitle(title, x=0.012, ha="left", fontsize=20, color=INK, weight="bold", y=0.975)
    fig.text(0.012, 0.895, subtitle, ha="left", fontsize=11, color=MUTED)
    fig.text(0.012, 0.035, footnote, ha="left", fontsize=9.6, color=MUTED, linespacing=1.6)
    fig.subplots_adjust(left=0.28, right=0.78, top=0.83, bottom=0.20)
    fig.savefig(out, dpi=200, facecolor="white")
    plt.close(fig)
    print(f"  wrote {out}")


def fig_topics(out: Path) -> None:
    """Metric 2 broken out by question topic - what explains the headline."""
    ask = load(f"model-comparison/ask-eval-{MODEL}.json")
    fixture = json.loads(Path("data/retrieval-eval.json").read_text(encoding="utf-8"))
    group_of = {i["id"]: i.get("group", "") for i in fixture["items"]}

    buckets: dict[str, list[bool]] = {}
    for it in ask["items"]:
        if it.get("answerable") is not True or it.get("judged") is None:
            continue
        topic = (group_of.get(it["id"], "") .split(":") + ["?"])[1]
        buckets.setdefault(topic, []).append(bool(it["judged"]))

    rows = sorted(((t, sum(v), len(v)) for t, v in buckets.items()), key=lambda r: r[1] / r[2])
    fig, ax = plt.subplots(figsize=(10.5, 0.42 * len(rows) + 2.2))
    ys = list(range(len(rows)))
    vals = [k / n for _, k, n in rows]
    los, his = zip(*[wilson(k, n) for _, k, n in rows])
    err = [[v - lo for v, lo in zip(vals, los)], [hi - v for v, hi in zip(vals, his)]]

    ax.barh(ys, vals, height=0.6, color=[CYAN if v >= 0.8 else AMBER for v in vals],
            edgecolor="none", zorder=2)
    ax.errorbar(vals, ys, xerr=err, fmt="none", ecolor=INK, elinewidth=1.4,
                capsize=5, capthick=1.4, zorder=3)
    for y, (_, k, n), v in zip(ys, rows, vals):
        ax.text(1.015, y, f"{v * 100:.0f}%   {k}/{n}", va="center", ha="left",
                fontsize=9, color=INK, family="monospace")

    ax.set_yticks(ys)
    ax.set_yticklabels([r[0] for r in rows], fontsize=10)
    ax.set_xlim(0, 1.0)
    ax.set_xticks([0, 0.25, 0.5, 0.75, 1.0])
    ax.set_xticklabels(["0", "25%", "50%", "75%", "100%"])
    ax.grid(axis="x", color=GRID, lw=0.8)
    style(ax)
    fig.suptitle("Where Ask is strong and where it is not", x=0.012, ha="left",
                 fontsize=15, color=INK, weight="bold")
    fig.text(0.012, 0.90, "Metric 2 (judged correct) by question topic. Amber below 80%.",
             ha="left", fontsize=9.5, color=MUTED)
    fig.text(0.012, 0.03,
             "Locating a single stated value is near-solved. Synthesising a qualitative judgement across studies is not.\n"
             "Retrieval reaches the page 95% of the time, so the gap is the synthesis step and not the search.",
             ha="left", fontsize=8.6, color=MUTED, linespacing=1.6)
    fig.subplots_adjust(left=0.24, right=0.82, top=0.86, bottom=0.14)
    fig.savefig(out, dpi=200, facecolor="white")
    plt.close(fig)
    print(f"  wrote {out}")


def fig_coverage(out: Path) -> None:
    """What the benchmark is measured ON - toxicity outcome and question kind."""
    fixture = json.loads(Path("data/retrieval-eval.json").read_text(encoding="utf-8"))
    sources = json.loads(Path("data/library-sources.json").read_text(encoding="utf-8"))["sources"]

    # The ladder, most severe last. A drug appears in exactly one rung - the worst one
    # that applies - so the bars sum to the document count. Obeticholic and mipomersen
    # carry boxed hepatic warnings too, but "withdrawn" is the outcome that matters.
    withdrawn = {"obeticholic", "mipomersen"}
    boxed_hepatic = {"turalio", "ponatinib", "regorafenib", "tolvaptan", "teriflunomide"}
    boxed_other = {"ivosidenib", "enasidenib", "gilteritinib"}
    warned = {"trabectedin", "lorlatinib", "fostamatinib", "tucatinib", "alpelisib",
              "zanubrutinib", "erdafitinib", "pralsetinib"}
    docs = {i["document"] for i in fixture["items"]}

    n_withdrawn = len(docs & withdrawn)
    n_boxed_hep = len(docs & boxed_hepatic)
    n_boxed_oth = len(docs & boxed_other)
    n_warned = len(docs & warned)
    n_clean = len(docs) - n_withdrawn - n_boxed_hep - n_boxed_oth - n_warned

    answerable = sum(1 for i in fixture["items"] if i["kind"] == "answerable")
    unanswerable = sum(1 for i in fixture["items"] if i["kind"] == "unanswerable")
    absent_study = sum(1 for i in fixture["items"]
                       if i["kind"] == "answerable" and "absent-study" in i.get("group", ""))

    fig, (a1, a2) = plt.subplots(1, 2, figsize=(11.5, 4.2))

    rungs = [n_clean, n_warned, n_boxed_oth, n_boxed_hep, n_withdrawn]
    xs5 = list(range(5))
    a1.bar(xs5, rungs, color=[CYAN, "#4A9BD1", AMBER, "#B4531C", "#C0392B"], width=0.68, zorder=2)
    a1.set_xticks(xs5)
    a1.set_xticklabels(["No warning", "Warning,\nnot boxed", "Boxed,\nnon-hepatic",
                        "Boxed\nhepatic", "Withdrawn for\nliver injury"], fontsize=8.6)
    a1.set_ylabel("documents", fontsize=9.5, color=MUTED)
    a1.set_title("Toxicity outcome of the drug — increasing severity", fontsize=11.5, color=INK, loc="left")
    for x, v in zip(xs5, rungs):
        a1.text(x, v + 0.2, str(v), ha="center", fontsize=11, color=INK, weight="bold")
    a1.grid(axis="y", color=GRID, lw=0.8)
    style(a1)

    a2.bar([0, 1, 2], [answerable - absent_study, unanswerable, absent_study],
           color=[CYAN, VIOLET, AMBER], width=0.6, zorder=2)
    a2.set_xticks([0, 1, 2])
    a2.set_xticklabels(["Answerable", "Document cannot\nanswer (refuse)",
                        "Study not done,\nand it says so"], fontsize=9.5)
    a2.set_ylabel("questions", fontsize=9.5, color=MUTED)
    a2.set_title("Availability of the information", fontsize=11.5, color=INK, loc="left")
    for x, v in zip([0, 1, 2], [answerable - absent_study, unanswerable, absent_study]):
        a2.text(x, v + 0.8, str(v), ha="center", fontsize=11, color=INK, weight="bold")
    a2.grid(axis="y", color=GRID, lw=0.8)
    style(a2)

    fig.suptitle("What the benchmark is measured on", x=0.012, ha="left",
                 fontsize=15, color=INK, weight="bold")
    fig.text(0.012, 0.025,
             "'Study not done, and the document says why' is scored as ANSWERABLE, not as a refusal: "
             "not applicable is not missing.",
             ha="left", fontsize=8.6, color=MUTED)
    fig.subplots_adjust(left=0.07, right=0.98, top=0.84, bottom=0.22, wspace=0.25)
    fig.savefig(out, dpi=200, facecolor="white")
    plt.close(fig)
    print(f"  wrote {out}")


if __name__ == "__main__":
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "results/figures")
    outdir.mkdir(parents=True, exist_ok=True)
    fig_ten(outdir / "benchmarks-scoreboard.png")

    ask_rows, verdict_rows, cf = gather()
    n_docs = len({i["document"] for i in
                  json.loads(Path("data/retrieval-eval.json").read_text(encoding="utf-8"))["items"]})
    fig_surface(
        ask_rows,
        "Ask — reads the document, answers the question",
        f"{MODEL} · {n_docs} FDA and EMA review documents · "
        f"{ask_rows[0][2]} answerable questions, {ask_rows[3][2]} the document cannot answer",
        CYAN,
        "Bars are point estimates; whiskers are 95% Wilson score intervals. Every question carries a verbatim gold quote and its page,\n"
        "and every unanswerable one was verified by searching the whole document and keeping only terms that returned zero hits.",
        outdir / "benchmarks-ask.png",
    )
    fig_surface(
        verdict_rows,
        "Verdict — weighs the findings, takes a position",
        f"{MODEL} · {verdict_rows[0][2]} constructed cases, each run 3 times · "
        f"answers follow from the registered ruleset, not from opinion",
        VIOLET,
        f"Benchmarks 2 and 3 are scored over the {verdict_rows[1][2]} and {verdict_rows[2][2]} cases that can FAIL them; the rest declare no absent\n"
        f"dimension or key no deciding rule, and counting them would inflate the sample rather than the rate. Benchmark 5 edits exactly\n"
        f"one fact per pair and requires the verdict to move with it — {cf['stuck']} stuck, so it never anchored on its first read.",
        outdir / "benchmarks-verdict.png",
    )

    fig_topics(outdir / "benchmarks-ask-topics.png")
    fig_coverage(outdir / "benchmarks-coverage.png")
