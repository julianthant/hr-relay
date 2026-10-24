import type { AssistantService } from "../../../assistant/service.js";
import type { ChatGptAccountRouteDeps } from "./chatgpt-account.js";
import type { WorkbooksRouteDeps } from "./workbooks.js";
import type { TrustRouteDeps } from "./trust-types.js";
import type { ShellRouteDeps } from "./shell-types.js";
import type { SettingsRouteDeps } from "./settings-types.js";
import type { StorageRouteDeps } from "./storage-types.js";
import type { ExplorerRouteDeps } from "./explorer-types.js";
import type { IntakeRouteDeps } from "./intake-types.js";
import type { RunDetailRouteDeps } from "./run-detail-types.js";
import type { composeDataQueries } from "../../../app/composition/dashboard/data.js";
import type { Hono } from "hono";
import type { DashboardCommandService } from "../../../runs/commands/command-service.js";
import type { BulkCommandAcceptanceAuthority } from "../../../runs/commands/operator-command-ingress.js";
import type { CommandRequest } from "../../../../rules/commands/commands.js";
import type { StartPlanService } from "../../../runs/commands/start-plan-service.js";
import type { RunQueueProjection } from "../../../runs/projections/run-queue-projection.js";
import type { StaticBundle } from "../static-bundle.js";
import type { RequestIdentityCheckpoint } from "../request-identity.js";

/** Shared wiring plus leaf-owned contracts. Existing composed fixtures remain valid. */
export interface DashboardAppDeps extends ChatGptAccountRouteDeps, WorkbooksRouteDeps, TrustRouteDeps, ShellRouteDeps, SettingsRouteDeps, StorageRouteDeps, ExplorerRouteDeps, IntakeRouteDeps, RunDetailRouteDeps {
  readonly notifications?: { collection?(actor: string, operation: import("../../../../models/notifications/notifications.js").NotificationCollectionOperation): import("../../../../models/notifications/notifications.js").NotificationCollectionTarget; snapshot(actor: string): readonly import("../../../../models/dashboard/projection.js").NotificationWire[]; target: ReturnType<typeof import("../../../runs/queries/notifications.js").createNotificationTargetQuery>; status(): import("../../../runs/notifications/observation.js").NotificationObservationStatus };
  readonly assistant?: AssistantService;
  readonly requestIdentity: RequestIdentityCheckpoint;
  readonly preflight: import("./settings-preflight-types.js").SettingsPreflightRouteDeps["preflight"];
  readonly projection: RunQueueProjection;
  readonly activityPopulation: import("./activity-types.js").ActivityRouteDeps["activityPopulation"];
  readonly activity?: import("./activity-types.js").ActivityRouteDeps["activity"];
  readonly data?: ReturnType<typeof composeDataQueries>;
  readonly commands: DashboardCommandService;
  readonly commandJournal: { get(commandId: string): CommandRequest | undefined };
  readonly bulkCommandAcceptances: BulkCommandAcceptanceAuthority;
  readonly protectedCommandAcceptedAt: (commandId: string) => string | undefined;
  readonly startPlans: StartPlanService;
  readonly staticBundle?: StaticBundle;
}

export type DashboardApp = Hono<{
  Variables: { requestActorId: ReturnType<RequestIdentityCheckpoint["identify"]> };
}>;
