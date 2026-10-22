/** Calendar-only parsing. Never construct a Date, parse a timezone, or use UTC. */
export function parseAcquiredOn(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) throw new Error(`Invalid acquisition date: ${text}`);
  const month = Number(match[1]); const day = Number(match[2]); const year = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) {
    throw new Error(`Invalid acquisition date: ${text}`);
  }
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
