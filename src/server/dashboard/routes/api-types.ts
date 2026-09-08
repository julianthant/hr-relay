import type { composeDataQueries } from "../compose/data.js";
import type { Hono } from "hono";
import type { DashboardCommandService } from "../commands/command-service.js";
import type { BulkCommandAcceptanceAuthority } from "../commands/operator-command-ingress.js";
import type { CommandRequest } from "../../../domain/commands.js";
import type { IntakeService } from "../commands/intake-service.js";
import type { StartPlanService } from "../commands/start-plan-service.js";
import type { ExplorerEditService } from "../commands/explorer-edit-service.js";
import type { BootstrapQueryDeps } from "../queries/bootstrap.js";
import type { StorageQueryDeps } from "../queries/storage.js";
import type { SettingsQueryDeps } from "../queries/settings.js";
import type { SettingsEditorQueryDeps } from "../queries/settings-editor.js";
import type { ExplorerQueryDeps } from "../queries/explorer.js";
import type { UiCatalogQueryDeps } from "../queries/ui-catalog.js";
import type { RunDetailQueryDeps } from "../queries/run-detail.js";
import type { AdvisoryQueryDeps } from "../queries/advisory.js";
import type { DiagnosticBundleQueryDeps } from "../queries/diagnostic-bundle.js";
import type { ArtifactBytesQueryDeps } from "../queries/artifact-bytes.js";
import type { ArchiveQueryDeps } from "../queries/archive.js";
import type { CrossDateSearchQueryService } from "../queries/search.js";
import type { RunQueueProjection } from "../projectors/run-queue-projection.js";
import type { OperatorXlsxExportService } from "../exports/operator-xlsx-export-service.js";
import type { DashboardStreamHub } from "../subscriptions/dashboard-stream.js";
import type { StaticBundle } from "../static-bundle.js";
import type { createPreflightAuthority } from "../../../domain/preflight.js";
import type { RequestIdentityCheckpoint } from "../request-identity.js";

export interface DashboardAppDeps {
  /** D75: the one server-owned actor derivation every BFF request crosses. */
  readonly requestIdentity: RequestIdentityCheckpoint;
  readonly bootstrap: BootstrapQueryDeps;
  /** Read-only strict preflight authority; no command-kernel mutation or journal row is produced. */
  readonly preflight: Pick<ReturnType<typeof createPreflightAuthority>, "execute">;
  readonly projection: RunQueueProjection;
  /** D283: bounded cross-date reads from exact durable run authority. */
  readonly search: CrossDateSearchQueryService;
  /** DCR5's dedicated command; it persists exact attachment evidence before returning bytes. */
  readonly xlsxExports?: OperatorXlsxExportService;
  readonly runDetail: RunDetailQueryDeps;
  /** Production supplies canonical backing; minimal Context-only compositions may omit it. */
  readonly data?: ReturnType<typeof composeDataQueries>;
  /** D137 bundle readback; exact-id routes verify durable row and bytes before serving. */
  readonly diagnosticBundles?: DiagnosticBundleQueryDeps & ArtifactBytesQueryDeps;
  /** Ref dashboard-surfaces §10.2's read-only Archive + the live version-bump state (2i-G, D179). */
  readonly archive: ArchiveQueryDeps;
  readonly commands: DashboardCommandService;
  readonly commandJournal: Readonly<{
    get(commandId: string): CommandRequest | undefined;
  }>;
  readonly bulkCommandAcceptances: BulkCommandAcceptanceAuthority;
  readonly protectedCommandAcceptedAt: (commandId: string) => string | undefined;
  readonly startPlans: StartPlanService;
  readonly intake: IntakeService;
  readonly hub: DashboardStreamHub;
  readonly storage: StorageQueryDeps;
  /** D274 item 6 / ledger 3 SE40–SE42 — the two READ-ONLY Settings status sections. */
  readonly settings: SettingsQueryDeps;
  /** DCC3's closed, resolver-owned editable Settings inventory and current readback. */
  readonly settingsEditor: SettingsEditorQueryDeps;
  /** Ref operator-trust §5.2's read-only explorer projection (2i-G, D176). */
  readonly explorer: ExplorerQueryDeps;
  /** D186/D283 safe-edit authority; production always composes it. */
  readonly explorerEdits?: Pick<ExplorerEditService, "validate">;
  /** The committed semantic UI catalog, served read-only (2i-G, D177). */
  readonly uiCatalog: UiCatalogQueryDeps;
  /**
   * Ref operator-trust §4.4's advisory seam (2i-G, D178). Absent when no `ai.advisory`
   * adapter is composed — the route then refuses by NAME rather than the
   * composition root wiring a producer that answers nothing.
   */
  readonly advisory?: AdvisoryQueryDeps;
  /**
   * The built dashboard bundle, present only in `built-bundle` mode (ref
   * frontend-backend-integration §6.9): its handler is registered last so every route
   * above wins, and it serves `dist/dashboard` from this same loopback process.
   */
  readonly staticBundle?: StaticBundle;
}

export type DashboardApp = Hono<{
  Variables: { requestActorId: ReturnType<RequestIdentityCheckpoint["identify"]> };
}>;
