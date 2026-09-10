"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { filterValue, orderCodeRange, tableLabelQuery } from "@/lib/order-code";
import type { Order } from "@/lib/types";

/** Ten reads as a list; more than that and the page is a wall again. */
export const HISTORY_PER_PAGE = 10;

/** Orders that are done with — served and settled, or cancelled. */
const CLOSED = ["completed", "cancelled"];

/**
 * Pages and searches the orders a restaurant has finished with.
 *
 * Read from the database a page at a time rather than filtered in the browser:
 * history is the one list that only ever grows, and the board was rendering
 * every order it had loaded — eighty-nine cards on a demo restaurant, and a
 * real one serves that before lunch. Searching server-side also means a code
 * from last month is findable, which it never was inside a loaded window.
 */
export function useOrderHistory(restaurantId: string) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  // A new search restarts the list; page 4 of the old one means nothing here.
  useEffect(() => setPage(1), [query]);

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const from = (page - 1) * HISTORY_PER_PAGE;
      let request = createClient()
        .from("orders")
        .select("*", { count: "exact" })
        .eq("restaurant_id", restaurantId)
        .in("status", CLOSED);

      if (debounced) {
        // A code is a prefix of the id, so it becomes a range on the primary
        // key. Anything else is matched against the table it was served to and
        // the name the diner gave — the two other things anyone remembers
        // about an order, and the only two the person searching can see.
        //
        // `or()` takes one raw filter string and splits it on commas, so the
        // term is quoted before it goes anywhere near it. Without that, a diner
        // called "Perez, Juan" would not merely fail to be found: the half
        // after the comma would be read as another condition.
        const code = orderCodeRange(debounced);
        if (code) {
          request = request.gte("id", code.from).lte("id", code.to);
        } else {
          const table = filterValue(`%${tableLabelQuery(debounced)}%`);
          const name = filterValue(`%${debounced}%`);
          request = request.or(`table_label.ilike.${table},customer_name.ilike.${name}`);
        }
      }

      const { data, count } = await request
        .order("created_at", { ascending: false })
        .range(from, from + HISTORY_PER_PAGE - 1);

      if (!cancelled) {
        setOrders((data as Order[] | null) ?? []);
        setTotal(count ?? 0);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, page, debounced]);

  const pages = useMemo(
    () => Math.max(1, Math.ceil(total / HISTORY_PER_PAGE)),
    [total],
  );

  return { orders, loading, page, pages, total, setPage, query, setQuery };
}
