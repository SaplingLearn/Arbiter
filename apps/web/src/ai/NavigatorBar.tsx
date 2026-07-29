import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState, useDispatch } from "../state/store.js";
import { ANCHORS, ruleAnchor } from "./anchors.js";
import { isTypingTarget } from "../ui/isTypingTarget.js";
import { anchorMeta, navigate, SUGGESTED_QUESTIONS, type NavResult } from "./navigate.js";
import type { Resolution } from "./resolve.js";

/**
 * Surface 3's mount: a slim bar between the tab nav and the tab body, one line
 * when idle (spec section 7.3). Global by construction, which is what a question
 * asked from any tab needs.
 *
 * Two keyboard collisions, both measured rather than guessed:
 *
 * 1. The box is a real <input>. ui/isTypingTarget.ts already returns true for
 *    INPUT, so the window-level arrow, M and ? handlers suppress themselves for
 *    free. A contenteditable div would need every one of those handlers taught
 *    about it, and the failure mode - typing "murine" silently stripping the
 *    motion out of the demo - is invisible until a judge is watching.
 * 2. Escape is NOT the dismiss key. Escape is deliberately exempt from that guard
 *    (TourFooter.tsx:25) and already dispatches setFocus: null, so a navigator
 *    that owned Escape would also collapse whichever Case region the presenter
 *    had just opened. Backspace on an already-empty box dismisses instead: there
 *    is nothing left for it to delete, it carries no global binding, and it
 *    cannot fire mid-word.
 */
export function NavigatorBar() {
  const { ruleset } = useAppState();
  const dispatch = useDispatch();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Resolution<NavResult> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * The labels handed to navigate() are for MATCHING, not for display. Rung 4
   * scores question tokens against them, and spec section 7.1 says the rule
   * statements are part of that surface - they are the most quotable text in the
   * app, and they are what a question about a rule actually echoes.
   */
  const matchAnchors = useMemo(() => {
    const statement = (id: string) => ruleset.rules.find((r) => ruleAnchor(r.id) === id)?.statement ?? "";
    return Object.entries(ANCHORS).map(([id, a]) => ({ id, label: `${a.label} ${statement(id)}`.trim() }));
  }, [ruleset]);

  const ask = useCallback(
    async (q: string) => {
      setQuestion(q);
      setResult(await navigate({ question: q, anchors: matchAnchors }));
    },
    [matchAnchors],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || isTypingTarget(e.target)) return;
      // Without preventDefault the slash that focused the box is also typed into it.
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Presentational only. Un-collapsing a region is the same setFocus a user
   * clicking the region header dispatches, exactly as the tour beats do, and the
   * tab switch is the tour's own mechanism - assigning the hash (TourFooter.tsx).
   * A compound change would be a DATA action and goes through selectCompound,
   * visibly (spec section 16).
   *
   * The scroll cannot happen here: hashchange is asynchronous, so the target is
   * not mounted on the next statement. useAnchorScroll picks it up once it is.
   */
  const pick = (id: string) => {
    const meta = anchorMeta(id);
    if (meta === null) return;
    if (meta.region) dispatch({ type: "setFocus", focus: meta.region });
    dispatch({ type: "setPendingAnchor", anchorId: id });
    window.location.hash = `#/${meta.tab}`;
  };

  const value = result?.value ?? null;
  const open = value !== null;

  return (
    <div data-testid="navigator" data-open={open ? "yes" : "no"} className="navigator">
      <form
        className="navigator-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim() === "") { setResult(null); return; }
          void ask(question);
        }}
      >
        <label className="navigator-label" htmlFor="nav-input">
          <span className="small muted">Ask</span>
        </label>
        <input
          ref={inputRef}
          id="nav-input"
          data-testid="nav-input"
          className="field navigator-input"
          value={question}
          placeholder="Ask about this case, then press Enter  ( / to focus )"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && e.currentTarget.value === "") {
              e.preventDefault();
              setResult(null);
            }
          }}
        />
        {open && (
          <span data-testid="nav-rung" className="small muted navigator-rung">
            rung {result!.rung} · {result!.source}
          </span>
        )}
      </form>

      {value !== null && !value.noMatch && (
        <div data-testid="nav-result" className="row navigator-answer">
          {value.anchorIds.map((id) => (
            <button key={id} type="button" className="btn" data-testid="nav-anchor" data-anchor-id={id}
                    onClick={() => pick(id)}>
              {anchorMeta(id)?.label ?? id}
            </button>
          ))}
        </div>
      )}

      {value !== null && value.noMatch && (
        <div data-testid="nav-nomatch" className="row navigator-answer">
          <span className="small muted">
            Nothing on screen answers that. These are answered on screen:
          </span>
          {SUGGESTED_QUESTIONS.map((q) => (
            <button key={q} type="button" className="btn btn-ghost" data-testid="nav-suggestion"
                    onClick={() => void ask(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
