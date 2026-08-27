"use client";

import { createContext, useContext } from "react";
import { tagsFor, type DietaryTag, type StoredDietaryTag } from "@/lib/dietary";

/**
 * The restaurant's dietary tags, already resolved.
 *
 * Both halves of the app use them — the editor to attach them and the diner's
 * menu to read and filter by them — and in both they live three or four
 * components deep. By context and not by props: passing them by hand would
 * mean threading through screens that have nothing to do with allergens.
 *
 * Outside a provider it returns the built-ins, which is what the app showed
 * before the list belonged to the restaurant.
 */
const DietaryTagsContext = createContext<DietaryTag[]>(tagsFor(null));

export function DietaryTagsProvider({
  tags,
  children,
}: {
  tags: StoredDietaryTag[] | null | undefined;
  children: React.ReactNode;
}) {
  return (
    <DietaryTagsContext.Provider value={tagsFor(tags)}>{children}</DietaryTagsContext.Provider>
  );
}

export function useDietaryTags(): DietaryTag[] {
  return useContext(DietaryTagsContext);
}
