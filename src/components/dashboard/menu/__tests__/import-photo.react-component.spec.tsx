// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/lib/menu-import";
import DishPhotoField from "../DishPhotoField";
import ImportMenuDialog from "../ImportMenuDialog";

const { upload, remove } = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/customer/DishImage", () => ({ default: () => null }));
vi.mock("@/lib/image-resize", () => ({ preparePhoto: async () => ({
  blob: new Blob(), ext: "webp", contentType: "image/webp", sourceWidth: 800,
}) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({
  upload, remove, getPublicUrl: () => ({ data: { publicUrl: "https://storage.test/replacement.webp" } }),
}) } }) }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  upload.mockResolvedValue({ error: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function selectFile(file: { size: number; text: () => Promise<string> }): Promise<void> {
  const input = host.querySelector("input")!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

it("refuses a CSV larger than 2 MB before reading its contents", async () => {
  await act(async () => root.render(<ImportMenuDialog open withTemplate={false} currency="MXN"
    existingNames={[]} onClose={vi.fn()} onImport={vi.fn()} />));
  const text = vi.fn(async () => "name,price\nCoffee,20");
  await selectFile({ size: MAX_IMPORT_BYTES + 1, text });
  expect(text).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("menuImport.fileTooLarge");
  await selectFile({ size: MAX_IMPORT_BYTES, text });
  expect(text).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("rejects a CSV over the row limit and disables import", async () => {
  await act(async () => root.render(<ImportMenuDialog open withTemplate={false} currency="MXN"
    existingNames={[]} onClose={vi.fn()} onImport={vi.fn()} />));
  const csv = "name,price" + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `\nDish ${i},10`).join("");
  await selectFile({ size: csv.length, text: async () => csv });
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("menuImport.tooManyRows");
  expect(host.querySelector<HTMLButtonElement>(".tt-btn-primary")?.disabled).toBe(true);
});

it("keeps an oversized selection rejected when an earlier read finishes late", async () => {
  await act(async () => root.render(<ImportMenuDialog open withTemplate={false} currency="MXN"
    existingNames={[]} onClose={vi.fn()} onImport={vi.fn()} />));
  let finishRead!: (content: string) => void;
  const previousRead = new Promise<string>(resolve => { finishRead = resolve; });
  await selectFile({ size: 20, text: () => previousRead });
  await selectFile({ size: MAX_IMPORT_BYTES + 1, text: vi.fn() });
  await act(async () => finishRead("name,price\nCoffee,20"));

  expect(host.querySelector('[role="alert"]')?.textContent).toBe("menuImport.fileTooLarge");
  expect(host.querySelector<HTMLButtonElement>(".tt-btn-primary")?.disabled).toBe(true);
});

it("leaves the stored photo intact when a shared URL is removed or replaced in the editor", async () => {
  const change = vi.fn();
  await act(async () => root.render(<DishPhotoField restaurantId="r1" value="https://storage.test/shared.webp"
    emoji="🍽️" name="Coffee" onChange={change} />));
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "img.remove")!.click());
  expect(change).toHaveBeenCalledWith(null);
  await selectFile({ size: 10, text: async () => "" });
  expect(upload).toHaveBeenCalledOnce();
  expect(change).toHaveBeenLastCalledWith("https://storage.test/replacement.webp");
  expect(remove).not.toHaveBeenCalled();
});
