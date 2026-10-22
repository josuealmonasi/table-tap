/** Everything duplicateMenuDeep needs; saved rows are read on the server. */
export interface DuplicateMenuArgs {
  /** Id of the menu to copy. */
  sourceId: string;
  /** API errors already say what happened in the caller's language. */
  onError?: (message: string) => void;
  /** Surfaces a failed write to the user; returns false when there was an error. */
  reportError: (action: string, error: { message: string } | null) => boolean;
}

export interface DuplicateMenuResult {
  newMenuId: string;
  copyName: string;
}

/**
 * Deep-copies a menu: its sections, products, extras, and product↔add-on
 * links, remapping every foreign key onto the freshly inserted rows. Returns
 * the new menu's id and name, or undefined if any write failed (the failure
 * is reported via reportError). The server transaction rolls back every row.
 */
export async function duplicateMenuDeep(
  { sourceId, reportError, onError }: DuplicateMenuArgs,
): Promise<DuplicateMenuResult | undefined> {
  try {
    const response = await fetch("/api/menu/duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (onError) onError(data.error);
      else reportError("write.duplicateMenu", { message: data.error });
      return undefined;
    }
    return data;
  } catch {
    reportError("write.duplicateMenu", { message: "Menu copy request failed" });
    return undefined;
  }
}
