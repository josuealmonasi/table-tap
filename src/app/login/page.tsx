import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { currentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

// /login — restaurant staff sign in. Already signed in? Go straight to the dashboard.
export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect("/dashboard");

  return <LoginForm />;
}
