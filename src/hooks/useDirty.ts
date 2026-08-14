import { useRef } from "react";

/**
 * Whether a form still holds the values it opened with.
 *
 * An enabled "save" on an untouched form invites a write that changes nothing:
 * the manager isn't sure whether they edited anything, saves to be safe, and
 * the record gets a new timestamp for no reason. Disabled until something
 * actually differs, the button answers the question instead of asking it.
 *
 * The snapshot is taken on the first render and compared by value, so forms
 * that rebuild their state into new objects on every keystroke still compare
 * against what the user started from. Pass whatever the form would submit.
 */
export function useDirty(current: unknown): boolean {
  const initial = useRef<string | null>(null);
  const now = JSON.stringify(current);
  if (initial.current === null) initial.current = now;
  return initial.current !== now;
}
