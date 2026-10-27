"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";
import { filterValue, orderCodeRange, tableLabelQuery } from "@/lib/order-code";
import type { Order } from "@/lib/types";

/** Ten reads as a list; more than that and the page is a wall again. */
export const HISTORY_PER_PAGE = 10;

/** Orders that are done with — served and settled, or cancelled. */
const CLOSED = ["completed", "cancelled"];

async function fetchHistory([, restaurantId, page, debounced]: readonly [string, string, number, string]) {
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

  const { data, count, error } = await request
    .order("created_at", { ascending: false })
    .range(from, from + HISTORY_PER_PAGE - 1);
  if (error) throw error;
  return { restaurantId, orders: (data as Order[] | null) ?? [], total: count ?? 0 };
}

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
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");

  // A new search restarts the list; page 4 of the old one means nothing here.
  useEffect(() => setPage(1), [query]);

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const { data, error, isLoading, mutate } = useSWR(
    ["order-history", restaurantId, page, debounced] as const,
    fetchHistory,
    { keepPreviousData: true },
  );
  // Previous pages can remain useful during a failed read; another venue's
  // rows must never be shown while its replacement is loading or unavailable.
  const current = data?.restaurantId === restaurantId ? data : undefined;
  const orders = current?.orders ?? [];
  const total = current?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / HISTORY_PER_PAGE));
  const loading = isLoading && !current;
  async function retry(): Promise<void> {
    await mutate().catch(() => undefined);
  }

  return { orders, loading, error, retry, page, pages, total, setPage, query, setQuery };
}
