import { checked, chargeAccountFixture, disposableAccountRestaurant } from "./disposable-account-fixtures.mjs";
import { attackAccountCredit } from "./attack-account-credit.mjs";
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

export async function attackAccounts({ admin, post, ok, bad }) {
  const home = await disposableAccountRestaurant(admin, process.env, MARK, ["manager", "waiter", "cashier", "kitchen"]);
  try {
    const neighbour = await disposableAccountRestaurant(admin, process.env, `${MARK}-foreign`);
    try {
      await accountCases({ admin, post, who: home.who, home: home.restaurant, neighbour: neighbour.restaurant, ok, bad });
    } finally { await neighbour.cleanup(); }
  } finally { await home.cleanup(); }
}

async function accountCases({ admin, post, who, home, neighbour, ok, bad }) {

  const account = async (restaurantId, limit) => {
    const data = await checked(admin.from("customer_accounts").insert({
      restaurant_id: restaurantId, name: MARK, code: newCode(), credit_limit: limit, opened_by: "attack@tabletap.dev",
    }).select("id, journal_started_at").single());
    if (!data.journal_started_at) throw new Error("Attack fixture account must start its journal");
    return data.id;
  };
  const order = async (restaurantId, total, extra = {}) => {
    const data = await checked(admin.from("orders").insert({
      restaurant_id: restaurantId, status: "received", paid: false, subtotal: total, service_fee: 0,
      tip: 0, tax_pct: 0, total, currency: "MXN", note: MARK,
      items: [{ itemId: "x", name: "attack fixture", emoji: "x", price: total, qty: 1, mods: {} }], ...extra,
    }).select("id").single());
    return data.id;
  };
  const accountOf = async id =>
    (await admin.from("orders").select("account_id").eq("id", id).single()).data?.account_id ?? null;
  const paymentsOf = async accountId =>
    (await admin.from("payments").select("amount, tip").eq("account_id", accountId)).data ?? [];

  const charge = (restaurant, account, id, total) => chargeAccountFixture(admin, restaurant, account, [id], total, "attack@tabletap.dev");

  await attackAccountCredit({ admin, post, who, home, neighbour, ok, bad, account, order, charge });
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
    await charge(home.id, tab, dish, 80);
    await Promise.all([1, 2].map(n =>
      post("/api/accounts/settle", { currency: "MXN", accountId: tab, expected: 80, tip: 0, method: "cash", ref: `${MARK}-${n}-${Date.now()}` }, who.cashier)));
    const pays = await paymentsOf(tab);
    pays.length === 1 && Math.abs(Number(pays[0].amount) - 80) < 0.01
      ? ok("one account balance collected twice at once is taken once")
      : bad(`${pays.length} payment(s) for one balance of 80: ${pays.map(p => p.amount).join(", ")}`);
  }

  // A tip with six noughts on it: never more than what it thanks.
  {
    const tab = await account(home.id, 1000);
    const dish = await order(home.id, 60);
    await charge(home.id, tab, dish, 60);
    await post("/api/accounts/settle", { currency: "MXN", accountId: tab, expected: 60, tip: 1000000, method: "card" }, who.cashier);
    const pays = await paymentsOf(tab);
    pays.every(p => Number(p.tip) <= 60 + 0.01)
      ? ok("a tip on an account is capped at the food it thanks")
      : bad(`an account was collected with a tip of ${pays.map(p => p.tip).join(", ")}`);
  }

  // The kitchen collecting, and the waiter collecting another restaurant's.
  {
    const tab = await account(home.id, 1000);
    const dish = await order(home.id, 25);
    await charge(home.id, tab, dish, 25);
    await post("/api/accounts/settle", { currency: "MXN", accountId: tab, expected: 25, tip: 0, method: "cash" }, who.kitchen);
    await post("/api/accounts/settle", { currency: "MXN", accountId: theirs, expected: 1, tip: 0, method: "cash" }, who.waiter);
    (await paymentsOf(tab)).length === 0 && (await paymentsOf(theirs)).length === 0
      ? ok("the kitchen collects no account, and nobody collects another restaurant's")
      : bad("money was recorded against an account by somebody who may not collect it");
  }

  // An account's open card checkout holds the till at any age (#578). Stripe
  // retries an expiry for days; under the old 35-minute hold a second
  // checkout opened beside a lapsed first one, and the first one's late expiry
  // lifted the second's hold. Now the second is refused until Stripe resolves
  // the first, and the till cannot collect while any page is open.
  {
    const held = await account(home.id, 1000);
    const dish = await order(home.id, 30);
    await charge(home.id, held, dish, 30);
    const open = async () => (await admin.rpc("account_checkout_open_v2", {
      p_restaurant: home.id, p_account: held, p_expected: 30, p_tip: 0, p_fee: 0,
    })).data;
    const first = await open();
    await admin.from("customer_accounts")
      .update({ checkout_until: new Date(Date.now() - 60_000).toISOString() }).eq("id", held);
    const second = await open();
    const tillWhileOpen = await post("/api/accounts/settle", { currency: "MXN", accountId: held, expected: 30, tip: 0, method: "cash", ref: `${MARK}-held-${Date.now()}` }, who.cashier);
    // The first one's expiry, late, through the same function the webhook calls.
    const { error } = await admin.rpc("account_checkout_release", { p_checkout: first?.checkout });
    const third = await open();
    const tillWhileThird = await post("/api/accounts/settle", { currency: "MXN", accountId: held, expected: 30, tip: 0, method: "cash", ref: `${MARK}-held2-${Date.now()}` }, who.cashier);
    first?.outcome === "open" && second?.outcome === "paying" && tillWhileOpen.status === 409 && !error
      && third?.outcome === "open" && tillWhileThird.status === 409 && (await paymentsOf(held)).length === 0
      ? ok("an open account checkout holds the till at any age, and a late expiry frees only its own page")
      : bad(`an account was collectable beside an open checkout (${first?.outcome}/${second?.outcome}/${third?.outcome}, till ${tillWhileOpen.status}/${tillWhileThird.status}, ${error?.message ?? "no error"})`);
  }

  // A tab being paid by card cannot also be collected in cash, however long
  // the page has been open (#578): the double payment that used to become a
  // refund due is refused before it happens, and the card pays the debt.
  {
    const tab = await account(home.id, 1000);
    const dish = await order(home.id, 40);
    await charge(home.id, tab, dish, 40);
    const checkout = (await admin.rpc("account_checkout_open_v2", {
      p_restaurant: home.id, p_account: tab, p_expected: 40, p_tip: 0, p_fee: 0,
    })).data;
    await admin.from("customer_accounts")
      .update({ checkout_until: new Date(Date.now() - 60_000).toISOString() }).eq("id", tab);
    const cash = await post("/api/accounts/settle", { currency: "MXN", accountId: tab, expected: 40, tip: 0, method: "cash", ref: `${MARK}-twice-${Date.now()}` }, who.cashier);
    const intent = `pi_${MARK}_twice_${tab.slice(0, 8)}`;
    await admin.rpc("account_checkout_settle_v2", { p_checkout: checkout?.checkout, p_intent: intent });
    await admin.rpc("account_checkout_settle_v2", { p_checkout: checkout?.checkout, p_intent: intent }); // Stripe sends it again
    const [{ data: byCard }, { data: due }, cashRows] = await Promise.all([
      admin.from("payments").select("amount").eq("stripe_payment_intent", intent),
      admin.from("refunds_due").select("amount").eq("stripe_payment_intent", intent),
      paymentsOf(tab),
    ]);
    cash.status === 409 && (byCard ?? []).length === 1 && Number(byCard[0].amount) === 40 && (due ?? []).length === 0
      && cashRows.length === 1
      ? ok("cash is refused while the tab is paid by card, and the card pays the MX$40 once")
      : bad(`a tab being paid by card: cash ${cash.status}, ${byCard?.length} card payment(s), refund ${JSON.stringify(due)}, ${cashRows.length} payment(s) in all`);
  }
}
