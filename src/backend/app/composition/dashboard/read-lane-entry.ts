/** The dashboard's read-lane worker: every module that defines a lane read is imported here, before the lane starts serving. */
import "../../../storage/sqlite/dashboard-background-read-worker.js";
import "./queue.js";
import { runReadLaneWorker } from "../../../storage/sqlite/dashboard-read-host.js";

runReadLaneWorker();
