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

/** Ids in one filter. Supabase refuses a URL past about 18 KB: 300 to 500 uuids. */
export const IDS_PER_READ = 150;

/**
 * Every row of a read filtered to a list of ids, however long the list.
 *
 * The ids ride in the URL, so a long list is refused outright — a menu of a
 * few hundred dishes, or a busy fortnight's orders. It goes in slices, and
 * each slice is read to its last row: a slice of 150 dishes with ten extras
 * each is already past the thousand rows one request returns.
 */
export async function everyRowIn<T>(
  ids: readonly string[],
  page: (slice: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const slices: string[][] = [];
  for (let i = 0; i < unique.length; i += IDS_PER_READ) slices.push(unique.slice(i, i + IDS_PER_READ));
  const parts = await Promise.all(slices.map(slice => everyRow<T>((from, to) => page(slice, from, to), what)));
  return parts.flat();
}
