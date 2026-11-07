import { StorageDoctorWireSchema, StorageDoctorLatestWireSchema, type StorageDoctorLatestWire, type StorageDoctorWire } from "../../../models/dashboard/storage.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";
import { RunHistoryStatusSchema, type RunHistoryStatus } from "../../../models/dashboard/run-history.js";


export interface StorageQueries {
  runHistoryStatus(): Promise<RunHistoryStatus>;

  /** Ref dashboard-surfaces's read-only storage doctor, run on demand from Settings. */
  storageDoctor(): Promise<StorageDoctorWire>;
  latestStorageDoctor(): Promise<StorageDoctorLatestWire>;
}

export function createStorageQueries(transport: DashboardTransport): StorageQueries { return Object.freeze({
    async runHistoryStatus() {
      return parseOrThrow(RunHistoryStatusSchema, "GET /api/v1/storage/run-history", await transport.requestJson("/api/v1/storage/run-history"));
    },

    async latestStorageDoctor(): Promise<StorageDoctorLatestWire> {
      return parseOrThrow(StorageDoctorLatestWireSchema, "GET /api/v1/storage/doctor/latest",
        await transport.requestJson("/api/v1/storage/doctor/latest"));
    },
    async storageDoctor(): Promise<StorageDoctorWire> {
      return parseOrThrow(
        StorageDoctorWireSchema,
        "GET /api/v1/storage/doctor",
        await transport.requestJson("/api/v1/storage/doctor"),
      );
    }
}); }
