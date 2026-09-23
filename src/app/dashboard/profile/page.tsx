import { unwrap } from "@/lib/ordering-data";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ProfileForm from "@/components/dashboard/profile/ProfileForm";
import { currentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

// /dashboard/profile — every logged-in user (owner, manager, kitchen) edits
// their own name, email and password here.
export default async function ProfilePage() {
  const supabase = await createClient();
  const user = await currentUser();
  if (!user) redirect("/login");

  // No row is an answer (a login with no name yet); a failed read is not.
  const profile = unwrap<{ full_name: string | null }>(
    await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", user.id)
      .single(),
    "your profile",
  );

  return (
    <ProfileForm
      userId={user.id}
      initialName={profile?.full_name ?? ""}
      initialEmail={user.email ?? ""}
    />
  );
}
