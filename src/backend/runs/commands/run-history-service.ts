import type { ClearRunHistoryRequest, ClearRunHistoryResult, RunHistoryStatus } from "../../../models/dashboard/run-history.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";

export interface RunHistoryService {
  status(): RunHistoryStatus;
  clear(request: ClearRunHistoryRequest): ClearRunHistoryResult;
  check(request: ClearRunHistoryRequest): ClearRunHistoryResult;
}

export function createRunHistoryService(input: { database: AuthorityDatabase; lifecycle: RunRecordService; afterClear(): void }): RunHistoryService {
  const settle = (result: ClearRunHistoryResult): ClearRunHistoryResult => {
    if (result.state === "cleared") {
      for (const receipt of input.database.authority.deletedRuns.list().filter(receipt => receipt.commandId === result.commandId)) {
        input.database.settleRunDeletionFiles({ runId: receipt.runId, commandId: result.commandId });
      }
      input.afterClear();
    }
    return result;
  };
  return {
    status: () => input.lifecycle.historyStatus(),
    clear: request => settle(input.lifecycle.clearHistory(request)),
    check: request => settle(input.lifecycle.clearHistoryResult(request)),
  };
}
