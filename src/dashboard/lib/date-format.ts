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
  return formatter({ month: '2-digit', day: '2-digit', year: 'numeric' }, timeZone).format(date);
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

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(options: Intl.DateTimeFormatOptions, timeZone?: string): Intl.DateTimeFormat {
  const key = JSON.stringify([options, timeZone]);
  let cached = formatters.get(key);
  if (cached === undefined) {
    cached = new Intl.DateTimeFormat('en-US', { ...options, ...(timeZone ? { timeZone } : {}) });
    formatters.set(key, cached);
  }
  return cached;
}

function instant(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(date.valueOf())) throw new Error('DASHBOARD_INSTANT_DATE_INVALID');
  return date;
}

function parts(options: Intl.DateTimeFormatOptions, value: string | Date, timeZone?: string): Readonly<Record<string, string>> {
  return Object.fromEntries(formatter(options, timeZone).formatToParts(instant(value)).map((part) => [part.type, part.value]));
}

/** `1:55 PM`: the 12-hour clock with plain spaces; the zone is the caller's (the browser's when omitted). */
export function formatTime(value: string | Date, timeZone?: string): string {
  const p = parts({ hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }, value, timeZone);
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** `2:00:02 PM`: seconds only where the order inside a minute matters (Logs). */
export function formatTimeWithSeconds(value: string | Date, timeZone?: string): string {
  const p = parts({ hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h12' }, value, timeZone);
  return `${p.hour}:${p.minute}:${p.second} ${p.dayPeriod}`;
}

/** `Nov 18, 2026`. */
export function formatDay(value: string | Date, timeZone?: string): string {
  const p = parts({ month: 'short', day: 'numeric', year: 'numeric' }, value, timeZone);
  return `${p.month} ${p.day}, ${p.year}`;
}

/** `Nov 18, 2:19 PM`; the year joins the day only when it is not the current year (`now` defaults to the clock). */
export function formatDayTime(value: string | Date, timeZone?: string, now: Date = new Date()): string {
  const p = parts({ month: 'short', day: 'numeric', year: 'numeric' }, value, timeZone);
  const year = parts({ year: 'numeric' }, now, timeZone).year;
  return `${p.month} ${p.day}, ${p.year === year ? '' : `${p.year}, `}${formatTime(value, timeZone)}`;
}

/** `6m 47s`, `7s`, `<1s`, `1h 04m`; negative spans keep their sign so clock skew stays visible. */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return `-${formatDuration(-seconds)}`;
  if (seconds < 1) return '<1s';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`;
}

/** `Sun` or `Sunday`. */
export function formatWeekday(value: string | Date, timeZone: string | undefined, style: 'short' | 'long'): string {
  return parts({ weekday: style }, value, timeZone).weekday!;
}

/** `Sep 20` or `September 20`. */
export function formatMonthDay(value: string | Date, timeZone: string | undefined, style: 'short' | 'long'): string {
  const p = parts({ month: style, day: 'numeric' }, value, timeZone);
  return `${p.month} ${p.day}`;
}

/** `2026-09` → `September 2026`. */
export function formatMonthYear(month: string): string {
  const p = parts({ month: 'long', year: 'numeric' }, `${month}-01T00:00:00.000Z`, 'UTC');
  return `${p.month} ${p.year}`;
}

/** `2026-09-17`: the calendar day an instant falls on in the zone. */
export function formatLocalDay(value: string | Date, timeZone: string): string {
  const p = parts({ year: 'numeric', month: '2-digit', day: '2-digit' }, value, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}
