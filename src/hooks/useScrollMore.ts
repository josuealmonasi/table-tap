"use client";

import { useEffect, type RefObject } from "react";

/**
 * Says which edges of a sideways scroller hide more of it, as `data-more` on
 * the element ("left", "right" or "both"; absent when everything shows), and
 * brings the current item to the middle when `currentKey` changes.
 *
 * The phone's tab bar holds every section and scrolls. Its scrollbar is
 * hidden, so without this the last tab was simply cut at the edge ("Le…") and
 * nothing said there were six more. The stylesheet fades the edge that has
 * more; this hook is what knows which edge that is.
 */
export function useScrollMore(
  ref: RefObject<HTMLElement | null>,
  currentKey: string,
  currentSelector = "[aria-current='page']",
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = (): void => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      const more = left && right ? "both" : left ? "left" : right ? "right" : "";
      if (more) el.dataset.more = more;
      else delete el.dataset.more;
    };
    // A section past the edge would be open with no tab lit, so the bar
    // scrolls it into view: Analíticas is the last of sixteen.
    // The menu's category chips mark the chosen one with a class, not
    // aria-current, so each caller says how its current item is marked.
    const current = el.querySelector<HTMLElement>(currentSelector);
    if (current && el.scrollWidth > el.clientWidth) {
      const box = el.getBoundingClientRect();
      const tab = current.getBoundingClientRect();
      el.scrollLeft = Math.max(0, el.scrollLeft + tab.left - box.left - (el.clientWidth - tab.width) / 2);
    }
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    const resized = new ResizeObserver(mark);
    resized.observe(el);
    // A badge arriving or the language changing can make the strip overflow
    // without the strip itself resizing: re-measure, never re-centre.
    const changed = new MutationObserver(mark);
    changed.observe(el, { childList: true, characterData: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", mark);
      resized.disconnect();
      changed.disconnect();
    };
  }, [ref, currentKey, currentSelector]);
}
