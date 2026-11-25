import { unwrap } from "@/lib/ordering-data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import ProfileForm from "@/components/dashboard/profile/ProfileForm";
import { getMember, MANAGES } from "@/lib/membership";
import { digestEnabled } from "@/lib/digest-preference";
import { saveDigestPreference } from "./digest-actions";

export const dynamic = "force-dynamic";

// /dashboard/profile — every logged-in user (owner, manager, kitchen) edits
// their own name, email and password here.
export default async function ProfilePage() {
  const supabase = await createClient();
  const { user, membership } = await getMember();
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

  let initialDigest: boolean | null = null;
  if (membership && MANAGES(membership.role)) {
    initialDigest = digestEnabled(membership.role, user.user_metadata.digest);
    if (initialDigest) {
      const stopped = await createAdminClient().rpc("digest_staff_stopped_v1", {
        p_restaurant: membership.restaurant.id, p_user: user.id,
      });
      if (stopped.error) throw new Error("Could not read the digest preference", { cause: stopped.error });
      initialDigest = !stopped.data;
    }
  }

  return (
    <ProfileForm
      userId={user.id}
      initialName={profile?.full_name ?? ""}
      initialEmail={user.email ?? ""}
      initialDigest={initialDigest}
      saveDigestAction={saveDigestPreference}
    />
  );
}
