import ServiceWorkerRegistrar from "@/components/pwa/ServiceWorkerRegistrar";

/**
 * Everything under /dashboard, plus the worker that keeps it working.
 *
 * The registrar lives here rather than in the root layout so it never runs on
 * a diner's screen. A diner who loses the connection should be told, not shown
 * an old menu whose prices may have moved since.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ServiceWorkerRegistrar />
      {children}
    </>
  );
}
