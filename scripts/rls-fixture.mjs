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

/** One row in each tenant-scoped table, belonging to the neighbour. */
export async function plantNeighbour(admin, restaurantId) {
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
    await keep("payment", "payments", {
      restaurant_id: restaurantId, order_id: orderId, amount: 11.5, method: "cash",
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
  await keep("notification", "notifications", {
    restaurant_id: restaurantId, kind: "low_stock", data: { note: "rls fixture" },
  });

  return {
    planted,
    /** Children first, so nothing is left holding a reference. */
    remove: async () => {
      const order = [
        "split", "sitting", "request", "notification", "iconGroup",
        "writeOff", "discount", "redemption", "rating", "print_job", "payment", "order",
      ];
      for (const name of order) {
        const row = planted[name];
        if (row) await admin.from(row.table).delete().eq("id", row.id);
      }
    },
  };
}
