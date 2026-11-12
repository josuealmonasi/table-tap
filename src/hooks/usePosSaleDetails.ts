"use client";

import type { SelectedCard } from "@/components/dashboard/loyalty/AttachCard.react-component";
import { useCardEmail } from "./useCardEmail";
import { useState } from "react";

/**
 * Who the sale is for and what goes with it — asked once, at the moment the
 * cashier is already speaking to them: a name to call out, a note for the
 * kitchen, a tip, and where the receipt goes, or that they want none.
 */
export function usePosSaleDetails() {
  const [loyaltyCard, selectCard] = useState<SelectedCard | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [skipTicketEmail, setSkipTicketEmail] = useState(false);
  const [saveCardEmail, setSaveCardEmail] = useState(false);
  const [emailConsent, setEmailConsent] = useState(false);
  const contact = useCardEmail(loyaltyCard?.code);
  const [email, changeEmail] = useState("");
  const [note, setNote] = useState("");
  // The customer waved the ticket away. Very common on a sale that is handed
  // over as it is rung up — a bottle of water does not need paperwork — and
  // the till should not print one nobody is going to take.
  const [noTicket, setNoTicket] = useState(false);
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  // The terminal voucher's reference, on a card sale. Optional.
  const [terminalRef, setTerminalRef] = useState("");

  function setLoyaltyCard(card: SelectedCard | null): void {
    selectCard(card); setSkipTicketEmail(false); setSaveCardEmail(false); setEmailConsent(false);
  }
  function setEmail(value: string): void {
    changeEmail(value); setEmailConsent(false);
  }

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
    cardEmail: contact.data?.email,
    cardEmailError: Boolean(contact.error),
    skipTicketEmail, setSkipTicketEmail,
    saveCardEmail, setSaveCardEmail,
    emailConsent, setEmailConsent,
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
