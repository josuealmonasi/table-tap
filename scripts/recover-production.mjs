import { pathToFileURL } from "node:url";

export const RECOVERY_URL = "https://tabletap.shop/api/cron/recover";

/** GitHub issues a short-lived identity; no production secret leaves Vercel.
 * @param {Record<string, string | undefined>} env */
export async function recoverProduction(env = process.env, send = fetch) {
  const token = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!token || !env.ACTIONS_ID_TOKEN_REQUEST_URL) throw new Error("GitHub recovery identity is unavailable.");
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".actions.githubusercontent.com") || url.username || url.password) {
    throw new Error("Refusing an unknown identity provider.");
  }
  url.searchParams.set("audience", RECOVERY_URL);
  const identity = await send(url, { headers: { authorization: `Bearer ${token}` },
    redirect: "error", signal: AbortSignal.timeout(10_000) });
  const body = identity.ok ? await identity.json().catch(() => null) : null;
  if (typeof body?.value !== "string" || !body.value) throw new Error("GitHub could not issue the recovery identity.");
  const response = await send(RECOVERY_URL, { headers: { authorization: `Bearer ${body.value}` },
    redirect: "error", signal: AbortSignal.timeout(75_000) });
  if (!response.ok) throw new Error(`Production recovery returned HTTP ${response.status}.`);
  const answer = await response.json().catch(() => null);
  for (const name of ["stock", "refunds", "fees", "subscriptions", "disputes"]) {
    const job = answer?.jobs?.[name];
    if (!job || job.failed !== 0 || job.observation_failed || !Number.isInteger(job.pending) || job.pending < 0) {
      throw new Error("Production recovery reported unfinished checks; inspect the protected recovery logs.");
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  recoverProduction().then(() => console.log("Production recovery checks passed.")).catch(() => {
    // The public workflow log must never contain an identity or response body.
    console.error("Production recovery failed; inspect the protected endpoint and scheduler identity.");
    process.exitCode = 1;
  });
}
