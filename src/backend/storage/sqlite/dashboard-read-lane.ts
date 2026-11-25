/** The read-lane worker: every module that defines a lane read is imported here, before the lane starts serving. */
import "./dashboard-background-read-worker.js";
import { runReadLaneWorker } from "./dashboard-read-host.js";

runReadLaneWorker();
