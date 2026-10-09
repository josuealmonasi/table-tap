// ============================================================================
// Customer accounts, attacked by people who are signed in.
//
// An account is credit: food out now, paid later. What must not happen is
// food going on an account the person may not charge, more going on it than
// its ceiling, or one balance being collected twice. Every case is judged on
// the rows that changed — the orders' `account_id` and the payments — never
// on the status code alone: a write refused by nothing and filtered to zero
// rows answers 200 just the same.
// ============================================================================

// No spaces: the activity log writes a space as "_", and a mark that reads
// differently there is a mark its own cleanup cannot find. One with a space
// left three collection lines behind, and the next `pnpm money` read them as
// cash in a drawer the ledger never had.
const MARK = "attack-money-account";
const CODES = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newCode = () => Array.from({ length: 12 }, () => CODES[Math.floor(Math.random() * 32)]).join("");

export async function attackAccounts({ admin, post, who, home, neighbour, ok, bad }) {
  const made = { accounts: [], orders: [] };

  const account = async (restaurantId, limit) => {
    const { data } = await admin.from("customer_accounts").insert({
      restaurant_id: restaurantId, name: MARK, code: newCode(), credit_limit: limit, opened_by: "attack@tabletap.dev",
    }).select("id").single();
    made.accounts.push(data.id);
    return data.id;
  };
  const order = async (restaurantId, total, extra = {}) => {
    const { data } = await admin.from("orders").insert({
      restaurant_id: restaurantId, status: "received", paid: false, subtotal: total, service_fee: 0,
      tip: 0, tax_pct: 0, total, currency: "MXN", note: MARK,
      items: [{ itemId: "x", name: "attack fixture", emoji: "x", price: total, qty: 1, mods: {} }], ...extra,
    }).select("id").single();
    made.orders.push(data.id);
    return data.id;
  };
  const accountOf = async id =>
    (await admin.from("orders").select("account_id").eq("id", id).single()).data?.account_id ?? null;
  const paymentsOf = async accountId =>
    (await admin.from("payments").select("amount, tip").eq("account_id", accountId)).data ?? [];

  try {
    const mine = await account(home.id, 1000);
    const theirs = await account(neighbour.id, 1000);

    // The kitchen puts nothing on an account and collects nothing from one.
    {
      const dish = await order(home.id, 50);
      await post("/api/accounts/charge", { accountId: mine, orderIds: [dish], expected: 50 }, who.kitchen);
      (await accountOf(dish)) === null
        ? ok("the kitchen cannot put a bill on an account")
        : bad("the kitchen put a bill on a customer's account");
    }

    // Another restaurant's account, with this restaurant's food on it.
    {
      const dish = await order(home.id, 40);
      await post("/api/accounts/charge", { accountId: theirs, orderIds: [dish], expected: 40 }, who.waiter);
      (await accountOf(dish)) === null
        ? ok("a waiter cannot put a bill on another restaurant's account")
        : bad("a bill went on another restaurant's customer account");
    }

    // Another restaurant's food, on this restaurant's account.
    {
      const theirDish = await order(neighbour.id, 30);
      await post("/api/accounts/charge", { accountId: mine, orderIds: [theirDish], expected: 30 }, who.waiter);
      (await accountOf(theirDish)) === null
        ? ok("a waiter cannot put another restaurant's order on an account")
        : bad("another restaurant's order went on this restaurant's account");
    }

    // Two bills at once that fit the ceiling apart and pass it together: the
    // account's lock lets one through.
    {
      const tight = await account(home.id, 150);
      const a = await order(home.id, 100);
      const b = await order(home.id, 100);
      await Promise.all([
        post("/api/accounts/charge", { accountId: tight, orderIds: [a], expected: 100 }, who.waiter),
        post("/api/accounts/charge", { accountId: tight, orderIds: [b], expected: 100 }, who.waiter),
      ]);
      const charged = [await accountOf(a), await accountOf(b)].filter(Boolean).length;
      charged === 1
        ? ok("two charges at once cannot take an account past its ceiling")
        : bad(`${charged} charges of 100 went on an account with a ceiling of 150`);
    }

    // A bill that was already paid is not credit anybody extended.
    {
      const paid = await order(home.id, 20, { paid: true, pay_method: "cash" });
      await post("/api/accounts/charge", { accountId: mine, orderIds: [paid], expected: 20 }, who.waiter);
      (await accountOf(paid)) === null
        ? ok("a paid order cannot be put on an account")
        : bad("an order already paid went on an account as well");
    }

    // The same balance collected twice at once, by two taps with two refs:
    // one payment, of the balance.
    {
      const tab = await account(home.id, 1000);
      const dish = await order(home.id, 80);
      await admin.from("orders").update({ account_id: tab, charged_by: "attack@tabletap.dev" }).eq("id", dish);
      await Promise.all([1, 2].map(n =>
        post("/api/accounts/settle", { accountId: tab, expected: 80, tip: 0, method: "cash", ref: `${MARK}-${n}-${Date.now()}` }, who.cashier)));
      const pays = await paymentsOf(tab);
      pays.length === 1 && Math.abs(Number(pays[0].amount) - 80) < 0.01
        ? ok("one account balance collected twice at once is taken once")
        : bad(`${pays.length} payment(s) for one balance of 80: ${pays.map(p => p.amount).join(", ")}`);
    }

    // A tip with six noughts on it: never more than what it thanks.
    {
      const tab = await account(home.id, 1000);
      const dish = await order(home.id, 60);
      await admin.from("orders").update({ account_id: tab, charged_by: "attack@tabletap.dev" }).eq("id", dish);
      await post("/api/accounts/settle", { accountId: tab, expected: 60, tip: 1000000, method: "card" }, who.cashier);
      const pays = await paymentsOf(tab);
      pays.every(p => Number(p.tip) <= 60 + 0.01)
        ? ok("a tip on an account is capped at the food it thanks")
        : bad(`an account was collected with a tip of ${pays.map(p => p.tip).join(", ")}`);
    }

    // The kitchen collecting, and the waiter collecting another restaurant's.
    {
      const tab = await account(home.id, 1000);
      const dish = await order(home.id, 25);
      await admin.from("orders").update({ account_id: tab, charged_by: "attack@tabletap.dev" }).eq("id", dish);
      await post("/api/accounts/settle", { accountId: tab, expected: 25, tip: 0, method: "cash" }, who.kitchen);
      await post("/api/accounts/settle", { accountId: theirs, expected: 1, tip: 0, method: "cash" }, who.waiter);
      (await paymentsOf(tab)).length === 0 && (await paymentsOf(theirs)).length === 0
        ? ok("the kitchen collects no account, and nobody collects another restaurant's")
        : bad("money was recorded against an account by somebody who may not collect it");
    }

    // A card payment's hold outlives a dead checkout's late expiry. Stripe
    // retries an expiry for days; one arriving after the hold had lapsed and a
    // new checkout had opened lifted the NEW checkout's hold, and the till could
    // collect the account while its customer was paying it by card.
    {
      const held = await account(home.id, 1000);
      await order(home.id, 30, { account_id: held });
      const open = async () => (await admin.rpc("account_checkout_open", {
        p_restaurant: home.id, p_account: held, p_expected: 30, p_tip: 0, p_fee: 0,
      })).data;
      const first = await open();
      // Thirty-five minutes on: the hold lapsed with the first still open.
      await admin.from("customer_accounts")
        .update({ checkout_until: new Date(Date.now() - 60_000).toISOString() }).eq("id", held);
      const second = await open();
      // The first one's expiry, late, through the same function the webhook calls.
      const { error } = await admin.rpc("account_checkout_release", { p_checkout: first?.checkout });
      const hold = (await admin.from("customer_accounts").select("checkout_until").eq("id", held).single()).data?.checkout_until;
      const collected = await post("/api/accounts/settle", { accountId: held, expected: 30, tip: 0, method: "cash", ref: `${MARK}-held-${Date.now()}` }, who.cashier);
      first?.outcome === "open" && second?.outcome === "open" && !error && hold && new Date(hold) > new Date()
        && (await paymentsOf(held)).length === 0
        ? ok("a dead checkout's late expiry leaves the hold of the one being paid, and the till cannot collect it")
        : bad(`a dead checkout's late expiry lifted the hold of the one being paid (${first?.outcome}/${second?.outcome}, hold ${hold}, till ${collected?.status ?? "?"}, ${error?.message ?? "no error"})`);
    }

    // A card payment whose webhook arrives after the hold ran out, for a tab
    // the till collected in cash meanwhile: the customer paid twice. It used
    // to go into the ledger against food already paid. Like a card payment on
    // a settled table, it is kept as a refund due, once, and the bell says so.
    {
      const tab = await account(home.id, 1000);
      await order(home.id, 40, { account_id: tab });
      const checkout = (await admin.rpc("account_checkout_open", {
        p_restaurant: home.id, p_account: tab, p_expected: 40, p_tip: 0, p_fee: 0,
      })).data;
      await admin.from("customer_accounts")
        .update({ checkout_until: new Date(Date.now() - 60_000).toISOString() }).eq("id", tab);
      const cash = await post("/api/accounts/settle", { accountId: tab, expected: 40, tip: 0, method: "cash", ref: `${MARK}-twice-${Date.now()}` }, who.cashier);
      const intent = `pi_${MARK}_twice_${tab.slice(0, 8)}`;
      await admin.rpc("account_checkout_settle", { p_checkout: checkout?.checkout, p_intent: intent });
      await admin.rpc("account_checkout_settle", { p_checkout: checkout?.checkout, p_intent: intent }); // Stripe sends it again
      const [{ data: byCard }, { data: due }, { count: told }] = await Promise.all([
        admin.from("payments").select("amount").eq("stripe_payment_intent", intent),
        admin.from("refunds_due").select("amount, account_name").eq("stripe_payment_intent", intent),
        admin.from("notifications").select("id", { count: "exact", head: true })
          .eq("restaurant_id", home.id).eq("kind", "refund_due").eq("data->>account", MARK),
      ]);
      cash.status === 200 && (byCard ?? []).length === 0 && due?.length === 1 &&
        Number(due[0].amount) === 40 && due[0].account_name === MARK && told === 1
        ? ok("a card payment for a tab the till already collected is kept as MX$40 to refund, once, and the bell says so")
        : bad(`card on a collected tab: cash ${cash.status}, ${byCard?.length} card payment(s) in the ledger, ` +
            `refund ${JSON.stringify(due)}, ${told} notification(s)`);
    }
  } finally {
    // The money first, then the orders pointing at the accounts, then them.
    if (made.accounts.length) {
      await admin.from("payments").delete().in("account_id", made.accounts);
      await admin.from("orders").delete().in("account_id", made.accounts);
      await admin.from("customer_accounts").delete().in("id", made.accounts);
    }
    if (made.orders.length) {
      await admin.from("payments").delete().in("order_id", made.orders);
      await admin.from("orders").delete().in("id", made.orders);
    }
    await admin.from("user_logs").delete().eq("entity", "account").like("detail", `%name=${MARK}%`);
    await admin.from("refunds_due").delete().eq("account_name", MARK);
    await admin.from("notifications").delete().eq("kind", "refund_due").eq("data->>account", MARK);
  }
}
