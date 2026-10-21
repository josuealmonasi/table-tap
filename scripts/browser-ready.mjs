/** Node-side polling: production's CSP forbids Playwright's waitForFunction. */
export async function observe(tab, sample, { timeout = 30000, interval = 100, required = true } = {}) {
  const until = Date.now() + timeout;
  do {
    if (tab.isClosed()) throw new Error("page closed before readiness");
    if (await sample()) return true;
    await new Promise(resolve => setTimeout(resolve, interval));
  } while (Date.now() < until);
  if (required) throw new Error(`page state did not become ready in ${timeout}ms`);
  return false;
}

/** Listen before navigation; a quiet shell is not evidence that data resolved. */
export function trackData(tab) {
  const active = [];
  const start = request => {
    if (["document", "fetch", "xhr"].includes(request.resourceType())) active.push(request);
  };
  const end = request => {
    const index = active.indexOf(request);
    if (index !== -1) active.splice(index, 1);
  };
  tab.on("request", start);
  tab.on("requestfinished", end);
  tab.on("requestfailed", end);
  return { get size() { return active.length; } };
}

export function contentFor(url) {
  const path = new URL(url).pathname;
  if (path.startsWith("/dashboard")) return ".tt-dash";
  if (path.startsWith("/r/")) return ".tt-root";
  if (path.startsWith("/order/")) return ".tt-root, .tt-track";
  if (path === "/") return ".tt-landing";
  if (path === "/rewards") return new URL(url).searchParams.has("c") ? ".tt-rewards" : ".tt-login";
  if (["/terminos", "/privacidad"].includes(path)) return ".tt-legal";
  return ".tt-login";
}

const snapshot = selector => `(() => {
  const root = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.body"};
  if (!root) return null;
  const visible = e => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.height > 0;
  };
  const busy = [...document.querySelectorAll('[aria-busy="true"], .tt-skeleton')].some(visible)
    || [...root.querySelectorAll('p, [role=status]')].some(e => visible(e) && /^(loading|cargando)[.…\\s]*$/i.test(e.innerText.trim()));
  const text = root.innerText.trim();
  // Rows, forms, static content and explicit empty/error text are all rendered
  // outcomes. Skeletons and in-flight data must be gone before any count.
  const content = text.length > 0 && !/^(loading|cargando)[.…\\s]*$/i.test(text);
  const images = [...document.body.querySelectorAll('img')].filter(i => visible(i) && (i.loading !== 'lazy' || i.getBoundingClientRect().top < innerHeight)).every(i => i.complete);
  const geometry = [...document.body.querySelectorAll('*')].filter(visible).map(e => {
    const r = e.getBoundingClientRect();
    return [e.tagName, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  });
  return { ready: content && !busy && images && document.fonts.status === 'loaded',
    signature: JSON.stringify([text, geometry]) };
})()`;

/**
 * Wait for the page to stop changing.
 *
 * The bar used to be "more than 200 characters of text", which is a stand-in
 * for settled rather than a measure of it — and the front door walked straight
 * into it: /login has exactly 200 and /reset-password 174, so both real,
 * fully-rendered pages sat here for thirty seconds and were reported as
 * failures. Consecutive geometry samples that agree measure settled directly,
 * after data, skeletons, images and fonts have resolved.
 *
 * Polled from here rather than with `waitForFunction`: Playwright runs that
 * predicate through `eval` inside the page — a function too, not just a
 * string — and production's CSP forbids `eval`, so against the deployed site
 * every screen failed before it was measured. `evaluate` goes through the
 * DevTools protocol, which a CSP does not govern, and the page keeps the
 * policy it really ships with.
 *
 * @param {*} tab
 * @param {{ url?: string, pending?: { readonly size: number }, timeout?: number, expect?: string }} [options]
 */
export async function ready(tab, { url, pending = new Set(), timeout = 30000, expect } = {}) {
  let previous;
  let stableSince = Date.now();
  await observe(tab, async () => {
    if (url) {
      const actual = new URL(tab.url());
      const planned = new URL(url);
      if (actual.origin !== planned.origin || actual.pathname !== planned.pathname || actual.search !== planned.search) {
        throw new Error(`unexpected route ${actual.pathname}${actual.search}; expected ${planned.pathname}${planned.search}`);
      }
    }
    // Navigation finishes before sampling. A destroyed page fails this visit
    // rather than standing in for a settled sample.
    const state = await tab.evaluate(snapshot(url ? contentFor(url) : undefined));
    if (!state?.ready || pending.size || (expect && !(await tab.evaluate(text => document.body.innerText.includes(text), expect)))) {
      previous = undefined;
      stableSince = Date.now();
      return false;
    }
    if (state.signature !== previous) stableSince = Date.now();
    previous = state.signature;
    return Date.now() - stableSince >= 300;
  }, { timeout });
}

export async function overlay(tab, selector = "[role=dialog]", open = true, timeout = 1500, required = true) {
  return observe(tab, async () => (await tab.locator(selector).count() > 0 && await tab.locator(selector).first().isVisible()) === open,
    { timeout, required });
}

/** A navigation that retries once.
 *
 * The dev server drops mid-run and the network failure showed up as though the
 * screen were broken. A false red teaches people to ignore reds.
 */
export async function navigate(tab, url, phase, pending) {
  await phase("navigation", async () => {
    let response;
    try { response = await tab.goto(url, { waitUntil: "load", timeout: 60000 }); }
    catch { response = await tab.goto(url, { waitUntil: "load", timeout: 60000 }); }
    if (response && response.status() >= 400) throw new Error(`navigation returned HTTP ${response.status()}`);
  });
  await phase("readiness", () => ready(tab, { url, pending }));
}
