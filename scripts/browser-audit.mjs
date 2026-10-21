import { AUDIT } from "./layout-audit.mjs";

/**
 * Does the audit still find anything?
 *
 * The overlap check is the expensive one, so it is also the one most likely to
 * be quietly broken by making it cheaper — and a check that finds nothing
 * reports every page as fine. Two blocks are planted overlapping on a blank
 * page before the run starts; if the audit shrugs at them, the whole gate is
 * worthless and says so rather than printing a column of ok.
 */
export async function assertAuditControl(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const tab = await ctx.newPage();
    await tab.setContent(`<!doctype html><body style="margin:0">
      <div style="font:20px/1.2 sans-serif;color:#000;height:40px">PLANTED ALPHA TEXT</div>
      <div style="font:20px/1.2 sans-serif;color:#000;height:40px;margin-top:-34px;margin-left:30px">PLANTED BETA TEXT</div>
    </body>`);
    const faults = await tab.evaluate(AUDIT);
    if (!faults.some(f => f.kind === "overlapping" && f.text.includes("PLANTED"))) {
      throw new Error("The audit no longer sees text painted over text. Every ok would be meaningless. Fix layout-audit.mjs first.");
    }
    console.log("  ok       the audit still catches a planted overlap\n");
  } finally { await ctx.close(); }
}

export async function look(tab, where, phase, log) {
  const faults = await phase("audit", () => tab.evaluate(AUDIT));
  if (!faults.length) log(`    ok       ${where}`);
  else {
    log(`    BAD      ${where}`);
    for (const f of faults) log(`             ${f.kind}: «${f.text}» (${f.w}px)`);
  }
  return faults.length;
}
