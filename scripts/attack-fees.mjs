// ============================================================================
// The month's fee ceiling, against diners arriving at once.
//
// Each plan promises "never more than X" in per-order fees a month, and the
// ledger (`platform_fees`) is the only thing that keeps it. Judged by effect,
// like the rest of `pnpm attack`: the rows are read back with the secret key.
//
//   - twelve checkouts reserving at once with room for two: exactly two fit
//   - the retired incremental fee refund: no permission and no ledger change
//   - a fee that was taken: Stripe's late expiry cannot release it
//   - a divided bill opened by two diners at once: one fee, not two
//
// Everything planted here is removed again, whatever happens in between.
// ============================================================================

const MARK = "attack-fees";

export async function attackFeeCeiling({ admin, home, ok, bad }) {
  const planted = [];
  const reserve = async (cents, cap, ref = null) => {
    const { data, error } = await admin.rpc("reserve_platform_fee", {
      p_restaurant: home.id, p_cents: cents, p_cap_cents: cap, p_source: ref ? "split" : "order", p_ref: ref,
    });
    if (error) throw new Error(`reserve_platform_fee: ${error.message}`);
    const row = data?.[0];
    if (row) planted.push(row.fee_id);
    return row ?? null;
  };
  const used = async () => {
    const month = new Date().toISOString().slice(0, 7) + "-01";
    const { data, error } = await admin.from("platform_fees").select("cents, refunded_cents")
      .eq("restaurant_id", home.id).eq("period", month).neq("status", "released");
    if (error) throw new Error(`reading the ledger: ${error.message}`);
    return data.reduce((s, f) => s + f.cents - f.refunded_cents, 0);
  };

  try {
    const before = await used();
    const cap = before + 600;
    const granted = (await Promise.all(Array.from({ length: 12 }, () => reserve(300, cap)))).filter(Boolean);
    const total = granted.reduce((s, g) => s + g.fee_cents, 0);
    if (granted.length === 2 && total === 600 && (await used()) - before === 600) {
      ok("twelve checkouts at once with room for two: two fit, the ceiling holds");
    } else {
      bad(`twelve checkouts at once with room for two: ${granted.length} reserved MX$${(total / 100).toFixed(2)} against MX$6.00 of room`);
    }

    // Taken on a MX$100 charge. The old half-refund writer must be refused:
    // it inferred returned fees without Stripe evidence or an epoch check.
    const [taken] = granted;
    await admin.rpc("take_platform_fee", { p_fee: taken.fee_id, p_intent: `pi_${MARK}`, p_charge_cents: 10000 });
    const { error: retiredError } = await admin.rpc("refund_platform_fee", {
      p_restaurant: home.id, p_intent: `pi_${MARK}`, p_refund_cents: 5000, p_refund_id: `re_${MARK}_1`,
    });
    const { data: refunded, error: readError } = await admin.from("platform_fees").select("refunded_cents").eq("id", taken.fee_id).single();
    if (retiredError?.code === "42501" && !readError && refunded?.refunded_cents === 0) {
      ok("the retired incremental fee refund cannot be called or change the ledger");
    } else {
      bad(`the retired fee refund: ${retiredError?.code ?? "call allowed"}, returned cents ${refunded?.refunded_cents ?? "unreadable"}`);
    }

    await admin.rpc("release_platform_fee", { p_fee: taken.fee_id });
    const { data: still } = await admin.from("platform_fees").select("status").eq("id", taken.fee_id).single();
    if (still?.status === "taken") ok("a late expiry cannot release a fee that was taken");
    else bad(`a late expiry released a taken fee: it reads ${still?.status}`);

    // One divided bill, two shares opened at the same moment.
    const ref = `split:${MARK}-${crypto.randomUUID()}`;
    const shares = (await Promise.all([reserve(300, null, ref), reserve(300, null, ref)])).filter(Boolean);
    if (shares.length === 1) ok("a divided bill opened twice at once carries one fee");
    else bad(`a divided bill opened twice at once carried ${shares.length} fees`);
  } finally {
    if (planted.length) await admin.from("platform_fees").delete().in("id", planted);
  }
}
