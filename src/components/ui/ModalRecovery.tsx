"use client";

import { createContext, type ReactNode } from "react";

interface ModalRecovery {
  blocked: boolean;
  notice: ReactNode;
}

/** A failed read blocks forms, but its retry must remain inside their dialog. */
export const ModalRecoveryContext = createContext<ModalRecovery | null>(null);
