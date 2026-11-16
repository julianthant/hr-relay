import type { StorageQueryDeps } from "../../../runs/queries/storage.js";
import type { RunHistoryService } from "../../../runs/commands/run-history-service.js";
import type { ClearRunHistoryRequest, ClearRunHistoryResult } from "../../../../models/dashboard/run-history.js";

export interface StorageRouteDeps {
  readonly storage: StorageQueryDeps;
  readonly runHistory?: Pick<RunHistoryService, "status"> & {
    clear(request: ClearRunHistoryRequest): ClearRunHistoryResult;
    check(request: ClearRunHistoryRequest): ClearRunHistoryResult;
  };
}
