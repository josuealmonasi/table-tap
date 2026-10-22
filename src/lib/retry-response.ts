import { NextResponse } from "next/server";

/** Only a transaction that returned without writing may release a retry key. */
export async function uncommittedRefusal(response: NextResponse): Promise<NextResponse> {
  return NextResponse.json({ ...await response.json(), retryUncommitted: true }, { status: response.status });
}
