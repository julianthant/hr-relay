import type { ActivityVolume, ActivityVolumeGranularity } from "../../domain/dashboard/activity-volume.js";

const MIN_AXIS_LABEL_GAP_PX = 8;
const MAX_AXIS_DIVISIONS = 4;

const GRANULARITY_TITLE: Record<ActivityVolumeGranularity, string> = {
  hourly: "Hourly volume",
  daily: "Daily volume",
  weekly: "Weekly volume",
  monthly: "Monthly volume",
  yearly: "Yearly volume",
};

export function activityVolumeTitle(granularity: ActivityVolumeGranularity): string {
  return GRANULARITY_TITLE[granularity];
}

const GRANULARITY_UNIT: Record<ActivityVolumeGranularity, string> = {
  hourly: "hour",
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

export interface ActivityChartBucketModel {
  key: string;
  intervalStart: string;
  intervalEndExclusive: string;
  timeZone: string;
  runs: number;
  barHeightPercent: number;
  axisLabel: string;
  showAxisLabel: boolean;
  intervalLabel: string;
  accessibleLabel: string;
}

export interface ActivityChartAxisTick {
  value: number;
  topPercent: number;
}

export type ActivityVolumeChartModel =
  | { state: "unavailable" }
  | {
      state: "complete";
      title: string;
      granularity: ActivityVolumeGranularity;
      timeZone: string;
      totalRuns: number;
      intervalCount: number;
      empty: boolean;
      summary: string;
      axisMax: number;
      axisTicks: readonly ActivityChartAxisTick[];
      buckets: readonly ActivityChartBucketModel[];
    };

function inclusiveEnd(instant: string): Date {
  const milliseconds = Date.parse(instant);
  if (!Number.isFinite(milliseconds)) {
    throw new RangeError(`Activity chart interval end is not an instant: ${instant}`);
  }
  return new Date(milliseconds - 1);
}

function localDateParts(instant: string | Date, timeZone: string): { month: string; day: string; year: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatToParts(typeof instant === "string" ? new Date(instant) : instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return { month: value("month"), day: value("day"), year: value("year") };
}

function dateLabel(instant: string | Date, timeZone: string, includeYear: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(typeof instant === "string" ? new Date(instant) : instant);
}

function conciseDateRange(start: string, endExclusive: string, timeZone: string): string {
  const end = inclusiveEnd(endExclusive);
  const startParts = localDateParts(start, timeZone);
  const endParts = localDateParts(end, timeZone);
  if (startParts.year === endParts.year && startParts.month === endParts.month && startParts.day === endParts.day) {
    return dateLabel(start, timeZone, false);
  }
  if (startParts.year === endParts.year) {
    return `${dateLabel(start, timeZone, false)}–${dateLabel(end, timeZone, false)}`;
  }
  return `${dateLabel(start, timeZone, true)}–${dateLabel(end, timeZone, true)}`;
}

function conciseIntervalLabel(
  start: string,
  endExclusive: string,
  timeZone: string,
  granularity: ActivityVolumeGranularity,
): string {
  if (granularity === "hourly") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      timeZoneName: "shortOffset",
    }).format(new Date(start));
  }
  if (granularity === "monthly") {
    const end = inclusiveEnd(endExclusive);
    const startParts = localDateParts(start, timeZone);
    const endParts = localDateParts(end, timeZone);
    const label = (instant: string | Date) => new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      year: "numeric",
    }).format(typeof instant === "string" ? new Date(instant) : instant);
    return startParts.month === endParts.month && startParts.year === endParts.year
      ? label(start)
      : `${label(start)}–${label(end)}`;
  }
  if (granularity === "yearly") {
    const end = inclusiveEnd(endExclusive);
    const startYear = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(new Date(start));
    const endYear = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(end);
    return startYear === endYear ? startYear : `${startYear}–${endYear}`;
  }
  return conciseDateRange(start, endExclusive, timeZone);
}

function axisFormatter(timeZone: string, granularity: ActivityVolumeGranularity): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = granularity === "hourly"
    ? { hour: "numeric" }
    : granularity === "yearly"
      ? { year: "numeric" }
      : granularity === "monthly"
        ? { month: "short", year: "2-digit" }
        : { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options });
}

function hourlyAxisLabel(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    timeZoneName: "shortOffset",
  }).format(new Date(instant));
}

function estimatedFormattedLabelWidthPx(label: string): number {
  return [...label].reduce((width, character) => {
    if (character === " ") return width + 3;
    if (character === "–" || character === "-") return width + 5;
    if (/\d/u.test(character)) return width + 7;
    return width + 7;
  }, 4);
}

function visibleLabelIndices(labels: readonly string[], availableWidthPx: number): ReadonlySet<number> {
  if (labels.length <= 1) return new Set([0]);
  const width = Number.isFinite(availableWidthPx) ? Math.max(0, availableWidthPx) : 0;
  const labelWidths = labels.map(estimatedFormattedLabelWidthPx);
  const allLabelsWidth = labelWidths.reduce((total, labelWidth) => total + labelWidth, 0)
    + (labels.length - 1) * MIN_AXIS_LABEL_GAP_PX;
  if (allLabelsWidth <= width) return new Set(labels.map((_, index) => index));
  const averageWidth = allLabelsWidth / labels.length;
  const labelCount = Math.min(labels.length, Math.max(2, Math.floor(width / averageWidth)));
  const indices = new Set<number>();
  for (let label = 0; label < labelCount; label += 1) {
    indices.add(Math.round((label * (labels.length - 1)) / (labelCount - 1)));
  }
  return indices;
}

function axisForBuckets(buckets: ActivityVolume["buckets"]): { axisMax: number; ticks: ActivityChartAxisTick[] } {
  const largest = buckets.reduce((max, bucket) => Math.max(max, bucket.runs), 0);
  const step = largest <= MAX_AXIS_DIVISIONS ? 1 : Math.ceil(largest / MAX_AXIS_DIVISIONS);
  const axisMax = largest <= MAX_AXIS_DIVISIONS ? Math.max(1, largest) : step * MAX_AXIS_DIVISIONS;
  const divisions = Math.ceil(axisMax / step);
  const ticks = Array.from({ length: divisions + 1 }, (_, index) => {
    const value = (divisions - index) * step;
    return { value, topPercent: value === axisMax ? 0 : value === 0 ? 100 : 100 - (value / axisMax) * 100 };
  });
  return { axisMax, ticks };
}

export function createActivityVolumeChartModel(
  volume: ActivityVolume | undefined,
  availableWidthPx: number,
): ActivityVolumeChartModel {
  if (volume === undefined) return { state: "unavailable" };

  const labels = axisFormatter(volume.timeZone, volume.granularity);
  const baseAxisLabels = volume.buckets.map((bucket) => labels.format(new Date(bucket.start)));
  const duplicateAxisLabelCounts = new Map<string, number>();
  for (const label of baseAxisLabels) {
    duplicateAxisLabelCounts.set(label, (duplicateAxisLabelCounts.get(label) ?? 0) + 1);
  }
  const axisLabels = volume.buckets.map((bucket, index) => {
    const baseAxisLabel = baseAxisLabels[index];
    if (baseAxisLabel === undefined) throw new Error("Activity chart base axis label is missing");
    return volume.granularity === "hourly" && (duplicateAxisLabelCounts.get(baseAxisLabel) ?? 0) > 1
      ? hourlyAxisLabel(bucket.start, volume.timeZone)
      : baseAxisLabel;
  });
  const labelIndices = visibleLabelIndices(axisLabels, availableWidthPx);
  const buckets = volume.buckets.map((bucket, index) => {
    const axisLabel = axisLabels[index];
    if (axisLabel === undefined) throw new Error("Activity chart axis label is missing");
    return {
      key: bucket.start,
      intervalStart: bucket.start,
      intervalEndExclusive: bucket.endExclusive,
      timeZone: volume.timeZone,
      runs: bucket.runs,
      barHeightPercent: 0,
      axisLabel,
      showAxisLabel: labelIndices.has(index),
      intervalLabel: conciseIntervalLabel(bucket.start, bucket.endExclusive, volume.timeZone, volume.granularity),
      accessibleLabel: `Interval [${bucket.start}, ${bucket.endExclusive}) in ${volume.timeZone}: ${String(bucket.runs)} ${bucket.runs === 1 ? "run" : "runs"}`,
    };
  });
  const { axisMax, ticks } = axisForBuckets(volume.buckets);
  for (const bucket of buckets) {
    bucket.barHeightPercent = (bucket.runs / axisMax) * 100;
  }

  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("Activity volume series must contain at least one interval");
  }
  const unit = GRANULARITY_UNIT[volume.granularity];
  const period = `[${first.intervalStart}, ${last.intervalEndExclusive}) in ${volume.timeZone}`;
  const intervalWord = buckets.length === 1 ? `${unit} interval` : `${unit} intervals`;
  const summary = `${String(volume.coveredRuns)} ${volume.coveredRuns === 1 ? "run" : "runs"} across ${String(buckets.length)} ${intervalWord}; ${period}.`;

  return {
    state: "complete",
    title: GRANULARITY_TITLE[volume.granularity],
    granularity: volume.granularity,
    timeZone: volume.timeZone,
    totalRuns: volume.coveredRuns,
    intervalCount: buckets.length,
    empty: volume.coveredRuns === 0,
    summary,
    axisMax,
    axisTicks: ticks,
    buckets,
  };
}
