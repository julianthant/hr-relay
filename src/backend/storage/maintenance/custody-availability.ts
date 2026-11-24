import { platform } from "node:os";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";

export type StorageMaintenanceOperation = "backup" | "restore" | "backup-retirement" | "schema-upgrade" | "layout-migration" | "account-deletion";

export class StorageMaintenanceCustodyUnavailableError extends Error {
  readonly code = "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE";
  constructor(readonly operation: StorageMaintenanceOperation) {
    super(ERROR_CATALOG.STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE.text);
    this.name = "StorageMaintenanceCustodyUnavailableError";
  }
}

export function maintenanceCustodyAvailable(): boolean { return platform() !== "win32"; }

export function assertMaintenanceCustodyAvailable(operation: StorageMaintenanceOperation): void {
  if (!maintenanceCustodyAvailable()) throw new StorageMaintenanceCustodyUnavailableError(operation);
}
