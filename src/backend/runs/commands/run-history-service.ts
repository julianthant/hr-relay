import { type RunHistoryCommand, type ClearRunHistoryResult } from "../../../models/dashboard/run-history.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";

export interface RunHistoryService {
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
    clear: request => settle(input.lifecycle.clearHistory(request)),
    check: request => settle(input.lifecycle.clearHistoryResult(request)),
  };
}
