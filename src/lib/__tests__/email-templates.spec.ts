import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "docs/email-templates");

const templates: Record<string, string[]> = {
  invite: ["{{ .ConfirmationURL }}", "{{ .SiteURL }}"],
  recovery: ["{{ .ConfirmationURL }}", "{{ .Email }}"],
  confirmation: ["{{ .ConfirmationURL }}", "{{ .Email }}"],
  "email-change": ["{{ .ConfirmationURL }}", "{{ .Email }}", "{{ .NewEmail }}"],
  "magic-link": ["{{ .ConfirmationURL }}", "{{ .Email }}"],
};

// Phrases from Supabase's English defaults (and generic English copy).
const english = [
  "You have been invited",
  "Accept the invite",
  "Accept the Invite",
  "Follow this link",
  "Reset Password",
  "Reset password",
  "Confirm your signup",
  "Confirm your mail",
  "Confirm Email Change",
  "Confirm change of email",
  "Magic Link",
  "Your Magic Link",
  "Log In",
  "Sign Up",
  "If you didn",
  "click the link below",
  "Click the link",
];

describe("auth email templates", () => {
  for (const [name, vars] of Object.entries(templates)) {
    const html = readFileSync(join(dir, `${name}.html`), "utf8");

    it(`${name} contains its required Go variables`, () => {
      for (const v of vars) expect(html).toContain(v);
    });

    it(`${name} has no English default phrase and is Spanish`, () => {
      for (const phrase of english) expect(html).not.toContain(phrase);
      expect(html).toContain('lang="es-MX"');
      expect(html).toContain("ignora este correo");
    });

    it(`${name} uses the app palette with a single button`, () => {
      expect(html).toContain("#0e6e6e");
      expect(html).toContain("#f2f2f3");
      expect(html).toContain("max-width:480px");
      expect(html).not.toMatch(/<img\b/);
      expect(html.match(/display:inline-block/g)).toHaveLength(1);
    });
  }

  it("invite says a restaurant invites and the link sets the password", () => {
    const html = readFileSync(join(dir, "invite.html"), "utf8");
    expect(html).toContain("Un restaurante en TableTap te invitó");
    expect(html).toContain("establece");
  });
});
