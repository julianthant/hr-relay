import { z } from "zod";
import "../../../../src/backend/storage/sqlite/dashboard-background-read-worker.js";
import { AuthoritySnapshotChangedError } from "../../../../src/backend/storage/sqlite/authority-errors.js";
import { defineLaneRead, runReadLaneWorker } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";

const built = { day: false };

/** A navigation lane whose fold leaves the next paired snapshot refused, as a peer commit between its two pins refuses it. */
export const laneFolded = defineLaneRead(import.meta.url, "lane-folded", { lane: "navigation", priority: "interactive", args: z.strictObject({}),
  warm({ history }) {
    Object.defineProperty(history, "withAuthorityReadSnapshot", { configurable: true, value: () => {
      Reflect.deleteProperty(history, "withAuthorityReadSnapshot");
      throw new AuthoritySnapshotChangedError();
    } });
  },
  run: () => ({ built: built.day }) });

/** Its optional day build, which asks for that refused snapshot. */
export const laneBuildRefused = defineLaneRead(import.meta.url, "lane-build-refused", { lane: "navigation", priority: "interactive", args: z.strictObject({}),
  warm() { built.day = true; },
  run: () => ({ built: built.day }) });

export const LANE_BUILD_REFUSED_ENTRY = new URL(import.meta.url);
runReadLaneWorker();
