import { IsoInstantSchema } from "../identity/ids.js";

/** Backend IPC deadlines need one machine-wide monotonic basis across processes. */
export function machineMonotonicMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

export interface Clock {
  now(): Date;
  nowMs(): number;
  monotonicMs(): number;
  todayLocal(): string;
  timeOfDayCode(at?: Date): string;
  fiscalYear(at?: Date): number;
}

export interface TestClock extends Clock {
  advanceWall(ms: number): void;
  advanceMonotonic(ms: number): void;
  setWall(at: Date): void;
}

/** IANA zone used by the runtime's local Date getters and local calendar derivations. */
export function runtimeTimeZone(): string {
  try {
    const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof timeZone !== "string" || timeZone.length === 0) throw new Error("unavailable");
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    throw new Error("runtime-time-zone-unavailable");
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDatePart(at: Date): string {
  return `${String(at.getFullYear()).padStart(4, "0")}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function formatTraceTimestamp(at: Date): string {
  return `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}

export const systemClock: Clock = Object.freeze({
  now: () => new Date(),
  nowMs: () => Date.now(),
  monotonicMs: () => performance.now(),
  todayLocal: () => localDatePart(systemClock.now()),
  timeOfDayCode(at = systemClock.now()) {
    return formatTraceTimestamp(at);
  },
  fiscalYear(at = systemClock.now()) {
    return at.getMonth() >= 6 ? at.getFullYear() + 1 : at.getFullYear();
  },
});

export function capturedInstantClock(instant: string, elapsed: Pick<Clock, "monotonicMs"> = systemClock): Clock {
  const parsed = IsoInstantSchema.safeParse(instant);
  const milliseconds = parsed.success ? Date.parse(parsed.data) : Number.NaN;
  if (!Number.isFinite(milliseconds)) throw new RangeError("captured-instant-clock: invalid ISO instant");
  const current = (): Date => new Date(milliseconds);
  return Object.freeze({
    now: current,
    nowMs: () => milliseconds,
    monotonicMs: () => elapsed.monotonicMs(),
    todayLocal: () => localDatePart(current()),
    timeOfDayCode: (at = current()) => formatTraceTimestamp(at),
    fiscalYear: (at = current()) => at.getMonth() >= 6 ? at.getFullYear() + 1 : at.getFullYear(),
  });
}

export function manualClock(at: Date, initialMonotonicMs = 0): TestClock {
  let wallMs = at.getTime();
  let monotonic = initialMonotonicMs;
  const current = (): Date => new Date(wallMs);
  return {
    now: current,
    nowMs: () => wallMs,
    monotonicMs: () => monotonic,
    todayLocal: () => localDatePart(current()),
    timeOfDayCode(value = current()) {
      return formatTraceTimestamp(value);
    },
    fiscalYear(value = current()) {
      return value.getMonth() >= 6 ? value.getFullYear() + 1 : value.getFullYear();
    },
    advanceWall(ms) {
      wallMs += ms;
    },
    advanceMonotonic(ms) {
      monotonic += ms;
    },
    setWall(value) {
      wallMs = value.getTime();
    },
  };
}
