import { buildStorageDoctor } from "../queries/storage.js";

import type { DashboardApp } from "./api-types.js";
import type { StorageRouteDeps } from "./storage-types.js";

export function registerStorageRoutes(app: DashboardApp, deps: StorageRouteDeps): void {
  app.get("/api/v1/storage/doctor", async (c) => c.json(await buildStorageDoctor(deps.storage)));

}
