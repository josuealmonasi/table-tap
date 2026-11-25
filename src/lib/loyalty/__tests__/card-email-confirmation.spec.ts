import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tokenHash } from "@/lib/digest-recipients";
import { sendCardEmailConfirmation } from "../card-email-confirmation";

const mocks = vi.hoisted(() => ({ send: vi.fn(), update: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/mail", () => ({ sendMail: mocks.send }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ update: mocks.update }) }) }));

const code = "K7QM3XW9K7P2";
const token = "A".repeat(43);
const email = "guest@example.invalid";
const request = (locale: string) => new NextRequest("https://tabletap.test/api/loyalty/card-email", {
  headers: { cookie: `tt-locale=${locale}`, origin: "https://elsewhere.invalid" },
});

beforeEach(() => { vi.resetAllMocks(); });

it.each([
  ["en", "Confirm your TableTap ticket email", "7 days"],
  ["es", "Confirma tu correo para recibir tickets de TableTap", "7 días"],
])("sends a single confirmation with %s copy and a link back to TableTap", async (locale, subject, expiry) => {
  mocks.send.mockResolvedValue({ sent: true });
  await sendCardEmailConfirmation(request(locale), code, email, token);
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    to: email, subject, text: expect.stringContaining(expiry),
    html: expect.stringContaining(`https://tabletap.test/tickets/confirm?t=${token}&amp;lang=${locale}`),
    idempotencyKey: `card-email-confirm-${tokenHash(token)}`, throwOnUncertainDelivery: true,
  }));
  expect(mocks.update).not.toHaveBeenCalled();
});

it("clears only the refused token so a later request can try again", async () => {
  mocks.send.mockResolvedValue({ sent: false, reason: "failed" });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValueOnce({ eq: mocks.eq }).mockResolvedValueOnce({ error: null });
  await expect(sendCardEmailConfirmation(request("en"), code, email, token)).rejects.toThrow();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ pending_email: null, pending_email_token_hash: null }));
  expect(mocks.eq.mock.calls).toEqual([["code", code], ["pending_email_token_hash", tokenHash(token)]]);
});

it("preserves the confirmation when the provider may already have accepted it", async () => {
  mocks.send.mockRejectedValue(new Error("reply lost"));
  await expect(sendCardEmailConfirmation(request("en"), code, email, token)).rejects.toThrow("reply lost");
  expect(mocks.update).not.toHaveBeenCalled();
});
