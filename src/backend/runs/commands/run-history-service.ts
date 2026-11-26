import { z } from "zod";
import { RunHistoryStatusSchema, type RunHistoryCommand, type ClearRunHistoryResult, type RunHistoryStatus } from "../../../models/dashboard/run-history.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { defineLaneRead, type DashboardReadLanes } from "../../storage/sqlite/dashboard-read-host.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";

export interface RunHistoryService {
  status(): RunHistoryStatus | Promise<RunHistoryStatus>;
  clear(request: RunHistoryCommand): ClearRunHistoryResult;
  check(request: RunHistoryCommand): ClearRunHistoryResult;
}

const runHistoryStatusRead = defineLaneRead(import.meta.url, "run-history-status", {
  lane: "navigation", priority: "interactive", args: z.strictObject({}), tables: ["runs"],
  run({ native }): RunHistoryStatus {
    const { finished, active } = native.authority.runs.countByTerminal();
    return { state: "available", finishedRuns: finished, activeRuns: active };
  },
});

export function createRunHistoryService(input: { database: AuthorityDatabase; lifecycle: RunRecordService; afterClear(): void;
  readLanes?: Pick<DashboardReadLanes, "read"> }): RunHistoryService {
  const { readLanes } = input;
  const settle = (result: ClearRunHistoryResult): ClearRunHistoryResult => {
    if (result.state === "cleared") {
      const runIds = input.database.authority.deletedRuns.list().filter(receipt => receipt.commandId === result.commandId).map(receipt => receipt.runId);
      input.database.settleRunDeletionFiles({ runIds, commandId: result.commandId });
      input.afterClear();
    }
    return result;
  };
  return {
    status() {
      // Committed deletion cleanup is a write; it stays on the main connection before the counts are read.
      if (input.database.resumeRunDeletionFiles() > 0) input.afterClear();
      if (readLanes === undefined) return input.lifecycle.historyStatus();
      return readLanes.read(runHistoryStatusRead, {}).then(reply => RunHistoryStatusSchema.parse(JSON.parse(reply.body)));
    },
    clear: request => settle(input.lifecycle.clearHistory(request)),
    check: request => settle(input.lifecycle.clearHistoryResult(request)),
  };
}
