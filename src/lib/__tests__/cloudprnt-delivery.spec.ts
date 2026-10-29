import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { A, B, TOKEN, database, job, state } from "./cloudprnt-fixture";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => database }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "printer", isRateLimited: async () => false }));
vi.mock("@/lib/ticket", () => ({ kitchenTicket: (order: { id: string }) => order.id }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ role: "owner", restaurantId: "r1" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (_key: string, status: number) => new NextResponse(null, { status }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
const { GET, POST, DELETE } = await import("@/app/api/print/cloudprnt/[token]/route");
const { POST: reprint } = await import("@/app/api/orders/print/route");
const ctx = { params: Promise.resolve({ token: TOKEN }) };
const request = (query = "") => new NextRequest(`http://localhost/api/print/cloudprnt/${TOKEN}${query}`);
const fetchCopy = (token: string) => GET(request(`?token=${token}`), ctx);
const confirm = (token: string, code = "OK") => DELETE(request(`?token=${token}&code=${encodeURIComponent(code)}`), ctx);
const queueCopy = () => reprint(new NextRequest("http://localhost/api/orders/print", {
  method: "POST", body: JSON.stringify({ orderId: `order-${A}`, to: "kitchen" }),
}));
beforeEach(() => {
  state.jobs = [job(A), job(B)]; state.failWrite = false; state.beforeClaim = null;
});

describe("a cancelled order never reaches the kitchen printer (sweep 4, finding 4)", () => {
  it("is skipped by the queue, which goes on to the next ticket", async () => {
    state.jobs[0].order_status = "cancelled";
    expect((await (await POST(request(), ctx)).json()).jobToken).toBe(B);
  });
  it("is refused when it was cancelled after the printer was told", async () => {
    const advertised = (await (await POST(request(), ctx)).json()).jobToken;
    state.jobs[0].order_status = "cancelled";
    expect((await fetchCopy(advertised)).status).toBe(404);
    expect(state.jobs[0].claimed_at).toBeNull();
  });
});

describe("CloudPRNT delivery identity", () => {
  it("fetches exactly the advertised delivery, even when another job is older", async () => {
    expect(await (await fetchCopy(B)).text()).toBe(`order-${B}`);
    expect(state.jobs[0].claimed_at).toBeNull();
    expect(state.jobs[1].claimed_at).not.toBeNull();
  });
  it("does not hand printer two the next ticket after printer one closes their advertised copy", async () => {
    const first = await (await POST(request(), ctx)).json();
    const second = await (await POST(request(), ctx)).json();
    expect(first.jobToken).toBe(second.jobToken);
    expect((await fetchCopy(first.jobToken)).status).toBe(200);
    expect((await confirm(first.jobToken)).status).toBe(200);
    expect((await fetchCopy(second.jobToken)).status).toBe(404);
    expect((await confirm(second.jobToken)).status).toBe(200);
    expect(state.jobs[1].claimed_at).toBeNull();
    expect(state.jobs[1].printed_at).toBeNull();
  });
  it.each(["", "?token=bad", `?token=${"00000000-0000-4000-8000-000000000099"}`])(
    "never falls back to a pending job for GET or DELETE %s", async query => {
      expect((await GET(request(query), ctx)).status).toBe(404);
      await DELETE(request(query), ctx);
      expect(state.jobs.every(row => row.claimed_at === null && row.printed_at === null)).toBe(true);
    },
  );
  it.each(["", "?token=bad"])("never closes a fetched pending job on a tokenless confirmation %s", async query => {
    await fetchCopy(A);
    expect((await DELETE(request(query), ctx)).status).toBe(200);
    expect(state.jobs[0].printed_at).toBeNull();
  });
  it("keeps repeated GETs on the same copy and repeated confirmations off the next ticket", async () => {
    expect(await (await fetchCopy(B)).text()).toBe(await (await fetchCopy(B)).text());
    await confirm(B); await confirm(B);
    expect(state.jobs[0].printed_at).toBeNull();
    expect(state.jobs[1].printed_at).not.toBeNull();
  });
  it("issues a fresh generation on every reprint and ignores an old copy's confirmation", async () => {
    await fetchCopy(A);
    expect((await queueCopy()).status).toBe(200);
    const next = state.jobs[0].delivery_token;
    expect(next).not.toBe(A);
    // The new copy can already be in another printer when the old one confirms.
    expect((await fetchCopy(next)).status).toBe(200);
    await confirm(A);
    expect(state.jobs[0].printed_at).toBeNull();
    expect((await fetchCopy(A)).status).toBe(404);
    await confirm(next);
    expect(state.jobs[0].printed_at).not.toBeNull();
    await queueCopy();
    expect(state.jobs[0].delivery_token).not.toBe(next);
  });
  it("advertises the delivery token instead of the stable queue row id", async () => {
    state.jobs[0].delivery_token = B;
    const advertised = await (await POST(request(), ctx)).json();
    expect(advertised.jobToken).toBe(B);
  });
  it("does not close an advertised delivery before GET hands it over", async () => {
    await confirm(A);
    expect(state.jobs[0].printed_at).toBeNull();
  });
  it("does not claim or hand out a copy superseded during GET", async () => {
    state.beforeClaim = () => { state.jobs[0].delivery_token = B; };
    expect((await fetchCopy(A)).status).toBe(404);
    expect(state.jobs[0].claimed_at).toBeNull();
  });
  it("does not hand out paper when recording its delivery fails", async () => {
    state.failWrite = true;
    expect((await fetchCopy(A)).status).toBe(500);
    expect(state.jobs[0].claimed_at).toBeNull();
  });
  it("never reads or closes a delivery in another restaurant", async () => {
    state.jobs[1].restaurant_id = "r2";
    expect((await fetchCopy(B)).status).toBe(404);
    await confirm(B);
    expect(state.jobs[1].printed_at).toBeNull();
  });
  it.each(["520 Paper Empty", "500", "bad"])("keeps a failed delivery queued (%s)", async code => {
    await fetchCopy(A);
    await confirm(A, code);
    expect(state.jobs[0].printed_at).toBeNull();
    expect((await fetchCopy(A)).status).toBe(200);
  });
  it.each(["OK", "200 OK", "204", ""])("closes only the fetched copy on success (%s)", async code => {
    await fetchCopy(A);
    await DELETE(request(`?token=${A}${code ? `&code=${encodeURIComponent(code)}` : ""}`), ctx);
    expect(state.jobs[0].printed_at).not.toBeNull();
    expect(state.jobs[1].printed_at).toBeNull();
  });
  it("returns 500 when the confirmation write fails", async () => {
    await fetchCopy(A); state.failWrite = true;
    expect((await confirm(A)).status).toBe(500);
    expect(state.jobs[0].printed_at).toBeNull();
  });
});
