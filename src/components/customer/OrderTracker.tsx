"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { OrderStatus } from "@/lib/types";
import { useOrderPolling } from "@/hooks/useOrderPolling";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import type { TrackedOrder } from "@/lib/order-tracking";
import { forgetOrder, rememberRecentOrder } from "@/lib/recent-order";
import { useT } from "@/lib/i18n/context";
import { Modal } from "@/components/ui/Modal";
import TrackerBody from "./TrackerBody";
import LanguageToggle from "./LanguageToggle";

const TERMINAL: OrderStatus[] = ["completed", "cancelled"];

interface OrderTrackerProps {
  initialOrder: TrackedOrder;
}

/** Live order tracking screen the diner lands on after paying. */
export default function OrderTracker({ initialOrder }: OrderTrackerProps) {
  const t = useT();
  const router = useRouter();
  const order = useOrderPolling(initialOrder);
  const isDesktop = useIsDesktop();

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

  const content = (
    <div className="tt-track-shell">
      <div className="tt-track-lang">
        <LanguageToggle className="tt-lang-toggle tt-lang-toggle-onink" />
      </div>
      <TrackerBody order={order}>
        <Link href={menuHref} className="tt-btn tt-btn-ghost" style={{ width: "100%" }}>
          {t("tracker.backToMenu")}
        </Link>
      </TrackerBody>
    </div>
  );

  // On a wide screen this is a dialog, not a screen. As a page it was a
  // phone-width column stranded in an empty desktop with the black hero band
  // running off the top edge; in our dialog the same content reads as one
  // card. Dismissing it — Escape, the backdrop, or the button inside — lands
  // on the menu, which is the only place the diner was going next anyway.
  if (isDesktop) {
    return (
      <Modal
        open
        onClose={() => router.push(menuHref)}
        maxWidth={520}
        label={t("tracker.title")}
      >
        <div className="tt-track-dialog">{content}</div>
      </Modal>
    );
  }

  return <div className="tt-root">{content}</div>;
}
