import type { ExportCommands } from "./commands/export-commands.js";
import { createExportCommands } from "./commands/export-commands.js";
import type { SettingsCommands } from "./commands/settings-commands.js";
import { createSettingsCommands } from "./commands/settings-commands.js";
import type { SharedCommands } from "./commands/shared-commands.js";
import { createSharedCommands } from "./commands/shared-commands.js";
import type { StartCommands } from "./commands/start-commands.js";
import { createStartCommands } from "./commands/start-commands.js";
import type { DashboardTransport } from "./transport.js";


export interface DashboardCommands extends StartCommands, SharedCommands, SettingsCommands, ExportCommands {}

export function createDashboardCommands(transport: DashboardTransport): DashboardCommands {return Object.freeze({...createStartCommands(transport),...createSharedCommands(transport),...createSettingsCommands(transport),...createExportCommands(transport)});}
export { createExportCommands } from "./commands/export-commands.js";
export type { ExportCommands,OperatorXlsxClientDownload } from "./commands/export-commands.js";
export { createSettingsCommands } from "./commands/settings-commands.js";
export type { SettingsCommands } from "./commands/settings-commands.js";
export { createSharedCommands } from "./commands/shared-commands.js";
export type { SharedCommands } from "./commands/shared-commands.js";
export { createStartCommands } from "./commands/start-commands.js";
export type { StartCommands,StartPlanResponse } from "./commands/start-commands.js";
