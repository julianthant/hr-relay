import type { FrontendBootstrapWire } from "../../models/dashboard/bootstrap.js";
import type { DashboardClient } from "../client/index.js";
import type { DashboardDayState } from "../state/use-dashboard-day.js";
import type { WorkflowCatalogEntry } from "../surfaces/workflows/workflow-catalog-model.js";
import type { AppRouteState } from "./navigation/url-state.js";
import type { CommandExecutionScope, CommandExecutor, CommandOutcome } from "./commands/command-executor.js";

export interface DashboardCommandBinding {
  readonly authority: DashboardAuthority;
  readonly executor: CommandExecutor;
  readonly scope: CommandExecutionScope;
  readonly feedback: (outcome: CommandOutcome) => void;
}

export interface DashboardAuthority {
  readonly epoch: Readonly<{ client: DashboardClient; bootstrap: FrontendBootstrapWire }>;
  readonly catalog: readonly WorkflowCatalogEntry[];
  readonly nowIso: string;
  readonly today: string;
  readonly day: string;
  readonly dayState: DashboardDayState;
  readonly selection: Readonly<{ route: AppRouteState; workflowId: string }>;
}

// Restore focus after route commit; an open discard dialog still traps focus away from the toolbar door.
import { SETTINGS_GEAR_ID } from "../surfaces/settings/settings-model.js";

export const RUN_START_DOOR_ID = "dashboard-run-start-door";

export type DashboardTakeoverCloseFocusTargetId = typeof RUN_START_DOOR_ID | typeof SETTINGS_GEAR_ID;

// A missing toolbar door may use the persistent main region; missing both is a composition failure.
export function restoreDashboardTakeoverFocus(
  documentRoot: Pick<Document, "activeElement" | "getElementById">,
  preferredTargetId: DashboardTakeoverCloseFocusTargetId,
  mainRegionId: string,
): void {
  const target = documentRoot.getElementById(preferredTargetId)
    ?? documentRoot.getElementById(mainRegionId);
  if (target === null) {
    throw new Error(
      `cannot restore takeover focus: neither ${preferredTargetId} nor ${mainRegionId} is mounted`,
    );
  }
  target.focus();
  if (documentRoot.activeElement !== target) {
    throw new Error(`cannot restore takeover focus: ${target.id} did not accept focus`);
  }
}
