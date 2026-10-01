import { exportSearchMetadata } from "../../../runs/exports/search-metadata-export.js";
import { createCalendarQuery } from "../../../runs/dashboard/queries/calendar.js";
import { randomBytes } from "node:crypto";
import { WORKFLOW_MODULES } from "../../control/workflow-registry.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../domain/config/settings.js";
import type { AuthorityDatabase } from "../../../../infra/sqlite/authority-database.js";
import type { BootstrapQueryDeps } from "../../../runs/dashboard/queries/bootstrap.js";
import { createCrossDateSearchService } from "../../../runs/dashboard/queries/search.js";
import type { OperatorXlsxExportServiceDependencies } from "../../../runs/exports/operator-xlsx-export-service.js";
import { createDashboardStreamHub, type DashboardStreamHubDeps } from "../../../transports/dashboard/subscriptions/dashboard-stream.js";
import type { ShellRouteDeps } from "../../../transports/dashboard/routes/shell-types.js";
import { composeGeneratedExports } from "./generated-exports.js";

/** Shell bootstrap, search, export and subscription use the same production authority. */
export function composeShell(input: Pick<BootstrapQueryDeps,
  "appVersion" | "clock" | "timeZone" | "descriptorSetHash" | "preflightReport" | "advisoryAvailability" | "backupSummary">
  & Pick<OperatorXlsxExportServiceDependencies, "ids" | "artifacts">
  & DashboardStreamHubDeps
  & { activity: import("../../../runs/dashboard/queries/activity-selection.js").ActivitySelectionService; database: AuthorityDatabase; descriptors: Parameters<typeof createCrossDateSearchService>[0]["descriptors"] }
): ShellRouteDeps {
  const { database, projection, clock, ids, artifacts, descriptors } = input;
  database.registerRunSearchDeclarations(WORKFLOW_MODULES.map(({ descriptor }) => ({
    workflow: descriptor.id, version: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
    subjectProjection: descriptor.subjectProjection ?? null,
  })));
  const search = createCrossDateSearchService({ clock,
    sourceIdentity: database.getSourceDatabaseIdentity(), cursorSigningKey: randomBytes(32), descriptors,
    authority: { readSnapshot: read => database.withAuthorityReadSnapshot(() => read({
      authorityGeneration: database.getMeta().authorityGeneration,
      searchRuns: searchInput => database.authority.runs.search(searchInput),
    })) },
  });
  return {
    bootstrap: { appVersion: input.appVersion, clock, timeZone: input.timeZone, modules: WORKFLOW_MODULES,
      descriptorSetHash: input.descriptorSetHash, settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      preflightReport: input.preflightReport, projection, authorityMeta: () => database.getMeta(),
      advisoryAvailability: input.advisoryAvailability, backupSummary: input.backupSummary },
    search,
    searchMetadataExports: {export: request=>exportSearchMetadata({search,sourceIdentity:database.getSourceDatabaseIdentity()},request)},
    calendar: createCalendarQuery(database, clock),
    xlsxExports: composeGeneratedExports({ clock, ids, sourceIdentity: database.getSourceDatabaseIdentity(),
      artifacts, authority: database.authority.operatorXlsxExports, search,
      activityReport: (from, to, token) => input.activity.readSelected(from, to, token) }),
    hub: createDashboardStreamHub(input),
  };
}
