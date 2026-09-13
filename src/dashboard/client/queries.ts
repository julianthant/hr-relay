import type { ActivityQueries } from "./activity-queries.js";
import { createActivityQueries } from "./activity-queries.js";
import type { ArchiveQueries } from "./archive-queries.js";
import { createArchiveQueries } from "./archive-queries.js";
import type { DetailQueries } from "./detail-queries.js";
import { createDetailQueries } from "./detail-queries.js";
import type { ExplorerQueries } from "./explorer-queries.js";
import { createExplorerQueries } from "./explorer-queries.js";
import type { IntakeQueries } from "./intake-queries.js";
import { createIntakeQueries } from "./intake-queries.js";
import type { PreflightQueries } from "./preflight-queries.js";
import { createPreflightQueries } from "./preflight-queries.js";
import type { QueueQueries } from "./queue-queries.js";
import { createQueueQueries } from "./queue-queries.js";
import type { SettingsQueries } from "./settings-queries.js";
import { createSettingsQueries } from "./settings-queries.js";
import type { ShellQueries } from "./shell-queries.js";
import { createShellQueries } from "./shell-queries.js";
import type { StorageQueries } from "./storage-queries.js";
import { createStorageQueries } from "./storage-queries.js";
import type { DashboardTransport } from "./transport.js";


export interface DashboardQueries extends ShellQueries, QueueQueries, DetailQueries, StorageQueries, SettingsQueries, PreflightQueries, IntakeQueries, ExplorerQueries, ArchiveQueries, ActivityQueries {}

export function createDashboardQueries(transport: DashboardTransport): DashboardQueries {return Object.freeze({...createShellQueries(transport),...createQueueQueries(transport),...createDetailQueries(transport),...createStorageQueries(transport),...createSettingsQueries(transport),...createPreflightQueries(transport),...createIntakeQueries(transport),...createExplorerQueries(transport),...createArchiveQueries(transport),...createActivityQueries(transport)});}
export { createActivityQueries } from "./activity-queries.js";
export type { ActivityQueries } from "./activity-queries.js";
export { createArchiveQueries } from "./archive-queries.js";
export type { ArchiveQueries } from "./archive-queries.js";
export { createDetailQueries } from "./detail-queries.js";
export type { DetailQueries } from "./detail-queries.js";
export { createExplorerQueries } from "./explorer-queries.js";
export type { ExplorerQueries } from "./explorer-queries.js";
export { createIntakeQueries } from "./intake-queries.js";
export type { IntakeQueries,IntakeUploadRequest,IntakeUploadResult } from "./intake-queries.js";
export { createPreflightQueries } from "./preflight-queries.js";
export type { PreflightQueries } from "./preflight-queries.js";
export { createQueueQueries } from "./queue-queries.js";
export type { QueueQueries } from "./queue-queries.js";
export { createSettingsQueries } from "./settings-queries.js";
export type { SettingsQueries } from "./settings-queries.js";
export { createShellQueries } from "./shell-queries.js";
export type { ShellQueries } from "./shell-queries.js";
export { createStorageQueries } from "./storage-queries.js";
export type { StorageQueries } from "./storage-queries.js";
