import { expect, it } from "vitest";
import { canonicalInbox } from "@/lib/canonical-inbox";
import { inboxMailKey, signupMailKey } from "@/lib/signup-mail-ceiling";

it("folds every spelling of one mailbox into one key", () => {
  expect(canonicalInbox(" Owner+Promo@Example.COM ")).toBe("owner@example.com");
  expect(canonicalInbox("o.w.n.e.r+x@gmail.com")).toBe("owner@gmail.com");
  expect(canonicalInbox("O.Wner@GoogleMail.com")).toBe("owner@gmail.com");
  expect(canonicalInbox("dueño@café.mx")).toBe("dueño@xn--caf-dma.mx");
});

it("keeps dots outside Gmail and a leading plus as typed", () => {
  expect(canonicalInbox("first.last@example.com")).toBe("first.last@example.com");
  expect(canonicalInbox("+tag@example.com")).toBe("+tag@example.com");
});

it("keys the ceiling on the canonical inbox, separately per kind of mail", () => {
  expect(signupMailKey("o.wner+1@googlemail.com")).toBe(signupMailKey("OWNER@gmail.com"));
  expect(signupMailKey("owner+a@example.com")).toBe(signupMailKey("owner@example.com"));
  expect(signupMailKey("owner@example.com")).not.toBe(signupMailKey("other@example.com"));
  expect(inboxMailKey("password-reset", "owner@example.com")).not.toBe(signupMailKey("owner@example.com"));
});
