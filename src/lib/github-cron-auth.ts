import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "https://tabletap.shop/api/cron/recover";
const REPOSITORY = "josuealmonasi/table-tap";
const WORKFLOW = `${REPOSITORY}/.github/workflows/recovery.yml@refs/heads/main`;
const githubKeys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`), {
  timeoutDuration: 3000, cooldownDuration: 30_000, cacheMaxAge: 3600_000,
});

/** Only this repository's approved recovery job can replace the daily cron. */
export async function githubCronAuthorized(request: Request, keys: JWTVerifyGetKey = githubKeys): Promise<boolean> {
  // A production identity must not start work on a preview or development DB.
  if (process.env.VERCEL_ENV !== "production") return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.length > 8192) return false;
  const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(authorization)?.[1];
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"], issuer: ISSUER, audience: AUDIENCE,
      subject: `repo:${REPOSITORY}:ref:refs/heads/main`,
      requiredClaims: ["exp", "iat", "nbf"], maxTokenAge: "5m", clockTolerance: 15,
    });
    // Names alone can be reclaimed after a rename or transfer. Pin both IDs,
    // and the workflow and branch: a fork or PR must never inherit this writer.
    return payload.aud === AUDIENCE && payload.repository === REPOSITORY
      && payload.repository_id === "1282544042" && payload.repository_owner_id === "5515242"
      && payload.ref === "refs/heads/main" && payload.workflow_ref === WORKFLOW
      && (!payload.job_workflow_ref || payload.job_workflow_ref === WORKFLOW)
      && payload.runner_environment === "github-hosted"
      && ["schedule", "workflow_dispatch"].includes(String(payload.event_name));
  } catch {
    // A failed signature, expired identity or unavailable key never opens a writer.
    return false;
  }
}
