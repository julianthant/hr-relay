import { exportSearchMetadata } from "../../../runs/exports/search-metadata-export.js";
import { createCalendarQuery } from "../../../runs/queries/calendar.js";
import { randomBytes } from "node:crypto";
import { WORKFLOW_MODULES, READABLE_WORKFLOW_MODULES } from "../../registries/workflow-registry.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../models/config/settings.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { BootstrapQueryDeps } from "../../../runs/queries/bootstrap.js";
import { ocrHostRun } from "../../../runs/queries/ocr-record-members.js";
import { createCrossDateSearchService } from "../../../runs/queries/search.js";
import type { OperatorXlsxExportServiceDependencies } from "../../../runs/exports/operator-xlsx-export-service.js";
import { createDashboardStreamHub, type DashboardStreamHubDeps } from "../../../transports/http/subscriptions/dashboard-stream.js";
import type { ShellRouteDeps } from "../../../transports/http/routes/shell-types.js";
import { composeGeneratedExports } from "./generated-exports.js";

/** Shell bootstrap, search, export and subscription use the same production authority. */
export function composeShell(input: Pick<BootstrapQueryDeps,
  "appVersion" | "actorLabel" | "clock" | "timeZone" | "descriptorSetHash" | "preflightReport" | "backupSummary">
  & Pick<OperatorXlsxExportServiceDependencies, "ids" | "artifacts">
  & DashboardStreamHubDeps
  & { activity: import("../../../runs/queries/activity-selection.js").ActivitySelectionService; database: AuthorityDatabase; descriptors: Parameters<typeof createCrossDateSearchService>[0]["descriptors"] }
): ShellRouteDeps {
  const { database, projection, clock, ids, artifacts, descriptors } = input;
  const catalogModules = READABLE_WORKFLOW_MODULES.filter(module => WORKFLOW_MODULES.some(publicModule => publicModule === module)
    || module.descriptor.capabilities?.review === true);
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
    host: record => ocrHostRun(database.authority, record),
  });
  return {
    bootstrap: { appVersion: input.appVersion, actorLabel: input.actorLabel, clock, timeZone: input.timeZone, modules: catalogModules,
      descriptorSetHash: input.descriptorSetHash, settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      preflightReport: input.preflightReport, projection, authorityMeta: () => database.getMeta(),
      backupSummary: input.backupSummary },
    search,
    searchMetadataExports: {export: request=>exportSearchMetadata({search,sourceIdentity:database.getSourceDatabaseIdentity()},request)},
    calendar: createCalendarQuery(database, clock),
    xlsxExports: composeGeneratedExports({ clock, ids, sourceIdentity: database.getSourceDatabaseIdentity(),
      artifacts, authority: database.authority.operatorXlsxExports, search,
      activityReport: (from, to, token) => input.activity.readSelected(from, to, token) }),
    hub: createDashboardStreamHub(input),
  };
}
