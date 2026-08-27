"use client";

import { createContext, useContext } from "react";
import type { StoredIconGroup } from "@/lib/icon-groups";

/**
 * The restaurant's own groups, for the icon picker.
 *
 * By context and not by props because the picker lives inside the dish form,
 * which lives inside the section: passing them by hand would mean threading
 * through four components that have nothing to do with emoji.
 */
const IconGroupsContext = createContext<StoredIconGroup[]>([]);

export function IconGroupsProvider({
  groups,
  children,
}: {
  groups: StoredIconGroup[];
  children: React.ReactNode;
}) {
  return <IconGroupsContext.Provider value={groups}>{children}</IconGroupsContext.Provider>;
}

/** Empty outside the editor — there the picker shows only the built-ins. */
export function useStoredIconGroups(): StoredIconGroup[] {
  return useContext(IconGroupsContext);
}
