// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Restaurant } from "@/lib/types";

// Logos moved from `logo.webp` to `logo.png`. Cleanup must delete the file the
// stored URL names, not the computed new path, or every pre-PNG logo stays
// public forever after the owner removes or replaces it.

const BASE = "https://project.supabase.co";
const R1 = "r1";
const urlOf = (path: string): string => `${BASE}/storage/v1/object/public/menu/${path}?v=1`;

const state = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ save: state.save, saving: false }) }));
vi.mock("@/components/ui/RestaurantMark", () => ({ default: () => null }));
vi.mock("@/lib/image-resize", () => ({
  preparePhoto: async () => ({
    blob: new Blob(["png"]), contentType: "image/png", sourceWidth: 256,
  }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  storage: { from: () => ({
    upload: state.upload,
    remove: state.remove,
    getPublicUrl: (path: string) => ({ data: { publicUrl: `${BASE}/storage/v1/object/public/menu/${path}` } }),
  }) },
}) }));
import LogoCard from "../LogoCard";

let container: HTMLDivElement;
let root: Root;

async function render(logoUrl: string | null): Promise<void> {
  const restaurant = { id: R1, name: "Casa", logo: "🌮", logo_url: logoUrl } as Restaurant;
  await act(async () => root.render(<LogoCard restaurant={restaurant} />));
}
async function replace(): Promise<void> {
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
  const file = new File(["x"], "logo.jpg", { type: "image/jpeg" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function remove(): Promise<void> {
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === "img.remove")!;
  await act(async () => button.click());
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE);
  state.upload.mockReset().mockResolvedValue({ error: null });
  state.remove.mockReset().mockResolvedValue({ error: null });
  state.save.mockReset().mockResolvedValue(true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

it("replacing a logo.webp logo uploads logo.png and deletes the old logo.webp", async () => {
  await render(urlOf(`${R1}/logo.webp`));
  await replace();
  expect(state.upload).toHaveBeenCalledWith(`${R1}/logo.png`, expect.anything(), expect.anything());
  expect(state.remove.mock.calls).toEqual([[[`${R1}/logo.webp`]]]);
});

it("replacing a logo.png logo deletes nothing, because the upsert overwrote it", async () => {
  await render(urlOf(`${R1}/logo.png`));
  await replace();
  expect(state.upload).toHaveBeenCalledOnce();
  expect(state.remove).not.toHaveBeenCalled();
});

it("replacing keeps the old file when the new reference could not be saved", async () => {
  state.save.mockResolvedValue(false);
  await render(urlOf(`${R1}/logo.webp`));
  await replace();
  expect(state.remove).not.toHaveBeenCalled();
});

it("removing deletes the path the URL names, after the reference is cleared", async () => {
  await render(urlOf(`${R1}/logo.webp`));
  await remove();
  expect(state.save).toHaveBeenCalledWith({ logo_url: null });
  expect(state.save.mock.invocationCallOrder[0]).toBeLessThan(state.remove.mock.invocationCallOrder[0]);
  expect(state.remove.mock.calls).toEqual([[[`${R1}/logo.webp`]]]);
});

it("removing keeps the file when clearing the reference fails", async () => {
  state.save.mockResolvedValue(false);
  await render(urlOf(`${R1}/logo.png`));
  await remove();
  expect(state.remove).not.toHaveBeenCalled();
});

it.each([
  ["another restaurant's folder", urlOf("r2/logo.webp")],
  ["a path that climbs out of its folder", urlOf(`${R1}/../r2/logo.webp`)],
  ["a URL that is not our storage", "https://elsewhere.example/r1/logo.webp"],
])("never deletes %s, on remove or replace", async (_label, logoUrl) => {
  await render(logoUrl);
  await replace();
  expect(state.remove).not.toHaveBeenCalled();
  // A fresh card: the replacement above moved this one onto our own logo.png.
  await act(async () => root.unmount()); root = createRoot(container);
  await render(logoUrl);
  await remove();
  expect(state.save).toHaveBeenLastCalledWith({ logo_url: null });
  expect(state.remove).not.toHaveBeenCalled();
});
