import { useEffect, type RefObject } from "react";
import { prefersReducedMotion } from "./reducedMotion.js";

/**
 * Scroll reveals, registration-tick fade-ins and stat count-ups, driven from ONE
 * observer over the page root rather than from sixty component-local ones.
 *
 * WHY THIS READS THE DOM INSTEAD OF BEING A `<Reveal>` COMPONENT. The stagger is the
 * reason. A revealed element is delayed by 70ms times its index AMONG ITS REVEALED
 * SIBLINGS, so a four-up metrics grid cascades left to right. A wrapper component
 * does not know its own index without being told, and telling it means threading an
 * `index` prop through every one of the ~60 call sites - noise at each of them, and
 * a silent visual bug the first time somebody reorders two cells and forgets to
 * renumber. Read off `parentElement` the index cannot be wrong.
 *
 * Nothing here changes what is on the page: every element is fully rendered and
 * readable with JavaScript off, and the hidden state is applied by `.is-armed`,
 * which this hook adds. Fail closed - if the hook never runs, the page is simply
 * visible.
 */

const STAGGER_MS = 70;
const COUNT_MS = 900;

function targetOf(el: Element): number {
  return Number.parseFloat(el.getAttribute("data-to") ?? "") || 0;
}

/**
 * Exported for the test: the formatting is the part with a decision in it, and it is
 * not observable from outside once it has been written into a text node mid-animation.
 *
 * Decimals are FIXED, never grouped - "0.750" is a belief mass, and a belief mass
 * with a thousands separator would be nonsense. Integers are grouped, because the
 * only ones on the page are draw counts in the thousands.
 */
export function formatCount(value: number, decimals: number, suffix: string): string {
  const body = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toLocaleString("en-US");
  return body + suffix;
}

function writeCount(el: HTMLElement, value: number): void {
  el.textContent = formatCount(
    value,
    Number.parseInt(el.getAttribute("data-decimals") ?? "0", 10),
    el.getAttribute("data-suffix") ?? "",
  );
}

export function useReveals(rootRef: RefObject<HTMLElement>, enabled: boolean): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const counters = () => Array.from(root.querySelectorAll<HTMLElement>("[data-count]"));

    // Three different reasons to skip, one behaviour: show everything, finally
    // formatted, immediately. `enabled === false` is the author's switch; the media
    // query is the reader's, and the reader's is not overridable. The third is an
    // environment without IntersectionObserver - jsdom, and anything old enough to
    // matter - where arming the page would hide content nothing could ever reveal.
    if (!enabled || typeof IntersectionObserver === "undefined" || prefersReducedMotion()) {
      counters().forEach((el) => writeCount(el, targetOf(el)));
      // A stopped marquee is a row of content the reader can no longer reach. Give
      // the window a scrollbar so the second half stays readable by hand.
      root.querySelectorAll<HTMLElement>(".marquee-window").forEach((w) => {
        w.style.overflowX = "auto";
      });
      return;
    }

    root.classList.add("is-armed");

    const frames = new Set<number>();
    const counted = new WeakSet<Element>();

    const animateCount = (el: HTMLElement): void => {
      if (counted.has(el)) return;
      counted.add(el);
      const to = targetOf(el);
      const start = performance.now();
      const step = (now: number): void => {
        const p = Math.min(1, (now - start) / COUNT_MS);
        // Cubic ease-out: the number arrives fast and settles, which reads as a
        // meter coming to rest rather than a slot machine.
        writeCount(el, to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) frames.add(requestAnimationFrame(step));
        else writeCount(el, to);
      };
      frames.add(requestAnimationFrame(step));
    };

    const reveals = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;

          const siblings = el.parentElement
            ? Array.from(el.parentElement.querySelectorAll(":scope > [data-reveal]"))
            : [];
          el.style.transitionDelay = `${Math.max(0, siblings.indexOf(el)) * STAGGER_MS}ms`;
          el.classList.add("is-in");

          if (el.matches("[data-count]")) animateCount(el);
          el.querySelectorAll<HTMLElement>("[data-count]").forEach(animateCount);
          reveals.unobserve(el);
        }
      },
      // -8% at the bottom so an element commits to appearing only once it is
      // properly on screen, not as its first pixel crosses the fold.
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );

    root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => reveals.observe(el));
    // A count-up that is not wrapped in a reveal still needs a trigger.
    counters().forEach((el) => {
      if (!el.closest("[data-reveal]")) reveals.observe(el);
    });

    // Ticks belong to their section, not to themselves: they mark where a boundary
    // crosses a rail, so a whole set lighting up at once reads as the section being
    // registered. Fading them one at a time as each scrolled past looked like dirt.
    const groups = new Map<Element, HTMLElement[]>();
    root.querySelectorAll<HTMLElement>(".tick").forEach((tick) => {
      const host = tick.closest("section, footer, header") ?? tick.parentElement;
      if (!host) return;
      const found = groups.get(host);
      if (found) found.push(tick);
      else groups.set(host, [tick]);
    });

    const ticks = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          groups.get(entry.target)?.forEach((tick) => tick.classList.add("is-in"));
          ticks.unobserve(entry.target);
        }
      },
      { threshold: 0, rootMargin: "0px 0px -5% 0px" },
    );
    groups.forEach((_, host) => ticks.observe(host));

    return () => {
      reveals.disconnect();
      ticks.disconnect();
      frames.forEach((id) => cancelAnimationFrame(id));
      root.classList.remove("is-armed");
    };
  }, [rootRef, enabled]);
}
