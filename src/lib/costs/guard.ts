import type { NextResponse } from "next/server";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";

/**
 * What stops a manager changing the restaurant's costs: a frozen dashboard,
 * or a tier without them. Said once for every costs route; who is calling is
 * checked in each route itself, where the guard can be seen.
 */
export async function costsBlocks(restaurantId: string): Promise<NextResponse | null> {
  return (await frozenBlocks(restaurantId)) ?? (await planBlocks(restaurantId, "costs"));
}

/** A uuid, or null. */
export function uuidOf(raw: unknown): string | null {
  return typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}
