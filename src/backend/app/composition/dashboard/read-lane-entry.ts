import "../../../storage/sqlite/dashboard-background-read-worker.js";
import "./shell.js";
import "./notification-sources.js";
import "./queue.js";
import "./write-safety.js";
import "./activity.js";
import "./notification-wiring.js";
import "./settings.js";
import { runReadLaneWorker } from "../../../storage/sqlite/dashboard-read-host.js";

runReadLaneWorker();
