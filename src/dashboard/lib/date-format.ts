/** Date-only values retain their calendar day; instants use the caller's time zone. */
export function formatCalendarDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('DASHBOARD_CALENDAR_DATE_INVALID');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error('DASHBOARD_CALENDAR_DATE_INVALID');
  return `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`;
}

export function formatInstantDate(value: string | Date, timeZone?: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(date.valueOf())) throw new Error('DASHBOARD_INSTANT_DATE_INVALID');
  return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', ...(timeZone ? { timeZone } : {}) }).format(date);
}

/** Unknown or abbreviated extracted dates remain editable evidence, never guessed years. */
export function displayExtractedDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    try { return formatCalendarDate(value); } catch { return value; }
  }
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/u.exec(value);
  if (!match) return value;
  try { return formatCalendarDate(`${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`); } catch { return value; }
}
