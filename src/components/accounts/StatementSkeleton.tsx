import { Skeleton } from "@/components/ui/Skeleton";

/** The statement's shape while it loads: name, balance, a day of charges, the buttons. */
export default function StatementSkeleton() {
  return (
    <div className="tt-login-card tt-statement-card" aria-busy="true">
      <Skeleton width="40%" height={14} />
      <Skeleton width="70%" height={30} style={{ margin: "8px 0" }} />
      <Skeleton width="50%" height={24} style={{ marginBottom: 16 }} />
      <Skeleton width="100%" height={18} style={{ marginBottom: 8 }} />
      <Skeleton width="100%" height={56} radius={10} style={{ marginBottom: 8 }} />
      <Skeleton width="100%" height={56} radius={10} style={{ marginBottom: 16 }} />
      <Skeleton width="100%" height={48} radius={12} style={{ marginBottom: 8 }} />
      <Skeleton width="100%" height={48} radius={12} />
    </div>
  );
}
