import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * What a failed layout visit looked like, saved beside the gate's output so
 * GitHub uploads it: a full-page screenshot, and for each fault the offending
 * elements' boxes with their scroll container's bounds and scroll position.
 * A 5 KB text line ("controls-touching … 3.6px") was all a red run left before,
 * and a geometry fault cannot be argued about from a sentence.
 *
 * Only when GATE_EVIDENCE_DIR is set (CI sets it), so local runs leave nothing.
 */
export const EVIDENCE_PROBE = `((texts) => {
  const box = r => ({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 });
  const scroller = el => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === "auto" || o === "scroll") return p; } return null; };
  const find = text => [...document.querySelectorAll("body *")].filter(e => e.textContent && e.textContent.trim().startsWith(text.slice(0, 40)))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
  return texts.map(text => {
    const el = find(text);
    if (!el) return { text, found: false };
    const sc = scroller(el);
    return { text, found: true, tag: el.tagName.toLowerCase(), cls: el.className && String(el.className).slice(0, 120), rect: box(el.getBoundingClientRect()),
      scroller: sc ? { cls: String(sc.className).slice(0, 120), rect: box(sc.getBoundingClientRect()), scrollTop: sc.scrollTop, clientHeight: sc.clientHeight, scrollHeight: sc.scrollHeight } : null };
  });
})`;

export const slug = where => where.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120);

/** The two sides of each fault, as the audit prints them: «A / B». */
export function faultTexts(faults) {
  return faults.flatMap(f => String(f.text ?? "").split(" / ").map(t => t.trim()).filter(Boolean));
}

export async function saveEvidence(tab, where, faults, dir = process.env.GATE_EVIDENCE_DIR) {
  if (!dir || !faults.length) return null;
  try {
    mkdirSync(dir, { recursive: true });
    const name = slug(where) || "visit";
    const viewport = typeof tab.viewportSize === "function" ? tab.viewportSize() : null;
    const elements = await tab.evaluate(`${EVIDENCE_PROBE}(${JSON.stringify(faultTexts(faults))})`);
    await tab.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
    writeFileSync(join(dir, `${name}.json`), JSON.stringify({ where, url: tab.url(), viewport, seed: process.env.SEED ?? null, faults, elements }, null, 2));
    return name;
  } catch (error) {
    // Evidence is a bonus: never let it turn a reported fault into a crash.
    console.log(`             (evidence not saved: ${error.message})`);
    return null;
  }
}
