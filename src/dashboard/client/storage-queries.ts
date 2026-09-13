import { StorageDoctorWireSchema,type StorageDoctorWire } from "../../domain/dashboard/storage.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "./transport.js";


export interface StorageQueries {

  /** Ref dashboard-surfaces §2.5's read-only doctor, run on demand from Settings (2i-D). */
  storageDoctor(): Promise<StorageDoctorWire>;
}

export function createStorageQueries(transport: DashboardTransport): StorageQueries { return Object.freeze({

    async storageDoctor(): Promise<StorageDoctorWire> {
      return parseOrThrow(
        StorageDoctorWireSchema,
        "GET /api/v1/storage/doctor",
        await transport.requestJson("/api/v1/storage/doctor"),
      );
    }
}); }
