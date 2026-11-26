import { z } from "zod";
import "../../../../src/backend/storage/sqlite/dashboard-background-read-worker.js";
import { defineLaneRead, runReadLaneWorker } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";

/** A navigation read whose warm step always throws, so its lane never boots. */
export const laneWarmRefused = defineLaneRead(import.meta.url, "lane-warm-refused", { lane: "navigation", priority: "interactive", args: z.strictObject({}),
  warm() { throw new Error("lane-warm-refused"); },
  run: () => ({ served: true }) });

export const LANE_WARM_REFUSED_ENTRY = new URL(import.meta.url);
runReadLaneWorker();
