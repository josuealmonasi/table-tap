// ============================================================================
// The home-screen icons for the restaurant's installed dashboard.
//
// Rendered with the Playwright that already ships here rather than adding an
// image library for four PNGs. Run it when the mark changes:
//
//   node scripts/app-icons.mjs
// ============================================================================
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const ACCENT = "#0e6e6e";
const OUT = "public/icons";

/**
 * Two shapes, because the platforms want different things.
 *
 * `maskable` is edge-to-edge colour: Android crops it to whatever silhouette
 * the launcher uses, and anything near the corner is what gets cut. `any` keeps
 * its own rounded square, which is what iOS shows verbatim.
 */
function page(size, maskable) {
  const pad = maskable ? size * 0.18 : size * 0.14;
  const radius = maskable ? 0 : size * 0.22;
  return `<!doctype html><meta charset="utf-8">
<body style="margin:0">
  <div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:${ACCENT};
              display:flex;align-items:center;justify-content:center">
    <div style="font-size:${size - pad * 2}px;line-height:1">🍴</div>
  </div>
</body>`;
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const [size, maskable] of [[192, false], [512, false], [192, true], [512, true], [180, false]]) {
  const ctx = await browser.newContext({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  const tab = await ctx.newPage();
  await tab.setContent(page(size, maskable));
  await tab.waitForTimeout(120);
  const name = maskable ? `maskable-${size}.png` : `icon-${size}.png`;
  await tab.screenshot({ path: `${OUT}/${name}`, omitBackground: true });
  console.log(`  ${OUT}/${name}`);
  await ctx.close();
}
await browser.close();
