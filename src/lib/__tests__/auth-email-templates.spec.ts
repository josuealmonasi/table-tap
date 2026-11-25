import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

const dir = "docs/auth-email-templates";
const links = {
  "change-email.html": ["/dashboard/profile", "email_change"],
  "confirm-signup.html": ["/signup/complete", "email"],
  "invite-user.html": ["/reset-password", "invite"],
  "reset-password.html": ["/reset-password", "recovery"],
};

it("lists every auth email template", () => {
  expect(readdirSync(dir).filter(f => f.endsWith(".html")).sort()).toEqual(Object.keys(links));
});

it.each(Object.entries(links))("puts the token in both language links' fragments in %s", (file, [next, type]) => {
  const html = readFileSync(`${dir}/${file}`, "utf8");
  expect(html).not.toMatch(/supabase\.co|ConfirmationURL|[?&]token_hash=/);
  const href = `{{ .SiteURL }}/auth/confirm?next=${next}#token_hash={{ .TokenHash }}&amp;type=${type}`;
  expect(html.split(`href="${href}"`)).toHaveLength(3);
  expect(html).toContain('{{ if and .Data.locale (eq .Data.locale "en") }}');
  expect(html).toContain("{{ else }}");
});

it("signup, invites and admin-created logins record the language the emails use", () => {
  for (const f of ["src/app/api/signup/confirm/route.ts", "src/lib/staff-invite.ts", "src/app/api/admin/users/route.ts"]) {
    expect(readFileSync(f, "utf8"), f).toMatch(/user_metadata: \{ locale/);
  }
});

it("password placeholders state the same minimum the forms enforce", async () => {
  const { PASSWORD_MIN } = await import("@/lib/password");
  const { messagesFor, translate } = await import("@/lib/i18n");
  for (const locale of ["es", "en"] as const) {
    for (const key of ["auth.passwordMinPlaceholder", "auth.newPasswordPlaceholder"]) {
      expect(translate(messagesFor(locale), key), `${locale} ${key}`).toContain(String(PASSWORD_MIN));
    }
  }
});
