import { redirect } from "next/navigation";
import { currentUser } from "@/lib/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import SignupCompletionError from "@/components/auth/SignupCompletionError";

export const dynamic = "force-dynamic";

/** The database checks verification too; a URL alone must never activate a trial. */
export default async function CompleteSignupPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  let error: { code?: string } | null;
  try {
    ({ error } = await createAdminClient().rpc("complete_owner_signup_v1", { p_user: user.id }));
  } catch { return <SignupCompletionError />; }
  if (error?.code === "PT403") redirect("/signup/verify");
  if (error) return <SignupCompletionError />;
  redirect("/dashboard");
}
