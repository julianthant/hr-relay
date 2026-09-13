import type { ExportCommands } from "./export-commands.js";
import { createExportCommands } from "./export-commands.js";
import type { SettingsCommands } from "./settings-commands.js";
import { createSettingsCommands } from "./settings-commands.js";
import type { SharedCommands } from "./shared-commands.js";
import { createSharedCommands } from "./shared-commands.js";
import type { StartCommands } from "./start-commands.js";
import { createStartCommands } from "./start-commands.js";
import type { DashboardTransport } from "./transport.js";


export interface DashboardCommands extends StartCommands, SharedCommands, SettingsCommands, ExportCommands {}

export function createDashboardCommands(transport: DashboardTransport): DashboardCommands {return Object.freeze({...createStartCommands(transport),...createSharedCommands(transport),...createSettingsCommands(transport),...createExportCommands(transport)});}
export { createExportCommands } from "./export-commands.js";
export type { ExportCommands,OperatorXlsxClientDownload } from "./export-commands.js";
export { createSettingsCommands } from "./settings-commands.js";
export type { SettingsCommands } from "./settings-commands.js";
export { createSharedCommands } from "./shared-commands.js";
export type { SharedCommands } from "./shared-commands.js";
export { createStartCommands } from "./start-commands.js";
export type { StartCommands,StartPlanResponse } from "./start-commands.js";
