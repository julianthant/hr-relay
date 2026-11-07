import type { RunHistoryCommand, ClearRunHistoryResult, RunHistoryStatus } from "../../../models/dashboard/run-history.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";

export interface RunHistoryService {
  status(): RunHistoryStatus;
  clear(request: RunHistoryCommand): ClearRunHistoryResult;
  check(request: RunHistoryCommand): ClearRunHistoryResult;
}

export function createRunHistoryService(input: { database: AuthorityDatabase; lifecycle: RunRecordService; afterClear(): void }): RunHistoryService {
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
      if (input.database.resumeRunDeletionFiles() > 0) input.afterClear();
      return input.lifecycle.historyStatus();
    },
    clear: request => settle(input.lifecycle.clearHistory(request)),
    check: request => settle(input.lifecycle.clearHistoryResult(request)),
  };
}
