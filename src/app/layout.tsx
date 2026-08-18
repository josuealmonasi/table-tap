import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { getMembership } from "@/lib/membership";
import { getPlatformAdmin } from "@/lib/admin";
import Navbar from "@/components/layout/Navbar";
import TermsGate from "@/components/legal/TermsGate";
import { needsTerms } from "@/lib/legal";
import Footer from "@/components/layout/Footer";
import { ToastProvider } from "@/components/ui/Toast";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

// One family, weight carries the hierarchy. next/font self-hosts the files at
// build time, so there's no request to a font CDN at runtime and no swap flash.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--tt-font",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TableTap — Scan, Order, Enjoy",
  description: "QR table ordering for restaurants.",
};

export const dynamic = "force-dynamic";

// Site-wide chrome: Navbar only for logged-in restaurant users, Footer always.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await getPlatformAdmin();
  const membership = admin ? null : await getMembership();
  const locale = await getLocale();

  return (
    <html lang={locale} className={archivo.variable}>
      <body>
        <LocaleProvider locale={locale}>
          <ToastProvider>
            {admin && (
              <Navbar restaurantName="TableTap Admin" restaurantLogo="🛡️" role="admin" />
            )}
            {membership && (
              <Navbar
                restaurantName={membership.restaurant.name}
                restaurantLogo={membership.restaurant.logo}
                restaurantLogoUrl={membership.restaurant.logo_url}
                role={membership.role}
                plan={membership.restaurant.plan}
              />
            )}
            {/* Only the owner is asked, and only in the dashboard: the diner's
                menu renders through this same layout, and holding up somebody's
                dinner over a contract with their restaurant would be absurd. */}
            {membership?.role === "owner" &&
              needsTerms(membership.restaurant.terms_version) && <TermsGate />}
            <main style={{ flex: 1 }}>{children}</main>
            <Footer />
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
