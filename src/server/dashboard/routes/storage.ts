import type { StorageDoctorWire, StorageDoctorLatestWire } from "../../../domain/dashboard/storage.js";
import { buildStorageDoctor } from "../queries/storage.js";

import type { DashboardApp } from "./api-types.js";
import type { StorageRouteDeps } from "./storage-types.js";

export function registerStorageRoutes(app: DashboardApp, deps: StorageRouteDeps, run = (): Promise<StorageDoctorWire> => buildStorageDoctor(deps.storage)): void {
  let latest: StorageDoctorLatestWire = { state: "never-run" };
  app.get("/api/v1/storage/doctor/latest", (c) => c.json(latest));
  app.get("/api/v1/storage/doctor", async (c) => {
    const report = await run();
    latest = { state: "completed", report };
    return c.json(report);
  });

}
