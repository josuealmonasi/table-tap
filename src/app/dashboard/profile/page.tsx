import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ProfileForm from "@/components/dashboard/profile/ProfileForm";

export const dynamic = "force-dynamic";

// /dashboard/profile — every logged-in user (owner, manager, kitchen) edits
// their own name, email and password here.
export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", user.id)
    .single();

  return (
    <ProfileForm
      userId={user.id}
      initialName={profile?.full_name ?? ""}
      initialEmail={user.email ?? ""}
    />
  );
}
