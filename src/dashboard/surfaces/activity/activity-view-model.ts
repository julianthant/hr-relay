import type { ActivityVolume } from "../../../domain/dashboard/activity-volume.js";
import type { ActivityDateRange } from "../activity-model.js";

export interface ActivityWorkflow {
  readonly id: string;
  readonly label: string;
  readonly version?: string;
  readonly completed: number;
  readonly outstanding: number;
  readonly failed: number;
  readonly total: number;
}

export interface ActivitySummary {
  readonly range: ActivityDateRange;
  readonly timeZone: string;
  readonly total: number;
  readonly completed: number;
  readonly outstanding: number;
  readonly running: number;
  readonly waiting: number;
  readonly failed: number;
  readonly terminal: number;
  readonly duration: { readonly medianSeconds: number | null; readonly measured: number; readonly unmeasured: number };
  readonly evidence: { readonly verified: number | null; readonly unread: number | null };
  readonly workflows: readonly ActivityWorkflow[];
  readonly transactions: readonly { readonly id: string; readonly label: string; readonly count: number; readonly environment: "production" | "test" }[];
  readonly volume?: ActivityVolume;
}

/** Presentation data; neither a transport response nor an execution authority. */
export type ActivityViewState =
  | { readonly state: "loaded"; readonly report: ActivitySummary }
  | { readonly state: "loading" }
  | { readonly state: "unavailable"; readonly reason: string };

export function activityDuration(seconds: number | null): string {
  if (seconds === null) return "Unavailable";
  const rounded = Math.round(seconds);
  return rounded < 60 ? `${rounded}s` : `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

export function activityFailureRate(failed: number, terminal: number): string {
  return terminal === 0 ? "No terminal runs" : `${failed} of ${terminal} terminal runs · ${Math.round(failed / terminal * 100)}%`;
}
