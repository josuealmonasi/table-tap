/**
 * The longest restaurant name, in characters after trimming. The database
 * holds the same limit (`restaurants_name_length`); the name is printed on
 * tickets, mail subjects and the menu header.
 */
export const RESTAURANT_NAME_MAX = 80;

/** The trimmed name, or null when it is empty or too long. */
export function cleanRestaurantName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || [...name].length > RESTAURANT_NAME_MAX) return null;
  return name;
}
