"use client";

import Breadcrumb from "@/components/layout/Breadcrumb";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import type { LoyaltyProgram } from "@/lib/loyalty/server";
import ProgramForm from "./ProgramForm";
import CardLookup from "./CardLookup";
import StampCard from "./StampCard";

interface LoyaltyAdminProps {
  program: LoyaltyProgram;
}

/**
 * The visit card, run by the owner and the managers: the program on one side,
 * any card looked up on the other — with every visit, who stamped it, and a
 * way to take back today's stamp given by mistake. The scanner is here too,
 * once the card is switched on, so the page that explains it can use it.
 */
export default function LoyaltyAdmin({ program }: LoyaltyAdminProps) {
  return (
    <ConfirmProvider>
      <div className="tt-dash">
        <div className="container">
          <header className="tt-dash-head">
            <Breadcrumb trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.loyalty" }]} />
            {program.active && <StampCard buttonClass="tt-btn tt-btn-primary tt-btn-sm" />}
          </header>
          <div className="tt-cols">
            <ProgramForm program={program} />
            <CardLookup />
          </div>
        </div>
      </div>
    </ConfirmProvider>
  );
}
