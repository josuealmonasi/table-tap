import type { createClient } from "@/lib/supabase/client";
import type { useToast } from "@/components/ui/Toast";
import { reorderRows, type Reorderable, type ReorderTable } from "@/lib/menu-data";
import { parsePlanLimit, planLimitText } from "@/lib/plan-error";
import { planLabel } from "@/lib/plan";

interface WriterDeps {
  supabase: ReturnType<typeof createClient>;
  toast: ReturnType<typeof useToast>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  reload: () => Promise<void>;
}

/** How every write in the menu editor reports itself and refreshes. */
export function makeWriter({ supabase, toast, t, reload }: WriterDeps) {
  /**
   * `key` names the action in the user's language. The raw Supabase message is
   * logged rather than shown: it is English, it leaks schema details, and it
   * tells a restaurant owner nothing they can act on.
   */
  function reportError(key: string, error: { message: string } | null): boolean {
    if (error) {
      console.error(`${key}:`, error.message);
      // A ceiling is not a failure the owner should read as "something broke":
      // the write was refused on purpose, and the toast has to say which limit
      // and on which plan. Anything else keeps the generic message.
      const hit = parsePlanLimit(error.message);
      if (hit) {
        const { key: limitKey, vars } = planLimitText(hit);
        toast(t(limitKey, { ...vars, plan: planLabel(vars.plan) }), "error");
      } else {
        toast(t(key), "error");
      }
    }
    return !error;
  }

  /**
   * Runs a write, reports it either way, then refreshes local state.
   *
   * `done` is the confirmation. Every create, rename, edit and delete says so
   * — the rule for the whole dashboard, decided here because this is the one
   * place all of them pass through. Reordering and availability switches are
   * the exception: the row moves, or the switch flips, in front of the person
   * who pressed it, and a toast on top of that is noise.
   */
  async function run(
    key: string,
    write: PromiseLike<{ error: { message: string } | null }>,
    done?: string,
  ): Promise<void> {
    const { error } = await write;
    if (reportError(key, error) && done) toast(t(done));
    await reload();
  }

  /** Inserts a row, reports any failure, refreshes, and returns the new row's id. */
  async function insertReturningId(
    key: string,
    table: ReorderTable,
    row: Record<string, unknown>,
    done?: string,
  ): Promise<string | undefined> {
    const { data, error } = await supabase.from(table).insert(row).select("id").single();
    if (!reportError(key, error)) return undefined;
    if (done) toast(t(done));
    await reload();
    return (data as { id: string } | null)?.id;
  }

  /** Moves a row one step among its siblings, reporting any failure. */
  async function move(
    key: string,
    table: ReorderTable,
    siblings: Reorderable[],
    id: string,
    direction: "up" | "down",
  ): Promise<void> {
    reportError(key, await reorderRows(supabase, table, siblings, id, direction));
    await reload();
  }

  return { reportError, run, insertReturningId, move };
}

export type Writer = ReturnType<typeof makeWriter>;
