import StatementSkeleton from "@/components/accounts/StatementSkeleton";

export default function Loading() {
  return (
    <div className="tt-login">
      <div className="container">
        <StatementSkeleton />
      </div>
    </div>
  );
}
