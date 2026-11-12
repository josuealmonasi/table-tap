"use client";
import { useEffect, useState } from "react";
import { readDeviceCard } from "@/lib/loyalty/device";
import { normalizeCode } from "@/lib/loyalty/code";
import AttachCard from "@/components/dashboard/loyalty/AttachCard.react-component";

interface DeviceBillCardProps {
  restaurantId: string;
  tableId: string;
  sessionId: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}
export default function DeviceBillCard({ restaurantId, tableId, sessionId, disabled, onBusy }: DeviceBillCardProps) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const card = readDeviceCard(restaurantId);
    setCode(card && "code" in card ? normalizeCode(card.code) : null);
  }, [restaurantId]);
  return code ? <AttachCard key={sessionId} active target={{ restaurantId, tableId, sessionId }} deviceCode={code} disabled={disabled} onBusy={onBusy} /> : null;
}
