import { describe, expect, it } from "vitest";
import { schema, sources, read } from "./helpers";
import {
  apiRoutes, dynamicOrderWrites, importClosure, orderCreatingSql, orderWriterFiles, sqlBody, sqlFunctions,
} from "./order-inventory";
import { ORDER_PATHS, ORDER_SQL, PRECONDITIONS } from "./order-paths";

/**
 * Every order-creating route and RPC is on the list in `order-paths.ts`, and
 * every listed path still references what enforces each of its preconditions.
 * To add a path: add it there, decide every precondition, and add a line to
 * docs/regressions.md ("Order paths are inventoried").
 */
const fns = sqlFunctions();
const creating = orderCreatingSql(fns);
const writers = orderWriterFiles(creating.keys());
const closures = new Map(apiRoutes().map(route => [route, importClosure(route)]));
const routesThatCreate = [...closures].filter(([, c]) => [...writers.keys()].some(w => c.has(w))).map(([r]) => r).sort();

describe("order creation inventory", () => {
  it("finds the order-creating SQL functions, and every one is listed", () => {
    expect(creating.size, "the SQL scan found nothing: the parser is broken").toBeGreaterThan(5);
    expect([...creating.keys()].sort(),
      "a SQL function that creates orders is not in ORDER_SQL — list it and decide its preconditions").toEqual(Object.keys(ORDER_SQL).sort());
    expect(dynamicOrderWrites(fns), "dynamic SQL writing orders cannot be followed by this scan").toEqual([]);
  });

  it("finds every source file that creates an order, and every one belongs to a listed path", () => {
    const listed = new Set(ORDER_PATHS.flatMap(p => p.writes));
    expect([...writers.keys()].sort(), "a file creates orders but no listed path owns it").toEqual([...listed].sort());
  });

  it("lists every API route that reaches an order writer, with exactly the writers it reaches", () => {
    expect(routesThatCreate.length).toBeGreaterThan(2);
    expect(routesThatCreate, "a NEW route creates orders: add it to ORDER_PATHS and decide its preconditions")
      .toEqual([...new Set(ORDER_PATHS.map(p => p.route))].sort());
    for (const route of routesThatCreate) {
      const reached = [...writers.keys()].filter(w => closures.get(route)!.has(w)).sort();
      const owned = [...new Set(ORDER_PATHS.filter(p => p.route === route).flatMap(p => p.writes))].sort();
      expect(reached, `${route} reaches order writers its listed paths do not name`).toEqual(owned);
    }
  });

  it("names each listed RPC in the path's own writer files", () => {
    for (const path of ORDER_PATHS) {
      for (const rpc of path.rpcs) {
        expect(ORDER_SQL[rpc], `${path.id}: ${rpc} is not an entry RPC`).toBe("entry");
        expect(path.writes.some(f => writers.get(f)?.includes(rpc)), `${path.id}: no writer names ${rpc}`).toBe(true);
      }
    }
  });

  it("calls entry functions from src, internal ones only from other listed functions, legacy ones from nothing", () => {
    const named = new Set([...writers.values()].flat());
    const calledBy = (name: string) => Object.keys(ORDER_SQL)
      .filter(other => other !== name && new RegExp(`\\b${name}\\s*\\(`).test(sqlBody(other, fns)));
    for (const [name, kind] of Object.entries(ORDER_SQL)) {
      if (kind === "entry") expect(named.has(name), `${name} is listed as entry but nothing in src calls it`).toBe(true);
      else expect(named.has(name), `${name} is ${kind} but src calls it directly: make it an entry with a path`).toBe(false);
      if (kind === "internal") expect(calledBy(name).length, `${name} is internal but no listed function calls it`).toBeGreaterThan(0);
      if (kind === "legacy") expect(calledBy(name), `${name} is legacy but is called: it is internal now`).toEqual([]);
    }
  });

  it("never lets a browser call an order-creating function directly, skipping every route check", () => {
    for (const name of Object.keys(ORDER_SQL)) {
      expect(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\)\\s+from public,\\s*anon,\\s*authenticated`).test(schema),
        `${name} is not revoked from browsers`).toBe(true);
      expect(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\)\\s+to[^;]*\\b(anon|authenticated|public)\\b`).test(schema),
        `${name} is granted to a browser role`).toBe(false);
    }
  });
});

describe("each order path enforces its preconditions", () => {
  it("decides every precondition on every path", () => {
    for (const path of ORDER_PATHS) {
      expect(Object.keys(path.rules).sort(), path.id).toEqual([...PRECONDITIONS].sort());
      for (const [key, rule] of Object.entries(path.rules)) {
        if (rule.status === "exempt") expect(rule.why.length, `${path.id}/${key}: say why`).toBeGreaterThan(10);
        else expect(rule.probes.length, `${path.id}/${key}: no probes`).toBeGreaterThan(0);
      }
    }
  });

  for (const path of ORDER_PATHS) {
    for (const key of PRECONDITIONS) {
      const rule = path.rules[key];
      if (rule.status === "exempt") continue;
      it(`${path.id}: ${key} is ${rule.status}`, () => {
        const ctx = { closure: closures.get(path.route)! };
        const results = rule.probes.map(p => ({ what: p.what, ok: p.test(ctx) }));
        if (rule.status === "enforced") {
          expect(results.filter(r => !r.ok).map(r => r.what), `${path.route} lost a ${key} check`).toEqual([]);
        } else {
          expect(results.every(r => r.ok),
            `expected-gap ${key} on "${path.id}" now looks fixed (${rule.fixedIn}): change it to enforced`).toBe(false);
        }
      });
    }
  }

  it("probes read real files: every route in the list exists and is scanned", () => {
    for (const path of ORDER_PATHS) {
      expect(sources.includes(path.route), path.route).toBe(true);
      expect(read(path.route).length).toBeGreaterThan(0);
    }
  });
});
