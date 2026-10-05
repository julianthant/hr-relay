import type { ArchiveQueries } from "../../client/queries/archive-queries.js";
import type { SharedCommands } from "../../client/commands/shared-commands.js";
import { useDashboardClient } from "../../state/client-context.js";
/** The surface port is the provider's existing object; no per-render adapter or second client. */
export function useArchiveClient(): ArchiveQueries & SharedCommands { return useDashboardClient(); }
