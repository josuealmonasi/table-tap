"use client";

import { createContext, useContext } from "react";
import type { StoredIconGroup } from "@/lib/icon-groups";

/**
 * Los grupos propios del restaurante, para el selector de iconos.
 *
 * Van por contexto y no por props porque el selector vive dentro del formulario
 * del platillo, que a su vez vive dentro de la sección: pasarlos a mano sería
 * atravesar cuatro componentes que no tienen nada que ver con emojis.
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

/** Vacío fuera del editor — ahí el selector enseña sólo los de fábrica. */
export function useStoredIconGroups(): StoredIconGroup[] {
  return useContext(IconGroupsContext);
}
