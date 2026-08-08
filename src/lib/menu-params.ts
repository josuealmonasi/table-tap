/**
 * The menu's shareable state, carried in the query string.
 *
 * Kept as pure functions over URLSearchParams so the rules — which keys exist,
 * what an empty value means, how a list is encoded — live in one testable
 * place rather than being spelled out at each call site. Two components write
 * to this URL (the menu writes q/cat/diet, the app shell writes item), so they
 * have to agree exactly on the format.
 */
export interface MenuParams {
  /** Free-text search across name and description. */
  q: string;
  /** Active category id, or "all". */
  cat: string;
  /** Selected dietary tag keys. */
  diet: string[];
  /** A product to open on load — the "share this dish" case. */
  item: string | null;
  /** A combo to open on load. Separate from `item` because their ids live in
   *  different tables and the two dialogs render different components. */
  combo: string | null;
}

export const EMPTY_MENU_PARAMS: MenuParams = {
  q: "",
  cat: "all",
  diet: [],
  item: null,
  combo: null,
};

export function readMenuParams(search: URLSearchParams): MenuParams {
  const diet = (search.get("diet") ?? "")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);
  return {
    q: search.get("q") ?? "",
    cat: search.get("cat") || "all",
    // Deduped: a hand-edited or double-encoded link shouldn't be able to make
    // the same filter count twice.
    diet: [...new Set(diet)],
    item: search.get("item") || null,
    combo: search.get("combo") || null,
  };
}

/**
 * Merges menu state into an existing query string, dropping keys at their
 * default so a clean view produces a clean URL rather than `?q=&cat=all&diet=`.
 * Anything already in the URL that isn't ours is preserved.
 */
export function applyMenuParams(
  current: URLSearchParams,
  patch: Partial<MenuParams>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const set = (key: string, value: string) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };

  if (patch.q !== undefined) set("q", patch.q.trim());
  if (patch.cat !== undefined) set("cat", patch.cat === "all" ? "" : patch.cat);
  if (patch.diet !== undefined) set("diet", [...new Set(patch.diet)].join(","));
  if (patch.item !== undefined) set("item", patch.item ?? "");
  if (patch.combo !== undefined) set("combo", patch.combo ?? "");
  return next;
}

/** The `?…` suffix for a URL, or "" when no params remain. */
export function toQueryString(params: URLSearchParams): string {
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * Writes menu state into the address bar without a Next navigation.
 *
 * `router.replace` would re-run the server component on every keystroke — the
 * menu routes are force-dynamic, so that's a round trip per character typed.
 * `history.replaceState` changes the URL only, which is all a shareable link
 * needs: params are read once on mount, so the cost belongs at share time, not
 * at typing time. Replace rather than push, so twenty keystrokes don't become
 * twenty entries the back button has to walk through.
 */
export function syncMenuUrl(patch: Partial<MenuParams>): void {
  if (typeof window === "undefined") return;
  const next = applyMenuParams(new URLSearchParams(window.location.search), patch);
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + toQueryString(next),
  );
}
