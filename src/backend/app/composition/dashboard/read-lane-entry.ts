import "../../../storage/sqlite/dashboard-background-read-worker.js";
import { runReadLaneWorker } from "../../../storage/sqlite/dashboard-read-host.js";

runReadLaneWorker(new Map<string, () => Promise<unknown>>([
  [import.meta.resolve("../../../runs/queries/bootstrap.js"), () => import("../../../runs/queries/bootstrap.js")],
  [import.meta.resolve("../../../runs/queries/calendar.js"), () => import("../../../runs/queries/calendar.js")],
  [import.meta.resolve("../../../runs/queries/item-attempt-history.js"), () => import("../../../runs/queries/item-attempt-history.js")],
  [import.meta.resolve("./activity.js"), () => import("./activity.js")],
  [import.meta.resolve("./notification-sources.js"), () => import("./notification-sources.js")],
  [import.meta.resolve("./notification-wiring.js"), () => import("./notification-wiring.js")],
  [import.meta.resolve("./queue.js"), () => import("./queue.js")],
  [import.meta.resolve("./run-detail.js"), () => import("./run-detail.js")],
  [import.meta.resolve("./settings.js"), () => import("./settings.js")],
  [import.meta.resolve("./shell.js"), () => import("./shell.js")],
]));
