import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TableJoinNotice from "../table-join-notice";
import { LocaleProvider } from "@/lib/i18n/context";
import { messagesFor, translate, type Locale } from "@/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

function screen(locale: Locale, error = false, pendingError = true): string {
  return renderToStaticMarkup(<LocaleProvider locale={locale}>
    <TableJoinNotice restaurantId="restaurant" state={{ status: "approved", sessionId: "sitting", diner: "me", pass: "pass" }}
      pending={[]} error={error} pendingError={pendingError} refresh={() => {}} />
  </LocaleProvider>);
}

it.each(["en", "es"] as const)("distinguishes the pending-list failure from admission failure in %s", locale => {
  const html = screen(locale);
  expect(html).toContain(translate(messagesFor(locale), "join.requestsFailed"));
  expect(html).not.toContain(translate(messagesFor(locale), "join.failed"));
  expect(html).not.toContain(translate(messagesFor(locale), "join.checking"));
});

it.each(["en", "es"] as const)("shows only the admission error when the whole poll fails in %s", locale => {
  const html = screen(locale, true);
  expect(html).toContain(translate(messagesFor(locale), "join.failed"));
  expect(html).not.toContain(translate(messagesFor(locale), "join.requestsFailed"));
});

it.each(["en", "es"] as const)("clears the warning after the list recovers in %s", locale => {
  expect(screen(locale, false, false)).toBe("");
});
