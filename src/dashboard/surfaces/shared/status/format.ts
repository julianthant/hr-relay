import { formatCalendarDate, formatInstantDate } from "../../../lib/date-format.js";
/** Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * src/dashboard/components/dev/rebuild-demo/demo-wire.ts (`fmtClock` */

/** A served ISO instant as the operator's wall clock (`3:07 PM`).
 * DEVIATION from the demo's implementation, on purpose: the demo regex-sliced */
export function fmtClock(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`fmtClock: not an ISO instant: ${iso}`);
  const date = new Date(ms);
  const h = date.getHours();
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(date.getMinutes()).padStart(2, "0")} ${suffix}`;
}

/** Confirmed action time in the operator's local wall clock, with seconds. */
export function fmtActionClock(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`fmtActionClock: not an ISO instant: ${iso}`);
  const date = new Date(ms);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}

/** Show negative elapsed as clock error; clamping would misreport future evidence as newly started. */
export function fmtElapsed(sec: number): string {
  if (sec < 0) return `-${fmtElapsed(-sec)}`;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

/** Keep signed served intervals so clock skew cannot masquerade as zero elapsed. */
export function elapsedSecondsBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from)) throw new Error(`elapsedSecondsBetween: not an ISO instant: ${fromIso}`);
  if (Number.isNaN(to)) throw new Error(`elapsedSecondsBetween: not an ISO instant: ${toIso}`);
  return Math.round((to - from) / 1000);
}

/** Settled runs require their recorded end; unknown durations retain reasons instead of substituting now. */
export function runTiming(
  surface: {
    readonly status: string;
    readonly startedAt: string;
    readonly endedAt: { readonly state: "present"; readonly value: string }
    | { readonly state: "absent"; readonly reason: string };
  },
  nowIso: string,
  isTerminalStatus: (status: string) => boolean,
): { text: string; title?: string } | undefined {
  if (surface.status === "queued") return undefined;
  if (surface.endedAt.state === "present") {
    // Bare: the number stands alone. What keeps it from a live elapsed is the row's
    // terminal status beside it, not a word in front of it.
    return { text: fmtElapsed(elapsedSecondsBetween(surface.startedAt, surface.endedAt.value)) };
  }
  if (isTerminalStatus(surface.status)) {
    return { text: "duration unknown", title: surface.endedAt.reason };
  }
  return { text: fmtElapsed(elapsedSecondsBetween(surface.startedAt, nowIso)) };
}


/** Dashboard dates use MM/DD/YYYY; canonical partitions and instants stay unchanged. */
export function dayLabel(day: string): string { return formatCalendarDate(day); }
export function fmtInstantDay(iso: string): string { return formatInstantDate(iso); }


export function pluralize(n: number, noun: string, pluralNoun?: string): string {
  return n === 1 ? noun : pluralNoun ?? `${noun}s`;
}

/** The count and the noun together — `3 columns`. */
export function plural(n: number, noun: string, pluralNoun?: string): string {
  return `${n} ${pluralize(n, noun, pluralNoun)}`;
}

/** Keep full opaque identifiers reachable beside the shared eye-scan prefix. */
export const SHORT_HASH_PREFIX = 8;

export function shortHash(value: string): string {
  return value.slice(0, SHORT_HASH_PREFIX);
}

/** Descriptor versions are single integers; never invent a minor version. */
export function versionTag(version: number): string {
  return `v${String(version)}`;
}

/** Display app major/minor; reject malformed served versions rather than silently printing raw text. */
export function fmtAppVersion(appVersion: string): string {
  const parts = appVersion.split(".");
  const [major, minor] = parts;
  if (
    parts.length < 2
    || major === undefined
    || minor === undefined
    || !/^\d+$/u.test(major)
    || !/^\d+$/u.test(minor)
  ) {
    throw new Error(
      `app version "${appVersion}" is not MAJOR.MINOR[.PATCH]; the shell's version tag prints the `
      + "first two components and will not guess at a shape it does not recognise",
    );
  }
  return `${major}.${minor}`;
}

/** `app 0.1` — where the number needs to say WHICH version it is. */
export function appVersionTag(appVersion: string): string {
  return `app ${fmtAppVersion(appVersion)}`;
}
