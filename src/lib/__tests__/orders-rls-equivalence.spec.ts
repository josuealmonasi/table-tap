import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const before = readFileSync("src/lib/__tests__/fixtures/orders-access-before.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
const names = ["team reads orders", "team reads service requests",
  "team reads kitchen tickets", "team reads kitchen calls"];

function policy(sql: string, name: string) {
  // The last definition wins when schema.sql reapplies a policy later on.
  const text = [...sql.replace(/--[^\n]*/g, "").matchAll(/create policy "([^"]+)"[^;]+;/g)]
    .filter(match => match[1] === name).at(-1)?.[0];
  if (!text) throw new Error(`Missing policy: ${name}`);
  const parsed = text.match(/on (\w+) for (select|update)( to authenticated)?\s+using \(([\s\S]+)\);$/);
  if (!parsed) throw new Error(`Unknown policy: ${text}`);
  return { table: parsed[1], command: parsed[2], authenticated: !!parsed[3], predicate: parsed[4] };
}

function access(predicate: string) {
  const direct = /^(has_role|works_at)\(restaurant_id(, array\[([^\]]+)\])?\)$/.exec(predicate);
  const cached = /^restaurant_id = any \(array\(\s*select r.id from public.restaurants r\s+where public\.(has_role|works_at)\(r.id(, array\[([^\]]+)\])?\)\s*\)\)$/.exec(predicate);
  const match = direct ?? cached;
  if (!match) throw new Error(`Unknown predicate: ${predicate}`);
  return { helper: match[1], roles: [...(match[3] ?? "").matchAll(/'([^']+)'/g)].map(m => m[1]), cached: !!cached };
}

interface Membership { user: string; restaurant: string; role: string }
const restaurants = [{ id: "a", owner: "founder" }, { id: "b", owner: "neighbour" },
  { id: "empty", owner: "absent" }];
const staff: Membership[] = ["owner", "manager", "cashier", "waiter", "kitchen"].map(role =>
  ({ user: role, restaurant: "a", role }));
staff.push({ user: "kitchen", restaurant: "b", role: "manager" },
  { user: "founder", restaurant: "b", role: "kitchen" });

function qualifies(rule: ReturnType<typeof access>, user: string | null, restaurant: string | null) {
  if (user === null || restaurant === null) return false;
  return restaurants.some(r => r.id === restaurant && r.owner === user)
    || staff.some(s => s.user === user && s.restaurant === restaurant
      && (s.role === "owner" || rule.helper === "works_at" || rule.roles.includes(s.role)));
}

describe("orders access is computed once without changing the audience", () => {
  it.each(names)("builds an uncorrelated restaurant array for %s", name => {
    const old = policy(before, name), current = policy(schema, name);
    expect({ ...current, predicate: old.predicate }).toEqual(old);
    expect(access(current.predicate).cached, "a row-dependent helper still runs for every order or call").toBe(true);
    expect(access(current.predicate)).toEqual({ ...access(old.predicate), cached: true });
  });

  it.each(["founder", "owner", "manager", "cashier", "waiter", "kitchen", "neighbour",
    "platform-admin", "outsider", null])("keeps exactly the old rows for %s", user => {
    for (const name of names) {
      const old = access(policy(before, name).predicate), current = access(policy(schema, name).predicate);
      const visible = restaurants.filter(r => qualifies(current, user, r.id)).map(r => r.id);
      for (const restaurant of ["a", "b", "empty", "missing", null]) {
        const allowed = current.cached ? visible.includes(restaurant ?? "") : qualifies(current, user, restaurant);
        expect(allowed, `${name}: ${user} at ${restaurant}`).toBe(qualifies(old, user, restaurant));
      }
    }
  });

  it("retains founding owners, co-owners and kitchen's different audience", () => {
    const orders = access(policy(schema, names[0]).predicate);
    const kitchen = access(policy(schema, names[2]).predicate);
    expect(qualifies(orders, "founder", "a")).toBe(true);
    expect(qualifies(orders, "owner", "a")).toBe(true);
    expect(qualifies(orders, "kitchen", "a")).toBe(false);
    expect(qualifies(kitchen, "kitchen", "a")).toBe(true);
    expect(qualifies(orders, "kitchen", "b")).toBe(true);
    expect(qualifies(orders, "platform-admin", "a")).toBe(false);
  });

  it("leaves the helper definitions and service-request write checks alone", () => {
    for (const helper of ["owns_restaurant", "has_role", "works_at"]) {
      const definition = new RegExp(`create or replace function public\\.${helper}\\([\\s\\S]+?\\n\\$\\$;`);
      expect(schema.match(definition)?.[0]).toBe(before.match(definition)?.[0]);
    }
    const update = /create policy "team updates service requests"[^;]+;/;
    expect(schema.match(update)?.[0]).toBe(before.match(update)?.[0]);
    expect([...schema.matchAll(/create policy "[^"]+"\s+on orders for (\w+)/g)].map(m => m[1]))
      .toEqual(["select"]);
  });

  it("can enumerate restaurant ids without private ownership columns", () => {
    // The helpers read private columns; the outer InitPlan only needs public ids.
    expect(policy(schema, "public read restaurants")).toEqual({
      table: "restaurants", command: "select", authenticated: false, predicate: "true",
    });
    for (const role of ["anon", "authenticated"]) {
      expect(schema).toMatch(new RegExp(`grant select \\(id,[^;]+\\) on restaurants to ${role};`));
    }
  });
});
