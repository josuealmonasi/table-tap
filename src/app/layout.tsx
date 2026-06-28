import type { Metadata } from "next";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "TableTap — Scan, Order, Enjoy",
  description: "QR table ordering for restaurants.",
};

export const dynamic = "force-dynamic";

// Site-wide chrome: Navbar only for logged-in restaurant users, Footer always.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let restaurant: { name: string; logo: string } | null = null;
  if (user) {
    const { data } = await supabase
      .from("restaurants")
      .select("name, logo")
      .eq("owner_id", user.id)
      .single();
    restaurant = data as { name: string; logo: string } | null;
  }

  return (
    <html lang="en">
      <body>
        {restaurant && <Navbar restaurantName={restaurant.name} restaurantLogo={restaurant.logo} />}
        <main style={{ flex: 1 }}>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
