import type { StorageQueries } from "../../../client/queries/storage-queries.js";
import { useDashboardClient } from "../../../state/client-context.js";
/** The surface port is the provider's existing object; no per-render adapter or second client. */
export function useStorageClient(): StorageQueries { return useDashboardClient(); }
