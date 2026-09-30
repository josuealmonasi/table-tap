import RewardsSkeleton from "@/components/rewards/RewardsSkeleton";

// While the page itself loads — the menu's visit card row sends a diner here.
export default function Loading() {
  return (
    <div className="tt-login">
      <div className="container">
        <RewardsSkeleton />
      </div>
    </div>
  );
}
