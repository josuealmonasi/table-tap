import { vi } from "vitest";

// Route handlers register `after()` work (the ticket-email drain); Next throws
// when it is called outside a real request, which every route spec is. A spec
// that counts drains mocks `next/server` itself, and its mock wins.
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: () => {} }));
