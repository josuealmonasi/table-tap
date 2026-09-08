import { describe, expect, it } from "vitest";
import { enqueue, type QueuedMove } from "@/lib/offline-queue";

const move = (id: string, from: string, to: string, at = 1): QueuedMove =>
  ({ id, from, to, at }) as QueuedMove;

describe("holding status moves until the connection comes back", () => {
  it("keeps a move nobody has queued yet", () => {
    expect(enqueue([], move("a", "received", "preparing"))).toEqual([
      move("a", "received", "preparing"),
    ]);
  });

  it("folds three taps on one ticket into the one change to send", () => {
    // Replaying every tap makes the board flicker through states nobody chose.
    let q = enqueue([], move("a", "received", "preparing", 1));
    q = enqueue(q, move("a", "preparing", "ready", 2));
    q = enqueue(q, move("a", "ready", "completed", 3));
    expect(q).toEqual([move("a", "received", "completed", 3)]);
  });

  it("drops a move that ends up back where it started", () => {
    // Nothing to tell the server: the order is as it was.
    let q = enqueue([], move("a", "received", "preparing", 1));
    q = enqueue(q, move("a", "preparing", "received", 2));
    expect(q).toEqual([]);
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
