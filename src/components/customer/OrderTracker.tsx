"use client";

import { useEffect } from "react";
import Link from "next/link";
import { orderCode, type OrderStatus } from "@/lib/types";
import { useOrderPolling } from "@/hooks/useOrderPolling";
import type { TrackedOrder } from "@/lib/order-tracking";
import { forgetOrder, rememberRecentOrder } from "@/lib/recent-order";
import { useT } from "@/lib/i18n/context";
import OrderStatusTimeline from "./OrderStatusTimeline";
import TrackedItemsCard from "./TrackedItemsCard";
import LanguageToggle from "./LanguageToggle";
import {
  StatusPreparingIcon,
  StatusReadyIcon,
  StatusReceivedIcon,
} from "@/components/ui/icons";

const TERMINAL: OrderStatus[] = ["completed", "cancelled"];

/** Collapse the full order status into the three stages the diner sees. */
function toDisplayStatus(status: OrderStatus): OrderStatus {
  if (status === "completed") return "ready";
  if (status === "pending_payment") return "received";
  return status;
}

const HERO: Record<string, { headlineKey: string; Glyph: typeof StatusReadyIcon }> = {
  ready: { headlineKey: "tracker.ready", Glyph: StatusReadyIcon },
  preparing: { headlineKey: "tracker.preparing", Glyph: StatusPreparingIcon },
  received: { headlineKey: "tracker.received", Glyph: StatusReceivedIcon },
};

interface OrderTrackerProps {
  initialOrder: TrackedOrder;
}

/** Live order tracking screen the diner lands on after paying. */
export default function OrderTracker({ initialOrder }: OrderTrackerProps) {
  const t = useT();
  const order = useOrderPolling(initialOrder);
  const status = toDisplayStatus(order.status);
  const hero = HERO[status] ?? HERO.received;

  // Back to the same menu the order came from (table route if it had a table).
  const menuHref = `/r/${order.restaurant_id}${
    order.table_id ? `/t/${order.table_id}` : ""
  }`;

  // Remember this order so the menu can offer a way back to its status — and
  // forget it once it's done, so a stale "track your order" link disappears.
  useEffect(() => {
    if (TERMINAL.includes(order.status)) forgetOrder(order.restaurant_id);
    else rememberRecentOrder(order.restaurant_id, order.id);
  }, [order.restaurant_id, order.id, order.status]);

  return (
    <div className="tt-root">
      <div className="tt-track-hero" style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: 16, right: 16 }}>
          <LanguageToggle />
        </div>
        <hero.Glyph size={46} weight="duotone" />
        <h2 className="tt-serif" style={{ margin: 0, fontSize: 22 }}>
          {t(hero.headlineKey)}
        </h2>
        <div className="tt-sage" style={{ fontSize: 13, marginTop: 4 }}>
          {orderCode(order.id)}
        </div>
      </div>

      <div style={{ padding: 20 }}>
        <OrderStatusTimeline status={status} tableLabel={order.table_label} />
        <TrackedItemsCard
          items={order.items}
          total={order.total}
          currency={order.currency}
        />
        <Link href={menuHref} className="tt-btn tt-btn-ghost" style={{ width: "100%" }}>
          {t("tracker.backToMenu")}
        </Link>
      </div>
    </div>
  );
}
