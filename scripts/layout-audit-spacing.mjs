// Inserted inside AUDIT: shares all, vis, forScreenReader, BAND and faults.
export const SPACING_AUDIT = String.raw`
  const readableCache = new Map();
  const readable = el => {
    if (!el || el === document.body) return true;
    if (!readableCache.has(el)) readableCache.set(el,
      vis(el) && !forScreenReader(el) && readable(el.parentElement));
    return readableCache.get(el);
  };
  const textCache = new Map();
  const clipCache = new Map();
  const clip = el => {
    if (!el || el === document.body) return { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };
    if (clipCache.has(el)) return clipCache.get(el);
    const bounds = { ...clip(el.parentElement) }, s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (/^(auto|scroll|hidden|clip)$/.test(s.overflowX)) {
      bounds.left = Math.max(bounds.left, r.left + el.clientLeft);
      bounds.right = Math.min(bounds.right, r.left + el.clientLeft + el.clientWidth);
    }
    if (/^(auto|scroll|hidden|clip)$/.test(s.overflowY)) {
      bounds.top = Math.max(bounds.top, r.top + el.clientTop);
      bounds.bottom = Math.min(bounds.bottom, r.top + el.clientTop + el.clientHeight);
    }
    clipCache.set(el, bounds);
    return bounds;
  };
  const painted = (rect, el) => {
    const bounds = clip(el), left = Math.max(rect.left, bounds.left), right = Math.min(rect.right, bounds.right);
    const top = Math.max(rect.top, bounds.top), bottom = Math.min(rect.bottom, bounds.bottom);
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  };
  const runs = el => {
    if (textCache.has(el)) return textCache.get(el);
    const result = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !readable(node.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
      if (rects.length) result.push({ node, rects });
    }
    textCache.set(el, result);
    return result;
  };

  // The bottom tabs almost touched despite having non-overlapping boxes.
  // Band and sort painted lines, then compare only horizontal neighbours;
  // never compare every child with every other child on a 20,000-item board.
  for (const row of all) {
    const style = getComputedStyle(row);
    if (!(/^(inline-)?grid$/.test(style.display) ||
      (/^(inline-)?flex$/.test(style.display) && style.flexDirection.startsWith('row')))) continue;
    const lines = new Map();
    for (const kid of row.children) {
      if (!readable(kid)) continue;
      const text = runs(kid).map(r => r.node.textContent.trim()).join(' ');
      for (const run of runs(kid)) for (const raw of run.rects) {
        const rect = painted(raw, run.node.parentElement);
        if (rect.width <= 0 || rect.height <= 0) continue;
        // Out-of-flow menus do not belong to the row's spacing.
        let floating = false;
        for (let up = run.node.parentElement; up && up !== row; up = up.parentElement) {
          if (/^(absolute|fixed)$/.test(getComputedStyle(up).position)) { floating = true; break; }
        }
        if (floating) continue;
        const item = { kid, text, rect };
        for (let b = Math.floor(rect.top / BAND); b <= Math.floor(rect.bottom / BAND); b++) {
          if (!lines.has(b)) lines.set(b, []);
          lines.get(b).push(item);
        }
      }
    }
    const reported = new Set();
    for (const bucket of lines.values()) {
      bucket.sort((a, b) => a.rect.left - b.rect.left);
      for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i], x = a.rect;
        for (let j = i + 1; j < bucket.length; j++) {
          const b = bucket[j], y = b.rect, gap = y.left - x.right;
          if (gap >= 6) break;
          if (a.kid === b.kid) continue;
          const overlap = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
          if (overlap <= Math.min(x.height, y.height) / 2) continue;
          const text = a.text.slice(0, 28) + ' / ' + b.text.slice(0, 28);
          if (!reported.has(text)) faults.push({ kind: 'cramped', text, w: Math.round(gap * 10) / 10 });
          reported.add(text);
          break;
        }
      }
    }
  }

  // Setup put " · optional" on its own flex-column row. Also catch a dangling
  // trailing separator; glyph Ranges avoid blaming a padded inline box.
  const separator = /^[·•|–—]$/;
  for (const el of all) for (const node of el.childNodes) {
    if (node.nodeType !== 3 || !readable(el)) continue;
    const text = node.textContent, trimmed = text.trim();
    if (!trimmed) continue;
    for (const start of [true, false]) {
      if (!separator.test(start ? trimmed[0] : trimmed.at(-1))) continue;
      let block = el;
      while (block && /^(inline|contents)$/.test(getComputedStyle(block).display)) block = block.parentElement;
      if (!block) continue;
      // A block child of a flex column can itself contain only the suffix.
      if (runs(block).length === 1 && /flex/.test(getComputedStyle(block.parentElement ?? block).display)) block = block.parentElement;
      const content = runs(block), index = content.findIndex(r => r.node === node);
      const others = start ? content.slice(0, index) : content.slice(index + 1);
      if (index < 0 || !others.length) continue;
      const offset = start ? text.indexOf(trimmed) : text.lastIndexOf(trimmed) + trimmed.length - 1;
      const range = document.createRange();
      range.setStart(node, offset); range.setEnd(node, offset + 1);
      const glyph = range.getBoundingClientRect(), ink = painted(glyph, el), box = block.getBoundingClientRect();
      const s = getComputedStyle(block);
      const edge = start ? box.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft) :
        box.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight);
      if (ink.height > 0 && ink.width > 0 && Math.abs((start ? glyph.left : glyph.right) - edge) <= 2)
        faults.push({ kind: 'separator-starts-line', text: trimmed.slice(0, 40), w: Math.round(glyph.width) });
    }
  }

  // Menu hours read "09:00–1…". Clipped names are fine; hidden digits are not.
  for (const el of all) {
    if (!readable(el) || el.clientWidth <= 0 || el.scrollWidth <= el.clientWidth + 1) continue;
    const s = getComputedStyle(el);
    if (!(s.textOverflow === 'ellipsis' ||
      (s.whiteSpace === 'nowrap' && /^(hidden|clip)$/.test(s.overflowX)))) continue;
    if (!/^(hidden|clip)$/.test(s.overflowX)) continue;
    const text = runs(el).map(r => r.node.textContent).join('').trim();
    const tail = text.slice(Math.floor(text.length * el.clientWidth / el.scrollWidth));
    if (/\d/.test(tail)) faults.push({ kind: 'truncated-number', text: text.slice(0, 60), w: el.scrollWidth - el.clientWidth });
  }

  // The last bottom tab vanished inside its own scroller, so the page never
  // overflowed. A fade or an explicit right-hand affordance explains the cut.
  for (const el of all) {
    const s = getComputedStyle(el);
    if (!/^(auto|scroll)$/.test(s.overflowX) || el.scrollWidth <= el.clientWidth + 1) continue;
    if ((s.maskImage && s.maskImage !== 'none') ||
      (s.webkitMaskImage && s.webkitMaskImage !== 'none') || el.getAttribute('data-more') === 'right') continue;
    let bar = el;
    while (bar && !/^(fixed|sticky)$/.test(getComputedStyle(bar).position)) bar = bar.parentElement;
    if (!bar) continue;
    const box = el.getBoundingClientRect(), left = Math.max(0, box.left + el.clientLeft);
    const right = Math.min(innerWidth, box.left + el.clientLeft + el.clientWidth);
    for (const kid of el.children) {
      if (!readable(kid)) continue;
      const r = kid.getBoundingClientRect();
      if (r.width <= 0 || r.left > right + 1 || r.right <= right + 1) continue;
      const fraction = Math.max(0, right - Math.max(left, r.left)) / r.width;
      if (fraction < 0.6) {
        faults.push({ kind: 'bar-cut-off', text: kid.textContent.trim().slice(0, 40), w: Math.round(fraction * 100) });
        break;
      }
    }
  }

  // Border paint, not a class name or a transparent layout border.
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const clearPaint = color => /^(transparent|rgba\(.*,\s*0\))$/.test(color);
  const hasBorder = (s, side) => parseFloat(s['border' + side + 'Width']) > 0 &&
    !/^(none|hidden)$/.test(s['border' + side + 'Style']) &&
    !clearPaint(s['border' + side + 'Color']);
  const backgroundCache = new Map();
  const background = el => {
    if (!el) return 'rgb(255, 255, 255)'; // The page canvas beneath transparent ancestors.
    if (!backgroundCache.has(el)) {
      const color = getComputedStyle(el).backgroundColor;
      backgroundCache.set(el, clearPaint(color) ? background(el.parentElement) : color);
    }
    return backgroundCache.get(el);
  };
  const surface = (s, behind) => sides.some(side => hasBorder(s, side)) ||
    s.backgroundImage !== 'none' || (!clearPaint(s.backgroundColor) && s.backgroundColor !== behind);
  const cardBox = (s, r) => sides.every(side => hasBorder(s, side)) &&
    parseFloat(s.borderTopLeftRadius) >= 6 && parseFloat(s.borderBottomLeftRadius) >= 6 &&
    r.width >= 120 && r.height >= 24;
  const reports = new Set();
  const report = (kind, text, gap) => {
    text = text.trim().replace(/\s+/g, ' ').slice(0, 60);
    const key = kind + '|' + text;
    if (reports.has(key)) return;
    reports.add(key);
    faults.push({ kind, text, w: Math.round(gap * 10) / 10 });
  };

  // Settings' sticky save actions shared bottom:0 with the fixed phone tabs.
  // Normal scrolling content may pass beneath a bar; pinned controls cannot
  // scroll clear. Check the declared sticky inset too, before it gets stuck.
  const dialogSelector = 'dialog, [role="dialog"], [role="alertdialog"]';
  const dialogOpen = all.some(el => el.matches(dialogSelector) && readable(el));
  const barLayer = el => el.closest(dialogSelector);
  const bars = [];
  for (const el of all) {
    if (!readable(el)) continue;
    const s = getComputedStyle(el), r = painted(el.getBoundingClientRect(), el.parentElement), layer = barLayer(el);
    if (s.position !== 'fixed' || (dialogOpen ? !layer : layer)) continue;
    const width = Math.min(innerWidth, r.right) - Math.max(0, r.left);
    const height = Math.min(innerHeight, r.bottom) - Math.max(0, r.top);
    // A bar is a strip. The diner's dish sheet and cart are fixed full-screen
    // layers with no dialog role; counted as bars, they "covered" the page
    // behind them on every coupon and tip screen (first full run, 2026-11-11).
    if (height >= 30 && height <= innerHeight * 0.35 && width >= innerWidth / 2) bars.push({ el, r, layer, bottom: parseFloat(s.bottom) });
  }
  const pinnedCache = new Map();
  const pinned = el => {
    if (!el) return false;
    if (!pinnedCache.has(el)) pinnedCache.set(el,
      /^(sticky|fixed)$/.test(getComputedStyle(el).position) || pinned(el.parentElement));
    return pinnedCache.get(el);
  };
  for (const el of all) {
    if (!bars.length || !readable(el)) continue;
    const s = getComputedStyle(el), layer = barLayer(el);
    const control = el.matches('button, a, input, select, textarea, [role="button"]');
    const stickyBottom = s.position === 'sticky' ? parseFloat(s.bottom) : NaN;
    if (!(control && pinned(el)) && !Number.isFinite(stickyBottom)) continue;
    const r = painted(el.getBoundingClientRect(), el.parentElement);
    if (r.width <= 0 || r.height <= 0) continue;
    for (const bar of bars) {
      if (layer !== bar.layer || bar.el.contains(el) || el.contains(bar.el)) continue;
      const width = Math.min(r.right, bar.r.right) - Math.max(r.left, bar.r.left);
      if (width <= 0) continue;
      const height = Math.max(0, Math.min(r.bottom, bar.r.bottom) - Math.max(r.top, bar.r.top));
      const fraction = width * height / (r.width * r.height);
      const centreX = (r.left + r.right) / 2, centreY = (r.top + r.bottom) / 2;
      const covered = control && fraction > 0.25 &&
        bar.el.contains(document.elementsFromPoint(centreX, centreY)[0]);
      const unsafeInset = Number.isFinite(stickyBottom) && Math.abs(bar.bottom) < 1 &&
        Math.abs(bar.r.bottom - innerHeight) < 1 && stickyBottom < bar.r.height;
      if (covered || unsafeInset) {
        const label = el.getAttribute('aria-label') || el.textContent || el.getAttribute('value') || el.tagName;
        report('covered-by-bar', label, covered ? fraction * 100 : bar.r.height - stickyBottom);
        break;
      }
    }
  }

  // Sweep cross-axis starts/centres/ends. A >half overlap means at least one
  // rectangle's centre is strictly inside the other. Wrapped controls need
  // only a positive horizontal overlap, so query at interval starts instead.
  // A prefix-max tree finds the nearest preceding edge in O(log n); mirror
  // for the other direction. Even coincident controls never need all pairs.
  const neighbours = (items, vertical, differentTypes, visit) => {
    for (const direction of [1, -1]) {
      const points = items.map(item => {
        const r = item.r, lo = vertical ? r.top : r.left, hi = vertical ? r.bottom : r.right;
        return { ...item, start: direction > 0 ? lo : -hi, end: direction > 0 ? hi : -lo,
          low: vertical ? r.left : r.top, high: vertical ? r.right : r.bottom };
      }).sort((a, b) => a.start - b.start);
      let size = 1;
      while (size < points.length) size *= 2;
      const trees = [new Array(size * 2).fill(-1), new Array(size * 2).fill(-1)];
      const best = (a, b) => a < 0 ? b : b < 0 ? a : points[a].end >= points[b].end ? a : b;
      const update = (i, active) => {
        const tree = trees[points[i].type ?? 0];
        let p = size + i;
        tree[p] = active ? i : -1;
        while (p > 1) { p >>= 1; tree[p] = best(tree[p * 2], tree[p * 2 + 1]); }
      };
      const events = [];
      points.forEach((p, i) => {
        events.push([p.low, 2, i], [vertical ? p.low : (p.low + p.high) / 2, vertical ? 3 : 1, i], [p.high, 0, i]);
      });
      events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [, event, i] of events) {
        if (event === 0 || event === 2) { update(i, event === 2); continue; }
        const a = points[i];
        update(i, false);
        let lo = 0, hi = points.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (points[mid].start <= a.start) lo = mid + 1; else hi = mid;
        }
        const tree = trees[differentTypes ? 1 - a.type : 0];
        let left = size, right = size + lo, found = -1;
        while (left < right) {
          if (left & 1) found = best(found, tree[left++]);
          if (right & 1) found = best(found, tree[--right]);
          left >>= 1; right >>= 1;
        }
        if (found >= 0) {
          const b = points[found], gap = a.start - b.end;
          const overlap = Math.min(a.high, b.high) - Math.max(a.low, b.low);
          if (gap < 4 && overlap > (vertical ? 0 : Math.min(a.high - a.low, b.high - b.low) / 2)) visit(a, b, gap);
        }
        update(i, true);
      }
    }
  };

  // One DOM walk assigns each painted fragment its nearest control, box, list
  // entry and dialog layer. Descendant ranges are never rescanned per ancestor.
  const iconControl = 'button, a, label, [role="button"], .tt-chip';
  const borderControl = 'button, input, select, textarea, .tt-chip, .tt-pill, [role="radio"]';
  const edgeControl = iconControl + ', input, select, textarea, .tt-pill, [role="radio"]';
  const contexts = new Map(), iconGroups = new Map(), controlGroups = new Map(), pinnedControlGroups = new Map(), lists = new Map();
  const add = (map, key, item) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  };
  const edge = (item, context) => {
    const box = context.box;
    if (!box || context.edgeRow) return;
    const r = item.r, b = box.inner;
    // Content scrolled part-way out of a card is cut by the scroll, not
    // cramped: a dialog's chips at the fold read "0px from the edge" while
    // the same chips scrolled into view had 14px (product dialog, 2026-11-11).
    const raw = item.raw;
    if (raw && (Math.abs(raw.top - r.top) > 0.5 || Math.abs(raw.bottom - r.bottom) > 0.5 ||
      Math.abs(raw.left - r.left) > 0.5 || Math.abs(raw.right - r.right) > 0.5)) return;
    const gap = Math.min(...[r.left - b.left, b.right - r.right, r.top - b.top, b.bottom - r.bottom].filter(n => n >= 0));
    if (gap >= 0 && gap < 6) report('content-touches-edge', item.text, gap);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.nextNode(); el; el = walker.nextNode()) {
    const parent = contexts.get(el.parentElement) ?? {}, s = getComputedStyle(el);
    const dialog = el.matches('dialog, [role="dialog"], [role="alertdialog"]');
    const r = el.getBoundingClientRect();
    const context = { ...parent, layer: dialog ? el : parent.layer,
      floating: dialog ? false : parent.floating || /^(absolute|fixed)$/.test(s.position) };
    // Dialog roots start a new scope, including when portalled inside a card.
    if (dialog) { context.box = null; context.control = null; context.entry = null; context.list = null; context.paintedControl = null; context.edgeRow = false; context.joined = false; }
    contexts.set(el, context);
    if (!readable(el) || context.floating) continue;
    const ink = painted(r, el.parentElement);
    if (ink.width <= 0 || ink.height <= 0) continue;
    const fullRow = context.box && sides.some(side => hasBorder(s, side)) &&
      Math.abs(r.left - context.box.inner.left) <= 1 && Math.abs(r.right - context.box.inner.right) <= 1;
    context.edgeRow ||= fullRow;
    context.joined ||= el.matches('[role="group"][data-joined], .tt-segmented');
    if (el.matches(edgeControl)) {
      const text = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('value') || el.tagName).trim();
      const paintsBox = surface(s, context.box?.background ?? background(el.parentElement));
      if (el.matches(borderControl) && !context.paintedControl && paintsBox) {
        // A pinned bar's controls are compared only with each other: against the
        // page scrolling past, the gap changes with every scroll position.
        if (!context.joined) add(pinned(el) ? pinnedControlGroups : controlGroups, context.layer, { r: ink, text });
        context.paintedControl = el;
      }
      // Unpainted controls use their descendant text Ranges below, never their
      // invisible hit targets (which may fill or overhang a card).
      if (paintsBox) edge({ r: ink, raw: r, text }, context);
    }
    if (el.matches(iconControl)) context.control = el;
    if (cardBox(s, r)) {
      context.box = { background: background(el), inner: { left: r.left + parseFloat(s.borderLeftWidth), right: r.right - parseFloat(s.borderRightWidth),
        top: r.top + parseFloat(s.borderTopWidth), bottom: r.bottom - parseFloat(s.borderBottomWidth) } };
      context.edgeRow = false;
    }
    if (el.matches('ul, ol, [role="list"]')) { context.list = el; context.entry = null; }
    if (el.matches('li, [role="listitem"]') && context.list) {
      context.entry = { first: Infinity, last: -Infinity, text: [],
        separated: surface(s, background(el.parentElement)), layer: context.layer };
      add(lists, context.list, context.entry);
    }
    if (context.control && (el.matches('svg') || (el.matches('img') && r.width < 32 && r.height < 32)))
      add(iconGroups, context.control, { r: ink, text: '', type: 0 });
    // SVG title/desc nodes describe icons; they are not painted text labels.
    if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      (s.textShadow === 'none' && clearPaint(s.webkitTextFillColor || s.color))) continue;
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue;
      const value = node.textContent, label = value.trim().slice(0, 60), range = document.createRange();
      range.setStart(node, value.search(/\S/)); range.setEnd(node, value.trimEnd().length);
      for (const raw of range.getClientRects()) {
        const line = painted(raw, el);
        if (line.width <= 0 || line.height <= 0) continue;
        const item = { r: line, text: label, type: 1 };
        if (context.control) add(iconGroups, context.control, item);
        edge({ ...item, raw }, context);
        if (context.entry) {
          context.entry.first = Math.min(context.entry.first, line.top);
          context.entry.last = Math.max(context.entry.last, line.bottom);
          context.entry.text.push(item.text);
        }
      }
    }
  }
  for (const items of iconGroups.values()) neighbours(items, false, true, (a, b, gap) => {
    report('icon-touches-label', a.text || b.text, gap);
  });
  // Overlap is not "touching": a sticky save bar sliding over fields while the
  // page scrolls overlaps them by design (Settings on production, 2026-11-11),
  // and painted text over text is the 'overlapping' check's job.
  for (const items of [...controlGroups.values(), ...pinnedControlGroups.values()]) for (const vertical of [false, true]) neighbours(items, vertical, false, (a, b, gap) => {
    if (gap < 0) return;
    report('controls-touching', [a, b].sort((x, y) => x.r.top - y.r.top || x.r.left - y.r.left || x.text.localeCompare(y.text)).map(x => x.text).join(' / '), gap);
  });
  for (const entries of lists.values()) {
    let previous;
    for (const entry of entries) {
      if (!Number.isFinite(entry.first)) continue;
      if (previous && previous.layer === entry.layer && !previous.separated && !entry.separated) {
        const gap = entry.first - previous.last;
        if (gap >= 0 && gap < 4) report('entries-run-together', previous.text.join(' ').slice(0, 28) + ' / ' + entry.text.join(' ').slice(0, 28), gap);
      }
      previous = entry;
    }
  }

  // "Para empezar" and the Menús card touched: an inline margin: 0 beat the
  // dashboard's 16px rhythm (owner's screenshot, 2026-11-11). Two rounded,
  // fully bordered cards stacked less than 6px apart read as one broken box.
  // Cards are compared within one layer, so a dialog never pairs with the page.
  const stackedCards = [];
  for (const el of all) {
    if (!readable(el)) continue;
    const s = getComputedStyle(el);
    if (/^(absolute|fixed)$/.test(s.position)) continue;
    const r = el.getBoundingClientRect();
    if (!cardBox(s, r)) continue;
    stackedCards.push({ el, r, layer: el.closest('dialog, [role="dialog"], [role="alertdialog"]') });
  }
  stackedCards.sort((a, b) => a.r.top - b.r.top);
  const touching = new Set();
  for (let i = 0; i < stackedCards.length; i++) {
    const a = stackedCards[i];
    for (let j = i + 1; j < stackedCards.length; j++) {
      const b = stackedCards[j], gap = b.r.top - a.r.bottom;
      if (gap >= 6) break;
      if (gap < 0 || a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const overlap = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      if (overlap < Math.min(a.r.width, b.r.width) / 2) continue;
      const text = a.el.textContent.trim().slice(0, 28) + ' / ' + b.el.textContent.trim().slice(0, 28);
      if (!touching.has(text)) faults.push({ kind: 'cards-touching', text, w: Math.round(gap * 10) / 10 });
      touching.add(text);
    }
  }

`;
