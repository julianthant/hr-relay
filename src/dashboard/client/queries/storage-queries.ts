import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";
import { RunHistoryStatusSchema, type RunHistoryStatus } from "../../../models/dashboard/run-history.js";


export interface StorageQueries {
  runHistoryStatus(): Promise<RunHistoryStatus>;
}

export function createStorageQueries(transport: DashboardTransport): StorageQueries { return Object.freeze({
    async runHistoryStatus() {
      return parseOrThrow(RunHistoryStatusSchema, "GET /api/v1/storage/run-history", await transport.requestJson("/api/v1/storage/run-history"));
    },
}); }
