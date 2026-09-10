/**
 * Print a window somebody just wrote a document into.
 *
 * The document used to print itself — `<body onload="window.print()">` — which
 * is an inline event handler, and the Content-Security-Policy refuses those. A
 * ticket that opens and never prints is worse than one that never opens.
 *
 * So the opener does it, from a script the policy already trusts, and waits
 * for the same moment `onload` did: printing before the stylesheet applies
 * puts an 80mm ticket on a Letter page.
 */
export function printWhenReady(w: Window): void {
  if (w.document.readyState === "complete") {
    w.print();
    return;
  }
  w.addEventListener("load", () => w.print(), { once: true });
}
