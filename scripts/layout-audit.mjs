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
  // Texto que existe sólo para el lector de pantalla: 1px y recortado a nada,
  // a propósito. Medirlo como si fuera visible es acusar al helper de a11y.
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
      const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
      const w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
      const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
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

  // 3. The page itself running off the side.
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
