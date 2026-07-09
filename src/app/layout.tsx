import type { Metadata } from "next";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/membership";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "TableTap — Scan, Order, Enjoy",
  description: "QR table ordering for restaurants.",
};

export const dynamic = "force-dynamic";

// Site-wide chrome: Navbar only for logged-in restaurant users, Footer always.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);

  return (
    <html lang="en">
      <body>
        <ToastProvider>
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
      </body>
    </html>
  );
}
