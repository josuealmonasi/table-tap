import { describe, it, expect } from "vitest";
import { MANAGES, type Role } from "@/lib/membership";

describe("MANAGES", () => {
  it("grants management to owner and manager", () => {
    expect(MANAGES("owner")).toBe(true);
    expect(MANAGES("manager")).toBe(true);
  });

  it("denies waiter and kitchen", () => {
    expect(MANAGES("waiter")).toBe(false);
    expect(MANAGES("kitchen")).toBe(false);
  });

  it("covers every role in the union", () => {
    const roles: Role[] = ["owner", "manager", "waiter", "kitchen"];
    expect(roles.filter(MANAGES)).toEqual(["owner", "manager"]);
  });
});
