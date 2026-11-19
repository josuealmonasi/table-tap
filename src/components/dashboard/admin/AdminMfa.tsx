"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";

interface Props { mode: "enroll" | "verify" }

/**
 * Two-step verification for the platform admin, with an authenticator app.
 * Enrol: scan the QR (or type the key), then prove it with one code. Verify:
 * the code a password-only session needs before it is treated as the admin.
 */
export default function AdminMfa({ mode }: Props) {
  const t = useT();
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const mfa = createClient().auth.mfa;
      try {
        const { data: list, error: listError } = await mfa.listFactors();
        if (listError) throw listError;
        if (mode === "verify") {
          const factor = list.totp.find(f => f.status === "verified");
          if (!live) return;
          if (factor) setFactorId(factor.id);
          else setError(t("adminMfa.noFactor"));
          return;
        }
        // An enrolment left half-done would block a new one: clear it first.
        for (const f of list.all.filter(f => f.status !== "verified")) await mfa.unenroll({ factorId: f.id });
        const { data, error: enrollError } = await mfa.enroll({ factorType: "totp", friendlyName: `TableTap admin ${Date.now()}` });
        if (enrollError) throw enrollError;
        if (live) { setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret); }
      } catch {
        if (live) setError(t("adminMfa.unavailable"));
      }
    })();
    return () => { live = false; };
  }, [mode, t]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true); setError("");
    try {
      const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (verifyError) { setError(t("adminMfa.wrongCode")); return; }
      router.replace("/dashboard/admin");
      router.refresh();
    } catch {
      setError(t("adminMfa.unavailable"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="tt-login"><div className="container"><div className="tt-login-card">
    <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>{t(mode === "enroll" ? "adminMfa.enrollTitle" : "adminMfa.verifyTitle")}</h1>
    <p className="tt-muted" style={{ marginTop: 0 }}>{t(mode === "enroll" ? "adminMfa.enrollBody" : "adminMfa.verifyBody")}</p>
    {mode === "enroll" && qr && (
      <div style={{ display: "grid", justifyItems: "center", gap: 8, margin: "12px 0" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from Supabase, not a file to optimise */}
        <img src={qr} alt={t("adminMfa.qrAlt")} width={180} height={180} />
        {secret && <p className="tt-muted" style={{ fontSize: 12, margin: 0, overflowWrap: "anywhere", textAlign: "center" }}>{t("adminMfa.secret", { secret })}</p>}
      </div>
    )}
    <form onSubmit={submit}>
      <input className="tt-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
        placeholder={t("adminMfa.codePlaceholder")} aria-label={t("adminMfa.codePlaceholder")} value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, ""))} style={{ marginBottom: 12 }} required />
      <button className="tt-btn tt-btn-primary" style={{ width: "100%" }} disabled={busy || !factorId || code.length !== 6}>
        {t(busy ? "common.saving" : mode === "enroll" ? "adminMfa.turnOn" : "adminMfa.verify")}
      </button>
    </form>
    {error && <p className="tt-field-error" role="alert">{error}</p>}
  </div></div></div>;
}
