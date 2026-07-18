"use client";

import { useServiceRequests } from "@/hooks/useServiceRequests";
import type { ServiceRequest } from "@/lib/types";
import { useT } from "@/lib/i18n/context";

interface ServiceRequestsBarProps {
  restaurantId: string;
  initialRequests: ServiceRequest[];
}

/** Open call-waiter / request-bill taps, pinned above the orders grid. */
export default function ServiceRequestsBar({
  restaurantId,
  initialRequests,
}: ServiceRequestsBarProps) {
  const t = useT();
  const { requests, markDone } = useServiceRequests(restaurantId, initialRequests);

  // Rough "how long ago" — kitchens think in minutes.
  const age = (createdAt: string): string => {
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000);
    return mins < 1 ? t("orders.justNow") : t("orders.minsAgo", { m: mins });
  };

  if (requests.length === 0) return null;

  return (
    <div className="tt-requests-bar" role="status">
      {requests.map(r => (
        <div key={r.id} className="tt-request-chip">
          <span>
            {r.kind === "waiter" ? "🛎️" : "🧾"}{" "}
            <strong>{t("dash.tableN", { label: r.table_label ?? "" })}</strong>{" "}
            {t(r.kind === "waiter" ? "orders.wantsWaiter" : "orders.wantsBill")}
            <span className="tt-muted"> · {age(r.created_at)}</span>
          </span>
          <button
            className="tt-btn tt-btn-ghost tt-btn-sm"
            onClick={() => markDone(r.id)}
          >
            {t("orders.requestDone")}
          </button>
        </div>
      ))}
    </div>
  );
}
