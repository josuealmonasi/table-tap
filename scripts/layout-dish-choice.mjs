/** Prefer a deal that actually changes the button, then the most extras.
 * Names break ties so the seed's row order does not decide what gets checked. */
export function chooseDish(shapes) {
  return [...shapes].sort((a, b) => Number(b.deal) - Number(a.deal)
    || b.extras - a.extras || a.name.localeCompare(b.name) || a.index - b.index)[0];
}
