"use client";

import { createContext, useContext } from "react";
import { tagsFor, type DietaryTag, type StoredDietaryTag } from "@/lib/dietary";

/**
 * Las etiquetas de dieta del restaurante, ya resueltas.
 *
 * Las usan las dos mitades de la app —el editor para ponerlas y el menú del
 * comensal para leerlas y filtrar— y en las dos viven a tres o cuatro
 * componentes de profundidad. Por contexto y no por props: pasarlas a mano
 * sería atravesar pantallas que no tienen nada que ver con alérgenos.
 *
 * Fuera de un proveedor devuelve las de casa, que es lo que la app enseñaba
 * antes de que la lista fuera del restaurante.
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
