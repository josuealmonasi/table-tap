"use client";

import { useServiceRequests } from "@/hooks/useServiceRequests";
import type { ServiceRequest } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import { BillIcon, CallWaiterIcon, StatusReadyIcon } from "@/components/ui/icons";
import type { ReadyTable } from "@/lib/ready-tables";
import { useEffect, useState } from "react";
import SettleTableDialog from "./SettleTableDialog";

interface ServiceRequestsBarProps {
  restaurantId: string;
  initialRequests: ServiceRequest[];
  currency: string;
  /** Only the floor settles bills — the kitchen sees the chip, not the money. */
  canSettle: boolean;
  /** Refreshes the board after a table is settled. */
  onSettled?: () => void;
  canApprove: boolean;
  /**
   * Food that is cooked and waiting on the pass, a trip at a time.
   *
   * The kitchen's job ends at `ready` and the floor's begins, and nothing used
   * to say so — a waiter had to keep looking across the room at a board, which
   * is the thing the board was meant to save them.
   */
  ready?: ReadyTable[];
  /** Handed over: every ticket on that trip is finished. */
  onDelivered?: (orderIds: string[]) => void;
}

/** Open call-waiter / request-bill taps, pinned above the orders grid. */
export default function ServiceRequestsBar({
  restaurantId,
  canSettle,
  initialRequests,
  currency,
  onSettled,
  canApprove,
  ready = [],
  onDelivered,
}: ServiceRequestsBarProps) {
  const t = useT();
  const { requests, markDone } = useServiceRequests(restaurantId, initialRequests);
  // The table whose bill the waiter is collecting, if any.
  const [settling, setSettling] = useState<ServiceRequest | null>(null);

  // Measured after mount, not during render: the server says "5m ago" and the
  // browser hydrating a moment later says "6m", which React reports as a
  // mismatch. Re-read every half minute so the wait climbs on screen.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  // How long the table has been waiting. Minutes for the first hour, because
  // that is how a floor thinks; hours and days after that, because a request
  // left open since Tuesday printed as "11495m ago" and read as a glitch.
  const age = (createdAt: string): string => {
    if (now === null) return "";
    const mins = Math.floor((now - new Date(createdAt).getTime()) / 60_000);
    if (mins < 1) return t("orders.justNow");
    if (mins < 60) return t("orders.minsAgo", { m: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("orders.hoursAgo", { h: hours });
    return t("orders.daysAgo", { d: Math.floor(hours / 24) });
  };

  const carrying = onDelivered ? ready : [];
  if (requests.length === 0 && carrying.length === 0) return null;

  return (
    <div className="tt-requests-bar" role="status">
      {/* Above the raised hands: a plate under a lamp is going cold while
          somebody who has already been served waits for a menu. */}
      {carrying.map(trip => (
        <div key={trip.key} className="tt-request-chip tt-request-ready">
          <span>
            <StatusReadyIcon size={14} weight="bold" />{" "}
            <strong>
              {trip.label
                ? t("dash.tableN", { label: trip.label })
                : [trip.code, trip.customerName].filter(Boolean).join(" · ")}
            </strong>{" "}
            {t("orders.readyToCarry", { n: trip.dishes })}
            <span className="tt-muted"> · {age(trip.since)}</span>
          </span>
          <button
            className="tt-btn tt-btn-primary tt-btn-sm"
            onClick={() => onDelivered?.(trip.orderIds)}
          >
            {t("orders.delivered")}
          </button>
        </div>
      ))}

      {requests.map(r => (
        <div key={r.id} className="tt-request-chip">
          <span>
            {r.kind === "waiter" ? (
              <CallWaiterIcon size={14} weight="bold" />
            ) : (
              <BillIcon size={14} weight="bold" />
            )}{" "}
            <strong>{t("dash.tableN", { label: r.table_label ?? "" })}</strong>{" "}
            {t(
              r.kind === "waiter"
                ? "orders.wantsWaiter"
                : r.kind === "pay"
                  ? "settle.wantsToPay"
                  : "orders.wantsBill",
            )}
            <span className="tt-muted"> · {age(r.created_at)}</span>
          </span>
          {/* A table waiting to pay needs the bill, not a "done" button —
              pressing done would clear the request and leave the money
              uncollected. */}
          {r.kind === "pay" && r.table_id && canSettle ? (
            <button
              className="tt-btn tt-btn-primary tt-btn-sm"
              onClick={() => setSettling(r)}
            >
              {t("settle.open")}
            </button>
          ) : (
            <button
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={() => markDone(r.id)}
            >
              {t("orders.requestDone")}
            </button>
          )}
        </div>
      ))}

      {settling?.table_id && (
        <SettleTableDialog
          open
          onClose={() => setSettling(null)}
          restaurantId={restaurantId}
          tableId={settling.table_id}
          tableLabel={settling.table_label ?? ""}
          currency={currency}
          canApprove={canApprove}
          onSettled={() => {
            // Drop the chip here as well as relying on the realtime update:
            // the waiter is standing at the table and the request is answered,
            // so it must not still be asking on their own screen.
            markDone(settling.id);
            onSettled?.();
          }}
        />
      )}
    </div>
  );
}
