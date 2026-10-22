import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { navigate, overlay, ready, trackData } from "../../../scripts/browser-ready.mjs";
import { phaseTimings } from "../../../scripts/browser-jobs.mjs";

class FakePage extends EventEmitter {
  path = "http://localhost/dashboard/orders";
  skeleton = false;
  fonts = "loaded";
  text = "An explicit empty state";
  x = 0;
  dialog = false;
  content = true;
  url() { return this.path; }
  isClosed() { return false; }
  async evaluate(source: string | ((arg: string) => boolean), arg?: string) {
    const node = { tagName: "P", innerText: this.text,
      getBoundingClientRect: () => ({ x: this.x, y: 0, width: 300, height: 40 }) };
    const root = { innerText: this.text, querySelectorAll: (selector: string) => selector === "*" ? [node] : [] };
    return runInNewContext(typeof source === "string" ? source : `(${source.toString()})(${JSON.stringify(arg)})`, {
      document: { body: root, fonts: { status: this.fonts },
        querySelector: () => this.content ? root : null,
        querySelectorAll: () => this.skeleton ? [node] : [],
      },
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    });
  }
  locator() { return { count: async () => this.dialog ? 1 : 0, first: () => ({ isVisible: async () => this.dialog }) }; }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("waits for the actual content, resolved data, skeletons, fonts and stable geometry", async () => {
  const page = new FakePage();
  const pending = trackData(page);
  const request = { resourceType: () => "fetch" };
  page.emit("request", request);
  page.skeleton = true;
  page.fonts = "loading";
  page.content = false;
  let done = false;
  const work = ready(page, { url: page.url(), pending }).then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(500);
  expect(done).toBe(false);
  page.content = true;
  page.skeleton = false;
  page.fonts = "loaded";
  await vi.advanceTimersByTimeAsync(500);
  expect(done).toBe(false);
  page.emit("requestfinished", request);
  await vi.advanceTimersByTimeAsync(200);
  page.x = 30;
  await vi.advanceTimersByTimeAsync(200);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(300);
  await work;
  expect(done).toBe(true);
});

it("accepts rows or an explicit empty/error outcome without a character threshold", async () => {
  for (const text of ["One row", "No orders", "Could not load orders"]) {
    const page = new FakePage();
    page.text = text;
    const work = ready(page, { url: page.url() });
    await vi.advanceTimersByTimeAsync(400);
    await work;
  }
});

it("rejects a redirect and a readiness evaluation error", async () => {
  const page = new FakePage();
  await expect(ready(page, { url: "http://localhost/dashboard/bills" })).rejects.toThrow("unexpected route");
  vi.spyOn(page, "evaluate").mockRejectedValue(new Error("evaluation broke"));
  await expect(ready(page)).rejects.toThrow("evaluation broke");
});

it("fails unresolved data instead of auditing the page shell", async () => {
  const page = new FakePage();
  page.content = false;
  const result = expect(ready(page, { url: page.url(), timeout: 500 })).rejects.toThrow("did not become ready");
  await vi.advanceTimersByTimeAsync(600);
  await result;
});

it("leaves a failed navigation to the pool retry policy", async () => {
  const goto = vi.fn().mockRejectedValue(new Error("navigation refused"));
  await expect(navigate({ goto }, "http://localhost/login", phaseTimings().phase, new Set())).rejects.toThrow("navigation refused");
  expect(goto).toHaveBeenCalledTimes(1);
});

it("waits for overlays to open and close, and observes a legitimate no-op for its full window", async () => {
  const page = new FakePage();
  let complete = false;
  const opening = overlay(page).then(() => { complete = true; });
  await vi.advanceTimersByTimeAsync(200);
  expect(complete).toBe(false);
  page.dialog = true;
  await vi.advanceTimersByTimeAsync(100);
  await opening;
  const closing = overlay(page, "[role=dialog]", false);
  page.dialog = false;
  await vi.advanceTimersByTimeAsync(100);
  await closing;
  const start = Date.now();
  const nothing = overlay(page, "[role=dialog]", true, 700, false);
  await vi.advanceTimersByTimeAsync(700);
  expect(await nothing).toBe(false);
  expect(Date.now() - start).toBe(700);
});

it("bounds a readiness sample whose page evaluation never settles", async () => {
  const page = new FakePage();
  vi.spyOn(page, "evaluate").mockImplementation(() => new Promise(() => {}));
  const result = expect(ready(page, { timeout: 20 })).rejects.toThrow("readiness sample timed out");
  await vi.advanceTimersByTimeAsync(21);
  await result;
});
