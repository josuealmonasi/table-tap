interface SaleEmailResult { saved: boolean }

/** This optional save has a short timeout: collected money must still reach the till. */
export async function saveSaleEmail(code: string, email: string): Promise<SaleEmailResult> {
  try {
    const res = await fetch("/api/loyalty/card-email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, email, consent: true }), signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    if (res.ok && data.outcome === "saved") return { saved: true };
    return { saved: false };
  } catch { return { saved: false }; }
}
