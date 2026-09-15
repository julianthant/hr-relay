import type { TrustRouteDeps } from "./trust-types.js";
import type { ShellRouteDeps } from "./shell-types.js";
import type { SettingsRouteDeps } from "./settings-types.js";
import type { StorageRouteDeps } from "./storage-types.js";
import type { ExplorerRouteDeps } from "./explorer-types.js";
import type { ArchiveRouteDeps } from "./archive-types.js";
import type { IntakeRouteDeps } from "./intake-types.js";
import type { RunDetailRouteDeps } from "./run-detail-types.js";
import type { composeDataQueries } from "../compose/data.js";
import type { Hono } from "hono";
import type { DashboardCommandService } from "../commands/command-service.js";
import type { BulkCommandAcceptanceAuthority } from "../commands/operator-command-ingress.js";
import type { CommandRequest } from "../../../domain/commands.js";
import type { StartPlanService } from "../commands/start-plan-service.js";
import type { RunQueueProjection } from "../projectors/run-queue-projection.js";
import type { StaticBundle } from "../static-bundle.js";
import type { createPreflightAuthority } from "../../../domain/preflight.js";
import type { RequestIdentityCheckpoint } from "../request-identity.js";

/** Shared wiring plus leaf-owned contracts. Existing composed fixtures remain valid. */
export interface DashboardAppDeps extends TrustRouteDeps, ShellRouteDeps, SettingsRouteDeps, StorageRouteDeps, ExplorerRouteDeps, ArchiveRouteDeps, IntakeRouteDeps, RunDetailRouteDeps {
  readonly notifications?: { snapshot(actor: string): readonly import("../../../domain/dashboard/projection.js").NotificationWire[]; target: ReturnType<typeof import("../queries/notifications.js").createNotificationTargetQuery>; status(): import("../../../services/notifications/observation.js").NotificationObservationStatus };
  readonly requestIdentity: RequestIdentityCheckpoint;
  readonly preflight: Pick<ReturnType<typeof createPreflightAuthority>, "execute">;
  readonly projection: RunQueueProjection;
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
