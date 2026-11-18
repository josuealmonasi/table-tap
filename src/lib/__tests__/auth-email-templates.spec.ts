import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

const dir = "docs/auth-email-templates";
const files = readdirSync(dir).filter(f => f.endsWith(".html"));

it("every auth email links to our own confirm page, in both languages, never to supabase.co", () => {
  expect(files.sort()).toEqual(["change-email.html", "confirm-signup.html", "invite-user.html", "reset-password.html"]);
  for (const f of files) {
    const html = readFileSync(`${dir}/${f}`, "utf8");
    expect(html, f).not.toMatch(/supabase\.co|ConfirmationURL/);
    expect(html.match(/\{\{ \.SiteURL \}\}\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}/g)?.length, f).toBe(2);
    expect(html, f).toContain('{{ if and .Data.locale (eq .Data.locale "en") }}');
    expect(html, f).toContain("{{ else }}");
  }
});

it("the confirm page only posts, and the callback accepts the post", () => {
  const page = readFileSync("src/app/auth/confirm/page.tsx", "utf8");
  expect(page).toContain('method="post" action="/auth/callback"');
  expect(page).not.toMatch(/verifyOtp|useEffect|requestSubmit/);
  const route = readFileSync("src/app/auth/callback/route.ts", "utf8");
  expect(route).toContain("export async function POST");
});

it("signup, invites and admin-created logins record the language the emails use", () => {
  for (const f of ["src/app/api/signup/route.ts", "src/lib/staff-invite.ts", "src/app/api/admin/users/route.ts"]) {
    expect(readFileSync(f, "utf8"), f).toMatch(/user_metadata: \{ locale/);
  }
});
