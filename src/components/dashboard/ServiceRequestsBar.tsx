"use client";

import { useServiceRequests } from "@/hooks/useServiceRequests";
import type { ServiceRequest } from "@/lib/types";

interface ServiceRequestsBarProps {
  restaurantId: string;
  initialRequests: ServiceRequest[];
}

/** Rough "how long ago" for a request timestamp — kitchens think in minutes. */
function age(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000);
  return mins < 1 ? "just now" : `${mins}m ago`;
}

/** Open call-waiter / request-bill taps, pinned above the orders grid. */
export default function ServiceRequestsBar({
  restaurantId,
  initialRequests,
}: ServiceRequestsBarProps) {
  const { requests, markDone } = useServiceRequests(restaurantId, initialRequests);

  if (requests.length === 0) return null;

  return (
    <div className="tt-requests-bar" role="status">
      {requests.map(r => (
        <div key={r.id} className="tt-request-chip">
          <span>
            {r.kind === "waiter" ? "🛎️" : "🧾"} <strong>Table {r.table_label}</strong>{" "}
            {r.kind === "waiter" ? "wants a waiter" : "wants the bill"}
            <span className="tt-muted"> · {age(r.created_at)}</span>
          </span>
          <button
            className="tt-btn tt-btn-ghost tt-btn-sm"
            onClick={() => markDone(r.id)}
          >
            Done
          </button>
        </div>
      ))}
    </div>
  );
}
