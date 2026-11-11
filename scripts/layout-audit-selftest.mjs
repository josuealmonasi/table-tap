import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { AUDIT } from "./layout-audit.mjs";

// Static pages only: no app, database, fixture writes or network required.
export async function layoutAuditSelftest(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let count = 0;
  const check = async (name, kind, html, expected = true, source = AUDIT) => {
    await page.setContent(`<!doctype html><style>
      body { margin:0; font:16px/20px Arial,sans-serif } * { box-sizing:border-box }
    </style>${html}`);
    const faults = await page.evaluate(source);
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
    const icon = '<svg width="16" height="16"><rect width="16" height="16" fill="black"/></svg>';
    const iconButton = (gap, graphic = icon) => `<button style="display:inline-flex;align-items:center;gap:${gap}px;font:inherit;padding:8px">${graphic}<span>Save</span></button>`;
    const edgeBox = (padding, content = 'Box label') => `<section style="width:260px;min-height:32px;border:2px solid #888;border-radius:12px;padding:${padding}px">${content}</section>`;
    const control = text => `<button style="border:1px solid #888;padding:6px;font:inherit;flex:none">${text}</button>`;
    const controls = (gap, extra = '') => `<div style="display:flex;gap:${gap}px;${extra}">${control('First')}${control('Second')}</div>`;
    const entries = (lineHeight, style = '') => `<ul style="margin:0;padding:0;list-style:none;line-height:${lineHeight}px"><li style="${style}">First entry</li><li style="${style}">Second entry</li></ul>`;
    const bottomBar = (extra = '') => `<nav style="position:fixed;bottom:0;left:0;width:100%;height:56px;z-index:10;background:#333;color:white;${extra}"><span style="display:block;padding:18px">Navigation</span></nav>`;
    const stickyForm = bottom => `<form><div style="height:1400px">Form fields</div>
      <footer style="position:sticky;bottom:${bottom}px;padding:8px;background:white">
        <button style="height:40px">Save changes</button>
      </footer></form>${bottomBar()}`;
    const pinnedButton = (extra = '') => `<div style="position:fixed;bottom:8px;left:16px;z-index:1;${extra}"><button style="height:40px">Pinned save</button></div>`;
    // The early actions are not currently stuck: only their unsafe inset can
    // expose the fault without scrolling. Exercise current occlusion separately.
    const earlyActions = bottom => `<form style="min-height:1400px"><footer style="position:sticky;bottom:${bottom}px">
      <button style="height:40px">Early save</button></footer></form>${bottomBar()}`;
    const twins = [
      ['icon-touches-label', 'icon 2px from label', iconButton(2), iconButton(4)],
      ['content-touches-edge', 'text 2px from inner border', edgeBox(2), edgeBox(6)],
      ['controls-touching', 'controls 2px apart', controls(2), controls(4)],
      ['entries-run-together', 'entries with 1px painted gap', entries(18), entries(24)],
      ['covered-by-bar', 'sticky actions under bottom tabs', stickyForm(0), stickyForm(64)],
    ];
    for (const [kind, name, broken, fixed] of twins) {
      await check(name, kind, broken);
      await check(`${name}: fixed twin`, kind, fixed, false);
    }
    const coverageTwins = [
      ['unsafe sticky inset before sticking', earlyActions(0), earlyActions(64)],
      ['fixed control covered at its centre', pinnedButton() + bottomBar(), pinnedButton('z-index:20') + bottomBar()],
    ];
    for (const [name, broken, fixed] of coverageTwins) {
      await check(name, 'covered-by-bar', broken);
      await check(`${name}: fixed twin`, 'covered-by-bar', fixed, false);
    }
    await check('sticky bar resting against a scrolled field', 'controls-touching', `<div style="height:2000px"><input style="display:block;height:40px;margin-top:500px;border:1px solid #999" value="Field"><div style="position:sticky;bottom:0;margin-top:1px"><button style="border:1px solid #999;height:40px">Save</button></div></div>`, false);
    await check('two touching buttons inside a sticky bar', 'controls-touching', `<div style="position:sticky;bottom:0;display:flex"><button style="border:1px solid #999">Cancel</button><button style="border:1px solid #999">Save</button></div>`);
    await check('full-screen sheet is not a bar', 'covered-by-bar', `<div style="position:fixed;inset:0;background:white;z-index:30">Sheet</div>${stickyForm(64)}`, false);
    await check('chips scrolled to the fold of a card', 'content-touches-edge', `<section style="border:1px solid #ccc;border-radius:12px;padding:14px;height:80px;overflow:auto"><div style="height:44px"></div><button style="border:1px solid #999;border-radius:8px;padding:8px 14px">Picante</button></section>`, false);
    await check('chip text flush on its card edge', 'content-touches-edge', `<section style="border:1px solid #ccc;border-radius:12px;padding:12px 14px 12px 2px"><span>Picante</span></section>`);
    await check('toast card floating over a page card', 'cards-touching', `<section style="border:1px solid #ccc;border-radius:12px;padding:12px;margin-top:40px">Page card text</section><div style="position:fixed;top:0;left:0;right:0"><div style="border:1px solid #ccc;border-radius:12px;padding:8px;height:40px">Mesa 10 quiere un mesero</div></div>`, false);
    await check('ordinary button scrolling under tabs', 'covered-by-bar', `<div style="margin-top:800px"><button style="height:40px">Scrolling save</button></div>${bottomBar()}`, false);
    await check('bar excludes its own controls', 'covered-by-bar', bottomBar().replace('Navigation', '<button>Tab</button>'), false);
    await check('small fixed element is not a bar', 'covered-by-bar', pinnedButton() + bottomBar('width:100px'), false);
    await check('short fixed element is not a bar', 'covered-by-bar', pinnedButton() + bottomBar('height:29px'), false);
    await check('hidden fixed bar', 'covered-by-bar', stickyForm(0).replace('z-index:10;', 'z-index:10;visibility:hidden;'), false);
    await check('dialog sticky actions ignore page tabs', 'covered-by-bar', `<div role="dialog" style="position:fixed;inset:0;z-index:20;background:white">${stickyForm(0).replace(bottomBar(), '')}</div>${bottomBar()}`, false);
    await check('page sticky actions ignored behind dialog', 'covered-by-bar', `${stickyForm(0)}<div role="dialog" style="position:fixed;inset:0;z-index:20;background:white">Dialog</div>`, false);
    await check('dialog sticky actions without page bar', 'covered-by-bar', `<div role="dialog">${earlyActions(0).replace(bottomBar(), '')}</div>`, false);
    await check('dialog bar can cover dialog controls', 'covered-by-bar', `<div role="dialog" style="position:fixed;inset:0">${pinnedButton()}${bottomBar()}</div>`);
    await check('40% overlap needs centre hit confirmation', 'covered-by-bar', pinnedButton('bottom:40px') + bottomBar(), false);
    await check('top bar covers pinned control', 'covered-by-bar', pinnedButton('bottom:auto;top:8px') + bottomBar('bottom:auto;top:0'));
    await check('small image beside label', 'icon-touches-label', iconButton(2, '<img width="16" height="16" alt="" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22%3E%3Crect width=%2216%22 height=%2216%22/%3E%3C/svg%3E">'));
    await check('32px image is not an icon', 'icon-touches-label', iconButton(2, '<img width="32" height="32" alt="">'), false);
    await check('padded label uses text range', 'icon-touches-label', iconButton(0).replace('<span>', '<span style="padding-left:8px">'), false);
    await check('icon in a separate control', 'icon-touches-label', `<div style="display:flex;align-items:center">${iconButton(4).replace('<span>Save</span>', '')}<a>Save</a></div>`, false);
    await check('unpainted label', 'icon-touches-label', iconButton(2).replace('<span>', '<span style="color:transparent">'), false);
    await check('floating icon', 'icon-touches-label', iconButton(2).replace('<svg ', '<svg style="position:absolute" '), false);
    await check('fully clipped icon', 'icon-touches-label', iconButton(2).replace(icon, `<span style="width:0;height:16px;overflow:hidden">${icon}</span>`), false);
    await check('vertical icon and label', 'icon-touches-label', iconButton(2).replace('align-items:center;', 'flex-direction:column;'), false);
    await check('control near inner border', 'content-touches-edge', edgeBox(2, control('Save')));
    await check('right inner border', 'content-touches-edge', edgeBox(12, '<div style="text-align:right;margin-right:-10px">Right</div>'));
    await check('bottom inner border', 'content-touches-edge', edgeBox(12, 'Bottom').replace('padding:12px', 'padding:12px 12px 2px'));
    await check('top inner border', 'content-touches-edge', edgeBox(12, 'Top').replace('padding:12px', 'padding:2px 12px 12px'));
    await check('edge-to-edge bordered row', 'content-touches-edge', edgeBox(0, '<div style="border-bottom:1px solid #888;padding:2px">Edge row</div>'), false);
    await check('dialog content never uses page box', 'content-touches-edge', edgeBox(0, '<div role="dialog">Dialog label</div>'), false);
    await check('edge image', 'content-touches-edge', edgeBox(0, '<img width="32" height="32" alt="">'), false);
    await check('transparent border box', 'content-touches-edge', edgeBox(2).replace('solid #888', 'solid transparent'), false);
    await check('floating edge text', 'content-touches-edge', edgeBox(0, '<span style="position:absolute">Floating</span>'), false);
    // Production at 390px: these invisible control boxes touch their cards,
    // but the field is drawn by its wrapper and the labels have real padding.
    const search = (paint = '') => `<div class="tt-bill-search" style="display:flex;align-items:center;gap:8px;padding:0 12px;margin:12px 0;border:1px solid #ccc;border-radius:999px;background:white">
      ${icon}<input class="tt-input" value="Find a bill" style="font:inherit;min-width:0;width:100%;border:0;background:transparent;padding:11px 0;${paint}">
    </div>`;
    const planActions = (offset = -16, paint = '') => `<section class="tt-section" style="width:300px;padding:18px;border:1px solid #ccc;border-radius:12px;background:white">
      <p style="margin:0">Your subscription and billing</p>
      <div class="tt-plan-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;margin-left:${offset}px">
        ${['Manage billing', 'Cancel subscription'].map(text => `<button class="tt-btn tt-btn-ghost tt-btn-sm tt-plan-cancel" style="display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;border:0;background:transparent;font:600 13px/20px Arial;padding:8px 16px;${paint}">${text}</button>`).join('')}
      </div></section>`;
    const terminalDay = (padding = 12, paint = '') => `<ul class="tt-costs-products" style="list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px">
      <li class="tt-terminal-day" style="border:1px solid #ccc;border-radius:8px;background:white;padding:0">
        <button class="tt-terminal-day-head" style="width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:2px 12px;padding:${padding}px;border:0;background:transparent;text-align:left;font:inherit;${paint}">
          <span class="tt-costs-product-name" style="font-weight:600;min-width:0;overflow-wrap:anywhere">Monday</span>
          <span class="tt-costs-chip">Received</span>
          <span class="tt-costs-product-meta" style="grid-column:1/-1;font-size:12px">Payments received</span>
        </button></li></ul>`;
    const productionTwins = [
      ['wrapper-drawn search input', search(), search('border:1px solid #888')],
      ['plan ghost button hit targets', planActions(), planActions(-30)],
      ['terminal grid item text', terminalDay(), terminalDay(2)],
    ];
    for (const [name, good, broken] of productionTwins) {
      assert.deepEqual(await check(name, 'content-touches-edge', good, false), [], `${name}: no faults`);
      await check(`${name}: broken twin`, 'content-touches-edge', broken);
    }
    await check('search input matching card background', 'content-touches-edge', search('background:white'), false);
    await check('search input contrasting background', 'content-touches-edge', search('background:#eee'));
    await check('plan ghost button with painted background', 'content-touches-edge', planActions(-16, 'background:#eee'));
    await check('terminal grid button matching card background', 'content-touches-edge', terminalDay(12, 'background:white'), false);
    await check('terminal grid button contrasting background', 'content-touches-edge', terminalDay(12, 'background:#eee'));
    await check('wrapped controls 2px apart', 'controls-touching', controls(2, 'width:80px;flex-wrap:wrap'));
    await check('wrapped controls 4px apart', 'controls-touching', controls(4, 'width:80px;flex-wrap:wrap'), false);
    await check('deliberately joined controls', 'controls-touching', controls(0).replace('<div ', '<div role="group" data-joined '), false);
    await check('segmented controls', 'controls-touching', controls(0).replace('<div ', '<div class="tt-segmented" '), false);
    const flatControls = (gap, paint) => controls(gap).replaceAll('border:1px solid #888', `border:0;background:${paint}`);
    await check('borderless controls', 'controls-touching', flatControls(0, 'transparent'), false);
    await check('matching-background controls', 'controls-touching', `<div style="background:white">${flatControls(0, 'white')}</div>`, false);
    await check('background-only controls 2px apart', 'controls-touching', flatControls(2, '#eee'));
    await check('background-only controls 4px apart', 'controls-touching', flatControls(4, '#eee'), false);
    await check('floating control', 'controls-touching', controls(0).replace('font:inherit;', 'font:inherit;position:absolute;'), false);
    await check('controls across dialog layer', 'controls-touching', `<div role="dialog">${control('Dialog')}</div><div style="margin-top:2px">${control('Page')}</div>`, false);
    await check('controls inside fixed dialog', 'controls-touching', `<div role="dialog" style="position:fixed">${controls(2)}</div>`);
    await check('input and select borders', 'controls-touching', '<div style="display:flex;gap:2px"><input style="width:100px"><select><option>Choice</option></select></div>');
    await check('chip pill and radio borders', 'controls-touching', '<div style="display:flex;gap:2px"><span class="tt-chip" style="border:1px solid">Chip</span><span class="tt-pill" style="border:1px solid">Pill</span><span role="radio" style="border:1px solid">Radio</span></div>');
    await check('list with dividers', 'entries-run-together', entries(18, 'border-bottom:1px solid #888'), false);
    await check('list with painted backgrounds', 'entries-run-together', entries(18, 'background:#eee'), false);
    await check('list with matching backgrounds', 'entries-run-together', `<div style="background:white">${entries(18, 'background:white')}</div>`);
    await check('wrapped list entry uses its last line', 'entries-run-together', entries(18).replace('First entry', 'First<br>entry'));
    await check('list role', 'entries-run-together', entries(18).replace('<ul ', '<div role="list" ').replace('</ul>', '</div>').replaceAll('<li ', '<div role="listitem" ').replaceAll('</li>', '</div>'));
    await check('floating list entries', 'entries-run-together', entries(18, 'position:absolute'), false);
    await check('fully clipped list entry', 'entries-run-together', entries(18).replace('First entry', '<span style="display:block;height:0;overflow:hidden">First entry</span>'), false);
    const duplicated = await check('spacing reports deduplicate text', 'icon-touches-label', iconButton(2) + iconButton(2));
    assert.equal(duplicated.filter(f => f.kind === 'icon-touches-label').length, 1);

    // Comment out each emitter in the evaluated source, require the broken
    // twin's assertion to fail, then use the unchanged AUDIT for the next run.
    for (const [kind, name, broken] of [...twins, ...coverageTwins.map(([name, broken]) => ['covered-by-bar', name, broken])]) {
      const lines = AUDIT.split('\n');
      const emitters = lines.filter(line => line.includes("report('" + kind + "',"));
      assert.equal(emitters.length, 1, `${kind}: exactly one sabotage target`);
      const sabotaged = lines.map(line => line === emitters[0] ? '// ' + line : line).join('\n');
      await assert.rejects(check(name, kind, broken, true, sabotaged), error => {
        assert.equal(error.code, 'ERR_ASSERTION');
        assert.match(error.message, new RegExp(`expected ${kind} present`));
        console.log(`  ok       sabotage: ${kind} disabled -> self-test FAILED as expected`);
        return true;
      });
      await check(`${kind}: restored after sabotage`, kind, broken);
    }
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
