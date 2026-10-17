/**
 * Everything under /dashboard. The root watches auth changes even on /login,
 * so leaving the dashboard cannot leave its private cache behind.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
