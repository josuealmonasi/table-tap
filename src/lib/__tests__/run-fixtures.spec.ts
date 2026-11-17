import { describe, expect, it, vi } from "vitest";
import { beginSharedCase, inheritedChange, runFixtures, settleSharedCase } from "../../../scripts/run-fixtures.mjs";

describe("audit #648: a cascade names the first case that changed a shared row", () => {
  it("blames the first borrower that left the row different, not the later ones that inherit it", async () => {
    const pool = runFixtures();
    let row = "original";
    const create = async () => ({ cleanup: async () => {}, fingerprint: async () => row });
    const run = async (name: string, act: () => void, fails: boolean) => {
      beginSharedCase();
      await pool.acquire("offer", create);
      act();
      const note = fails ? inheritedChange() : "";
      await settleSharedCase(name);
      return note;
    };
    expect(await run("A refuses cleanly", () => {}, false)).toBe("");
    // B's refusal wrongly writes. Its own failure has nobody earlier to blame.
    expect(await run("B writes on refusal", () => { row = "changed"; }, true)).toBe("");
    // C and D only inherit B's change; each says so, naming B.
    expect(await run("C", () => {}, true)).toBe(' (shared fixture offer was already changed by "B writes on refusal")');
    expect(await run("D", () => { row = "changed again"; }, true)).toContain('"B writes on refusal"');
    // A case that never borrowed the row is not told about it.
    beginSharedCase();
    expect(inheritedChange()).toBe("");
    await pool.cleanup();
  });

  it("tracks nothing for a fixture without a fingerprint, and survives an unreadable one", async () => {
    const pool = runFixtures();
    let readable = true;
    beginSharedCase();
    await pool.acquire("plain", async () => ({ cleanup: async () => {} }));
    await pool.acquire("flaky", async () => ({ cleanup: async () => {}, fingerprint: async () => {
      if (!readable) throw new Error("read failed");
      return "row";
    } }));
    readable = false;
    await settleSharedCase("E");
    beginSharedCase();
    await pool.acquire("plain", async () => ({ cleanup: async () => {} }));
    await pool.acquire("flaky", async () => ({ cleanup: async () => {} }));
    expect(inheritedChange()).toBe("");
    await settleSharedCase("F");
    // A baseline that cannot be read never fails the setup it describes.
    await expect(pool.acquire("unreadable", async () => ({ id: "row", cleanup: async () => {},
      fingerprint: async () => { throw new Error("no read"); } }))).resolves.toMatchObject({ id: "row" });
    await pool.cleanup();
  });
});

describe("run-owned fixture cleanup", () => {
  it("creates concurrent borrowers once and leaves cleanup to the owner", async () => {
    const pool = runFixtures(), cleanup = vi.fn(async () => {});
    const create = vi.fn(async () => ({ id: "same", cleanup }));
    const borrowers = await Promise.all([pool.acquire("same", create), pool.acquire("same", create)]);
    expect(create).toHaveBeenCalledOnce();
    for (const borrower of borrowers) await borrower.cleanup();
    expect(cleanup).not.toHaveBeenCalled();
    await pool.cleanup();
    await pool.cleanup();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("releases one case group without deleting another group's rows", async () => {
    const pool = runFixtures(), offer = vi.fn(async () => {}), order = vi.fn(async () => {});
    await pool.acquire("offer", async () => ({ cleanup: offer }));
    await pool.acquire("order", async () => ({ cleanup: order }));
    await pool.cleanup(["offer"]);
    expect(offer).toHaveBeenCalledOnce();
    expect(order).not.toHaveBeenCalled();
    await pool.cleanup();
    expect(offer).toHaveBeenCalledOnce();
    expect(order).toHaveBeenCalledOnce();
  });

  it("tries every cleanup and retains failed deletions for run teardown", async () => {
    const pool = runFixtures();
    const failed = vi.fn(async () => {}).mockRejectedValueOnce(new Error("delete failed"));
    const succeeded = vi.fn(async () => {});
    await pool.acquire("failed", async () => ({ cleanup: failed }));
    await pool.acquire("succeeded", async () => ({ cleanup: succeeded }));
    await expect(pool.cleanup()).rejects.toThrow("delete failed");
    expect(failed).toHaveBeenCalledOnce();
    expect(succeeded).toHaveBeenCalledOnce();
    await pool.cleanup();
    expect(failed).toHaveBeenCalledTimes(2);
    expect(succeeded).toHaveBeenCalledOnce();
  });
});
