/**
 * Whether the storage summary owes the operator attention
 *
 * It lives beside `settings.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import type { z } from "zod";
import type { StorageHealthSummaryWireSchema } from "../../domain/dashboard/bootstrap.js";

export type StorageHealthSummary = z.infer<typeof StorageHealthSummaryWireSchema>;

/** True when the top-bar gear should carry the attention dot. */
export function storageNeedsAttention(storage: StorageHealthSummary): boolean {
  return storage.authority !== "healthy" || storage.backup !== "current";
}
