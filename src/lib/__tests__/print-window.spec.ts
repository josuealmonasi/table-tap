import { describe, expect, it, vi } from "vitest";
import { printWhenReady } from "@/lib/print-window";

/**
 * The ticket used to print itself with `<body onload="window.print()">`, which
 * is an inline handler the Content-Security-Policy refuses — a ticket that
 * opened and never printed. The opener prints it now, and must wait for the
 * same moment `onload` did: printing before the stylesheet applies puts an
 * 80mm kitchen ticket on a Letter page.
 */
function fakeWindow(readyState: DocumentReadyState) {
  const listeners: Record<string, (() => void)[]> = {};
  const w = {
    document: { readyState },
    print: vi.fn(),
    addEventListener: vi.fn((event: string, fn: () => void) => {
      (listeners[event] ??= []).push(fn);
    }),
  };
  return { w: w as unknown as Window, print: w.print, fire: (e: string) => listeners[e]?.forEach(f => f()) };
}

describe("printing a ticket once it can be printed", () => {
  it("prints straight away when the document has already loaded", () => {
    const { w, print } = fakeWindow("complete");
    printWhenReady(w);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("waits for the load when it has not", () => {
    const { w, print, fire } = fakeWindow("loading");
    printWhenReady(w);
    expect(print).not.toHaveBeenCalled();
    fire("load");
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("asks to be told only once, so a ticket is not printed twice", () => {
    const { w } = fakeWindow("interactive");
    printWhenReady(w);
    expect(w.addEventListener).toHaveBeenCalledWith("load", expect.any(Function), { once: true });
  });
});
