// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import CardEmail from "../CardEmail.react-component";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars) }));
let root: Root, host: HTMLDivElement;
const code = "K7QM3XW9K7P2";
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
async function render(props: Partial<React.ComponentProps<typeof CardEmail>> = {}) {
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><CardEmail code={code} {...props} /></SWRConfig>));
}
async function type(value: string) {
  await act(async () => { const input = host.querySelector<HTMLInputElement>('input[type="email"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ email: "j***@hotmail.com" })));
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("shows exactly the role-masked answer and never puts the mask in the edit field", async () => {
  await render(); expect(host.textContent).toContain("j***@hotmail.com");
  await act(async () => button("Agregar/cambiar correo").click());
  expect(host.querySelector<HTMLInputElement>('input[type="email"]')!.value).toBe("");
  await type("new@example.com"); expect(button("Guardar correo").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ outcome: "saved", email: "n***@example.com" }));
  await act(async () => button("Guardar correo").click());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toEqual({ code, email: "new@example.com", consent: true });
  expect(host.textContent).toContain("n***@example.com"); expect(host.textContent).not.toContain("new@example.com");
  await act(async () => button("Agregar/cambiar correo").click());
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
});
it("diner reads their full address from rewards without calling the staff-only GET", async () => {
  await render({ diner: true, initialEmail: "diner@example.com" });
  expect(fetch).not.toHaveBeenCalled(); expect(host.textContent).toContain("diner@example.com");
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ outcome: "removed" }));
  await act(async () => button("Quitar correo").click());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ code, email: null, consent: false });
  expect(host.textContent).toContain("Sin correo");
});
it("says which card already has the address without silently moving it", async () => {
  await render(); await act(async () => button("Agregar/cambiar correo").click()); await type("taken@example.com");
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ outcome: "taken", suffix: "ABCD" }, { status: 409 }));
  await act(async () => button("Guardar correo").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("···· ABCD");
  expect(host.textContent).toContain("j***@hotmail.com");
});
it("read failures stay distinct from a card without email and allow retry", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({}, { status: 503 }));
  await render(); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain("Sin correo");
});
it("a new staff reader never flashes a previous reader's full email from a shared cache", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ email: "owner-visible@example.com" }));
  const cache = new Map();
  const provider = () => cache;
  await act(async () => root.render(<SWRConfig value={{ provider, dedupingInterval: 0 }}><CardEmail key="owner" code={code} /></SWRConfig>));
  expect(host.textContent).toContain("owner-visible@example.com");
  let answer!: (res: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
  await act(async () => root.render(<SWRConfig value={{ provider, dedupingInterval: 0 }}><CardEmail key="cashier" code={code} /></SWRConfig>));
  expect(host.textContent).not.toContain("owner-visible@example.com");
  await act(async () => answer(Response.json({ email: "o***@example.com" })));
  expect(host.textContent).toContain("o***@example.com");
});
it("a saved address refreshes other mounted readers with the server's masked answer", async () => {
  let linked = "j***@hotmail.com";
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === "POST") linked = "n***@example.com";
    return Response.json(init?.method === "POST" ? { outcome: "saved", email: linked } : { email: linked });
  });
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <CardEmail code={code} /><CardEmail code={code} />
  </SWRConfig>));
  const editors = () => [...host.querySelectorAll("fieldset")];
  await act(async () => [...editors()[0].querySelectorAll("button")].find(b => b.textContent === "Agregar/cambiar correo")!.click());
  await type("new@example.com");
  await act(async () => editors()[0].querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => [...editors()[0].querySelectorAll("button")].find(b => b.textContent === "Guardar correo")!.click());
  expect(editors()[1].textContent).toContain("n***@example.com");
  expect(host.textContent).not.toContain("new@example.com");
});
