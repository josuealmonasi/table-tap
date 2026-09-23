"use client";

import Breadcrumb from "@/components/layout/Breadcrumb";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";
import type { LoyaltyProgram } from "@/lib/loyalty/server";
import type { CardFace } from "@/lib/loyalty/face";
import type { QrGrid } from "@/lib/loyalty/qr-grid";
import CardDownload from "@/components/loyalty/CardDownload";
import ProgramForm from "./ProgramForm";
import ProgramStatus from "./ProgramStatus";
import CardLookup from "./CardLookup";
import StampCard from "./StampCard";

interface LoyaltyAdminProps {
  program: LoyaltyProgram;
  /** The card as a diner gets it, drawn from a sample code. */
  preview: { face: CardFace; qr: QrGrid } | null;
}

/**
 * The visit card, run by the owner and the managers: whether it is on and what
 * that means, the program and the card it makes, and any card looked up — by
 * camera or by code — with every visit, who stamped it, and a way to stamp,
 * redeem, or take back today's stamp given by mistake.
 */
export default function LoyaltyAdmin({ program, preview }: LoyaltyAdminProps) {
  const t = useT();
  return (
    <ConfirmProvider>
      <div className="tt-dash">
        <div className="container">
          <header className="tt-dash-head">
            <Breadcrumb trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.loyalty" }]} />
            {program.active && <StampCard buttonClass="tt-btn tt-btn-primary tt-btn-sm" />}
          </header>
          <ProgramStatus active={program.active} />
          {/* The program on one side; on the other what the team does every day
              — find a card, by camera or code — and the card a diner gets. On
              a phone the lookup comes before the tall picture, not after it. */}
          <div className="tt-cols">
            <ProgramForm program={program} />
            <div className="tt-loyalty-col">
              <CardLookup active={program.active} reward={program.reward} />
              {preview && (
                <section className="tt-section">
                  <div className="tt-section-head">
                    <h2 className="tt-serif" style={{ margin: 0 }}>{t("loyaltyAdmin.previewTitle")}</h2>
                  </div>
                  <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>{t("loyaltyAdmin.previewHint")}</p>
                  <div className="tt-loyalty-preview">
                    <CardDownload face={preview.face} qr={preview.qr} preview />
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </ConfirmProvider>
  );
}
