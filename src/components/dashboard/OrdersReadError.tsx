"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";

interface OrdersReadErrorProps {
  orders: boolean;
  requests: boolean;
}

/** A failed feed must never tell the floor that nobody is waiting. */
export default function OrdersReadError({ orders, requests }: OrdersReadErrorProps) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div role="alert">
      {orders && <p>{t("orders.readFailed")}</p>}
      {requests && <p>{t("orders.requestsReadFailed")}</p>}
      <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={pending}
        onClick={() => startTransition(() => router.refresh())}>
        {t("fallback.retry")}
      </button>
    </div>
  );
}
