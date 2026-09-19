// ============================================================================
// A neighbouring restaurant with one of everything.
//
// The cross-tenant sweep can only prove a table is safe if there is a foreign
// row in it to reach for. Without this it passed on twelve of twenty-one
// tables by finding nothing to attack — a green tick for a question never
// asked — and that is exactly how a leak survives a check that "passed".
//
// Everything planted here is deleted again by `remove()`, whatever happened in
// between. NEVER against production: these are somebody's real books, and a
// probe order there shows up in their takings and in their corte.
// ============================================================================

/** The line every fixture order carries, and the name on its cash payment. */
const MARK = "rls fixture";
const ACTOR = "rls-fixture@tabletap.dev";

/**
 * Anything a previous run left behind, before this one plants more.
 *
 * `remove()` runs at the end, which is fine until a run does not reach the
 * end. This one crashed mid-sweep and left its cash payment on the ledger —
 * and `pnpm money` then failed, correctly, on a cashier with no corte line
 * behind MX$11.50, four gates and an hour later. The comment beside the
 * payment already warned that this happens; nothing stopped it happening.
 *
 * Everything the fixture plants hangs off its order, which is recognisable by
 * the line it carries. Taking the order first would orphan the rest, so the
 * children go in the same order `remove()` uses.
 */
async function sweepLeftovers(admin) {
  // Matched in JavaScript, not in the query. A `contains` on a jsonb array
  // wants the value as JSON text and answers "invalid input syntax for type
  // json" when handed a JS array — quietly, as an error object nobody was
  // reading, which is how the first version of this swept nothing and said so
  // by saying nothing. The neighbour has a handful of orders; reading them is
  // cheaper than being clever.
  // Not scoped to THIS run's neighbour. Which restaurant is the neighbour
  // depends on what the seed produced, so a leftover can belong to a different
  // one than the run now cleaning up — and scoping the sweep to the current
  // one is exactly why the first attempt removed the stray payment and left
  // its order standing, paid, with nothing behind it.
  const { data: theirs } = await admin.from("orders").select("id, items");
  const ids = (theirs ?? [])
    .filter(o => (o.items ?? []).some(line => line?.name === MARK))
    .map(o => o.id);

  if (ids.length > 0) {
    for (const table of ["dish_ratings", "coupon_redemptions", "print_jobs", "payments"]) {
      await admin.from(table).delete().in("order_id", ids);
    }
    await admin.from("orders").delete().in("id", ids);
  }

  // And a payment that outlived its order: `payments.order_id` is
  // `on delete set null`, so a run that got as far as the order and no
  // further leaves money on the ledger with nothing to trace it back to.
  const { data: orphans } = await admin
    .from("payments").select("id").eq("actor_email", ACTOR);
  if (orphans?.length) {
    await admin.from("payments").delete().in("id", orphans.map(p => p.id));
  }

  return ids.length + (orphans?.length ?? 0);
}

/** One row in each tenant-scoped table, belonging to the neighbour. */
export async function plantNeighbour(admin, restaurantId) {
  const swept = await sweepLeftovers(admin);
  if (swept > 0) {
    console.log(`  (cleared ${swept} row set(s) a previous run left behind)`);
  }
  const planted = {};
  const keep = async (name, table, row) => {
    const { data, error } = await admin.from(table).insert(row).select("id").maybeSingle();
    if (data?.id) planted[name] = { table, id: data.id };
    return { id: data?.id ?? null, error };
  };

  // What the neighbour already has, to hang the rest off.
  const [{ data: table }, { data: item }, { data: coupon }] = await Promise.all([
    admin.from("restaurant_tables").select("id, label").eq("restaurant_id", restaurantId)
      .limit(1).maybeSingle(),
    admin.from("menu_items").select("id").eq("restaurant_id", restaurantId).limit(1).maybeSingle(),
    admin.from("coupons").select("id, code").eq("restaurant_id", restaurantId)
      .limit(1).maybeSingle(),
  ]);

  const { id: orderId } = await keep("order", "orders", {
    restaurant_id: restaurantId, status: "received", paid: true, subtotal: 11.5,
    service_fee: 0, tip: 0, tax_pct: 0, total: 11.5, currency: "MXN",
    items: [{ itemId: "x", name: "rls fixture", emoji: "x", price: 11.5, qty: 1, mods: {} }],
  });

  if (orderId) {
    // Named, like every real cash payment: `pnpm money` fails a cash row with
    // nobody behind it, and a run of this killed part-way through left one
    // planted — so a perfectly healthy ledger reported a missing cashier, in
    // the other gate, hours later. A fixture should never be able to look like
    // the bug a different check is watching for.
    await keep("payment", "payments", {
      restaurant_id: restaurantId, order_id: orderId, amount: 11.5, method: "cash",
      actor_email: ACTOR,
    });
    await keep("print_job", "print_jobs", {
      restaurant_id: restaurantId, order_id: orderId, kind: "kitchen",
    });
    if (item?.id) {
      await keep("rating", "dish_ratings", {
        restaurant_id: restaurantId, order_id: orderId, item_id: item.id, rating: 5,
      });
    }
    await keep("redemption", "coupon_redemptions", {
      restaurant_id: restaurantId, coupon_id: coupon?.id ?? null, order_id: orderId,
      code: coupon?.code ?? "RLS-FIXTURE", amount: 1,
    });
    await keep("discount", "discount_requests", {
      restaurant_id: restaurantId, table_id: table?.id ?? null,
      table_label: table?.label ?? "rls", order_ids: [orderId],
      code: "RLS-FIXTURE", amount: 1, requested_by: "rls@fixture.invalid",
    });
    await keep("writeOff", "write_off_requests", {
      restaurant_id: restaurantId, table_id: table?.id ?? null,
      table_label: table?.label ?? "rls", order_ids: [orderId],
      amount: 1, reason: "walkout", requested_by: "rls@fixture.invalid",
    });
  }

  if (table?.id) {
    await keep("request", "service_requests", {
      restaurant_id: restaurantId, table_id: table.id, table_label: table.label, kind: "waiter",
    });
    // A sitting the neighbour's own waiter opened — the column that says a bill
    // is settled in person, and a staff email nobody else may read.
    const { id: sessionId } = await keep("sitting", "table_sessions", {
      restaurant_id: restaurantId, table_id: table.id,
      // Closed, so the neighbour's `one open sitting per table` index is never
      // in the way and their floor is not shown a table that is not occupied.
      opened_by: "rls@fixture.invalid",
      closed_at: new Date().toISOString(), close_reason: "expired",
    });
    if (sessionId) {
      await keep("split", "bill_splits", {
        restaurant_id: restaurantId, session_id: sessionId, shares: 2,
        amount: 10, proposed_by: "rls-fixture",
      });
    }
  }

  await keep("iconGroup", "icon_groups", {
    restaurant_id: restaurantId, variant: "product", name: "rls fixture",
  });
  // The three the sweep kept reporting as "no fixture, so not attacked". What
  // a seed happens to have left in a neighbour's tables is not something a
  // security check may depend on: the run that finds nothing to attack is the
  // one that passes without asking anything.
  await keep("coupon", "coupons", {
    restaurant_id: restaurantId, code: "RLS-FIXTURE", kind: "fixed", value: 1,
  });
  await keep("promotion", "promotions", {
    restaurant_id: restaurantId, name: "rls fixture", kind: "bogo",
    buy_qty: 2, pay_qty: 1, active: false,
  });
  await keep("log", "user_logs", {
    restaurant_id: restaurantId, actor_email: "rls@fixture.invalid",
    entity: "staff", action: "created", target_email: "rls@fixture.invalid",
    target_role: "waiter",
  });
  // A colleague of theirs. Nothing signs in as this row; it exists so that
  // "cannot read their staff" is a question rather than an empty table.
  await keep("colleague", "staff", {
    restaurant_id: restaurantId, email: "rls@fixture.invalid", role: "waiter",
  });
  await keep("notification", "notifications", {
    restaurant_id: restaurantId, kind: "low_stock", data: { note: "rls fixture" },
  });

  return {
    planted,
    /** Children first, so nothing is left holding a reference. */
    remove: async () => {
      const order = [
        "split", "sitting", "request", "notification", "iconGroup", "log", "colleague",
        "writeOff", "discount", "redemption", "promotion", "coupon",
        "rating", "print_job", "payment", "order",
      ];
      for (const name of order) {
        const row = planted[name];
        if (row) await admin.from(row.table).delete().eq("id", row.id);
      }
    },
  };
}
