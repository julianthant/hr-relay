import type { Clock } from "../clock.js";
import type { AnnualDateEntry, Config } from "./schema.js";

export class FiscalDateNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiscalDateNotConfiguredError";
  }
}

interface CalendarParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function leapYear(year: number): boolean {
  return year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
}

function parseUsDate(value: string, field: string): CalendarParts {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new FiscalDateNotConfiguredError(`${field} must use M/D/YYYY (got ${value})`);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const days = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximum = days[month - 1];
  if (maximum === undefined || day < 1 || day > maximum) {
    throw new FiscalDateNotConfiguredError(`${field} is not a valid calendar date (got ${value})`);
  }
  return { year, month, day };
}

function dateCode(parts: CalendarParts): number {
  return parts.year * 10_000 + parts.month * 100 + parts.day;
}

function parseLocalDate(value: string): CalendarParts {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new FiscalDateNotConfiguredError(`Clock.todayLocal returned invalid date ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function assertNotPast(value: string, field: string, clock: Clock): void {
  if (dateCode(parseUsDate(value, field)) < dateCode(parseLocalDate(clock.todayLocal()))) {
    throw new FiscalDateNotConfiguredError(`${field}=${value} is stale for today ${clock.todayLocal()}`);
  }
}

export function requireAnnualDates(config: Config, clock: Clock): AnnualDateEntry {
  const fiscalYear = clock.fiscalYear();
  const key = `FY${String(fiscalYear)}`;
  const entry = config.annualDates[key];
  if (entry === undefined) {
    throw new FiscalDateNotConfiguredError(
      `no ANNUAL_DATES configured for ${key} (today ${clock.todayLocal()} falls in ${key}, `
      + `Jul 1 ${String(fiscalYear - 1)} – Jun 30 ${String(fiscalYear)}); configure annualDates.${key}`,
    );
  }
  assertNotPast(entry.jobEndDate, `${key}.jobEndDate`, clock);
  return entry;
}
