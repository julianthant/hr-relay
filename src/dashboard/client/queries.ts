import { createWorkbookLibraryQueries, type WorkbookLibraryQueries } from "./queries/workbook-library-queries.js";
import { createRerunQueries, type RerunQueries } from "./queries/rerun-queries.js";
import { createNotificationQueries, type NotificationQueries } from "./queries/notification-queries.js";
import type { ActivityQueries } from "./queries/activity-queries.js";
import { createActivityQueries } from "./queries/activity-queries.js";
import type { DetailQueries } from "./queries/detail-queries.js";
import { createDetailQueries } from "./queries/detail-queries.js";
import type { ExplorerQueries } from "./queries/explorer-queries.js";
import { createExplorerQueries } from "./queries/explorer-queries.js";
import type { IntakeQueries } from "./queries/intake-queries.js";
import { createIntakeQueries } from "./queries/intake-queries.js";
import type { PreflightQueries } from "./queries/preflight-queries.js";
import { createPreflightQueries } from "./queries/preflight-queries.js";
import type { QueueQueries } from "./queries/queue-queries.js";
import { createQueueQueries } from "./queries/queue-queries.js";
import type { SettingsQueries } from "./queries/settings-queries.js";
import { createSettingsQueries } from "./queries/settings-queries.js";
import type { ShellQueries } from "./queries/shell-queries.js";
import { createShellQueries } from "./queries/shell-queries.js";
import type { StorageQueries } from "./queries/storage-queries.js";
import { createStorageQueries } from "./queries/storage-queries.js";
import type { DashboardTransport } from "./transport.js";


export interface DashboardQueries extends WorkbookLibraryQueries, RerunQueries, NotificationQueries, ShellQueries, QueueQueries, DetailQueries, StorageQueries, SettingsQueries, PreflightQueries, IntakeQueries, ExplorerQueries, ActivityQueries {}

export function createDashboardQueries(transport: DashboardTransport): DashboardQueries {return Object.freeze({...createWorkbookLibraryQueries(transport),...createRerunQueries(transport),...createNotificationQueries(transport),...createShellQueries(transport),...createQueueQueries(transport),...createDetailQueries(transport),...createStorageQueries(transport),...createSettingsQueries(transport),...createPreflightQueries(transport),...createIntakeQueries(transport),...createExplorerQueries(transport),...createActivityQueries(transport)});}
export { createActivityQueries } from "./queries/activity-queries.js";
export type { ActivityQueries } from "./queries/activity-queries.js";
export { createDetailQueries } from "./queries/detail-queries.js";
export type { DetailQueries } from "./queries/detail-queries.js";
export { createExplorerQueries } from "./queries/explorer-queries.js";
export type { ExplorerQueries } from "./queries/explorer-queries.js";
export { createIntakeQueries } from "./queries/intake-queries.js";
export type { IntakeQueries,IntakeUploadRequest,IntakeUploadResult } from "./queries/intake-queries.js";
export { createPreflightQueries } from "./queries/preflight-queries.js";
export type { PreflightQueries } from "./queries/preflight-queries.js";
export { createQueueQueries } from "./queries/queue-queries.js";
export type { QueueQueries } from "./queries/queue-queries.js";
export { createSettingsQueries } from "./queries/settings-queries.js";
export type { SettingsQueries } from "./queries/settings-queries.js";
export { createShellQueries } from "./queries/shell-queries.js";
export type { ShellQueries } from "./queries/shell-queries.js";
export { createStorageQueries } from "./queries/storage-queries.js";
export type { StorageQueries } from "./queries/storage-queries.js";

export type { RerunQueries } from "./queries/rerun-queries.js";

export type { WorkbookLibraryQueries } from "./queries/workbook-library-queries.js";
