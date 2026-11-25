import "../../../storage/sqlite/dashboard-background-read-worker.js";
import "./shell.js";
import { runReadLaneWorker } from "../../../storage/sqlite/dashboard-read-host.js";

runReadLaneWorker();
