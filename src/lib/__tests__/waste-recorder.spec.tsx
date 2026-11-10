// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import WasteRecorder from "@/components/dashboard/costs/WasteRecorder";

const state = vi.hoisted(() => ({ bodies: [] as Record<string, unknown>[] }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/hooks/useWhen", () => ({ useWhen: () => () => "today" }));
vi.mock("@/hooks/useCostsSend", () => ({ useCostsSend: () => Object.assign(
  async (_: string, _method: string, body: Record<string, unknown>) => { state.bodies.push(body); return null; },
  { pending: () => false, unconfirmed: () => false },
) }));
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(async () => { await act(async () => root.unmount()); host.remove(); state.bodies = []; vi.unstubAllGlobals(); });
async function change(selector: string, value: string) {
  await act(async () => {
    const element = host.querySelector(selector)!;
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLInputElement ? "input" : "change", { bubbles: true }));
  });
}

it("R7-6 asks for the wasted product's required choice and sends its oat milk and extra", async () => {
  await act(async () => root.render(<WasteRecorder choices={[{ kind: "product", id: "latte", label: "Latte", unit: "pza",
    modifiers: [{ label: "Milk", type: "single", options: ["Whole", "Oat"], required: true }],
    extras: [{ id: "shot", label: "Shot" }],
  }]} today={[]} canSeeCost={false} currency="MXN" timeZone="UTC" />));
  await change("select", "product:latte");
  await change('input[inputmode="decimal"]', "2");
  await act(async () => host.querySelectorAll<HTMLButtonElement>('[role="radio"]')[3].click());
  const save = () => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(save().disabled).toBe(true);
  const milk = [...host.querySelectorAll("label")].find(l => l.textContent?.includes("Milk"))?.querySelector("select");
  expect(milk, "the waste form asks for Milk").toBeTruthy();
  await change('select[name="Milk"]', "Oat");
  await act(async () => host.querySelector<HTMLInputElement>('input[value="shot"]')!.click());
  await act(async () => save().click());
  expect(state.bodies[0]).toMatchObject({ itemId: "latte", quantity: "2", mods: { Milk: "Oat" }, extras: ["shot"] });
});
