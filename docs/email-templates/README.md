# Auth email templates (Supabase)

Spanish (Mexico) replacements for Supabase's English default auth emails.
Inline CSS only, 480px card on `#f2f2f3`, Agave `#0e6e6e` button, no images.
Each template uses Supabase's Go variables (`{{ .ConfirmationURL }}`,
`{{ .SiteURL }}`, `{{ .Email }}`, and `{{ .NewEmail }}` for email change).

## Where to paste

Supabase dashboard → Authentication → Emails → Templates. For each row, set the
**Subject** and paste the whole `.html` file into **Message body** (source view).

| Supabase template | File | Subject |
| --- | --- | --- |
| Invite user | `invite.html` | Un restaurante te invitó a TableTap |
| Reset password | `recovery.html` | Restablece tu contraseña de TableTap |
| Confirm sign up | `confirmation.html` | Confirma tu correo en TableTap |
| Change email address | `email-change.html` | Confirma tu nuevo correo en TableTap |
| Magic link | `magic-link.html` | Tu enlace para entrar a TableTap |

## SMTP

Authentication → Emails → SMTP Settings → enable custom SMTP:

- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: a Resend API key (never commit it)
- Sender email: `no-reply@tabletap.shop`
- Sender name: `TableTap`

## Notes

- `{{ .SiteURL }}` is the Auth Site URL; it must be `https://tabletap.shop`.
- `src/lib/email-templates.spec.ts` checks each template has its required
  variable and no English default phrase. Edit templates here, then re-paste.
