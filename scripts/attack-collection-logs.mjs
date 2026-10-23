/** Capture the one paid activity row created by a whole-table control case. */
export async function trackCollectionLogs(admin, context, captured, operation) {
  const detail = `amount=${context.amount.toFixed(2)} tip=0.00 currency=MXN method=cash`;
  async function read() {
    const { data, error } = await admin.from("user_logs").select("id")
      .eq("restaurant_id", context.restaurantId).eq("actor_email", context.actor)
      .eq("entity", "bill").eq("action", "paid").eq("detail", detail);
    if (error || !Array.isArray(data) || data.some(row => typeof row.id !== "string")) {
      throw new Error("Could not read the attack collection's activity rows");
    }
    return data.map(row => row.id);
  }

  const before = new Set(await read());
  let result, failure;
  let failed = false;
  try {
    result = await operation();
  } catch (error) {
    failed = true;
    failure = error;
  }
  // A request can land before its response is lost. Remember its log before
  // rethrowing, so the outer fixture teardown can remove that exact row.
  const made = (await read()).filter(id => !before.has(id));
  if (made.length > 1) throw new Error("Ambiguous attack collection activity; refusing broad cleanup");
  if (!failed && made.length !== 1) throw new Error("Expected exactly one attack collection activity row");
  for (const id of made) captured.add(id);
  if (failed) throw failure;
  return result;
}

/** Called only after the corresponding test payments have been removed. */
export async function clearCollectionLogs(admin, restaurantId, captured) {
  if (captured.size === 0) return;
  const ids = [...captured];
  const { data, error } = await admin.from("user_logs").delete()
    .eq("restaurant_id", restaurantId).in("id", ids).select("id");
  if (error || !Array.isArray(data) || data.length !== ids.length || data.some(row => !captured.has(row.id))) {
    throw new Error("Could not remove the exact attack collection activity rows");
  }
  captured.clear();
}
