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
`;
