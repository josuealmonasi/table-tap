import { randomUUID } from "node:crypto";
import { MARK } from "../api-fixtures.mjs";

export function accountsCases(fx) {
  const { dish } = fx;
  return [
    // ── Customer accounts ("cuenta abierta") ─────────────────────────────
    // In the order a real one lives: opened, its ceiling moved, a table's bill
    // put on it, a charge past the ceiling refused, a sale rung onto it at the
    // till, collected in person, and its statement read by the customer.
    { name: "GET  /api/accounts", as: "cashier", method: "GET", path: "/api/accounts", expect: [200],
      check: d => (Array.isArray(d.accounts) && d.accounts.some(a => a.id === fx.accountId)) || "the gate's account is not listed" },
    { name: "POST /api/accounts (open one)", as: "waiter", method: "POST", path: "/api/accounts",
      body: { name: `${MARK} customer`, limit: 500, email: "cliente@example.com" }, expect: [200],
      effect: async f => {
        const { data } = await f.admin.from("customer_accounts").select("opened_by, credit_limit, code")
          .eq("restaurant_id", f.restaurant.id).eq("name", `${MARK} customer`).maybeSingle();
        if (!data) return "no account was opened";
        if (data.opened_by !== "demo-waiter@tabletap.dev") return `opened by ${data.opened_by}, not the waiter`;
        return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(data.code) || `a code the QR cannot carry: ${data.code}`;
      } },
    { name: "POST /api/accounts (no name)", as: "waiter", method: "POST", path: "/api/accounts",
      body: { name: "  ", limit: 500 }, expect: [400], expectError: /nombre del cliente|customer's name/i },
    { name: "PATCH /api/accounts (a waiter moves a ceiling)", as: "waiter", method: "PATCH", path: "/api/accounts",
      body: { id: fx.accountId, action: "limit", limit: 5000 }, expect: [403] },
    { name: "PATCH /api/accounts (a manager moves a ceiling)", as: "manager", method: "PATCH", path: "/api/accounts",
      body: { id: fx.accountId, action: "limit", limit: 1500 }, expect: [200],
      effect: async f => {
        const { data } = await f.admin.from("customer_accounts").select("credit_limit").eq("id", fx.accountId).single();
        return Number(data.credit_limit) === 1500 || `the ceiling is ${data.credit_limit}`;
      } },
    { name: "POST /api/accounts/charge (a table's bill)", as: "waiter", method: "POST", path: "/api/accounts/charge",
      body: { accountId: fx.accountId, orderIds: [fx.acctOrder], expected: fx.lineTotal }, expect: [200],
      effect: async f => {
        const { data: o } = await f.admin.from("orders").select("account_id, paid, charged_by").eq("id", fx.acctOrder).single();
        if (o.account_id !== fx.accountId || o.paid) return `the order is ${JSON.stringify(o)}`;
        if (o.charged_by !== "demo-waiter@tabletap.dev") return `charged by ${o.charged_by}`;
        const { data: s } = await f.admin.from("table_sessions").select("close_reason").eq("id", fx.acctSessionId).single();
        return s.close_reason === "account" || `the table's sitting closed as ${s.close_reason}`;
      } },
    { name: "POST /api/accounts/charge (past the ceiling)", as: "waiter", method: "POST", path: "/api/accounts/charge",
      arrange: async f => {
        await f.admin.from("customer_accounts").update({ credit_limit: fx.lineTotal + 0.01 }).eq("id", fx.accountId);
        return async () => { await f.admin.from("customer_accounts").update({ credit_limit: 1500 }).eq("id", fx.accountId); };
      },
      body: { accountId: fx.accountId, orderIds: [fx.acctOrder2], expected: fx.lineTotal }, expect: [409],
      expectError: /límite|limit/i,
      effect: async f => {
        const { data } = await f.admin.from("orders").select("account_id").eq("id", fx.acctOrder2).single();
        return data.account_id === null || "the refused charge went on the account anyway";
      } },
    { name: "POST /api/pos/order (on an account)", as: "cashier", method: "POST", path: "/api/pos/order",
      body: { posRef: crypto.randomUUID(), method: "account", accountId: fx.accountId, note: MARK,
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 1, emoji: "🍽️", mods: {} }] },
      expect: [200], check: d => Boolean(d.onAccount?.owed > 0) || `no account in ${JSON.stringify(d).slice(0, 80)}`,
      effect: async f => {
        const { data } = await f.admin.from("payments").select("id").eq("account_id", fx.accountId);
        return (data ?? []).length === 0 || "a sale on account recorded money that never arrived";
      } },
    { name: "POST /api/accounts/settle (the balance changed)", as: "cashier", method: "POST", path: "/api/accounts/settle",
      body: { accountId: fx.accountId, expected: 0.5, tip: 0, method: "cash" }, expect: [409],
      expectError: /cambió|changed/i },
    { name: "POST /api/accounts/settle (cash, with a tip)", as: "cashier", method: "POST", path: "/api/accounts/settle",
      body: async f => {
        const { data } = await f.admin.from("orders").select("total")
          .eq("account_id", fx.accountId).eq("paid", false).neq("status", "cancelled");
        f.accountOwed = Math.round((data ?? []).reduce((s, o) => s + Number(o.total), 0) * 100) / 100;
        return { accountId: fx.accountId, expected: f.accountOwed, tip: 10, method: "cash", ref: crypto.randomUUID() };
      },
      expect: [200],
      effect: async f => {
        const [{ data: pays }, { data: owed }] = await Promise.all([
          f.admin.from("payments").select("amount, tip, method, actor_email").eq("account_id", fx.accountId),
          f.admin.from("orders").select("id").eq("account_id", fx.accountId).eq("paid", false).neq("status", "cancelled"),
        ]);
        if ((pays ?? []).length !== 1) return `${(pays ?? []).length} payments for one collection`;
        const [p] = pays;
        if (Math.abs(Number(p.amount) - (f.accountOwed + 10)) > 0.01 || Number(p.tip) !== 10) return `paid ${p.amount} with tip ${p.tip}`;
        if (p.actor_email !== "demo-cashier@tabletap.dev") return `the drawer is ${p.actor_email}'s`;
        return (owed ?? []).length === 0 || "orders still owed after the account was paid";
      } },
    { name: "GET  /api/account (a statement)", as: "diner", method: "GET", path: `/api/account?c=${fx.accountCode}`,
      expect: [200],
      check: d => {
        if (typeof d.owed !== "number" || !Array.isArray(d.days)) return `no statement in ${JSON.stringify(d).slice(0, 80)}`;
        const said = JSON.stringify({ ...d, restaurant: { ...d.restaurant, id: undefined } });
        if (said.includes("@")) return "the statement names somebody's email";
        if (/credit_limit|opened_by/.test(said)) return "the statement hands out the ceiling or who opened it";
        return !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(said) || "the statement hands out a row id";
      } },
    { name: "GET  /api/account (no such account)", as: "diner", method: "GET", path: "/api/account?c=000000000000",
      expect: [404], expectError: /encontramos|couldn't find/i },
    // The demo has no card reader: refused before any hold is put on.
    { name: "POST /api/account/pay (no card reader)", as: "diner", method: "POST", path: "/api/account/pay",
      body: { c: fx.accountCode, expected: 1 }, expect: [409], expectError: /tarjeta|card/i },
    // Dev carries a placeholder mail key, so a real send fails there: either
    // answer is one the route gives, and neither keeps the address.
    { name: "POST /api/account/email (the statement)", as: "diner", method: "POST", path: "/api/account/email",
      body: { c: fx.accountCode, email: "cliente@example.com", ref: randomUUID() }, expect: [200, 409, 502] },
  ];
}
