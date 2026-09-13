import type { SettingsCommands } from "../client/settings-commands.js";
import type { SettingsQueries } from "../client/settings-queries.js";
import type { SharedCommands } from "../client/shared-commands.js";
import { useDashboardClient } from "./client-context.js";
/** The surface port is the provider's existing object; no per-render adapter or second client. */
export function useSettingsClient(): SettingsQueries & SettingsCommands & SharedCommands { return useDashboardClient(); }
