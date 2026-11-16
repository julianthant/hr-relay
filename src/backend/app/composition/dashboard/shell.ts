import { readTimelineRecords } from "../../../storage/events/timeline-reader.js";
import type { RunRecord } from "../../../../models/run/record.js";
import { exportSearchMetadata } from "../../../runs/exports/search-metadata-export.js";
import { createCalendarQuery } from "../../../runs/queries/calendar.js";
import { randomBytes } from "node:crypto";
import { WORKFLOW_MODULES, READABLE_WORKFLOW_MODULES } from "../../registries/workflow-registry.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../models/config/settings.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { BootstrapQueryDeps } from "../../../runs/queries/bootstrap.js";
import { createCrossDateSearchService } from "../../../runs/queries/search.js";
import type { OperatorXlsxExportServiceDependencies } from "../../../runs/exports/operator-xlsx-export-service.js";
import { createDashboardStreamHub, type DashboardStreamHubDeps } from "../../../transports/http/subscriptions/dashboard-stream.js";
import type { ShellRouteDeps } from "../../../transports/http/routes/shell-types.js";
import { composeGeneratedExports } from "./generated-exports.js";

/** Shell bootstrap, search, export and subscription use the same production authority. */
export function composeShell(input: Pick<BootstrapQueryDeps,
  "appVersion" | "actorLabel" | "clock" | "timeZone" | "descriptorSetHash" | "preflightReport" | "workbookCompatibility">
  & Pick<OperatorXlsxExportServiceDependencies, "ids" | "artifacts">
  & DashboardStreamHubDeps
  & { activity: import("../../../runs/queries/activity-selection.js").ActivitySelectionService; database: AuthorityDatabase; descriptors: Parameters<typeof createCrossDateSearchService>[0]["descriptors"] }
): ShellRouteDeps {
  const { database, projection, clock, ids, artifacts } = input;
  const catalogModules = READABLE_WORKFLOW_MODULES.filter(module => WORKFLOW_MODULES.some(publicModule => publicModule === module)
    || module.descriptor.capabilities?.review === true);
  database.registerRunSearchDeclarations(WORKFLOW_MODULES.map(({ descriptor }) => ({
    workflow: descriptor.id, version: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
    subjectProjection: descriptor.subjectProjection ?? null,
  })));
  const displayTitle = (record: RunRecord): string => {
    if (record.displayName !== undefined) return record.displayName;
    const { records } = readTimelineRecords(database.authority.timelineEvents, 0, record.envelope.runId);
    for (const event of records) {
      if (event.payload.kind !== "span" || event.payload.event.t !== "run.queued") continue;
      const queued = event.payload.event;
      if (event.workflow !== record.envelope.workflow || queued.traceId !== record.envelope.traceId
        || queued.runId !== record.envelope.runId || queued.attempt > record.envelope.attempt) {
        throw new Error("search-display-title-owner-mismatch");
      }
      if (queued.title !== undefined) return queued.title;
    }
    return record.envelope.workflow;
  };
  const search = createCrossDateSearchService({ clock,
    sourceIdentity: database.getSourceDatabaseIdentity(), cursorSigningKey: randomBytes(32),
    descriptors: { resolve: id => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor },
    authority: { readSnapshot: read => database.withAuthorityReadSnapshot(() => read({
      authorityGeneration: database.getMeta().authorityGeneration,
      searchRuns: searchInput => {
        const page = database.authority.runs.search(searchInput);
        return { ...page, rows: page.rows.map(row => ({ ...row, displayTitle: displayTitle(row.record) })) };
      },
    })) },
  });
  return {
    bootstrap: { appVersion: input.appVersion, actorLabel: input.actorLabel, clock, timeZone: input.timeZone, modules: catalogModules,
      descriptorSetHash: input.descriptorSetHash, settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      preflightReport: input.preflightReport, projection, authorityMeta: () => database.getMeta(),
      workbookCompatibility: input.workbookCompatibility },
    search,
    searchMetadataExports: {export: request=>exportSearchMetadata({search,sourceIdentity:database.getSourceDatabaseIdentity()},request)},
    calendar: createCalendarQuery(database, clock),
    xlsxExports: composeGeneratedExports({ clock, ids, sourceIdentity: database.getSourceDatabaseIdentity(),
      artifacts, authority: database.authority.operatorXlsxExports, search,
      activityReport: (from, to, token) => input.activity.readSelected(from, to, token) }),
    hub: createDashboardStreamHub(input),
  };
}
