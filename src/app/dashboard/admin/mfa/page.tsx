import { redirect } from "next/navigation";
import { platformAdminForMfa, platformAdminMfa } from "@/lib/admin";
import AdminMfa from "@/components/dashboard/admin/AdminMfa";

export const dynamic = "force-dynamic";

// /dashboard/admin/mfa — the platform admin turns on two-step verification, or
// enters the code a password-only session needs before any admin page or action.
export default async function AdminMfaPage() {
  if (!(await platformAdminForMfa())) redirect("/dashboard");
  const state = await platformAdminMfa();
  if (state === "verified") redirect("/dashboard/admin");
  return <AdminMfa mode={state === "needs-code" ? "verify" : "enroll"} />;
}
