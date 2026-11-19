import type { StorageAuthoritySummary } from "../../../../models/storage/storage-status.js";

export type StorageHealthSummary = StorageAuthoritySummary;

/** True when the top-bar gear should carry the attention dot. */
export function storageNeedsAttention(storage: StorageHealthSummary): boolean {
  return storage.authority !== "healthy";
}
