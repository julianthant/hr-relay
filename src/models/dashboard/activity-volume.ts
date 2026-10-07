import { z } from "zod";
import { IsoInstantSchema } from "../../rules/identity/ids.js";

export const ACTIVITY_VOLUME_WEEK_STARTS_ON = 0;
export const ACTIVITY_VOLUME_MAX_YEAR_BUCKETS = 32;
const MILLISECONDS_PER_DAY = 86_400_000;
const MILLISECONDS_PER_HOUR = 3_600_000;

export const ActivityVolumeGranularitySchema = z.enum([
  "hourly", "daily", "weekly", "monthly", "yearly",
]);
export type ActivityVolumeGranularity = z.infer<typeof ActivityVolumeGranularitySchema>;

type ActivityVolumeGranularityPolicy =
  | { kind: "hourly"; unit: "hour"; step: 1 }
  | { kind: "daily"; unit: "day"; step: 1 }
  | { kind: "weekly"; unit: "week"; weekStartsOn: 0 }
  | { kind: "monthly"; unit: "month"; step: 1 }
  | { kind: "yearly"; unit: "year"; yearsPerBucket: number };

interface ActivityVolumeDateRange {
  from: string;
  to: string;
}

interface ActivityVolumeInterval {
  start: string;
  endExclusive: string;
}

interface ActivityVolumeBucketBoundary {
  start: string;
  endExclusive: string;
}

interface ActivityVolumeBoundarySkeleton {
  timeZone: string;
  granularity: ActivityVolumeGranularity;
  interval: ActivityVolumeInterval;
  buckets: ActivityVolumeBucketBoundary[];
}

const ExpandedYearInstantSchema = z.string().refine((value) => {
  if (!/^[+-]\d{6}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}, "must be an ISO date-time with an expanded year and explicit offset");
const ActivityVolumeInstantSchema = z.union([IsoInstantSchema, ExpandedYearInstantSchema]);
export const ActivityTimeZoneSchema = z.string().min(1).refine(isValidActivityTimeZone, "must be a valid IANA time zone");
const ActivityVolumeIntervalSchema = z.strictObject({
  start: ActivityVolumeInstantSchema,
  endExclusive: ActivityVolumeInstantSchema,
});
const ActivityVolumeBucketSchema = z.strictObject({
  start: ActivityVolumeInstantSchema,
  endExclusive: ActivityVolumeInstantSchema,
  runs: z.number().int().nonnegative(),
});

export const ActivityVolumeSchema = z.strictObject({
  state: z.literal("complete"),
  timeZone: ActivityTimeZoneSchema,
  granularity: ActivityVolumeGranularitySchema,
  interval: ActivityVolumeIntervalSchema,
  coveredRuns: z.number().int().nonnegative(),
  buckets: z.array(ActivityVolumeBucketSchema).min(1).max(ACTIVITY_VOLUME_MAX_YEAR_BUCKETS),
}).superRefine((volume, context) => {
  const intervalStart = Date.parse(volume.interval.start);
  const intervalEnd = Date.parse(volume.interval.endExclusive);
  if (intervalStart >= intervalEnd) {
    context.addIssue({ code: "custom", path: ["interval"], message: "volume interval must have positive duration" });
  }

  let expectedStart = intervalStart;
  let bucketTotal = 0;
  for (const [index, bucket] of volume.buckets.entries()) {
    const start = Date.parse(bucket.start);
    const end = Date.parse(bucket.endExclusive);
    if (start >= end) {
      context.addIssue({ code: "custom", path: ["buckets", index], message: "bucket interval must have positive duration" });
    }
    if (start !== expectedStart) {
      context.addIssue({ code: "custom", path: ["buckets", index, "start"], message: "buckets must be ordered, contiguous, and clipped to the overall interval" });
    }
    if (start < intervalStart || end > intervalEnd) {
      context.addIssue({ code: "custom", path: ["buckets", index], message: "bucket interval must be contained by the overall interval" });
    }
    expectedStart = end;
    bucketTotal += bucket.runs;
  }
  if (expectedStart !== intervalEnd) {
    context.addIssue({ code: "custom", path: ["buckets"], message: "buckets must cover the overall interval without gaps or overlap" });
  }
  if (bucketTotal !== volume.coveredRuns) {
    context.addIssue({ code: "custom", path: ["coveredRuns"], message: `bucket counts sum to ${String(bucketTotal)} but volume covers ${String(volume.coveredRuns)} runs` });
  }
});
export type ActivityVolume = z.infer<typeof ActivityVolumeSchema>;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface ZonedDateParts extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
}

function formatterForZone(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      era: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new RangeError(`activity volume: invalid IANA time zone ${String(timeZone)}`);
  }
}

function isValidActivityTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function partsAt(milliseconds: number, formatter: Intl.DateTimeFormat): ZonedDateParts {
  const parts = formatter.formatToParts(new Date(milliseconds));
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const era = value("era");
  const yearOfEra = Number(value("year"));
  const year = era === "BC" || era === "BCE" ? 1 - yearOfEra : yearOfEra;
  const result = {
    year,
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    second: Number(value("second")),
  };
  if (Object.values(result).some((part) => !Number.isInteger(part))) {
    throw new RangeError("activity volume: time zone could not represent the requested instant");
  }
  return result;
}

function compareDate(left: CalendarDate, right: CalendarDate): number {
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

function parseRangeDate(value: string): CalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 0 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function calendarMilliseconds(date: CalendarDate): number {
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(date.year, date.month - 1, date.day);
  return value.getTime();
}

function fromCalendarMilliseconds(milliseconds: number): CalendarDate {
  const date = new Date(milliseconds);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromCalendarMilliseconds(calendarMilliseconds(date) + days * MILLISECONDS_PER_DAY);
}

function daysInclusive(from: CalendarDate, to: CalendarDate): number {
  return (calendarMilliseconds(to) - calendarMilliseconds(from)) / MILLISECONDS_PER_DAY + 1;
}

function parseValidRange(
  range: ActivityVolumeDateRange,
  caller = "activity volume",
): { from: CalendarDate; to: CalendarDate } {
  if (typeof range !== "object" || range === null
    || typeof range.from !== "string" || typeof range.to !== "string") {
    throw new RangeError(`${caller}: range must contain ordered valid YYYY-MM-DD dates from 0000 through 9999`);
  }
  const from = parseRangeDate(range.from);
  const to = parseRangeDate(range.to);
  if (from === null || to === null || compareDate(from, to) > 0) {
    throw new RangeError(`${caller}: range must contain ordered valid YYYY-MM-DD dates from 0000 through 9999`);
  }
  return { from, to };
}

/** Shared date-only threshold policy for the Activity range model and volume series. */
export function chooseActivityVolumeGranularity(range: ActivityVolumeDateRange): ActivityVolumeGranularityPolicy {
  const { from, to } = parseValidRange(range, "chooseActivityVolumeGranularity");
  const count = daysInclusive(from, to);
  if (count === 1) return { kind: "hourly", unit: "hour", step: 1 };
  if (count <= 31) return { kind: "daily", unit: "day", step: 1 };
  if (count <= 180) return { kind: "weekly", unit: "week", weekStartsOn: ACTIVITY_VOLUME_WEEK_STARTS_ON };
  if (count <= 730) return { kind: "monthly", unit: "month", step: 1 };
  return {
    kind: "yearly",
    unit: "year",
    yearsPerBucket: Math.max(1, Math.ceil((to.year - from.year + 1) / ACTIVITY_VOLUME_MAX_YEAR_BUCKETS)),
  };
}

function formatYear(year: number): string {
  if (year >= 0 && year <= 9999) return String(year).padStart(4, "0");
  return `${year < 0 ? "-" : "+"}${String(Math.abs(year)).padStart(6, "0")}`;
}

function formatCalendarDate(date: CalendarDate): string {
  return `${formatYear(date.year)}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function scalarUtc(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const value = new Date(0);
  value.setUTCHours(hour, minute, second, 0);
  value.setUTCFullYear(year, month - 1, day);
  return value.getTime();
}

function firstInstantOfLocalDate(date: CalendarDate, formatter: Intl.DateTimeFormat): number {
  const target = calendarMilliseconds(date);
  let low = target - 48 * MILLISECONDS_PER_HOUR;
  let high = target + 48 * MILLISECONDS_PER_HOUR;
  const lowDate = (): CalendarDate => {
    const { year, month, day } = partsAt(low, formatter);
    return { year, month, day };
  };
  const highDate = (): CalendarDate => {
    const { year, month, day } = partsAt(high, formatter);
    return { year, month, day };
  };
  if (compareDate(lowDate(), date) >= 0 || compareDate(highDate(), date) < 0) {
    throw new RangeError(`activity volume: could not resolve local calendar date ${formatCalendarDate(date)}`);
  }

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    const { year, month, day } = partsAt(middle, formatter);
    if (compareDate({ year, month, day }, date) < 0) low = middle;
    else high = middle;
  }
  const resolved = partsAt(high, formatter);
  if (compareDate(resolved, date) !== 0) {
    throw new RangeError(`activity volume: local calendar date ${formatCalendarDate(date)} does not exist in the reporting time zone`);
  }
  return high;
}

function formatInstant(milliseconds: number, formatter: Intl.DateTimeFormat): string {
  const parts = partsAt(milliseconds, formatter);
  const wholeSecond = Math.floor(milliseconds / 1000) * 1000;
  const offsetMinutes = (scalarUtc(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second) - wholeSecond) / 60_000;
  if (!Number.isInteger(offsetMinutes)) {
    // Historical IANA offsets can include seconds, which ISO's numeric offset cannot represent.
    return new Date(milliseconds).toISOString();
  }
  if (Math.abs(offsetMinutes) >= 24 * 60) {
    throw new RangeError("activity volume: could not resolve the reporting time zone offset");
  }
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, "0")}:${String(absoluteOffset % 60).padStart(2, "0")}`;
  const fractional = String(((milliseconds % 1000) + 1000) % 1000).padStart(3, "0");
  return `${formatCalendarDate(parts)}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}.${fractional}${offset}`;
}

function interval(start: number, endExclusive: number, formatter: Intl.DateTimeFormat): ActivityVolumeInterval {
  return { start: formatInstant(start, formatter), endExclusive: formatInstant(endExclusive, formatter) };
}

function clipBoundary(start: number, candidateEnd: number, intervalEnd: number, formatter: Intl.DateTimeFormat): ActivityVolumeBucketBoundary {
  return interval(start, Math.min(candidateEnd, intervalEnd), formatter);
}

function nextMonthStart(date: CalendarDate): CalendarDate {
  return date.month === 12 ? { year: date.year + 1, month: 1, day: 1 } : { year: date.year, month: date.month + 1, day: 1 };
}

function makeBuckets(
  range: ActivityVolumeDateRange,
  granularity: ActivityVolumeGranularityPolicy,
  overallStart: number,
  overallEnd: number,
  formatter: Intl.DateTimeFormat,
): ActivityVolumeBucketBoundary[] {
  const { from, to } = parseValidRange(range);
  const boundaries: ActivityVolumeBucketBoundary[] = [];

  if (granularity.kind === "hourly") {
    for (let start = overallStart; start < overallEnd;) {
      const end = Math.min(start + MILLISECONDS_PER_HOUR, overallEnd);
      boundaries.push(interval(start, end, formatter));
      start = end;
    }
    return boundaries;
  }

  if (granularity.kind === "daily") {
    for (let date = from; compareDate(date, to) <= 0; date = addDays(date, 1)) {
      const next = addDays(date, 1);
      const start = firstInstantOfLocalDate(date, formatter);
      const end = firstInstantOfLocalDate(next, formatter);
      boundaries.push(clipBoundary(start, end, overallEnd, formatter));
    }
    return boundaries;
  }

  if (granularity.kind === "weekly") {
    const weekday = new Date(calendarMilliseconds(from)).getUTCDay();
    let boundaryDate = addDays(from, weekday === ACTIVITY_VOLUME_WEEK_STARTS_ON ? 7 : 7 - weekday);
    let start = overallStart;
    while (start < overallEnd) {
      const end = boundaryDate.year > to.year || compareDate(boundaryDate, addDays(to, 1)) >= 0
        ? overallEnd
        : firstInstantOfLocalDate(boundaryDate, formatter);
      boundaries.push(interval(start, Math.min(end, overallEnd), formatter));
      start = end;
      boundaryDate = addDays(boundaryDate, 7);
    }
    return boundaries;
  }

  if (granularity.kind === "monthly") {
    let boundaryDate = nextMonthStart(from);
    let start = overallStart;
    while (start < overallEnd) {
      const end = compareDate(boundaryDate, addDays(to, 1)) >= 0
        ? overallEnd
        : firstInstantOfLocalDate(boundaryDate, formatter);
      boundaries.push(interval(start, Math.min(end, overallEnd), formatter));
      start = end;
      boundaryDate = nextMonthStart(boundaryDate);
    }
    return boundaries;
  }

  let boundaryDate: CalendarDate = { year: from.year + granularity.yearsPerBucket, month: 1, day: 1 };
  let start = overallStart;
  while (start < overallEnd) {
    const end = compareDate(boundaryDate, addDays(to, 1)) >= 0
      ? overallEnd
      : firstInstantOfLocalDate(boundaryDate, formatter);
    boundaries.push(interval(start, Math.min(end, overallEnd), formatter));
    start = end;
    boundaryDate = { year: boundaryDate.year + granularity.yearsPerBucket, month: 1, day: 1 };
  }
  return boundaries;
}

/** Construct bounded, contiguous real-instant bucket intervals for an inclusive report-calendar range. */
export function buildActivityVolumeBoundarySkeleton(
  range: ActivityVolumeDateRange,
  timeZone: string,
): ActivityVolumeBoundarySkeleton {
  const { from, to } = parseValidRange(range, "buildActivityVolumeBoundarySkeleton");
  if (typeof timeZone !== "string" || !isValidActivityTimeZone(timeZone)) {
    throw new RangeError(`buildActivityVolumeBoundarySkeleton: invalid IANA time zone ${String(timeZone)}`);
  }
  const formatter = formatterForZone(timeZone);
  const policy = chooseActivityVolumeGranularity(range);
  const afterRange = addDays(to, 1);
  const startMilliseconds = firstInstantOfLocalDate(from, formatter);
  const endMilliseconds = firstInstantOfLocalDate(afterRange, formatter);
  if (startMilliseconds >= endMilliseconds) {
    throw new RangeError("buildActivityVolumeBoundarySkeleton: range has no positive duration in the reporting time zone");
  }
  const overall = interval(startMilliseconds, endMilliseconds, formatter);
  const buckets = makeBuckets(range, policy, startMilliseconds, endMilliseconds, formatter);
  if (buckets.length === 0) {
    throw new RangeError("buildActivityVolumeBoundarySkeleton: range produced no volume buckets");
  }
  return { timeZone, granularity: policy.kind, interval: overall, buckets };
}

/** Create a report-calendar date reader that validates an IANA zone once for a bounded summary fold. */
export function createActivityDatePartReader(timeZone: string): (instant: string) => string {
  if (typeof timeZone !== "string" || !isValidActivityTimeZone(timeZone)) {
    throw new RangeError(`createActivityDatePartReader: invalid IANA time zone ${String(timeZone)}`);
  }
  const formatter = formatterForZone(timeZone);
  return (instant: string): string => {
    if (typeof instant !== "string" || !ActivityVolumeInstantSchema.safeParse(instant).success) {
      throw new RangeError("activityDatePartAtInstant: instant must be an ISO date-time with an explicit offset");
    }
    const milliseconds = Date.parse(instant);
    if (!Number.isFinite(milliseconds)) throw new RangeError("activityDatePartAtInstant: instant is outside the supported date range");
    return formatCalendarDate(partsAt(milliseconds, formatter));
  };
}

/** Return the instant's report-calendar date in an explicitly resolved IANA time zone. */
export function activityDatePartAtInstant(instant: string, timeZone: string): string {
  if (typeof timeZone !== "string" || !isValidActivityTimeZone(timeZone)) {
    throw new RangeError(`activityDatePartAtInstant: invalid IANA time zone ${String(timeZone)}`);
  }
  return createActivityDatePartReader(timeZone)(instant);
}
