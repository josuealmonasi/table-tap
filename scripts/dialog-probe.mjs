import { AUDIT } from "./layout-audit.mjs";
import { deadline } from "./browser-jobs.mjs";
import { navigate, overlay, ready, trackData } from "./browser-ready.mjs";

/** What a person would call this button. */
const LABELS = `
  [...document.querySelectorAll("button, [role=button]")]
    .filter(b => b.offsetParent !== null && !b.disabled)
    .map(b => (b.textContent || b.getAttribute("aria-label") || b.getAttribute("title") || "").trim())
    .filter(t => t.length > 0 && t.length < 40)
`;

const clickByLabel = (tab, label) =>
  tab.evaluate(`(() => {
    const b = [...document.querySelectorAll("button, [role=button]")]
      .filter(x => x.offsetParent !== null && !x.disabled)
      .find(x => ((x.textContent||x.getAttribute("aria-label")||x.getAttribute("title")||"").trim()) === ${JSON.stringify(label)});
    if (!b) return false; b.click(); return true;
  })()`);

/**
 * Nothing here may hang.
 *
 * Clicking every button on a page means eventually clicking one that opens a
 * native file chooser — Ajustes has three — and an unhandled chooser blocks
 * the page for as long as the process lives. This run sat silent for fifteen
 * minutes on one. Native dialogs do the same. Both are dismissed the moment
 * they appear, and every probe still gets a ceiling on top of that.
 */
function defuse(tab) {
  tab.on("filechooser", fc => fc.setFiles([]).catch(() => {}));
  tab.on("dialog", d => d.dismiss().catch(() => {}));
}

/**
 * Buttons that leave the app.
 *
 * Signing out throws away the session the rest of the sweep is using, and the
 * plan tiers hand off to Stripe's own checkout — another origin, on somebody
 * else's servers. Neither opens a dialog here, so neither is skipped for
 * convenience: there is nothing at the end of them to measure.
 */
const LEAVES_THE_APP = /cerrar sesión|sign out|log out|elegir|contratar|cambiar de plan|choose|subscribe/i;

/**
 * Typing into a dialog's fields: does each keep its focus and its text?
 *
 * Every form in a dialog lost focus after one character — it jumped back to
 * the first field — because the dialog re-ran its "move focus in" effect on
 * every render. Measuring the dialog never noticed: it looked perfect, it just
 * could not be typed into. So this types, the way a person does, and checks
 * the cursor stayed and the characters arrived.
 */
const TYPABLE =
  "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range])" +
  ":not([type=color]):not([type=date]):not([type=time]):not([type=datetime-local]):not([type=month])" +
  ":not([type=week]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])";
export async function typingFaults(tab, scope = "[role=dialog]", most = 4) {
  const faults = [];
  const fields = tab.locator(scope).last().locator(TYPABLE);
  const n = Math.min(await fields.count(), most);
  for (let i = 0; i < n; i++) {
    const field = fields.nth(i);
    if (!(await field.isVisible())) continue;
    const name = await field.evaluate(e => e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.name || e.type);
    const chars = (await field.getAttribute("type")) === "number" ? "12" : "ab";
    try {
      await field.click({ timeout: 3000 });
      await tab.keyboard.type(chars, { delay: 40 });
      const stayed = await field.evaluate(e => document.activeElement === e);
      const value = await field.inputValue();
      if (!stayed) {
        const now = await tab.evaluate(() => {
          const a = document.activeElement;
          return a ? a.getAttribute("aria-label") || a.getAttribute("placeholder") || a.tagName.toLowerCase() : "nothing";
        });
        faults.push(`typing in «${name}» moved the cursor to «${now}»`);
      } else if (!value.toLowerCase().includes(chars)) {
        // Case aside: a coupon code and the promotion search write in capitals.
        faults.push(`typing «${chars}» in «${name}» left «${value}»`);
      }
    } catch (error) {
      faults.push(`could not type in «${name}»: ${error.message.split("\n")[0]}`);
    }
  }
  return faults;
}

/** Still on the page this visit is for. */
export function samePage(current, planned) {
  const a = new URL(current), b = new URL(planned);
  return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
}

export async function probeDialogs({ tab, log, phase, stop }, { url, role, path }) {
  defuse(tab);
  const pending = trackData(tab);
  let failures = 0;
  let opened = 0;
  const ok = where => log(`    ok       ${where}`);
  const bad = (where, faults) => {
    failures++;
    log(`    BAD      ${where}`);
    // The layout audit reports a measured thing; the typing check, a sentence.
    for (const f of faults) log(`             ${typeof f === "string" ? f : `${f.kind}: «${f.text}» (${f.w}px)`}`);
  };
  await navigate(tab, url, phase, pending);
  // The page's own fields first, before any dialog opens: a field rebuilt
  // on every keystroke loses its cursor the same way outside a dialog.
  const pageFaults = await phase("audit", () => typingFaults(tab, "main, body", 8));
  const pageWhere = `${role} · ${path} (its own fields)`;
  pageFaults.length ? bad(pageWhere, pageFaults) : ok(pageWhere);
  await navigate(tab, url, phase, pending);
  const seen = new Set();
  for (const label of await tab.evaluate(LABELS)) {
    if (seen.has(label) || LEAVES_THE_APP.test(label)) continue;
    seen.add(label);
    // A click that navigated (a link-like button) left every later label to be
    // looked for on another page, and skipped without a word: on /dashboard,
    // «Main Menu Abrir →» went first, so the menus' rename, copy and delete
    // dialogs were never checked by any run. Come back before the next click,
    // outside the probe's deadline so a slow page is not a timed-out probe.
    if (!samePage(tab.url(), url)) await navigate(tab, url, phase, pending);
    await deadline(20000, async () => {
      if (!(await clickByLabel(tab, label))) return;
      // A button can legitimately open nothing. Observe the full window then.
      if (!(await phase("readiness", () => overlay(tab, "[role=dialog]", true, 700, false)))) return;
      await phase("readiness", () => ready(tab, { pending }));
      opened++;
      const where = `${role} · ${path} → «${label}»`;
      // An audit that throws used to become an empty list, and an empty
      // list prints ok — so the one dialog heavy enough to break the check
      // was the one reported as flawless. A check that cannot run is not a
      // check that passed.
      const faults = await phase("audit", async () => [
        ...(await tab.evaluate(AUDIT)), ...(await typingFaults(tab)),
      ]);
      faults.length ? bad(where, faults) : ok(where);
      await tab.keyboard.press("Escape");
      // A dialog that will not close makes every later click hit it instead.
      if (!(await phase("readiness", () => overlay(tab, "[role=dialog]", false, 1000, false)))) {
        await navigate(tab, url, phase, pending);
      }
    }, stop);
    // A timed-out probe closes the whole visit and throws. It can never click
    // into the next probe, even if its JavaScript finishes after the timeout.
  }
  return { failures, opened, fieldChecks: 1 };
}
