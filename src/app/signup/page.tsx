import { redirect } from "next/navigation";
import SignupForm from "@/components/auth/SignupForm";
import { currentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

// /signup — create a restaurant account.
export default async function SignupPage() {
  const user = await currentUser();
  if (user) redirect("/dashboard");

  return <SignupForm />;
}
