// @vitest-environment jsdom
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScrollMore } from "../useScrollMore";

// jsdom lays nothing out, so each strip is given the geometry a phone would.
function geometry(el: HTMLElement, widths: { client: number; scroll: () => number }): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => widths.client });
  Object.defineProperty(el, "scrollWidth", { configurable: true, get: widths.scroll });
  el.getBoundingClientRect = () => ({ left: 0, width: widths.client } as DOMRect);
}

let root: Root, host: HTMLDivElement, scrollWidth = 600;
function Strip({ current, selector }: { current: string; selector?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollMore(ref, current, selector);
  return (
    <div ref={el => {
      (ref as { current: HTMLDivElement | null }).current = el;
      if (el) geometry(el, { client: 300, scroll: () => scrollWidth });
    }}>
      {["a", "b", "c", "d", "e", "f"].map((key, i) => (
        <button key={key} className={key === current ? "tt-cat-on" : undefined}
          ref={b => { if (b) b.getBoundingClientRect = () => ({ left: i * 100, width: 100 } as DOMRect); }}>{key}</button>
      ))}
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  scrollWidth = 600;
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("centres the menu's chosen category chip, which is marked by class, not aria-current", async () => {
  await act(async () => root.render(<Strip current="e" selector=".tt-cat-on" />));
  const strip = host.firstElementChild as HTMLDivElement;
  // Chip "e" sits at 400–500 in a 300px strip: centred means scrolled to 300.
  expect(strip.scrollLeft).toBe(300);
});

it("leaves a strip alone when the default marker is not on any chip", async () => {
  await act(async () => root.render(<Strip current="e" />));
  expect((host.firstElementChild as HTMLDivElement).scrollLeft).toBe(0);
});

it("re-measures the fade when a label changes without the strip resizing", async () => {
  scrollWidth = 300;
  await act(async () => root.render(<Strip current="a" />));
  const strip = host.firstElementChild as HTMLDivElement;
  expect(strip.dataset.more).toBeUndefined();
  scrollWidth = 600;
  await act(async () => { strip.firstElementChild!.textContent = "a much longer label"; });
  expect(strip.dataset.more).toBe("right");
});
