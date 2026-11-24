# Auth email templates (Supabase)

Supabase sends the sign-up, invitation, password-reset and email-change
emails. These templates:

- are written in **Spanish or English**, switched on `user_metadata.locale`,
  which the app saves at signup, staff invite and admin-created logins;
  anyone without it gets Spanish;
- link to **tabletap.shop** (`/auth/confirm`), never to `…supabase.co`. A link
  to another domain than the sender's is a strong spam signal;
- open a page with one button. Mail scanners (Outlook Safe Links) open links
  to check them, and a link that spent its token on open was dead before the
  person clicked;
- put the token and its type after `#` so they stay out of the request URL.
  The browser clears the fragment before the person confirms with a POST.

## Paste them (production project → Authentication → Emails → Templates)

| Supabase template | File | Subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `{{ if and .Data.locale (eq .Data.locale "en") }}Confirm your TableTap email{{ else }}Confirma tu correo de TableTap{{ end }}` |
| Invite user | `invite-user.html` | `{{ if and .Data.locale (eq .Data.locale "en") }}You're invited to TableTap{{ else }}Te invitaron a TableTap{{ end }}` |
| Reset password | `reset-password.html` | `{{ if and .Data.locale (eq .Data.locale "en") }}Reset your TableTap password{{ else }}Restablece tu contraseña de TableTap{{ end }}` |
| Change email address | `change-email.html` | `{{ if and .Data.locale (eq .Data.locale "en") }}Confirm your new TableTap email{{ else }}Confirma tu nuevo correo de TableTap{{ end }}` |

Deploy the fragment-aware confirmation page before replacing the templates.
For each email, open the template, replace **Subject** with the text in the table,
replace the **Message body** with the whole file, **Save**.

After saving, send yourself a password reset from `tabletap.shop/login`. If the
subject arrives with `{{ if …` written in it, the subject field does not run
conditions: use the Spanish subject alone.

Magic link and Reauthentication are not used by the app; leave them.
