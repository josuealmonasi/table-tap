import { describe, expect, it, vi } from "vitest";
import { runFixtures } from "../../../scripts/run-fixtures.mjs";

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
