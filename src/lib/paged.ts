/**
 * Every row of a read, however many there are.
 *
 * PostgREST returns at most a fixed number of rows per request (1000 on
 * Supabase unless configured otherwise) and says nothing when it stops: a
 * month of a busy café's orders read in one request is the first thousand of
 * them, and every total built on it is quietly too small.
 *
 * Pages until one comes back empty rather than until one comes back short,
 * so a server cap smaller than the page asked for cannot end it early. The
 * read must be ordered on something unique, or pages can overlap.
 *
 * Throws on a failed page: a total built on half the rows is a wrong number,
 * and the page's error screen is the honest answer.
 */
export async function everyRow<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
  size = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + size - 1);
    if (error) throw new Error(`Could not read ${what}: ${error.message}`);
    if (!data?.length) return rows;
    rows.push(...data);
  }
}
