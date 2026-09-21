/**
 * The zones offered in Settings.
 *
 * Deliberately short. Menu schedules only need the zone the restaurant is
 * actually in, and every IANA name the runtime knows is ~400 options — a list
 * nobody can scan. Mexico and the United States cover where TableTap operates;
 * adding a country later is a few lines here.
 *
 * Grouped so the select can use <optgroup>, and labelled through i18n because
 * "Mexico City" and "Ciudad de México" are not the same word.
 */
export interface ZoneGroup {
  /** i18n key for the group heading. */
  labelKey: string;
  zones: { zone: string; labelKey: string }[];
}

export const ZONE_GROUPS: ZoneGroup[] = [
  {
    labelKey: "tz.mexico",
    zones: [
      { zone: "America/Mexico_City", labelKey: "tz.mexicoCity" },
      { zone: "America/Cancun", labelKey: "tz.cancun" },
      { zone: "America/Merida", labelKey: "tz.merida" },
      { zone: "America/Monterrey", labelKey: "tz.monterrey" },
      { zone: "America/Chihuahua", labelKey: "tz.chihuahua" },
      { zone: "America/Mazatlan", labelKey: "tz.mazatlan" },
      { zone: "America/Tijuana", labelKey: "tz.tijuana" },
      { zone: "America/Hermosillo", labelKey: "tz.hermosillo" },
    ],
  },
  {
    labelKey: "tz.usa",
    zones: [
      { zone: "America/New_York", labelKey: "tz.newYork" },
      { zone: "America/Chicago", labelKey: "tz.chicago" },
      { zone: "America/Denver", labelKey: "tz.denver" },
      { zone: "America/Phoenix", labelKey: "tz.phoenix" },
      { zone: "America/Los_Angeles", labelKey: "tz.losAngeles" },
      { zone: "America/Anchorage", labelKey: "tz.anchorage" },
      { zone: "Pacific/Honolulu", labelKey: "tz.honolulu" },
    ],
  },
];

/** Every zone the selector offers — what the settings route accepts. */
export const ALLOWED_ZONES: string[] = ZONE_GROUPS.flatMap(g => g.zones.map(z => z.zone));

/** Only a zone we actually offer; keeps an arbitrary string out of the column. */
export function isAllowedTimeZone(zone: string): boolean {
  return ALLOWED_ZONES.includes(zone);
}

/**
 * The zone's current offset, e.g. "GMT-6". Shown beside the city so two zones
 * an hour apart are told apart without knowing the geography, and worked out
 * at the moment it is asked so it follows daylight saving where there is any:
 * Tijuana and the four US zones move their clocks, Phoenix does not.
 *
 * NOT the reason Cancún and Mérida differ, which this comment used to claim.
 * Mexico stopped changing its clocks in 2022, so both are fixed — Cancún on
 * GMT-5 all year and Mérida on GMT-6 all year. They are an hour apart in
 * January as much as in July, which is exactly why a restaurant in one must
 * not be offered only the other.
 */
export function offsetLabel(zone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    return parts.find(p => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}
