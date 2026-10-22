/** An old copy can finish after a reprint is already in another printer. */
export function printReprintRace() {
  let url, oldToken, newToken;
  const checked = async query => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data) throw new Error("the print fixture has no queued delivery");
    return data;
  };
  const ask = async (f, path, method, body) => {
    const res = await fetch(f.base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(body ? { cookie: f.who.waiter } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status !== 200) throw new Error(`${method} ${path}: ${res.status}`);
    return res;
  };
  return {
    name: "DELETE /api/print/cloudprnt (an old copy cannot close a fetched reprint)",
    as: "diner", method: "DELETE", expect: [200],
    path: () => `${url}?token=${oldToken}&code=OK`,
    arrange: async f => {
      url = `/api/print/cloudprnt/${await f.printToken()}`;
      const before = await checked(f.admin.from("print_jobs").select("delivery_token")
        .eq("id", f.printJobId).eq("restaurant_id", f.restaurant.id).single());
      oldToken = before.delivery_token;
      await ask(f, `${url}?token=${oldToken}`, "GET");
      await ask(f, "/api/orders/print", "POST", { orderId: f.printableOrder, to: "kitchen" });
      const after = await checked(f.admin.from("print_jobs").select("delivery_token, claimed_at, printed_at")
        .eq("id", f.printJobId).eq("restaurant_id", f.restaurant.id).single());
      newToken = after.delivery_token;
      if (oldToken === newToken || after.claimed_at !== null || after.printed_at !== null) {
        throw new Error("the reprint did not issue a fresh, unclaimed delivery");
      }
      await ask(f, `${url}?token=${newToken}`, "GET");
      // Both copies were handed out before the delayed success arrives.
      // This is our fixture's order; the normal teardown deletes it and its job.
    },
    effect: async f => {
      const afterOld = await checked(f.admin.from("print_jobs").select("delivery_token, claimed_at, printed_at")
        .eq("id", f.printJobId).eq("restaurant_id", f.restaurant.id).single());
      if (afterOld.delivery_token !== newToken || !afterOld.claimed_at || afterOld.printed_at !== null) {
        return "the old confirmation closed or changed the fetched reprint";
      }
      const stale = await fetch(`${f.base}${url}?token=${oldToken}`);
      if (stale.status !== 404) return `the old GET received ${stale.status} instead of 404`;
      await ask(f, `${url}?token=${newToken}&code=200%20OK`, "DELETE");
      const afterNew = await checked(f.admin.from("print_jobs").select("printed_at")
        .eq("id", f.printJobId).eq("restaurant_id", f.restaurant.id).single());
      return !!afterNew.printed_at || "the new copy's own confirmation did not close it";
    },
  };
}
