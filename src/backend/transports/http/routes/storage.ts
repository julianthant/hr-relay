import { StorageDoctorWireSchema } from "../../../../models/dashboard/storage.js";
import type { StorageDoctorWire, StorageDoctorLatestWire } from "../../../../models/dashboard/storage.js";
import { buildStorageDoctor } from "../../../runs/queries/storage.js";

import type { DashboardApp } from "./api-types.js";
import type { StorageRouteDeps } from "./storage-types.js";
import { ClearRunHistoryRequestSchema, ClearRunHistoryResultSchema, RunHistoryStatusSchema } from "../../../../models/dashboard/run-history.js";
import { operatorMutationIngressGuard } from "./operator-mutation-ingress.js";

export function registerStorageRoutes(app: DashboardApp, deps: StorageRouteDeps, run = (): Promise<StorageDoctorWire> => buildStorageDoctor(deps.storage)): void {
  let latest: StorageDoctorLatestWire = { state: "never-run" };
  app.get("/api/v1/storage/run-history", c => c.json(RunHistoryStatusSchema.parse(deps.runHistory?.status() ?? { state: "unavailable" })));
  app.use("/api/v1/storage/run-history/clear", operatorMutationIngressGuard);
  app.post("/api/v1/storage/run-history/clear", async c => {
    const request = ClearRunHistoryRequestSchema.parse(await c.req.json());
    return c.json(ClearRunHistoryResultSchema.parse(deps.runHistory?.clear(request)
      ?? { state: "refused", commandId: request.commandId, reason: "unavailable" }));
  });
  app.use("/api/v1/storage/run-history/result", operatorMutationIngressGuard);
  app.post("/api/v1/storage/run-history/result", async c => {
    const request = ClearRunHistoryRequestSchema.parse(await c.req.json());
    return c.json(ClearRunHistoryResultSchema.parse(deps.runHistory?.check(request)
      ?? { state: "refused", commandId: request.commandId, reason: "unavailable" }));
  });
  app.get("/api/v1/storage/doctor/latest", (c) => c.json(latest));
  app.get("/api/v1/storage/doctor", async (c) => {
    const report = StorageDoctorWireSchema.parse(await run());
    latest = { state: "completed", report };
    return c.json(report);
  });

}
