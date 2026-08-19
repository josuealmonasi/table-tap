"use client";

import { useEffect, useState } from "react";
import type { OrderStatus } from "@/lib/types";
import type { TrackedOrder } from "@/lib/order-tracking";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { forgetOrder, rememberRecentOrder } from "@/lib/recent-order";
import { useT } from "@/lib/i18n/context";
import { Modal } from "@/components/ui/Modal";
import TrackerBody from "./TrackerBody";
import TrackerSkeleton from "./TrackerSkeleton";

const TERMINAL: OrderStatus[] = ["completed", "cancelled"];
const POLL_MS = 5000;

/**
 * The live order status, over the menu it came from.
 *
 * It is layered rather than routed to: a diner watching their food cook has
 * not left the restaurant, and taking the menu away to show three dots was
 * how a dialog ended up floating on an empty page. On a phone the overlay is
 * opaque and full-bleed, so it still reads as a screen; on a wide one it is
 * our dialog, with the menu visible behind it.
 */
export default function TrackerOverlay({
  orderId,
  initialOrder = null,
  onClose,
}: {
  orderId: string;
  /** Present when the server already loaded it — the post-payment landing. */
  initialOrder?: TrackedOrder | null;
  onClose: () => void;
}) {
  const t = useT();
  const isDesktop = useIsDesktop();
  const [order, setOrder] = useState<TrackedOrder | null>(initialOrder);

  // One fetch when opened from the menu, then a poll until the food is out.
  // Orders can't be read with the publishable key, so this route is the only
  // way to ask — polling it is the secure equivalent of a subscription.
  useEffect(() => {
    let active = true;

    async function read(): Promise<TrackedOrder | null> {
      try {
        const res = await fetch(`/api/order-status?id=${orderId}`);
        if (!res.ok) return null;
        const next = (await res.json()) as TrackedOrder;
        if (active) setOrder(next);
        return next;
      } catch {
        return null; // transient: keep what we have and try again next tick
      }
    }

    if (!order) void read();
    const timer = setInterval(() => {
      if (!order || !TERMINAL.includes(order.status)) void read();
    }, POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [orderId, order]);

  // Remember this order so the menu keeps offering a way back to it — and
  // forget it once it's done, so a stale "track your order" link disappears.
  useEffect(() => {
    if (!order) return;
    // Keyed by the table the order was placed at, so it is offered back only
    // at that table.
    if (TERMINAL.includes(order.status)) forgetOrder(order.restaurant_id, order.table_id);
    else rememberRecentOrder(order.restaurant_id, order.id, order.table_id);
  }, [order]);

  // No language control of its own: the menu behind carries one, and a second
  // copy of it inside the dialog is just clutter.
  const content = (
    <div className="tt-track-shell">
      {order ? (
        <TrackerBody order={order}>
          <button
            type="button"
            className="tt-btn tt-btn-ghost"
            style={{ width: "100%" }}
            onClick={onClose}
          >
            {t("tracker.backToMenu")}
          </button>
        </TrackerBody>
      ) : (
        <TrackerSkeleton />
      )}
    </div>
  );

  if (isDesktop) {
    return (
      <Modal open onClose={onClose} maxWidth={520} label={t("tracker.title")}>
        <div className="tt-track-dialog">{content}</div>
      </Modal>
    );
  }

  return (
    <div className="tt-detail-overlay" onClick={onClose}>
      <div className="tt-detail-panel" onClick={e => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
