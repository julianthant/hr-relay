import type { ClearRunHistoryRequest, ClearRunHistoryResult, RunHistoryStatus } from "../../../models/dashboard/run-history.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";

export interface RunHistoryService {
  status(): RunHistoryStatus;
  clear(request: ClearRunHistoryRequest): ClearRunHistoryResult;
}

export function createRunHistoryService(input: { database: AuthorityDatabase; lifecycle: RunRecordService; afterClear(): void }): RunHistoryService {
  return {
    status: () => input.lifecycle.historyStatus(),
    clear(request) {
      const result = input.lifecycle.clearHistory(request);
      if (result.state === "cleared") {
        input.database.resumeRunDeletionFiles();
        input.afterClear();
      }
      return result;
    },
  };
}
