import type { RunQueueProjection } from "../../../runs/projections/run-queue-projection.js";
import { exportSearchMetadata } from "../../../runs/exports/search-metadata-export.js";
import { createCalendarQuery } from "../../../runs/queries/calendar.js";
import { randomBytes } from "node:crypto";
import { DASHBOARD_CATALOG_MODULES, WORKFLOW_MODULES, READABLE_WORKFLOW_MODULES } from "../../registries/workflow-registry.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../models/config/settings.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { BootstrapQueryDeps } from "../../../runs/queries/bootstrap.js";
import { createCrossDateSearchService } from "../../../runs/queries/search.js";
import type { OperatorXlsxExportServiceDependencies } from "../../../runs/exports/operator-xlsx-export-service.js";
import { createDashboardStreamHub, type DashboardStreamHubDeps } from "../../../transports/http/subscriptions/dashboard-stream.js";
import type { ShellRouteDeps } from "../../../transports/http/routes/shell-types.js";
import { composeGeneratedExports } from "./generated-exports.js";
import { resolveResultTitle, resolveSubjectTitle } from "../../../runs/projections/run-subject-title.js";
import { retainedRunProtectedBindings } from "../../../../models/write-safety/protected-input.js";
import { runResultCurrent } from "../../../storage/sqlite/delegation-refresh.js";

/** Shell bootstrap, search, export and subscription use the same production authority. */
export function composeShell(input: Pick<BootstrapQueryDeps,
  "appVersion" | "actorLabel" | "clock" | "descriptorSetHash" | "preflightReport" | "workbookCompatibility">
  & Pick<OperatorXlsxExportServiceDependencies, "ids" | "artifacts">
  & DashboardStreamHubDeps
  & { projection: Pick<RunQueueProjection, "runFold">; activity: import("../../../runs/queries/activity-selection.js").ActivitySelectionService; database: AuthorityDatabase; descriptors: Parameters<typeof createCrossDateSearchService>[0]["descriptors"] }
): ShellRouteDeps {
  const { database, projection, clock, ids, artifacts } = input;
  database.registerRunSearchDeclarations(WORKFLOW_MODULES.map(({ descriptor }) => ({
    workflow: descriptor.id, version: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
    subjectProjection: descriptor.subjectProjection ?? null,
  })));
  const descriptorOf = (id: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor;
  const withSearchSnapshot = <Result>(read: () => Result): Result => database.withAuthorityReadSnapshot(read);
  const search = createCrossDateSearchService({ clock,
    sourceIdentity: database.getSourceDatabaseIdentity(), cursorSigningKey: randomBytes(32),
    descriptors: { resolve: descriptorOf },
    authority: { readSnapshot: read => withSearchSnapshot(() => read({
      authorityGeneration: database.getMeta().authorityGeneration,
      searchRuns: searchInput => database.authority.runs.search(searchInput),
      displayTitle: run => {
        if (run.displayName !== undefined && retainedRunProtectedBindings(run).length === 0) return run.displayName;
        const { runId, workflow, itemId, shape } = run.envelope;
        const descriptor = descriptorOf(workflow);
        const receipt = descriptor?.titleProjection !== undefined && shape !== "operation"
          && runResultCurrent(run) && run.lifecycle.outcome === "done" ? database.authority.evidenceReceipts.findByRun(runId) : undefined;
        return (descriptor === undefined ? undefined : resolveResultTitle(descriptor, run, receipt))
          ?? resolveSubjectTitle(descriptor?.subjectProjection, { workflowId: workflow, itemId },
            { latestCheckpoint: (workflowId, item, node) => database.authority.runCheckpoints.latest(workflowId, item, node) })
          ?? projection.runFold(runId)?.queued.title ?? runId;
      },
    })) },
  });
  return {
    bootstrap: { appVersion: input.appVersion, actorLabel: input.actorLabel, clock, modules: DASHBOARD_CATALOG_MODULES,
      descriptorSetHash: input.descriptorSetHash, settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      preflightReport: input.preflightReport, projection, authorityMeta: () => database.getMeta(),
      workbookCompatibility: input.workbookCompatibility },
    search,
    searchMetadataExports: {export: request=>exportSearchMetadata({search,withSearchSnapshot,sourceIdentity:database.getSourceDatabaseIdentity()},request)},
    calendar: createCalendarQuery(database, clock),
    xlsxExports: composeGeneratedExports({ clock, ids, sourceIdentity: database.getSourceDatabaseIdentity(),
      artifacts, authority: database.authority.operatorXlsxExports, search, withSearchSnapshot,
      activityReport: (from, to, token) => input.activity.readSelected(from, to, token) }),
    hub: createDashboardStreamHub(input),
  };
}
