"use client";

import { useT } from "@/lib/i18n/context";
import type { PhoneMembership } from "@/hooks/useTableMembership";
import type { PendingPhone } from "@/lib/table-member-requests";
import PhoneRequest from "@/components/table-membership/phone-request";

interface TableJoinNoticeProps {
  restaurantId: string;
  state: PhoneMembership | null;
  pending: PendingPhone[];
  error: boolean;
  pendingError?: boolean;
  refresh: () => void;
}

export default function TableJoinNotice({ restaurantId, state, pending, error, pendingError = false, refresh }: TableJoinNoticeProps) {
  const t = useT();
  const waiting = !state || state.status === "pending" || state.status === "rejected";
  return <>
    {waiting && (
      <div className="tt-closed-banner" role="status">
        <strong>{t(state?.status === "rejected" ? "join.rejected" : state?.status === "pending" ? "join.waiting" : "join.checking")}</strong>
        {state?.status === "pending" && <>
          <p>{t("join.explain")}</p>
          <p>{t("join.phone", { code: (state.diner ?? "").slice(0, 6).toUpperCase() })}</p>
        </>}
        {state?.status === "rejected" && <p>{t("join.rejectedHelp")}</p>}
      </div>
    )}
    {error && <p role="status">{t("join.failed")}</p>}
    {!error && pendingError && <p role="status">{t("join.requestsFailed")}</p>}
    {pending.map(phone => <PhoneRequest key={phone.id} restaurantId={restaurantId} phone={phone} onDecided={refresh} />)}
  </>;
}
