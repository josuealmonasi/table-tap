import Stripe from "stripe";

// Server-side Stripe instance. Uses the SECRET key (server-only env var).
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-08-27.basil",
  typescript: true,
});
