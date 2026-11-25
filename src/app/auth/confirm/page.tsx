"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

const KINDS = ["signup", "invite", "recovery", "email_change", "magiclink"] as const;

interface ConfirmationLink {
  tokenHash: string | null;
  type: string | null;
  next: string;
}

/**
 * /auth/confirm — where the auth emails link. One button, which POSTs the
 * token to /auth/callback. Nothing here spends the token: a mail scanner that
 * opens the link sees this page and leaves the token for the person.
 */
export default function ConfirmPage() {
  const t = useT();
  const [link, setLink] = useState<ConfirmationLink>();

  useEffect(() => {
    const { hash, pathname, search } = window.location;
    const fragment = new URLSearchParams(hash.slice(1));
    const tokenHash = fragment.get("token_hash");
    const type = fragment.get("type");
    if (hash) window.history.replaceState(null, "", pathname + search);

    const next = new URLSearchParams(search).get("next") ?? "";
    // The second effect run in Strict Mode sees the already-cleared URL.
    setLink(current => current ?? { tokenHash, type, next });
  }, []);

  if (!link) return null;

  // Supabase sends signup confirmations with type `email`.
  const type = KINDS.find(kind => kind === link.type) ?? "email";
  const kind = type === "email" ? "signup" : type;
  const usable = link.tokenHash !== null && /^[A-Za-z0-9_-]{8,}$/.test(link.tokenHash);
  return (
    <div className="tt-login"><div className="container"><div className="tt-login-card">
      <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>{t(`authConfirm.title.${kind}`)}</h1>
      {usable ? (
        <form method="post" action="/auth/callback">
          <p className="tt-muted" style={{ marginTop: 0 }}>{t(`authConfirm.body.${kind}`)}</p>
          <input type="hidden" name="token_hash" value={link.tokenHash ?? ""} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="next" value={link.next} />
          <button className="tt-btn tt-btn-primary" style={{ width: "100%" }}>{t(`authConfirm.button.${kind}`)}</button>
        </form>
      ) : (
        <p className="tt-field-error" role="alert">{t("authConfirm.broken")}</p>
      )}
    </div></div></div>
  );
}
