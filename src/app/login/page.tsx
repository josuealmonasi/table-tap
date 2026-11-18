import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { currentUser } from "@/lib/current-user";
import { safeLoginNext } from "@/lib/login-next";

export const dynamic = "force-dynamic";

// /login — restaurant staff sign in. Already signed in? Finish a pending signup, then open the dashboard.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Only the assigned-tier pay link survives sign-in (`safeLoginNext`).
  const next = safeLoginNext((await searchParams).next);
  const user = await currentUser();
  if (user) redirect(next ?? "/signup/complete");

  return <LoginForm next={next} />;
}
