import { NextResponse } from "next/server";
import { messagesFor, translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

/**
 * A translated cart error that keeps the machine-readable fields alongside it.
 *
 * The customer screen acts on `unavailableItemId` / `missingModifiers` to
 * highlight the offending line, so the message can't just be a bare string —
 * and it can't stay English either, which is what it was until now.
 */
export async function cartError(
  key: string,
  vars: Record<string, string | number>,
  status: number,
  extra: Record<string, unknown>,
): Promise<NextResponse> {
  const messages = messagesFor(await getLocale());
  return NextResponse.json(
    { error: translate(messages, key, vars), ...extra },
    { status },
  );
}
