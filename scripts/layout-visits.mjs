import { DIALOGS, TILL } from "./layout-paths.mjs";
import { look } from "./browser-audit.mjs";
import { navigate, observe, overlay, ready, trackData } from "./browser-ready.mjs";

/**
 * Click from inside the page: Playwright's click waits for everything to
 * settle. A disabled control is not clicked and says so. «Agregar» on a dish
 * with a choice still to make, or «Cobrar» on an empty sale, used to report
 * a click that did nothing (cross-review of batch 5).
 */
const tap = (tab, sel) =>
  tab.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e && !e.disabled){e.click(); return true;} return false;})()`);
const tapText = (tab, text) =>
  tab.evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>x.textContent.includes(${JSON.stringify(text)}) && !x.disabled); if(b){b.click(); return true;} return false;})()`);

const SHEET = ".tt-detail-overlay > [role=dialog]:not(.tt-pos-ask)";
const saleHasDish = tab =>
  tab.evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.includes(${JSON.stringify(TILL.cash.label)}) && !b.disabled)`);

/**
 * What a till dialog needs first. Named, not a list of clicks: the till adds a
 * plain dish at once and opens a sheet for one with choices, and a fixed
 * «tile, then Agregar» either found no sheet or pressed a disabled button.
 * Each is idempotent, so a retried opening never adds a second dish.
 */
export const PREPARE = {
  // A dish in the sale. A tile whose sheet cannot be added from (a choice
  // still to make) is closed, and the next tile tried.
  async dishInSale(tab, phase, pending) {
    for (let n = 0; n < 8 && !(await saleHasDish(tab)); n++) {
      if (!(await tab.evaluate(`(()=>{const t=document.querySelectorAll('.tt-pos-tile:not(.tt-pos-tile-out)')[${n}]; if(!t) return false; t.click(); return true;})()`))) return false;
      await phase("readiness", () => ready(tab, { pending }));
      if (await tab.locator(SHEET).count()) {
        if (!(await tapText(tab, TILL.add.label))) await tab.keyboard.press("Escape");
        // Never click the next tile behind a sheet that stayed open.
        if (!(await phase("readiness", () => overlay(tab, SHEET, false, 3000, false)))) return false;
      }
    }
    return saleHasDish(tab);
  },
};

/** Openers that need more than one click: a tile that opens a sheet, not one added at once. */
export const OPEN = {
  async dishSheet(tab, phase, pending) {
    for (let n = 0; n < 8; n++) {
      if (await tab.locator(SHEET).count()) return true;
      if (!(await tab.evaluate(`(()=>{const t=document.querySelectorAll('.tt-pos-tile:not(.tt-pos-tile-out)')[${n}]; if(!t) return false; t.click(); return true;})()`))) return false;
      await phase("readiness", () => ready(tab, { pending }));
    }
    return (await tab.locator(SHEET).count()) > 0;
  },
};

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
  let failures = await look(tab, `diner ${lang} · ${flow.name}`, phase, log);
  if (flow.escape !== undefined) {
    // Escape answers the topmost dialog only. Before S24 the sheets ignored it,
    // and nothing here would have said so. The sheet measured must be open as
    // a dialog first, and that very sheet must be the one that closes: a sheet
    // that lost both its role and its Escape counted zero dialogs either side
    // and passed (cross-review of batch 5).
    const visible = `[...document.querySelectorAll('[role=dialog][aria-modal=true]')].filter(d => d.getBoundingClientRect().height > 0)`;
    const before = await tab.evaluate(`(()=>{const open=${visible}; const top=open.at(-1); if(top) top.setAttribute('data-escape-probe',''); return open.length;})()`);
    if (before !== flow.escape + 1) {
      log(`    BAD      diner ${lang} · ${flow.name}: ${before} dialog(s) open before Escape, not ${flow.escape + 1}`);
      failures++;
    } else {
      await tab.keyboard.press("Escape");
      const closed = async () => (await tab.evaluate(`(()=>{const p=document.querySelector('[data-escape-probe]'); return (!p || p.getBoundingClientRect().height === 0) && ${visible}.length === ${flow.escape};})()`));
      if (!(await phase("readiness", () => observe(tab, closed, { timeout: 3000, required: false })))) {
        log(`    BAD      diner ${lang} · ${flow.name}: Escape did not close the sheet on top, or closed more than it`);
        failures++;
      }
    }
  }
  return { failures, audits: 1 };
}

export async function teamVisit({ tab, phase, log }, { who, path, base, width }) {
  const pending = trackData(tab);
  await navigate(tab, base + path, phase, pending);
  let failures = await look(tab, `${who.role} · ${path}`, phase, log);
  let reloads = 0;
  let audits = 1;
  const dialogs = [];
  for (const dialog of DIALOGS[path] ?? []) {
    // What the screen needs before the dialog can open (a dish in the sale),
    // and openers that take more than one click. Both are named in PREPARE
    // and OPEN, and safe to repeat.
    const prepare = async () => !dialog.prepare || PREPARE[dialog.prepare](tab, phase, pending);
    const press = async () => (await prepare()) && (dialog.open ? OPEN[dialog.open](tab, phase, pending)
      : dialog.text ? tapText(tab, dialog.text) : tap(tab, dialog.click));
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
      // A dialog the demo data always has is not «no data» when it fails to open.
      if (dialog.required) {
        log(`    BAD      ${who.role} · ${path} → ${dialog.name}: did not open`);
        failures++;
      } else log(`    –        ${who.role} · ${path} → ${dialog.name}: did not open (no data)`);
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
