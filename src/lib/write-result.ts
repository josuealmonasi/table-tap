export interface WriteResult {
  error: { message: string } | null;
  data?: readonly unknown[] | null;
  count?: number | null;
}

/** RLS can hide every target without an error. Success needs rows or a count. */
export function writeError(result: WriteResult, expected = 1): { message: string } | null {
  if (result.error) return result.error;
  return (result.count ?? result.data?.length) === expected
    ? null
    : { message: "The write did not change all expected rows" };
}
