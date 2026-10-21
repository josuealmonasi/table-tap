import { DIALOGS } from "./layout-paths.mjs";
import { look } from "./browser-audit.mjs";
import { navigate, overlay, ready, trackData } from "./browser-ready.mjs";

/** Click from inside the page: Playwright's click waits for everything to settle. */
const tap = (tab, sel) =>
  tab.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e){e.click(); return true;} return false;})()`);
const tapText = (tab, text) =>
  tab.evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(b){b.click(); return true;} return false;})()`);

export async function dinerVisit({ ctx, tab, phase, log }, { lang, flow, base, r, table, anyOrder }) {
  // The language belongs to the restaurant, not the phone: the app starts in
  // Spanish no matter what and only the cookie changes it. Setting the browser
  // `locale` and believing it was English measured Spanish twice.
  await ctx.addCookies([{ name: "tt-locale", value: lang, url: base }]);
  // Most flows start at the table. One does not: the tracker has its own
  // URL, so it says where it begins.
  const start = flow.at ? `${base}${flow.at.replace(":orderId", anyOrder ?? "")}` : `${base}/r/${r.id}/t/${table.id}`;
  if (flow.at && !anyOrder) throw new Error("no order in the demo data to track");
  const pending = trackData(tab);
  await navigate(tab, start, phase, pending);
  for (const step of flow.steps) {
    if (step.addToCart) {
      if (!(await tap(tab, lang === "es" ? "button[aria-label^='Agregar ']" : "button[aria-label^='Add ']"))) {
        throw new Error("could not find a dish to add");
      }
      // Some dishes open their choices before they can be added. Observe that
      // outcome or the cart button, rather than sleeping through both.
      await phase("readiness", () => ready(tab, { pending }));
      await tab.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Agregar al carrito|Add to (cart|order)/i.test(x.textContent)); if(b) b.click();})()`);
      await tab.waitForSelector(".tt-fab", { timeout: 8000 });
    }
    // A step that cannot find its button leaves the previous screen up, and then
    // the menu gets measured twice while we think the dish detail was checked.
    // That does not get to pass quietly.
    if (step.click) {
      const sel = typeof step.click === "string" ? step.click : step.click[lang];
      if (!(await tap(tab, sel))) throw new Error(`could not find «${sel}»`);
    }
    if (step.text) {
      const label = typeof step.text === "string" ? step.text : step.text[lang];
      if (!(await tapText(tab, label))) throw new Error(`could not find the button «${label}»`);
    }
    if (step.bottom) {
      await tab.evaluate(`(()=>{const o=document.querySelector('.tt-detail-overlay'); if(o) o.scrollTop=o.scrollHeight;})()`);
    }
    await phase("readiness", () => ready(tab, { pending }));
  }
  await phase("readiness", () => ready(tab, { pending, expect: flow.expect?.[lang] }));
  return { failures: await look(tab, `diner ${lang} · ${flow.name}`, phase, log), audits: 1 };
}

export async function teamVisit({ tab, phase, log }, { who, path, base, width }) {
  const pending = trackData(tab);
  await navigate(tab, base + path, phase, pending);
  let failures = await look(tab, `${who.role} · ${path}`, phase, log);
  let reloads = 0;
  let audits = 1;
  const dialogs = [];
  for (const dialog of DIALOGS[path] ?? []) {
    const press = () => dialog.text ? tapText(tab, dialog.text) : tap(tab, dialog.click);
    const shows = dialog.shows ?? "[role=dialog]";
    let clicked = await press();
    // Having clicked does not mean anything opened. A silent no-op reads exactly
    // like an ok, and that is how a whole role went unchecked with nothing
    // saying so.
    let open = await phase("readiness", () => overlay(tab, shows, true, 900, false));
    // Again, after a bounded observation, and once more after a longer one:
    // a click that lands before the page is ready is the usual reason, and now
    // that a dialog missing at one width fails the run, a slow page must not read
    // as a broken one. One pause of 1.5s was not enough right after a
    // deploy: the first pages of a production run are cold, and every one
    // of the owner's dialogs at 360px read as missing while all of them
    // opened on a warm page a minute later.
    for (const window of [1500, 3000]) {
      if (clicked && open) break;
      clicked = await press();
      open = await phase("readiness", () => overlay(tab, shows, true, window, false));
    }
    // And once more on a fresh load. When the dev server swaps its worker
    // mid-run, the page already open keeps a bundle that no longer
    // answers, and pressing it again changes nothing: five times in one
    // day a dialog read as missing at exactly one width, on a page this
    // change never touched, during a restart — and opened on the rerun.
    // A fresh navigation is what a person would do, and a dialog that
    // still does not open after it is missing.
    if (!clicked || !open) {
      await navigate(tab, base + path, phase, pending);
      clicked = await press();
      open = await phase("readiness", () => overlay(tab, shows, true, 1500, false));
      if (clicked && open) reloads++;
    }
    dialogs.push({ key: `${who.role} · ${path} → ${dialog.name}`, width, open: clicked && open });
    if (!clicked || !open) {
      log(`    –        ${who.role} · ${path} → ${dialog.name}: did not open (no data)`);
      continue;
    }
    await phase("readiness", () => ready(tab, { pending }));
    failures += await look(tab, `${who.role} · ${path} → ${dialog.name}`, phase, log);
    audits++;
    await tab.keyboard.press("Escape");
    await phase("readiness", () => overlay(tab, shows, false));
  }
  return { failures, reloads, dialogs, audits };
}
