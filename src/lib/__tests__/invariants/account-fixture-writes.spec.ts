import { expect, it } from "vitest";
import { read, walkAll } from "./helpers";
import { fixtureBypasses } from "./account-fixture-writes";

const history = "scripts/account-journal-probe-fixtures.mjs";
// The deferred-check attack probe writes a raw account receipt on purpose: it
// proves the journal check refuses one. It runs only inside the dev probe,
// which refuses production — the last two specs below hold it to that.
const attackProbe = "scripts/account-journal-deferred-probe.mjs";
const scripts = walkAll("scripts").filter(file => file.endsWith(".mjs") && !file.includes("/__tests__/") && file !== attackProbe);

it("the raw-write attack probe is reached only from the probe that refuses production", () => {
  const importers = walkAll("scripts").concat(walkAll("src"))
    .filter(file => /\.(m?js|tsx?)$/.test(file) && file !== attackProbe && !file.includes("/__tests__/")
      && read(file).includes("account-journal-deferred-probe"));
  expect(importers).toEqual(["scripts/probe-account-journal.mjs"]);
  expect(read("scripts/probe-account-journal.mjs")).toContain('throw new Error("refusing to probe production or an unknown database")');
});

it("gate fixtures use writers for account charges, receipts and adjustments", () => {
  expect(scripts.flatMap(file => fixtureBypasses(read(file), file === history).map(failure => `${file}:${failure}`))).toEqual([]);
});

it.each([
  'admin.from("orders").update({ account_id: owner }).eq("id", id);',
  'admin.from("orders").update({ charged_at: now, charged_by: "fake" });',
  'const patch = { account_id: owner }; admin.from("orders").update(patch);',
  'const patch = { account_id: owner }; admin.from("orders").insert({ ...patch });',
  'admin.from("payments").insert({ account_id: owner, amount: 40 });',
  'admin.from("payments").delete().in("account_id", ids);',
  'admin.from("payments").delete().eq("order_id", id);',
  'admin.from("order_adjustments").delete().eq("order_id", id);',
  'db.query("insert into orders(id, account_id, charged_at) values($1,$2,now())");',
  'db.query("update orders set account_id=null where id=$1");',
  'db.query("insert into payments(restaurant_id, account_id, amount) values($1,$2,40)");',
  'db.query("delete from payments where order_id=$1");',
  'bulkInsert(db, "orders", ["restaurant_id", "account_id"], rows);',
])("sabotage catches a planted direct write: %s", badLine => {
  expect(fixtureBypasses(`// realistic fixture\n${badLine}`)).not.toEqual([]);
});

it("allows readers, real writers and explicitly non-account receipt cleanup", () => {
  expect(fixtureBypasses(`
    admin.from("orders").select("account_id, charged_at");
    admin.rpc("account_charge_v2", { p_account: owner });
    admin.rpc("account_settle_currency_v1", { p_account: owner });
    admin.from("payments").delete().is("account_id", null).eq("order_id", id);
    db.query("update orders set status='preparing' where account_id=$1");
    // admin.from("orders").update({ account_id: owner });
  `)).toEqual([]);
});

it("bounds the historical exception to two dormant import rows", () => {
  const source = read(history);
  expect(fixtureBypasses(source)).toHaveLength(1);
  expect(source).toContain("assert.equal(rows[0].journal_started_at, null)");
  expect(source).toContain("assert.equal(rows[0].account_journal_started_at, null)");
  expect(source).toContain("c.journal_started_at is null and r.account_journal_started_at is null");
  expect(source).toContain("assert.equal(inserted.rowCount, 1");
  expect(source.match(/await dormantOrder\(/g)).toHaveLength(2);
  expect(source).not.toContain("export async function dormantOrder");
  for (const file of scripts.filter(file => file !== history)) expect(read(file), file).not.toMatch(/\bdormantOrder\b/);
});

it("fresh dev mock accounts are charged by the writer and activated", () => {
  const seed = read("scripts/mock-accounts.mjs"), runner = read("scripts/db.mjs");
  expect(seed).toContain("select account_charge_v2(");
  expect(seed).toContain('if (result.value.outcome !== "charged") throw');
  expect(runner).toMatch(/await seedMock\(client\)[\s\S]*?if \(!isProd\)[\s\S]*?journal-activate\.sql[\s\S]*?query\("commit"\)/);
});
