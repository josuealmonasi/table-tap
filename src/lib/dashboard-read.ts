/** A failed read leaves SWR's last successful answer intact. */
export class DashboardReadError extends Error {
  constructor(public status: number) {
    super(`Dashboard read failed (${status})`);
  }
}

export async function readDashboardJson<T>([url]: readonly [string, string]): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new DashboardReadError(response.status);
  return response.json();
}
