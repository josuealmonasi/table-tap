"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** One entry from the restaurant's activity log. */
export interface UserLog {
  id: string;
  actor_email: string;
  entity: string;
  action: string;
  detail: string | null;
  target_role: string | null;
  target_email: string | null;
  created_at: string;
}

/** Ten reads as a list; more than that and the page becomes a wall. */
export const LOGS_PER_PAGE = 10;

/** Which column the list is ordered by. */
export type LogSort = "created_at" | "action";

const COLUMNS =
  "id, actor_email, entity, action, detail, target_role, target_email, created_at";

/**
 * Pages, sorts and searches the restaurant's activity log.
 *
 * Sorting and paging happen in the database rather than in the browser: the
 * log grows for as long as the restaurant is open, and a page that fetches
 * everything to sort four hundred rows is a page that gets slower every week.
 * Owner-only by RLS — anyone else simply gets zero rows.
 */
export function useUserLogs(
  restaurantId: string,
  /**
   * Los tipos que el texto buscado nombra, ya resueltos por quien pinta.
   *
   * `entity` se guarda en inglés —"settings"— y en pantalla se lee traducido
   * —"AJUSTES"—, así que quien escribía lo que estaba viendo no encontraba
   * nada. La traducción la tiene el componente, no el hook, así que llega de
   * fuera ya resuelta.
   */
  matchedEntities: string[] = [],
) {
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LogSort>("created_at");
  const [ascending, setAscending] = useState(false);

  // A search or a sort restarts the list; page 7 of the old ordering means
  // nothing in the new one.
  useEffect(() => setPage(1), [query, sort, ascending]);

  const entityKey = matchedEntities.join(",");

  // Typing shouldn't fire a query per keystroke.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const from = (page - 1) * LOGS_PER_PAGE;
      let request = createClient()
        .from("user_logs")
        .select(COLUMNS, { count: "exact" })
        .eq("restaurant_id", restaurantId);

      if (debounced) {
        // Whatever the owner remembers: who did it, what kind of thing it was,
        // what happened, or the specifics recorded alongside it.
        const like = `%${debounced}%`;
        const clauses = [
          `actor_email.ilike.${like}`,
          `entity.ilike.${like}`,
          `action.ilike.${like}`,
          `detail.ilike.${like}`,
          `target_email.ilike.${like}`,
        ];
        // "ajustes" es lo que se lee en la fila; "settings" es lo que hay en la
        // columna. Sin esto, buscar lo que se ve en pantalla no daba nada.
        if (matchedEntities.length) clauses.push(`entity.in.(${matchedEntities.join(",")})`);
        request = request.or(clauses.join(","));
      }

      const { data, count } = await request
        .order(sort, { ascending })
        // Within one action type the newest is still the interesting one.
        .order("created_at", { ascending: false })
        .range(from, from + LOGS_PER_PAGE - 1);

      if (!cancelled) {
        setLogs((data as UserLog[] | null) ?? []);
        setTotal(count ?? 0);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Las entidades se comparan por su contenido: el arreglo se rehace en cada
    // render y como dependencia dispararía una consulta por render. `entityKey`
    // es ese mismo arreglo hecho cadena, que sí es estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, page, debounced, sort, ascending, entityKey]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / LOGS_PER_PAGE)), [total]);

  /** Clicking a column heading sorts by it, or flips it if it already is. */
  function sortBy(column: LogSort): void {
    if (column === sort) {
      setAscending(a => !a);
      return;
    }
    setSort(column);
    setAscending(false);
  }

  return {
    logs,
    loading,
    page,
    pages,
    total,
    setPage,
    query,
    setQuery,
    sort,
    ascending,
    sortBy,
  };
}
