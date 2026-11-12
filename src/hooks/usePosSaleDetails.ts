"use client";

import type { SelectedCard } from "@/components/dashboard/loyalty/AttachCard.react-component";
import { useState } from "react";

/**
 * Who the sale is for and what goes with it — asked once, at the moment the
 * cashier is already speaking to them: a name to call out, a note for the
 * kitchen, a tip, and where the receipt goes, or that they want none.
 */
export function usePosSaleDetails() {
  const [loyaltyCard, setLoyaltyCard] = useState<SelectedCard | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  // The customer waved the ticket away. Very common on a sale that is handed
  // over as it is rung up — a bottle of water does not need paperwork — and
  // the till should not print one nobody is going to take.
  const [noTicket, setNoTicket] = useState(false);
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  // The terminal voucher's reference, on a card sale. Optional.
  const [terminalRef, setTerminalRef] = useState("");

  /** Ready for the next customer. */
  function reset(): void {
    setLoyaltyCard(null);
    setCustomerName("");
    setEmail("");
    setNote("");
    setNoTicket(false);
    setTipPct(0);
    setTipCustom(null);
    setTerminalRef("");
  }

  return {
    loyaltyCard,
    setLoyaltyCard,
    customerName,
    setCustomerName,
    email,
    setEmail,
    note,
    setNote,
    noTicket,
    setNoTicket,
    tipPct,
    setTipPct,
    tipCustom,
    setTipCustom,
    terminalRef,
    setTerminalRef,
    reset,
  };
}

export type PosSaleDetails = ReturnType<typeof usePosSaleDetails>;
