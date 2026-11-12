import { afterEach, expect, it, vi } from "vitest";
import { ownStorageUrl, ticketAddress } from "@/lib/ticket-place";

afterEach(() => vi.unstubAllEnvs());

it("fetches a logo only from this project's public storage (no SSRF through a stored URL)", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  expect(ownStorageUrl("https://abc.supabase.co/storage/v1/object/public/logos/r/logo.png")).toBe(true);
  for (const bad of ["http://abc.supabase.co/storage/v1/object/public/x.png", "https://evil.example/storage/v1/object/public/x.png",
    "https://abc.supabase.co/rest/v1/restaurants", "https://169.254.169.254/latest/meta-data", "not a url", null]) {
    expect(ownStorageUrl(bad), String(bad)).toBe(false);
  }
});

it("writes the address the way a ticket prints it, skipping what is empty", () => {
  expect(ticketAddress({ address_street: "Av. Los Pinos", address_ext_number: "245", address_int_number: "3",
    address_colonia: "Centro", address_postal_code: "44100", address_municipality: "Guadalajara", address_state: "Jalisco" }))
    .toEqual(["Av. Los Pinos 245, Int. 3", "Col. Centro, C.P. 44100", "Guadalajara, Jalisco"]);
  expect(ticketAddress({ address_postal_code: "44100" })).toEqual(["C.P. 44100"]);
  expect(ticketAddress({})).toEqual([]);
});
