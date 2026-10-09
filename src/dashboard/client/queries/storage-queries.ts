import { StorageDoctorWireSchema, StorageDoctorLatestWireSchema, type StorageDoctorLatestWire, type StorageDoctorWire } from "../../../models/dashboard/storage.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "../transport.js";


export interface StorageQueries {

  /** Ref dashboard-surfaces §2.5's read-only doctor, run on demand from Settings (2i-D). */
  storageDoctor(): Promise<StorageDoctorWire>;
  latestStorageDoctor(): Promise<StorageDoctorLatestWire>;
}

export function createStorageQueries(transport: DashboardTransport): StorageQueries { return Object.freeze({

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
