import { getLocale } from "@/lib/i18n/server";
import { messagesFor, translate } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const KINDS = ["signup", "invite", "recovery", "email_change"] as const;
type Kind = (typeof KINDS)[number];

/**
 * /auth/confirm — where the auth emails link. One button, which POSTs the
 * token to /auth/callback. Nothing here spends the token: a mail scanner that
 * opens the link sees this page and leaves the token for the person.
 */
export default async function ConfirmPage({ searchParams }: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const p = await searchParams;
  const m = messagesFor(await getLocale());
  const t = (key: string) => translate(m, key);
  // `email` is how a signup confirmation arrives in the token_hash format.
  const type = p.type === "email" ? "email" : (KINDS as readonly string[]).includes(p.type ?? "") ? (p.type as Kind) : "email";
  const kind: Kind = type === "email" ? "signup" : type;
  const usable = typeof p.token_hash === "string" && /^[A-Za-z0-9_-]{8,}$/.test(p.token_hash);
  return (
    <div className="tt-login"><div className="container"><div className="tt-login-card">
      <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>{t(`authConfirm.title.${kind}`)}</h1>
      {usable ? (
        <form method="post" action="/auth/callback">
          <p className="tt-muted" style={{ marginTop: 0 }}>{t(`authConfirm.body.${kind}`)}</p>
          <input type="hidden" name="token_hash" value={p.token_hash} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="next" value={p.next ?? ""} />
          <button className="tt-btn tt-btn-primary" style={{ width: "100%" }}>{t(`authConfirm.button.${kind}`)}</button>
        </form>
      ) : (
        <p className="tt-field-error" role="alert">{t("authConfirm.broken")}</p>
      )}
    </div></div></div>
  );
}
