import { expect, it, vi } from "vitest";
import { recoverProduction, RECOVERY_URL } from "../../../scripts/recover-production.mjs";

const env = { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture-request-token",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/fixture?api-version=2" };
const jobs = Object.fromEntries(["stock", "refunds", "fees", "subscriptions", "disputes"]
  .map(name => [name, { failed: 0, pending: 0 }]));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it("requests an exact-audience identity then calls only the protected production endpoint", async () => {
  const send = vi.fn().mockResolvedValueOnce(response({ value: "fixture-identity" })).mockResolvedValueOnce(response({ jobs }));
  await recoverProduction(env, send);
  expect(send).toHaveBeenCalledTimes(2);
  const [url, identity] = send.mock.calls[0];
  expect(url.searchParams.get("audience")).toBe(RECOVERY_URL);
  expect(identity).toMatchObject({ headers: { authorization: "Bearer fixture-request-token" }, redirect: "error" });
  expect(send.mock.calls[1]).toMatchObject([RECOVERY_URL, {
    headers: { authorization: "Bearer fixture-identity" }, redirect: "error",
  }]);
});

it.each([{}, { ...env, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" },
  { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: "http://pipelines.actions.githubusercontent.com/id" },
  { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.githubusercontent.com.attacker.example/id" },
  { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: "https://user:fake@pipelines.actions.githubusercontent.com/id" },
])("does not send credentials without the real GitHub identity provider (%j)", async value => {
  const send = vi.fn();
  await expect(recoverProduction(value, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

it.each([response({}, 503), response({ value: "" }), new Response("not json")])(
  "does not call recovery when an identity cannot be issued", async result => {
    const send = vi.fn().mockResolvedValueOnce(result);
    await expect(recoverProduction(env, send)).rejects.toThrow("could not issue");
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it.each([response({}, 401), response({}, 503), response({}), response({ jobs: { ...jobs, fees: { failed: 1, pending: null } } })])(
  "fails visibly when recovery is refused or a queue cannot be observed", async result => {
    const send = vi.fn().mockResolvedValueOnce(response({ value: "fixture-identity" })).mockResolvedValueOnce(result);
    await expect(recoverProduction(env, send)).rejects.toThrow();
  },
);
