import { notFound, redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/admin";
import { auditedOwnerView } from "@/lib/admin-owner-view";
import AdminOwnerView from "@/components/dashboard/admin/AdminOwnerView";
import { getLocale } from "@/lib/i18n/server";
import { messagesFor, translate } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// /dashboard/admin/restaurants/[id] — what the owner sees, read only, for the
// platform team. Each visit is written in platform_admin_audit before anything
// is read; without that record, the view is not shown.
export default async function AdminOwnerViewPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getPlatformAdmin();
  if (!admin) redirect("/dashboard");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const result = await auditedOwnerView(admin, id);
  if (!result.audited) {
    const m = messagesFor(await getLocale());
    return (
      <div className="tt-dash"><div className="container">
        <p className="tt-muted" role="alert">{translate(m, "apiErr.adminAuditUnavailable")}</p>
      </div></div>
    );
  }
  if (!result.view) notFound();
  return <AdminOwnerView view={result.view} />;
}
