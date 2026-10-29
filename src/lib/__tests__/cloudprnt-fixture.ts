export interface PrintJob extends Record<string, unknown> {
  id: string;
  restaurant_id: string;
  order_id: string;
  delivery_token: string;
  created_at: string;
  claimed_at: string | null;
  printed_at: string | null;
}
export const TOKEN = "a".repeat(43);
export const A = "00000000-0000-4000-8000-000000000001";
export const B = "00000000-0000-4000-8000-000000000002";
export const state = {
  jobs: [] as PrintJob[], failWrite: false, beforeClaim: null as (() => void) | null,
};
export function job(id: string, restaurant = "r1"): PrintJob {
  return { id, restaurant_id: restaurant, order_id: `order-${id}`, delivery_token: id,
    created_at: id, claimed_at: null, printed_at: null };
}

interface Result { data: Record<string, unknown> | null; error: { message: string } | null }
class Query implements PromiseLike<Result> {
  private filters: ((row: Record<string, unknown>) => boolean)[] = [];
  private values: Record<string, unknown> | null = null;
  constructor(private table: string) {}
  select() { return this; }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
  is(key: string, value: unknown) { return this.eq(key, value); }
  // `orders.status` filters a job by its order's status, as the inner embed does.
  neq(key: string, value: unknown) {
    this.filters.push(row => (key === "orders.status" ? row.order_status ?? "received" : row[key]) !== value); return this;
  }
  not(key: string, _operator: string, value: unknown) {
    this.filters.push(row => row[key] !== value); return this;
  }
  order() { return this; }
  limit() { return this; }
  update(values: Record<string, unknown>) { this.values = values; return this; }
  async upsert(values: Record<string, unknown>) {
    if (state.failWrite) return { error: { message: "write failed" } };
    const found = state.jobs.find(row => row.order_id === values.order_id);
    if (found) Object.assign(found, values);
    return { error: null };
  }
  async maybeSingle(): Promise<Result> { return this.execute(); }
  private execute(): Result {
    if (this.values?.claimed_at && state.beforeClaim) {
      const race = state.beforeClaim; state.beforeClaim = null; race();
    }
    if (this.values && state.failWrite) return { data: null, error: { message: "write failed" } };
    const rows = this.table === "print_jobs" ? state.jobs
      : this.table === "restaurants" ? [{ id: "r1", print_token: TOKEN, name: "Bistro", timezone: "UTC" }]
      : state.jobs.map(row => ({ id: row.order_id, restaurant_id: row.restaurant_id,
        items: [], created_at: "2026-10-21T00:00:00Z", status: row.order_status ?? "received" }));
    const row = rows.find(row => this.filters.every(filter => filter(row)));
    if (row && this.values) Object.assign(row, this.values);
    return { data: row ? { ...row } : null, error: null };
  }
  then<TResult1 = Result, TResult2 = never>(
    resolve?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> { return Promise.resolve(this.execute()).then(resolve, reject); }
}
export const database = { from: (table: string) => new Query(table) };
