/**
 * The audit that runs inside the page.
 *
 * Three faults, each one something that actually shipped:
 *
 *  - *aplastado*: the only elastic column in a flex row collapsed to nothing
 *    and its text spilled out. That is how "Comida del día" came out one word
 *    per line and how the amount owed ended up behind the Cobrar button.
 *  - *encimado*: two pieces of text painted on top of each other. Reading the
 *    DOM never shows it; only the rectangles do.
 *  - *desbordado*: the page scrolls sideways, which on a phone means content
 *    nobody will ever find.
 *
 * Kept as a plain string of source because it is evaluated in the browser.
 */
export const AUDIT = `(() => {
  const vis = el => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    // Height only. Requiring width > 0 here is how the first version of this
    // file managed to pass on the very bug it was written for: a box squashed
    // to zero width still paints its text, and filtering it out as "invisible"
    // threw away the one element that was broken.
    return el.getBoundingClientRect().height > 0;
  };
  // Text that exists only for the screen reader: 1px and clipped to nothing, on
  // purpose. Measuring it as visible is accusing the a11y helper.
  const forScreenReader = el => {
    const s = getComputedStyle(el);
    const clipped = s.clip !== "auto" || s.clipPath !== "none";
    const r = el.getBoundingClientRect();
    return clipped && r.width <= 2 && r.height <= 2;
  };
  const own = el => {
    // The element's own text, not its children's — so a wrapper isn't blamed.
    let t = "";
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim();
  };
  const floats = el => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === "fixed" || p === "absolute" || p === "sticky") return true;
    }
    return false;
  };

  const faults = [];
  const all = [...document.querySelectorAll("body *")].filter(el => vis(el) && !forScreenReader(el));

  // 1. Text with nowhere to go.
  //
  // Measured on the box, never on scrollWidth: for an inline element — the
  // <strong> that holds every dish name — clientWidth and scrollWidth are both
  // 0 by definition, so a check written on them can never fire. This is the
  // version that catches the real thing: a container holding real words in
  // less room than one word needs, which is what makes text stack a word per
  // line and spill over its neighbours.
  for (const el of all) {
    const text = el.textContent.trim();
    if (text.length < 4) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= 40) continue;
    // Text inside an absolutely-positioned descendant is not laid out in this
    // box at all — it escapes it. The account menu hangs off a 38px avatar
    // button, so measuring the button's whole textContent said five menu items
    // were crushed into 38 pixels while the menu was sitting there, open and
    // perfectly readable. Only in-flow text can be squashed by its container.
    if ([...el.querySelectorAll("*")].some(d => {
      const p = getComputedStyle(d).position;
      return (p === "absolute" || p === "fixed") && d.textContent.trim().length > 0;
    })) continue;
    // A parent at 40px is only guilty if the text really is wider than that.
    const range = document.createRange();
    range.selectNodeContents(el);
    const needs = range.getBoundingClientRect().width;
    range.detach?.();
    if (needs > r.width + 4) {
      faults.push({
        kind: "aplastado",
        text: text.slice(0, 40),
        w: Math.round(r.width),
      });
    }
  }

  // 2. Text painted over text.
  const leaves = all.filter(el => own(el).length > 1 && !floats(el));
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i], b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      // Line against line, not box against box.
      //
      // getBoundingClientRect on a wrapped inline element returns the UNION of its
      // lines: "· 39 min ago" split across two gave a box spanning edge to edge
      // that crossed everything beside it, and the check accused text of
      // overlapping that reads perfectly on screen. Per-line rectangles are what
      // actually gets painted.
      let w = 0, h = 0;
      for (const x of a.getClientRects()) {
        for (const y of b.getClientRects()) {
          const dw = Math.min(x.right, y.right) - Math.max(x.left, y.left);
          const dh = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
          if (dw > w && dh > 0) { w = dw; h = dh; }
          else if (dh > h && dw > 0) h = dh;
        }
      }
      // 4px of overlap is a hairline; 8 is two words sharing the same pixels.
      if (w > 8 && h > 8) {
        faults.push({
          kind: "encimado",
          text: own(a).slice(0, 28) + " ⟂ " + own(b).slice(0, 28),
          w: Math.round(w),
        });
      }
    }
  }

  // 3. Blocks that don't line up.
  //
  // Legible is not the same as aligned: the activity log went out sitting flush
  // against the window while the card above it kept the page margin, because it
  // was rendered outside the container. Every fault above passed it. Two cards
  // stacked one above the other must share both edges — side by side is a
  // different layout and is left alone.
  const cards = all.filter(el => el.classList.contains("tt-section"));
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i].getBoundingClientRect(), b = cards[j].getBoundingClientRect();
      const stacked = a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
      if (!stacked) continue;
      // And in the same column. Settings is two columns: a card on the left and one
      // on the right do not overlap vertically either, and comparing them was
      // asking two columns to be one.
      const shared = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (shared < Math.min(a.width, b.width) * 0.5) continue;
      const dl = Math.abs(a.left - b.left), dr = Math.abs(a.right - b.right);
      if (dl > 2 || dr > 2) {
        const name = el => (el.querySelector("h2,h3")?.textContent ?? el.className).trim().slice(0, 26);
        faults.push({
          kind: "desalineado",
          text: name(cards[i]) + " ⇄ " + name(cards[j]),
          w: Math.round(Math.max(dl, dr)),
        });
      }
    }
  }

  // 4. One word painted on two lines.
  //
  // A pill or a button label is one word wide; nothing legitimately breaks it.
  // "DESCUENTO" came out "DESCUENT / O" and "Marcar listo" stood two lines tall
  // beside a one-line "Cancelar", and every check above passed: the boxes were
  // wide enough to measure and nothing overlapped. Short words only — an email
  // or a URL is a single "word" too, and the activity log breaks those on
  // purpose because there is nowhere else for them to go.
  for (const el of all) {
    const isButton = el.classList.contains("tt-btn");
    for (const node of el.childNodes) {
      if (node.nodeType !== 3) continue;
      const text = node.textContent.trim();
      if (text.length < 4) continue;
      // A button's label is one line by contract, however many words it has.
      // Anywhere else only a single short word proves a squeeze.
      const suspect = isButton ? text.length <= 40 : text.length <= 16 && !/\\s/.test(text);
      if (!suspect) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = range.getClientRects().length;
      range.detach?.();
      if (lines > 1) {
        faults.push({ kind: "partido", text: text.slice(0, 40), w: lines });
      }
    }
  }

  // 5. A label sitting at the top of the control it belongs to.
  //
  // A flex row left at its default "align-items: stretch" makes a short text
  // child as tall as the row and paints its words at the top, so the hint
  // beside a field floats level with the field's upper edge instead of its
  // middle. Nothing overlaps and nothing is cut off, so every other check here
  // passes; it just looks like nobody laid it out.
  //
  // Measured on the text itself, not its box: a stretched span's box IS the
  // full height, which is exactly what hides the fault from a box comparison.
  for (const row of all) {
    const rs = getComputedStyle(row);
    if (rs.display !== "flex" && rs.display !== "inline-flex") continue;
    if (rs.flexDirection.startsWith("column")) continue;
    if (rs.alignItems !== "stretch" && rs.alignItems !== "normal") continue;

    const kids = [...row.children].filter(vis);
    if (kids.length < 2) continue;
    if (row.getBoundingClientRect().height < 24) continue;

    const isControl = el =>
      /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName) ||
      el.querySelector("input, select, textarea, button");
    const control = kids.find(isControl);
    if (!control) continue;

    for (const kid of kids) {
      if (kid === control || isControl(kid)) continue;
      const words = kid.textContent.trim();
      if (words.length < 8) continue;

      const range = document.createRange();
      range.selectNodeContents(kid);
      const textBox = range.getBoundingClientRect();
      range.detach?.();
      if (textBox.height === 0) continue;

      const box = control.getBoundingClientRect();
      // Only when the words could sit level and simply do not: a block taller
      // than its control has nowhere to centre to.
      if (textBox.height > box.height + 2) continue;
      const off = Math.round(Math.abs((textBox.top + textBox.bottom) / 2 - (box.top + box.bottom) / 2));
      if (off > 4) {
        faults.push({ kind: "descentrado", text: words.slice(0, 40), w: off });
      }
    }
  }

  // 6. The page itself running off the side.
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth + 1) {
    const wide = all.find(el => el.getBoundingClientRect().right > window.innerWidth + 1);
    faults.push({
      kind: "desbordado",
      text: wide ? (wide.className || wide.tagName).toString().slice(0, 40) : "?",
      w: doc.scrollWidth - window.innerWidth,
    });
  }

  // The same fault on twenty rows of a list is one fault, not twenty.
  const seen = new Set();
  return faults.filter(f => {
    const key = f.kind + "|" + f.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
})()`;
