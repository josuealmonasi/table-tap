"use client";
import type { TerminalReport } from "@/lib/terminal-report";
import TerminalDeposits from "./TerminalDeposits";
import VerifyDeposit from "./VerifyDeposit";

interface Props { report: TerminalReport; timeZone: string }
export default function TerminalReportView({ report, timeZone }: Props) {
  return <>
    {report.currencies.map(({ currency, view }) => <TerminalDeposits key={currency} terminal={view} currency={currency} timeZone={timeZone} />)}
    {report.unverified.map(deposit => <VerifyDeposit key={deposit.id} deposit={deposit} />)}
  </>;
}
