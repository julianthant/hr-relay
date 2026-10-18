import { DashboardErrorReportSchema, type DashboardErrorReport } from "../../models/events/debug-report.js";
import { invalidatePreflightReadiness } from "./queries/preflight-state.js";
/** The ONE typed dashboard client (ref frontend-backend-integration) */
import { createDashboardCommands, type DashboardCommands } from "./commands.js";
import { createDashboardQueries, type DashboardQueries } from "./queries.js";
import {
  subscribeDashboardDay,
  type DashboardDaySubscription,
  type DashboardDaySubscriptionDeps,
} from "./subscriptions/subscription.js";
import { createDashboardTransport, type FetchLike } from "./transport.js";

export { DashboardClientError } from "./errors.js";
export { applyDashboardDayPatch } from "./queries/day-state.js";
export type { SubscriptionState } from "./subscriptions/subscription.js";
export type { StartPlanResponse } from "./commands.js";
export type { OperatorXlsxClientDownload } from "./commands.js";
export type { OperatorXlsxExportRequest } from "../../models/dashboard/xlsx-export.js";
export type { IntakeUploadRequest, IntakeUploadResult } from "./queries.js";
export type {
  CrossDateSearchPage,
  CrossDateSearchQuery,
  CrossDateSearchQueryInput,
} from "../../models/dashboard/search.js";

export interface DashboardClient extends DashboardQueries, DashboardCommands {
  reportError(report: DashboardErrorReport): Promise<void>;
  subscribeDay(
    input: Omit<DashboardDaySubscriptionDeps, "transport">,
  ): DashboardDaySubscription;
}

export function createDashboardClient(input: Readonly<{
  baseUrl: string;
  fetchImpl?: FetchLike;
}>): DashboardClient {
  const transport = createDashboardTransport(input);
  const queries = createDashboardQueries(transport);
  const commands = createDashboardCommands(transport);
  const client: DashboardClient = Object.freeze({
    async reportError(report: DashboardErrorReport) {
      await transport.requestJson("/api/v1/debug/errors", { method: "POST", body: JSON.stringify(DashboardErrorReportSchema.parse(report)) });
    },
    ...queries,
    ...commands,
    async applySettings(request: unknown) {
      try { return await commands.applySettings(request); }
      finally { invalidatePreflightReadiness(client); }
    },
    async executeCommand(request: unknown) {
      try { return await commands.executeCommand(request); }
      finally { invalidatePreflightReadiness(client); }
    },
    subscribeDay: (subscriptionInput: Omit<DashboardDaySubscriptionDeps, "transport">): DashboardDaySubscription =>
      subscribeDashboardDay({ ...subscriptionInput, transport }),
  });
  return client;
}

export type { NotificationQueries } from "./queries/notification-queries.js";

export type { RerunQueries } from "./queries/rerun-queries.js";

export { StartPlanRefusalError } from "./commands/start-commands.js";

export type { WorkbookLibraryQueries } from "./queries/workbook-library-queries.js";

export type { AssistantQueries } from "./queries/assistant-queries.js";
export type { AssistantRequest, AssistantResult, AssistantSubject } from "../../models/dashboard/assistant.js";
