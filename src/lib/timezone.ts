/**
 * Convert a wall-clock "YYYY-MM-DDTHH:mm" in an IANA time zone to a UTC Date,
 * and back. Uses Intl only (no dependencies). Handles DST by iterating on the offset.
 */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - date.getTime();
}

export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) throw new Error("invalid local datetime");
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = naive - tzOffsetMs(new Date(naive), timeZone);
  guess = naive - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

export function utcToZonedLocal(date: Date, timeZone: string): string {
  const shifted = new Date(date.getTime() + tzOffsetMs(date, timeZone));
  return shifted.toISOString().slice(0, 16);
}
