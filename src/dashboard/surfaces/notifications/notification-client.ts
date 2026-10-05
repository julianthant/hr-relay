import type { NotificationQueries } from "../../client/queries/notification-queries.js";
import type { SharedCommands } from "../../client/commands/shared-commands.js";
import { useDashboardClient } from "../../state/client-context.js";
/** The surface port is the provider's existing object; no per-render adapter or second client. */
export function useNotificationClient(): SharedCommands & NotificationQueries { return useDashboardClient(); }
