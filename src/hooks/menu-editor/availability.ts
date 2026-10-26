import type { MenuItem } from "@/lib/types";
import { writeError } from "@/lib/write-result";
import type { EditorContext } from "./types";

export interface AvailabilityRequest { done: Promise<void> }
export interface AvailabilityContext {
  pending: Map<string, AvailabilityRequest>;
  current: () => boolean;
  revision: () => number | null;
  patch: (row: MenuItem | undefined, revision: number, keepOptimistic: boolean) => boolean;
}

/** Keep each item's clicks in order across renders, without blocking other items. */
export function setAvailability(ctx: EditorContext, id: string, available: boolean): Promise<void> {
  const state = ctx.availability;
  const previous = state.pending.get(id)?.done ?? Promise.resolve();
  const request: AvailabilityRequest = { done: Promise.resolve() };
  state.pending.set(id, request);
  const showIntent = () => {
    if (state.current() && state.pending.get(id) === request) {
      ctx.setProducts(rows => rows.map(row => row.id === id ? { ...row, available } : row));
      ctx.setAddons(rows => rows.map(row => row.id === id ? { ...row, available } : row));
    }
  };
  request.done = (async () => {
    const initiallyReady = state.current() && await ctx.ready();
    if (initiallyReady) showIntent();
    // Even a dropped intent waits for its predecessor before leaving the queue.
    await previous.catch(() => {});
    if (!initiallyReady || !state.current()) return;
    let revision: number | null = null;
    while (revision === null) {
      if (!(await ctx.ready()) || !state.current()) return;
      revision = state.revision();
    }
    showIntent();
    try {
      const result = await ctx.supabase.from("menu_items").update({ available })
        .eq("id", id).eq("restaurant_id", ctx.restaurantId).select("*");
      if (!state.current()) return;
      const error = writeError(result);
      ctx.w.reportError("write.updateAvailability", error);
      const row = result.data?.[0] as MenuItem | undefined;
      // A newer click keeps its optimistic switch until its own write answers.
      if (!error && row?.id === id && state.patch(row, revision, state.pending.get(id) !== request)) return;
    } catch {
      if (!state.current()) return;
      ctx.w.reportError("write.updateAvailability", { message: "Availability did not save" });
    }
    // Failed/ambiguous saves, changed grouping, or an overlapping full read
    // reconcile after this write. Never restore an older render's arrays.
    if (state.current()) await ctx.reload();
  })();
  void request.done.finally(() => {
    if (state.pending.get(id) === request) state.pending.delete(id);
  }).catch(() => {});
  return request.done;
}
