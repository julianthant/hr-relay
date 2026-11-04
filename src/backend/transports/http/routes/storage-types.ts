import type { StorageQueryDeps } from "../../../runs/queries/storage.js";
import type { RunHistoryService } from "../../../runs/commands/run-history-service.js";

export interface StorageRouteDeps {
  readonly storage: StorageQueryDeps;
  readonly runHistory?: RunHistoryService;
}
