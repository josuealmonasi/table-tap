"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";
import { useT } from "@/lib/i18n/context";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/**
 * Asks an owner to accept the terms before they carry on in the dashboard.
 *
 * Shown to accounts that predate the terms and to anyone whose accepted
 * version is out of date. Deliberately not dismissible — an agreement you can
 * click away is not one — but it holds up the dashboard only. The diner's menu
 * is untouched: whatever we need to settle with the owner is not the business
 * of somebody sitting at a table waiting for food.
 */
export default function TermsGate() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  // The dashboard, and nowhere else.
  //
  // An owner checking their own QR on their phone is logged in, so without
  // this the modal lands on top of the customer menu — the one screen it must
  // never touch. The documents themselves are PDFs, so opening one leaves the
  // app entirely and this question stays where it belongs.
  if (!pathname.startsWith("/dashboard")) return null;

  async function accept(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/legal/accept", { method: "POST" });
      if (!res.ok) {
        toast(t("notice.generic"), "error");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      toast(t("notice.network"), "error");
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={() => {}} maxWidth={460} label={t("auth.termsChanged")}>
      <h3 className="tt-serif" style={{ marginTop: 0 }}>
        {t("auth.termsChanged")}
      </h3>
      <p className="tt-muted" style={{ fontSize: 14 }}>
        {t("auth.termsChangedBody")}
      </p>

      <div className="tt-legal-links">
        <a href={TERMS_PATH} target="_blank" rel="noreferrer">
          {t("auth.termsLink")}
        </a>
        <a href={PRIVACY_PATH} target="_blank" rel="noreferrer">
          {t("auth.privacyLink")}
        </a>
      </div>

      <button
        className="tt-btn tt-btn-primary"
        style={{ width: "100%", marginTop: 16 }}
        disabled={busy}
        onClick={accept}
      >
        {t("auth.termsAcceptNow")}
      </button>
    </Modal>
  );
}
