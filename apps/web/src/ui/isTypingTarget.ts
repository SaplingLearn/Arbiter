/**
 * Is this keystroke meant for a form field rather than for a global shortcut?
 *
 * The presentation shortcuts are bound on `window`, so every keystroke in the app
 * reaches them. Without this guard, arrow keys nudging a focused ruleset slider
 * also jump the beat and switch tabs, typing "murine" or "malformed" into the
 * Rationale field silently strips the motion out of the demo, and a "?" in a
 * rationale opens the pre-flight panel over the top of it. Each of those looks
 * like a crash from the far end of a Teams call.
 *
 * Range inputs and checkboxes are deliberately included: arrow keys are how you
 * nudge a slider, and that is the caller's intent, not the tour's.
 *
 * Shared rather than duplicated per handler, because the failure mode of a second
 * copy is one handler quietly keeping the old behaviour.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}
