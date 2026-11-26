import { z } from "zod";
import "../../../../src/backend/storage/sqlite/dashboard-background-read-worker.js";
import { defineLaneRead, runReadLaneWorker } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { systemClock } from "../../../../src/rules/time/clock.js";

/** How long the warm step holds the lane, so a ready that does not wait for it shows. */
export const WARM_MS = 200;
const pause = new Int32Array(new SharedArrayBuffer(4));
const warmed: { at?: number; count: number } = { count: 0 };

/** A navigation read whose warm step blocks the lane before it reports ready. */
export const laneWarmed = defineLaneRead(import.meta.url, "lane-warmed", { lane: "navigation", priority: "interactive", args: z.strictObject({}),
  warm(context) {
    Atomics.wait(pause, 0, 0, WARM_MS);
    warmed.count += 1;
    warmed.at = context.nowMs;
  },
  run: () => ({ warms: warmed.count, warmedAt: warmed.at ?? null }) });

/** How long the optional prebuild holds the lane, so a ready that waits for it shows. */
const PREBUILD_MS = 300;
const prebuilt: { at?: number } = {};

/** A navigation read whose optional prebuild blocks the lane, and reports when it finished. */
export const lanePrebuilt = defineLaneRead(import.meta.url, "lane-prebuilt", { lane: "navigation", priority: "interactive", args: z.strictObject({}),
  prebuild() {
    Atomics.wait(pause, 0, 0, PREBUILD_MS);
    prebuilt.at = systemClock.nowMs();
  },
  run: () => ({ prebuiltAt: prebuilt.at ?? null }) });

export const LANE_WARM_ENTRY = new URL(import.meta.url);
runReadLaneWorker();
