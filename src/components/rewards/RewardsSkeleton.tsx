import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The card's shape while it is looked up: the logo, the name, the count, its
 * dots and its ladder of rewards. The page used to sit on the form and then jump to the card, and
 * nothing said anything was happening in between.
 */
export default function RewardsSkeleton() {
  return (
    <div className="tt-login-card" aria-busy="true">
      <div className="tt-rewards">
        <Skeleton width={64} height={64} radius={32} />
        <Skeleton width="60%" height={28} />
        <Skeleton width={120} height={20} />
        <div className="tt-rewards-dots">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} width={22} height={22} radius={11} />
          ))}
        </div>
        {/* The ladder: most cards carry more than one reward. */}
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={`step-${i}`} width="100%" height={34} radius={8} />
        ))}
        <Skeleton width="80%" height={16} />
        <Skeleton width="50%" height={14} />
        <Skeleton width="70%" height={14} />
      </div>
      <Skeleton width="100%" height={44} radius={12} style={{ marginTop: 16 }} />
      <Skeleton width="100%" height={44} radius={12} style={{ marginTop: 8 }} />
    </div>
  );
}
