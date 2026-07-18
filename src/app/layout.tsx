import type { Metadata } from "next";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/membership";
import { getPlatformAdmin } from "@/lib/admin";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { ToastProvider } from "@/components/ui/Toast";
import { LocaleProvider } from "@/lib/i18n/context";
import { getLocale } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "TableTap — Scan, Order, Enjoy",
  description: "QR table ordering for restaurants.",
};

export const dynamic = "force-dynamic";

// Site-wide chrome: Navbar only for logged-in restaurant users, Footer always.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const admin = await getPlatformAdmin();
  const membership = admin ? null : await getMembership(supabase);
  const locale = await getLocale();

  return (
    <html lang={locale}>
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
                role={membership.role}
              />
            )}
            <main style={{ flex: 1 }}>{children}</main>
            <Footer />
          </ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
