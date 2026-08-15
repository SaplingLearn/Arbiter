import { useEffect, useRef, type ElementType, type ReactNode } from "react";
import gsap from "gsap";
import { reducedMotion } from "./motion.js";

/**
 * HEADLINE REVEAL — display type arriving one line at a time.
 *
 * Each line sits in its own `overflow-hidden` mask and slides up from fully below it, so
 * the letters appear to be uncovered rather than to move. The whole block scales 0.95→1
 * and fades at the same time, which is what stops six separate line animations reading
 * as six separate events.
 *
 * WHY PER LINE AND NOT PER CHARACTER. The mono labels decode per character; headlines
 * must not. At 60px a per-character stagger across "THROUGH THE EVIDENCE" is twenty
 * independent animations and the eye cannot assemble a word out of them — it reads as a
 * ransom note. Per line, the unit of animation matches the unit of meaning.
 *
 * WHY THE MASK IS ON A SEPARATE ELEMENT FROM THE TRANSFORM. `overflow: hidden` on the
 * same element being transformed clips against the pre-transform box in some engines and
 * the post-transform box in others; a static mask wrapping a moving child is the only
 * arrangement that behaves the same everywhere.
 *
 * The line boxes get `pb` and a matching negative `mb`: descenders on a `y` or a comma
 * fall below the text box, and a mask fitted exactly to the line clips them off — a
 * detail invisible until a headline happens to contain one.
 */
export function Headline({
  as: Tag = "h2",
  lines,
  /** Rising edge plays the reveal. */
  play,
  className = "",
}: {
  as?: ElementType;
  lines: readonly string[];
  play: boolean;
  className?: string;
}) {
  const blockRef = useRef<HTMLElement>(null);
  const wasPlaying = useRef(false);

  useEffect(() => {
    const rising = play && !wasPlaying.current;
    wasPlaying.current = play;
    if (!rising) return;

    const block = blockRef.current;
    if (!block) return;
    const inner = block.querySelectorAll<HTMLElement>("[data-line-inner]");

    if (reducedMotion()) {
      gsap.set(block, { opacity: 1, scale: 1 });
      gsap.set(inner, { yPercent: 0 });
      return;
    }

    const tl = gsap.timeline();
    tl.fromTo(
      block,
      { opacity: 0, scale: 0.95 },
      { opacity: 1, scale: 1, duration: 0.75, ease: "power3.out" },
    ).fromTo(
      inner,
      { yPercent: 100 },
      { yPercent: 0, duration: 0.85, stagger: 0.06, ease: "expo.out" },
      0,
    );

    return () => {
      tl.kill();
    };
  }, [play]);

  return (
    <Tag ref={blockRef} className={className} style={{ transformOrigin: "center bottom" }}>
      {lines.map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.12em] mb-[-0.12em]">
          <span data-line-inner className="block">
            {line}
          </span>
        </span>
      ))}
    </Tag>
  );
}

/**
 * The paragraph under a headline.
 *
 * Fades only, and 100ms behind the last line. It does not slide: a paragraph rising into
 * place competes with the headline doing the same thing directly above it, and the two
 * movements read as the page settling rather than as one deliberate reveal. The delay is
 * what makes the order legible — headline, then the sentence that qualifies it.
 */
export function RevealParagraph({
  children,
  play,
  className = "",
}: {
  children: ReactNode;
  play: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const wasPlaying = useRef(false);

  useEffect(() => {
    const rising = play && !wasPlaying.current;
    wasPlaying.current = play;
    if (!rising) return;
    const el = ref.current;
    if (!el) return;

    if (reducedMotion()) {
      gsap.set(el, { opacity: 1 });
      return;
    }

    const tw = gsap.fromTo(
      el,
      { opacity: 0 },
      { opacity: 1, duration: 0.6, delay: 0.1, ease: "power2.out" },
    );
    return () => {
      tw.kill();
    };
  }, [play]);

  return (
    <p ref={ref} className={className}>
      {children}
    </p>
  );
}
