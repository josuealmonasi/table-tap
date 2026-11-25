import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { confirmationMail, newToken, tokenHash, validToken, MAX_DIGEST_RECIPIENTS, CONFIRM_DAYS } from "@/lib/digest-recipients";

/** Extra recipients of the daily digest (owner decisions 2026-11-25). */
const sql = readFileSync("supabase/schema.sql", "utf8");

it("tokens are 32 random bytes, the confirm token is stored only as its hash", () => {
  const a = newToken();
  expect(validToken(a)).toBe(true);
  expect(validToken(newToken())).toBe(true);
  expect(a).not.toBe(newToken());
  expect(validToken("short")).toBe(false);
  expect(tokenHash(a)).toMatch(/^[0-9a-f]{64}$/);
  expect(sql).toContain("confirm_token_hash text unique");
});

it("at most five per restaurant, counted under the restaurant's lock, one row per address", () => {
  expect(MAX_DIGEST_RECIPIENTS).toBe(5);
  const fn = sql.slice(sql.indexOf("function public.add_digest_recipient_v1(")).split("end; $$;")[0];
  expect(fn.indexOf("for update")).toBeLessThan(fn.indexOf(">= 5"));
  expect(sql).toContain("create unique index if not exists digest_recipients_address on digest_recipients (restaurant_id, lower(email));");
});

it("nothing but the server touches the table, and unconfirmed addresses expire after the promised days", () => {
  expect(sql).toContain("revoke all on digest_recipients from anon, authenticated, public;");
  expect(CONFIRM_DAYS).toBe(7);
  expect(sql).toContain("status = 'pending' and confirm_sent_at < now() - interval '7 days'");
  expect(readFileSync("src/lib/legal/privacy-es.json", "utf8")).toContain("Un correo que no se confirma en siete días se elimina.");
});

it("the confirmation email names the restaurant, carries the link and says how to ignore it, in both languages", () => {
  for (const locale of ["es", "en"]) {
    const mail = confirmationMail({ restaurant: "Demo <Bistro>", link: "https://tabletap.shop/digest/confirm?t=x" }, locale);
    expect(mail.subject).toContain("Demo <Bistro>");
    expect(mail.html).toContain("Demo &lt;Bistro&gt;");
    expect(mail.text).toContain("https://tabletap.shop/digest/confirm?t=x");
    expect(mail.text).toContain("7");
  }
});

it("only the owner manages them", () => {
  const route = readFileSync("src/app/api/settings/digest-recipients/route.ts", "utf8");
  expect(route.match(/const actor = await actingOwner\(\);/g)).toHaveLength(4);
  expect(route).not.toMatch(/actingManager|actingStaff/);
});
