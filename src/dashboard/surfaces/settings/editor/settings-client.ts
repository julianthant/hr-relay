import type { SettingsCommands } from "../../../client/commands/settings-commands.js";
import type { SettingsQueries } from "../../../client/queries/settings-queries.js";
import type { SharedCommands } from "../../../client/commands/shared-commands.js";
import { useDashboardClient } from "../../../state/client-context.js";
/** The surface port is the provider's existing object; no per-render adapter or second client. */
export function useSettingsClient(): SettingsQueries & SettingsCommands & SharedCommands { return useDashboardClient(); }
