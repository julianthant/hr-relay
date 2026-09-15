/**
 * The ONE typed dashboard client (ref frontend-backend-integration §0.2/§2): query, subscription,
 * command, error normalization, schema parsing, and reconnect all live behind
 * this facade. No other frontend module may touch `fetch` or an event stream.
 * The React surface (1i) consumes exactly this object.
 */
import { createDashboardCommands, type DashboardCommands } from "./commands.js";
import { createDashboardQueries, type DashboardQueries } from "./queries.js";
import {
  subscribeDashboardDay,
  type DashboardDaySubscription,
  type DashboardDaySubscriptionDeps,
} from "./subscription.js";
import { createDashboardTransport, type FetchLike } from "./transport.js";

export { DashboardClientError } from "./errors.js";
export { applyDashboardDayPatch } from "./day-state.js";
export type { SubscriptionState } from "./subscription.js";
export type { StartPlanResponse } from "./commands.js";
export type { OperatorXlsxClientDownload } from "./commands.js";
export type { OperatorXlsxExportRequest } from "../../domain/dashboard/xlsx-export.js";
export type { IntakeUploadRequest, IntakeUploadResult } from "./queries.js";
export type {
  CrossDateSearchPage,
  CrossDateSearchQuery,
  CrossDateSearchQueryInput,
} from "../../domain/dashboard/search.js";

export interface DashboardClient extends DashboardQueries, DashboardCommands {
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
  return Object.freeze({
    ...queries,
    ...commands,
    subscribeDay: (subscriptionInput: Omit<DashboardDaySubscriptionDeps, "transport">): DashboardDaySubscription =>
      subscribeDashboardDay({ ...subscriptionInput, transport }),
  });
}

export type { NotificationQueries } from "./notification-queries.js";
