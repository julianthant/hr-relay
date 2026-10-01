import type { StorageQueryDeps } from "../../../../server/dashboard/queries/storage.js";

export interface StorageRouteDeps {
  readonly storage: StorageQueryDeps;
}
