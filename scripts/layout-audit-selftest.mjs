import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { AUDIT } from "./layout-audit.mjs";

// Static pages only: no app, database, fixture writes or network required.
export async function layoutAuditSelftest(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let count = 0;
  const check = async (name, kind, html, expected = true) => {
    await page.setContent(`<!doctype html><style>
      body { margin:0; font:16px/20px Arial,sans-serif } * { box-sizing:border-box }
    </style>${html}`);
    const faults = await page.evaluate(AUDIT);
    assert.equal(faults.some(f => f.kind === kind), expected,
      `${name}: expected ${kind} ${expected ? 'present' : 'absent'}; got ${JSON.stringify(faults)}`);
    count++;
    console.log(`  ok       audit self-test: ${name}`);
    return faults;
  };
  const tabs = padding => `<nav style="display:flex;width:max-content">
    ${['Take order', 'Bills', 'Menu', 'Tables', 'More'].map(t => `<span style="padding:0 ${padding}px">${t}</span>`).join('')}
  </nav>`;
  const scroller = extra => `<footer style="position:fixed;bottom:0;width:390px">
    <nav style="display:flex;width:250px;overflow-x:auto;${extra}">
      ${['First tab', 'Second tab', 'Last tab'].map(t => `<span style="flex:none;width:110px;padding:10px">${t}</span>`).join('')}
    </nav></footer>`;
  try {
    await check('tabs with 2px padding', 'cramped', tabs(2));
    await check('tabs with 10px padding', 'cramped', tabs(10), false);
    await check('column separator', 'separator-starts-line', '<div style="display:flex;flex-direction:column"><span>Checklist</span><span> · optional</span></div>');
    await check('joined inline separator', 'separator-starts-line', '<div>Checklist&nbsp;· optional</div>', false);
    await check('trailing separator', 'separator-starts-line', '<div style="width:max-content"><span>Checklist ·</span><br><span>optional</span></div>');
    await check('ordinary list bullets', 'separator-starts-line', '<ul><li>• First</li><li>• Second</li></ul>', false);
    const ellipsis = text => `<div style="width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${text}</div>`;
    await check('ellipsized hours', 'truncated-number', ellipsis('Sun, Sat 09:00–14:00'));
    await check('ellipsized name', 'truncated-number', ellipsis('A very long delicious dish name'), false);
    await check('nowrap price', 'truncated-number', '<div style="width:60px;white-space:nowrap;overflow:hidden">Total $12345.00</div>');
    await check('cut-off fixed bar', 'bar-cut-off', scroller(''));
    await check('masked fixed bar', 'bar-cut-off', scroller('mask-image:linear-gradient(to right,black,transparent)'), false);
    await check('bar with explicit affordance', 'bar-cut-off', scroller('').replace('<nav ', '<nav data-more="right" '), false);
    await check('ordinary scroller', 'bar-cut-off', scroller('').replace('position:fixed;', ''), false);
    await check('wrapped row neighbours', 'cramped', '<div style="display:flex;flex-wrap:wrap;width:100px;gap:10px"><span>First words</span><span>Next words</span></div>', false);
    await check('screen reader descendant', 'cramped', '<div style="display:flex"><span>First<span style="position:absolute;width:1px;height:1px;clip:rect(0,0,0,0)">Hidden</span></span><span style="padding-left:12px">Second</span></div>', false);
    await check('grid neighbours', 'cramped', '<div style="display:grid;grid-template-columns:max-content max-content;gap:4px"><span>First</span><span>Second</span></div>');
    await check('fully clipped row text', 'cramped', '<div style="display:flex;width:30px;overflow:hidden"><span style="flex:none;width:100px">First</span><span style="flex:none">Second</span><span style="flex:none">Third</span></div>', false);
    const card = (style = '') => `<section style="border:1px solid #ccc;border-radius:12px;padding:12px;${style}">Card text</section>`;
    await check('cards flush on the page', 'cards-touching', card() + `<fieldset style="border:0;padding:0;margin:0">${card('margin-top:2px')}</fieldset>`);
    await check('cards with the 16px rhythm', 'cards-touching', card() + `<fieldset style="border:0;padding:0;margin:16px 0 0">${card()}</fieldset>`, false);
    await check('cards side by side', 'cards-touching', `<div style="display:flex;gap:2px">${card('width:180px')}${card('width:180px')}</div>`, false);
    await check('card inside a card', 'cards-touching', `<section style="border:1px solid #ccc;border-radius:12px;padding:0">${card()}</section>`, false);
    // One planted specimen for every pre-existing fault kind.
    await check('squashed', 'squashed', '<div style="width:10px;white-space:nowrap">Squashed words</div>');
    await check('overlapping', 'overlapping', '<div>PLANTED ALPHA TEXT</div><div style="margin-top:-18px;margin-left:20px">PLANTED BETA TEXT</div>');
    await check('misaligned', 'misaligned', '<section class="tt-section" style="width:200px">First card</section><section class="tt-section" style="width:190px;margin-left:10px">Second card</section>');
    await check('wrapped', 'wrapped', '<div style="width:30px;overflow-wrap:anywhere">DISCOUNT</div>');
    await check('off-center', 'off-center', '<div style="display:flex"><span>Helpful label</span><input style="height:60px;width:100px"></div>');
    await check('overflowing', 'overflowing', '<div style="width:500px">Wide page</div>');
    await check('cut-off-left', 'cut-off-left', '<div style="position:fixed;left:-10px;width:100px;height:30px">Left panel</div>');
    const crowded = Array.from({ length: 40 }, (_, i) => `<div style="display:flex"><span>A${i}</span><span>B${i}</span></div>`).join('');
    const ranked = await check('overflow survives report cap', 'overflowing', crowded + '<div style="width:500px">Overflow</div>');
    assert.equal(ranked[0].kind, 'overflowing');
    assert.equal(ranked.length, 12);
    console.log(`  Audit self-test passed (${count} fixtures).`);
  } finally { await page.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let browser;
  try {
    browser = await chromium.launch();
    await layoutAuditSelftest(browser);
  } catch (error) {
    console.error('Layout audit self-test failed:', error);
    process.exitCode = 1;
  } finally { await browser?.close(); }
}
