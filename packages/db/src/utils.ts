/** JST offset: UTC+9 in milliseconds */
const JST_OFFSET_MS = 9 * 60 * 60_000;

/**
 * Returns current time as JST ISO 8601 string with +09:00 offset.
 * Format: YYYY-MM-DDTHH:mm:ss.sss+09:00
 *
 * All timestamps in this project are standardized to JST.
 * The +09:00 suffix ensures new Date() parses correctly for epoch comparisons.
 */
export function jstNow(): string {
  return toJstString(new Date());
}

/**
 * Convert a Date object to JST ISO 8601 string with +09:00 offset.
 * Format: YYYY-MM-DDTHH:mm:ss.sss+09:00
 */
export function toJstString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, -1) + '+09:00';
}

/**
 * Compare two timestamp strings (any format) as epoch milliseconds.
 * Handles both Z and +09:00 formats correctly.
 */
export function isTimeBefore(a: string, b: string): boolean {
  return new Date(a).getTime() <= new Date(b).getTime();
}

/**
 * Normalize a user-supplied datetime string to carry an explicit JST offset.
 *
 * datetime-local inputs ("2026-06-25T10:00") have no timezone, and the Workers
 * runtime parses offset-naive datetimes as UTC — so a value the user meant as
 * 10:00 JST becomes 19:00 JST (9h skew). When the string already has a zone
 * (Z or ±HH:MM), it is returned untouched so correctly-formatted values are
 * never double-shifted.
 */
export function ensureJstOffset(s: string): string {
  const trimmed = s.trim();
  // Already has Z or ±HH:MM (allow optional colon) → leave as-is.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) return trimmed;
  // Date-only ("2026-06-25") → anchor at JST midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00+09:00`;
  // Offset-naive datetime → tag as JST.
  return `${trimmed}+09:00`;
}

/**
 * Add N calendar months to a JST timestamp, keeping the JST wall-clock day/time.
 * Returns a JST ISO 8601 string with +09:00 offset.
 *
 * Overflow (e.g. Jan 31 + 1 month) clamps to the last day of the target month
 * so a cycle anchored on the 31st rolls to Feb 28/29 instead of skipping to March.
 */
export function addMonthsJst(jstIso: string, months: number): string {
  const epoch = new Date(jstIso).getTime();
  // Shift into JST so that getUTC* fields represent the JST wall clock.
  const jst = new Date(epoch + JST_OFFSET_MS);
  const day = jst.getUTCDate();
  jst.setUTCMonth(jst.getUTCMonth() + months);
  // If the day rolled over into the following month, clamp to the last valid day.
  if (jst.getUTCDate() < day) {
    jst.setUTCDate(0);
  }
  // Convert the JST wall clock back to a real epoch, then to a +09:00 string.
  return toJstString(new Date(jst.getTime() - JST_OFFSET_MS));
}
