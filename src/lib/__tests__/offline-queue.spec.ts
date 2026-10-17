import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueue, readQueue, type QueuedMove } from "@/lib/offline-queue";

const move = (id: string, from: string, to: string, at = 1): QueuedMove =>
  ({ id, from, to, at }) as QueuedMove;

describe("holding status moves until the connection comes back", () => {
  it("keeps a move nobody has queued yet", () => {
    expect(enqueue([], move("a", "received", "preparing"))).toEqual([
      move("a", "received", "preparing"),
    ]);
  });

  it("keeps each permitted step so reconnect never needs to skip cooking", () => {
    let q = enqueue([], move("a", "received", "preparing", 1));
    q = enqueue(q, move("a", "preparing", "ready", 2));
    q = enqueue(q, move("a", "ready", "completed", 3));
    expect(q).toEqual([
      move("a", "received", "preparing", 1),
      move("a", "preparing", "ready", 2),
      move("a", "ready", "completed", 3),
    ]);
  });

  it("keeps an undo because the first tap may have reached the server before disconnect", () => {
    // A lost response does not prove the original move failed.
    let q = enqueue([], move("a", "received", "preparing", 1));
    q = enqueue(q, move("a", "preparing", "received", 2));
    expect(q).toEqual([move("a", "received", "preparing", 1), move("a", "preparing", "received", 2)]);
  });

  it("keeps each ticket's move separate", () => {
    let q = enqueue([], move("a", "received", "preparing"));
    q = enqueue(q, move("b", "preparing", "ready"));
    expect(q.map(m => m.id)).toEqual(["a", "b"]);
  });

  it("remembers where a move started, not just where it went", () => {
    // The server needs the `from` to refuse work that a live connection has
    // already overtaken.
    let q = enqueue([], move("a", "received", "preparing", 1));
    q = enqueue(q, move("a", "preparing", "ready", 2));
    expect(q[0].from).toBe("received");
  });
});

afterEach(() => vi.unstubAllGlobals());
it("expands a saved queue from the old client into permitted forward steps", () => {
  vi.stubGlobal("localStorage", { getItem: () => JSON.stringify([move("a", "received", "completed")]) });
  expect(readQueue()).toEqual([
    move("a", "received", "preparing"), move("a", "preparing", "ready"), move("a", "ready", "completed"),
  ]);
});
