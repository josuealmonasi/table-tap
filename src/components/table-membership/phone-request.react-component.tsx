"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import type { PendingPhone } from "@/lib/table-member-requests";

interface PhoneRequestProps {
  restaurantId: string;
  phone: PendingPhone;
  onDecided: () => void;
}

/** The short code lets staff ask the person in front of them which phone is theirs. */
export default function PhoneRequest({ restaurantId, phone, onDecided }: PhoneRequestProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/table-membership", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, tableId: phone.tableId, memberId: phone.id, approve }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? t("join.failed"));
      } else onDecided();
    } catch { setError(t("join.failed")); }
    finally { setBusy(false); }
  }
  function approve() { void decide(true); }
  function reject() { void decide(false); }
  return (
    <div className="tt-request-chip" style={{ flexWrap: "wrap" }}>
      <span>
        <strong>{t("dash.tableN", { label: phone.tableLabel })}</strong>{" · "}
        {t("join.phone", { code: phone.id.slice(0, 6).toUpperCase() })}{" · "}{t("join.ask")}
      </span>
      <div className="tt-row" style={{ flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy} onClick={approve}>{t("join.approve")}</button>
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy} onClick={reject}>{t("join.reject")}</button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
