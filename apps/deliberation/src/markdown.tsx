import type { ReactElement, ReactNode } from "react";

/**
 * The small amount of Markdown a model actually emits, rendered as React elements.
 *
 * WHY THIS EXISTS AT ALL. `ask` returns one JSON string and the page used to put it in
 * a single `<p>`. A real answer measured off this deployment is 5,953 characters with
 * ZERO newlines - the model writes "Animal findings (rats):" and "Human clinical
 * findings:" as run-on labels inside one paragraph, because nothing ever asked it for
 * structure. The prompt in `services/api/ask.ts` now does, which turns that wall into
 * headings and bullets - and a `<p>` renders those as literal `##` and `-`. Both halves
 * are needed; either alone changes nothing on screen.
 *
 * WHY NOT A LIBRARY. This app depends on react and pdfjs and nothing else, and the
 * grammar below is the whole grammar the ask prompt permits. react-markdown would bring
 * a remark/micromark tree for a surface that renders six constructs. The cost of writing
 * it here is that this file has to be correct; the tests next to it are the argument
 * that it is.
 *
 * NOT AN HTML RENDERER, and that is the security property. Every branch below builds a
 * React element from a string. There is no `dangerouslySetInnerHTML` anywhere in this
 * file, so a `<script>` or an `onerror=` in a model's answer is text on the page rather
 * than a node in the document. Raw HTML in the source is deliberately NOT interpreted.
 *
 * LINKS ARE NOT A CONSTRUCT HERE, deliberately. An answer is drawn from the words on a
 * PDF page and has nowhere legitimate to point; supporting `[text](url)` would mean a
 * model's output could put a clickable destination in front of a reviewer. The
 * citations under an answer are resolved server-side and rendered by the page itself,
 * which is the only provenance this surface offers. `[3, 8]` passage markers therefore
 * pass through as the literal text they are.
 */

/** A block is the unit that gets its own element. Lists carry their items. */
type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
/** A rule is a block the model sometimes emits and this surface has no use for. */
const RULE = /^\s*(?:[-*_]\s*){3,}$/;

/**
 * Source to blocks.
 *
 * A BLANK LINE IS NOT THE ONLY SEPARATOR, which matters because models are inconsistent
 * about them: a bullet directly under a paragraph, with no blank line between, is common
 * and CommonMark-legal in a list context. So a line's own shape opens a block, and a
 * blank line only ever closes one.
 */
export function parse(src: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = (): void => {
    if (para.length > 0) out.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  const flushList = (): void => {
    if (list !== null) out.push({ kind: "list", ...list });
    list = null;
  };
  const flush = (): void => { flushPara(); flushList(); };

  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trimEnd();

    if (line.trim() === "") { flush(); continue; }
    // Tested BEFORE the bullet rule, because "---" and "***" satisfy both and a
    // horizontal rule read as a list item renders an empty bullet.
    if (RULE.test(line)) { flush(); continue; }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      // COLLAPSED TO TWO LEVELS. `h1` is the page title and belongs to the page, not to
      // something a model chose; anything deeper than one nesting step inside a single
      // answer is a distinction no reader of a five-paragraph answer is tracking.
      out.push({ kind: "heading", level: heading[1]!.length <= 2 ? 2 : 3, text: heading[2]!.trim() });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet === null ? ORDERED.exec(line) : null;
    if (bullet !== null || ordered !== null) {
      flushPara();
      const isOrdered = ordered !== null;
      const text = (bullet?.[1] ?? ordered?.[1] ?? "").trim();
      // A change of list TYPE ends the list. Bullets continuing into numbers is two
      // lists that happen to touch, and one <ul> holding both would renumber nothing
      // and mislabel everything.
      if (list !== null && list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(text);
      continue;
    }

    // A plain line. It cannot continue a list here: nested continuation lines are not
    // in the grammar the prompt asks for, and guessing at them turns a model's stray
    // indent into a silently swallowed sentence.
    flushList();
    para.push(line.trim());
  }

  flush();
  return out;
}

/**
 * `**bold**`, `*emphasis*` and `` `code` ``, and nothing else.
 *
 * NO UNDERSCORE EMPHASIS, which is a deliberate subtraction rather than an omission.
 * `_..._` is legal Markdown and models do occasionally use it, but this surface renders
 * regulatory prose full of identifiers - `NDA_211810`, `snake_case` field names quoted
 * off a page - and turning the middle of one into italics is a corruption of evidence.
 * Losing the rare intentional italic is the cheaper error.
 */
const INLINE = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;

export function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let n = 0;

  // `exec` in a loop rather than `matchAll`, because the "not really emphasis" branch
  // below has to emit the marker as literal text and keep scanning from inside it.
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text)) !== null) {
    const body = m[1] ?? m[2] ?? m[3] ?? "";
    // CommonMark's flanking rule, in the one form that matters here: `* 5` and `2 * 3`
    // are arithmetic and spacing, not emphasis. A delimiter padded with whitespace is
    // not a delimiter, and treating it as one eats real characters out of a dose.
    if (body !== body.trim()) continue;

    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[1] !== undefined) out.push(<strong key={`${key}-b${n}`}>{body}</strong>);
    else if (m[2] !== undefined) out.push(<em key={`${key}-i${n}`}>{body}</em>);
    else out.push(<code key={`${key}-c${n}`}>{body}</code>);
    at = m.index + m[0].length;
    n += 1;
  }

  if (at < text.length) out.push(text.slice(at));
  return out;
}

/**
 * The rendered answer.
 *
 * Returns a fragment rather than a wrapper, so the caller decides what the prose sits
 * in - the thread wants its own class on the turn, and an extra div here would put a
 * layout box inside every citation block too.
 */
export function Markdown({ children }: { children: string }): ReactElement {
  const blocks = parse(children);
  return (
    <>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.kind === "heading") {
          return b.level === 2
            ? <h4 key={key} className="md-h">{inline(b.text, key)}</h4>
            : <h5 key={key} className="md-h md-h-sub">{inline(b.text, key)}</h5>;
        }
        if (b.kind === "para") return <p key={key}>{inline(b.text, key)}</p>;
        const items = b.items.map((t, j) => <li key={`${key}-${j}`}>{inline(t, `${key}-${j}`)}</li>);
        // HEADING LEVELS ARE h4/h5, not h2/h3. The page already spends h1 on its title
        // and h2 on section headers, and a model's "Animal findings" is subordinate to
        // both - a screen reader walking the outline should not find an answer's
        // internal label sitting at the same level as "Ask the documents".
        return b.ordered
          ? <ol key={key} className="md-list">{items}</ol>
          : <ul key={key} className="md-list">{items}</ul>;
      })}
    </>
  );
}
