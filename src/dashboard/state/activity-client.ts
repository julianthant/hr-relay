import type { ExportCommands } from "../client/export-commands.js";
import type { ActivityQueries } from "../client/activity-queries.js";
import { useDashboardClient } from "./client-context.js";
/** The surface port is the provider's existing object; no per-render adapter or second client. */
export function useActivityClient(): ActivityQueries & Pick<ExportCommands,"exportXlsx"> { return useDashboardClient(); }
