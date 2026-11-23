import type { ComponentType } from "react";
import { z } from "zod";
import type { BulkBatchOutcome } from "./commands/bulk-dispatch.js";
import type { CommandRecoveryEntry } from "../surfaces/shared/actions/command-recovery-model.js";
import type { DashboardClient } from "../client/index.js";
import type { InboxWiring } from "../state/inbox-wiring-adapter.js";
import type { NotificationTarget } from "../../models/notifications/notification-target.js";
import type { QueueSurfaceWire } from "../../models/dashboard/projection.js";
import type { NavbarData } from "../surfaces/shell/search/navbar-view-model.js";
import type { AppRouteState } from "./navigation/url-state.js";
import type { RunNavigation } from "./navigation/run-navigation.js";
import type { PaletteSheet } from "../surfaces/shell/search/search-palette-model.js";
import type { CommandResultFeedEntry } from "../surfaces/shared/actions/actions-model.js";
import configuredSources from "../../../config/dashboard-workflow-sources.json" with { type: "json" };
import type { SessionsHarness } from "../surfaces/sessions/session-panel.js";
import type { LogSelection } from "../surfaces/run-detail/logs/log-selection-model.js";
import type { DashboardActionHandler } from "../surfaces/shared/actions/actions.js";
import type { ActivityReportHook } from "../surfaces/activity/activity.js";

/** "hidden" workflows run and serve data for their host but have no catalog, queue or assistant entry. */
export type WorkflowSource = "served" | "hidden";
export type WorkflowSourcePolicy = Readonly<Record<string, WorkflowSource>>;

export const WORKFLOW_SOURCES = Object.freeze(z.record(z.string(), z.enum(["served", "hidden"])).parse(configuredSources));

export function workflowSource(id: string, policy: WorkflowSourcePolicy = WORKFLOW_SOURCES): WorkflowSource {
  const source = policy[id];
  if (source === undefined) throw new Error(`WORKFLOW_SOURCE_UNDECLARED: ${id}`);
  return source;
}

export type RunNavigationContext = Readonly<{ client: DashboardClient; day: string; rows: readonly QueueSurfaceWire[]; canSelectWorkflowId: (id: string) => boolean; canOpenRegisteredWorkflow: (id: string, row: QueueSurfaceWire) => boolean }>;
export interface InboxHarnessInput {
  readonly day: string; readonly nowIso: string; readonly anchorIso: string; readonly rows?: readonly QueueSurfaceWire[];
  readonly workflowLabel: (id: string) => string; readonly unavailable?: string;
}
export interface SearchHarnessInput {
  readonly today: string; readonly day: string; readonly unavailable?: string; readonly rows: readonly QueueSurfaceWire[]; readonly workflowLabel: (id: string) => string;
}

/** Extra frames a design harness mounts beside the app and the first command feedback it seeds; the product leaves it unset. */
export interface DashboardHarness {
  readonly Host?: ComponentType;
  /** Sample logs in place of the served Logs panel, for top-level rows and, with `logsChildRows`, child rows. */
  readonly LogPreview?: ComponentType<{ selection: LogSelection; onAction?: DashboardActionHandler }>;
  readonly logsChildRows?: true;
  readonly commandResults?: readonly CommandResultFeedEntry[];
  readonly bulkOutcome?: BulkBatchOutcome;
  readonly unknownCommand?: CommandRecoveryEntry;
  /** Sample notifications in place of the served inbox, with their local read marks. */
  readonly useInbox?: (input: InboxHarnessInput) => InboxWiring;
  /** Sample search results in place of the served search. */
  readonly useSearch?: (input: SearchHarnessInput) => NavbarData;
  /** Opens a run from a notification or search result against the harness's own rows; other targets take the served route. */
  readonly resolveRun?: (target: NotificationTarget, route: AppRouteState, context: RunNavigationContext) => Promise<RunNavigation>;
  /** Spreadsheets the search palette lists when the served read gives none. */
  readonly paletteSheets?: readonly PaletteSheet[];
}

export interface WorkflowComposition {
  readonly harness?: DashboardHarness;
  readonly sources: WorkflowSourcePolicy;
  readonly dataSources?: WorkflowSourcePolicy;
  readonly servedDay?: boolean;
  /** The design-mock harness supplies sample workers and a command port; the product leaves it unset and reads the served day. */
  readonly sessionsHarness?: SessionsHarness;
  /** The design-mock harness supplies its own report hook; the product leaves it unset and reads the served population. */
  readonly useActivityReport?: ActivityReportHook;
}

export function workflowComposition(sources: WorkflowSourcePolicy): WorkflowComposition {
  return Object.freeze({ sources });
}

export const PRODUCT_WORKFLOW_COMPOSITION = workflowComposition(WORKFLOW_SOURCES);
export const productWorkflowComposition = () => PRODUCT_WORKFLOW_COMPOSITION;
