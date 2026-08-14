/**
 * Page furniture, removed once, before anything reads the document.
 *
 * A regulatory review repeats a header and a footer on every page - "NDA/BLA
 * Multi-disciplinary Review and Evaluation NDA 211810 TURALIO (pexidartinib)",
 * "Version date: February 1, 2016 for initial rollout", "Reference ID: 4470487",
 * "Assessment report", "EMA/CHMP/290491/2025". On the three library documents that is
 * 8.4%, 1.6% and 6.3% of all extracted characters, and it is in every passage the ask
 * surface sends and every page a summary reads.
 *
 * IT WAS FOUND BY MEASURING SOMETHING ELSE. Dense retrieval performed badly, and the
 * pages it returned were the diagnosis: cosine scores bunched between 0.70 and 0.74
 * because each page's vector was dominated by the same header, so every page looked
 * equally like the document and none looked like its own content. BM25 shrugs that off
 * - idf discounts a term that appears everywhere - which is why the cost was invisible
 * until an embedding was asked to carry it.
 *
 * Removing it helps three separate things, and the first is the smallest: recall@8
 * rose from 75.0% to 77.8% on `data/retrieval-eval.json`. The other two are not on
 * that scoreboard - 8% fewer tokens in every prompt, paid on every question and every
 * summary, and 8% less repeated text competing for the model's attention.
 *
 * A LINE IS FURNITURE IF IT IS ON HALF THE PAGES. Measured at 30% and 50%: identical
 * scores, so the conservative threshold wins. Short documents are left alone entirely,
 * because "appears on half the pages" says nothing about a four-page upload where a
 * real sentence can easily appear twice.
 */

export const BOILERPLATE_SHARE = 0.5;

/**
 * Below this, the statistic is not a statistic. A case upload of a few pages can
 * repeat a genuine line on half of them without it being furniture.
 */
export const MIN_PAGES_FOR_BOILERPLATE = 10;

export function boilerplateLines(
  pages: { page: number; text: string }[],
  share = BOILERPLATE_SHARE,
): Set<string> {
  if (pages.length < MIN_PAGES_FOR_BOILERPLATE) return new Set();

  const count = new Map<string, number>();
  for (const p of pages) {
    // Counted ONCE per page. A header repeated inside one page must not count as
    // evidence that it is repeated across the document.
    const seen = new Set(p.text.split("\n").map((l) => l.trim()).filter((l) => l.length > 3));
    for (const line of seen) count.set(line, (count.get(line) ?? 0) + 1);
  }

  const threshold = pages.length * share;
  return new Set([...count.entries()].filter(([, n]) => n >= threshold).map(([line]) => line));
}

/**
 * The same pages with their furniture gone. Page NUMBERS are untouched - they are the
 * citation, and a citation that moved because a header was dropped would be worse
 * than the header.
 */
export function stripBoilerplate(
  pages: { page: number; text: string }[],
  share = BOILERPLATE_SHARE,
): { page: number; text: string }[] {
  const furniture = boilerplateLines(pages, share);
  if (furniture.size === 0) return pages;
  return pages.map((p) => ({
    page: p.page,
    text: p.text.split("\n").filter((line) => !furniture.has(line.trim())).join("\n"),
  }));
}
