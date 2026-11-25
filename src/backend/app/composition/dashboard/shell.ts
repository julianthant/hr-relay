import { defineLaneRead, type DashboardReadLanes, type LaneReadContext, type LaneReadDefinition } from "../../../storage/sqlite/dashboard-read-host.js";
import type { RunQueueProjection } from "../../../runs/projections/run-queue-projection.js";
import { buildSearchMetadata, exportSearchMetadata, SearchMetadataFileSchema } from "../../../runs/exports/search-metadata-export.js";
import { selectionDownload } from "../../../runs/exports/selection-download.js";
import { calendarLaneRead, createCalendarQuery } from "../../../runs/queries/calendar.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DASHBOARD_CATALOG_MODULES, WORKFLOW_MODULES, READABLE_WORKFLOW_MODULES } from "../../registries/workflow-registry.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../models/config/settings.js";
import { CrossDateSearchQuerySchema } from "../../../../models/dashboard/search.js";
import { SearchMetadataExportRequestSchema } from "../../../../models/dashboard/search-export.js";
import { OperatorXlsxSearchDocumentSchema, OperatorXlsxSearchSelectionSchema } from "../../../../models/dashboard/xlsx-export.js";
import { FingerprintSchema } from "../../../../rules/identity/ids.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { BootstrapQueryDeps } from "../../../runs/queries/bootstrap.js";
import { createAuthorityCrossDateSearchService, rethrowSearchLaneError, storedSearchQueuedTitle, withSearchSelectionRefusals } from "../../../runs/queries/search.js";
import { collectSearchDocument, type OperatorXlsxExportServiceDependencies } from "../../../runs/exports/operator-xlsx-export-service.js";
import { createDashboardStreamHub, type DashboardStreamHubDeps } from "../../../transports/http/subscriptions/dashboard-stream.js";
import type { ShellRouteDeps } from "../../../transports/http/routes/shell-types.js";
import { composeGeneratedExports } from "./generated-exports.js";

const searchDescriptors = { resolve: (id: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor };
// All three search reads share the BFF's key, including after a lane restart.
const laneSigningKey = { signingKey: FingerprintSchema };
type SearchDocumentDependencies = Parameters<typeof collectSearchDocument>[0];

function withLaneSearch<Result>(context: LaneReadContext, signingKey: string, read: (deps: SearchDocumentDependencies) => Result): Result {
  const { history, nowMs } = context;
  const sourceIdentity = history.getSourceDatabaseIdentity();
  const search = createAuthorityCrossDateSearchService({ database: history, sourceIdentity, clock: { now: () => new Date(nowMs) },
    cursorSigningKey: Buffer.from(signingKey, "hex"), descriptors: searchDescriptors,
    queuedTitle: runId => storedSearchQueuedTitle(history, runId) });
  return withSearchSelectionRefusals(() => read({ search, sourceIdentity,
    withSearchSnapshot: work => history.withAuthorityReadSnapshot(work) }));
}

const searchPageRead = defineLaneRead(import.meta.url, "search-page", {
  lane: "search", priority: "interactive", args: z.strictObject({ ...laneSigningKey, query: CrossDateSearchQuerySchema }),
  run: (context, { signingKey, query }) => withLaneSearch(context, signingKey, ({ search }) => search.search(query)),
});

const searchMetadataRead = defineLaneRead(import.meta.url, "search-metadata-export", {
  lane: "search", priority: "interactive", args: z.strictObject({ ...laneSigningKey,
    selection: OperatorXlsxSearchSelectionSchema, format: SearchMetadataExportRequestSchema.shape.format }),
  run: (context, { signingKey, selection, format }) => withLaneSearch(context, signingKey,
    deps => buildSearchMetadata(collectSearchDocument(deps, selection), format)),
});

const searchDocumentRead = defineLaneRead(import.meta.url, "search-xlsx-selection", {
  lane: "search", priority: "interactive", args: z.strictObject({ ...laneSigningKey, selection: OperatorXlsxSearchSelectionSchema }),
  run: (context, { signingKey, selection }) => withLaneSearch(context, signingKey, deps => collectSearchDocument(deps, selection)),
});

export function composeShellLaneReads(lanes: DashboardReadLanes, cursorSigningKey: Uint8Array) {
  const signingKey = FingerprintSchema.parse(Buffer.from(cursorSigningKey).toString("hex"));
  const read = async <Args>(definition: LaneReadDefinition<Args, unknown>, args: Args, signal?: AbortSignal) => {
    try { return (await lanes.read(definition, args, signal === undefined ? {} : { signal })).body; }
    catch (error) { rethrowSearchLaneError(error); }
  };
  return {
    searchPage: (query: z.output<typeof CrossDateSearchQuerySchema>, signal?: AbortSignal) => read(searchPageRead, { query, signingKey }, signal),
    calendar: { read: (query: z.output<typeof calendarLaneRead.args>, signal?: AbortSignal) => read(calendarLaneRead, query, signal) },
    searchMetadataExports: { async export(input: unknown, signal?: AbortSignal) {
      const { selection, format } = SearchMetadataExportRequestSchema.parse(input);
      if (selection.kind !== "search") throw new Error("search-export-selection-required");
      const body = await read(searchMetadataRead, { selection, format, signingKey }, signal);
      const file = SearchMetadataFileSchema.parse(JSON.parse(body));
      return selectionDownload(file.body, file.filename, file.mediaType, selection.snapshot.token);
    } },
    async readSearchDocument(selection: z.output<typeof OperatorXlsxSearchSelectionSchema>) {
      const body = await read(searchDocumentRead, { selection, signingKey });
      return OperatorXlsxSearchDocumentSchema.parse(JSON.parse(body));
    },
  };
}

/** Shell bootstrap, search, export and subscription use the same production authority. */
export function composeShell(input: Pick<BootstrapQueryDeps,
  "appVersion" | "actorLabel" | "clock" | "descriptorSetHash" | "preflightReport" | "workbookCompatibility">
  & Pick<OperatorXlsxExportServiceDependencies, "ids" | "artifacts">
  & DashboardStreamHubDeps
  & { readLanes?: DashboardReadLanes; projection: Pick<RunQueueProjection, "runFold">; activity: import("../../../runs/queries/activity-selection.js").ActivitySelectionService; database: AuthorityDatabase; descriptors: Parameters<typeof createAuthorityCrossDateSearchService>[0]["descriptors"] }
): ShellRouteDeps {
  const { projection, clock, ids, artifacts } = input;
  const database = input.database.dashboardHistory();
  input.database.registerRunSearchDeclarations(WORKFLOW_MODULES.map(({ descriptor }) => ({
    workflow: descriptor.id, version: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
    subjectProjection: descriptor.subjectProjection ?? null,
  })));
  const sourceIdentity = database.getSourceDatabaseIdentity();
  const cursorSigningKey = randomBytes(32);
  const lane = input.readLanes === undefined ? undefined : composeShellLaneReads(input.readLanes, cursorSigningKey);
  const search = createAuthorityCrossDateSearchService({ database, sourceIdentity, clock, cursorSigningKey, descriptors: searchDescriptors,
    queuedTitle: runId => projection.runFold(runId)?.queued.title });
  const localSearch = { search, sourceIdentity, withSearchSnapshot: <Result>(read: () => Result) => database.withAuthorityReadSnapshot(read) };
  return {
    bootstrap: { appVersion: input.appVersion, actorLabel: input.actorLabel, clock, modules: DASHBOARD_CATALOG_MODULES,
      descriptorSetHash: input.descriptorSetHash, settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      preflightReport: input.preflightReport, projection, authorityMeta: () => database.getMeta(),
      workbookCompatibility: input.workbookCompatibility },
    search,
    ...(lane === undefined ? {} : { searchPage: lane.searchPage }),
    searchMetadataExports: lane?.searchMetadataExports ?? { export: request => exportSearchMetadata(localSearch, request) },
    calendar: lane?.calendar ?? createCalendarQuery(database, clock),
    xlsxExports: composeGeneratedExports({ clock, ids, sourceIdentity, artifacts, authority: input.database.authority.operatorXlsxExports,
      ...(lane === undefined ? localSearch : { readSearchDocument: lane.readSearchDocument }),
      activityReport: (from, to, token) => input.activity.readSelected(from, to, token) }),
    hub: createDashboardStreamHub(input),
  };
}
