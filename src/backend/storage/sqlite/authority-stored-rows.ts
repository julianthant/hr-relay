import { workerSlotFromRow } from "./worker-slots.js";
import { CURRENT_RUN_SETTLEMENT_SQL, runSettlementContext } from "./run-settlement-row.js";
import { SETTINGS_RECORD_CONVERSION_VERSION } from "./settings-record-conversion.js";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { z } from "zod";
import { CHANGE_LOG_SCHEMA_VERSION, RunReferenceSourceSchema, currentRowKey, expectedRunReferences } from "./authority-change-log.js";
import { AuthorityTableNameSchema, RUN_REFERENCES_TABLE, type AuthorityTableName } from "../../../models/config/authority.js";
import { AssistantActionRecordSchema,AssistantChatRecordSchema } from "../../../models/profiles/assistant-authorization.js";
import { PredecessorRunRecordSchema } from "../../../models/run/record.js";
import { RunResultRecordSchema } from "../../../models/run/result.js";
import { deriveBulkChildCommand } from "../../../rules/commands/command-groups.js";
import { BulkParentCommandRecordSchema } from "../../../rules/commands/commands.js";
import { createAssistantModelPreferenceRepository } from "./assistant-model-preference.js";
import { convertPredecessorCommandRowState } from "./command-record-row.js";
import { deletedRunFromRow } from "./deleted-run-row.js";
import { extractedArtifactFromRow } from "./extracted-artifact-row.js";
import { generatedArtifactFromRow } from "./generated-artifacts.js";
import { importedArtifactFromRow } from "./imported-artifacts.js";
import { isNativeOrdinaryTable, nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { assertPredecessorWorkerHistory, isPredecessorWorkerHistory, predecessorWorkerSlotFromRow } from "./worker-custody-predecessor.js";
import { withoutNativeRecordReadMemo } from "./run-record-row.js";
import { SearchStateColumnSchema, runSearchIndexFromRow } from "./run-search-index.js";
import { readAppSettings, readSettingsRecordConversion } from "./settings-storage.js";
import { DEBUG_EVENTS_MIGRATION, debugEventFromRow, predecessorTimelineEventFromRow, timelineEventFromRow } from "./timeline-repository.js";
import { validateWorkbookLibrary, WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION, WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION, WORKBOOK_PAYLOAD_MIGRATION } from "./workbook-library-repository.js";
import { RunEvidenceReceiptSchema } from "../../../models/trust/evidence.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { exclusiveSessionLeaseFromRow } from "./exclusive-session-leases.js";
import { assistantConversationFromRow, assistantM1MessageFromRow, assistantMessageFromRow } from "./assistant-history.js";
import { ASSISTANT_EFFORT_SCALE_VERSION, convertAssistantEffortRow } from "./assistant-effort-migration.js";
import { FAILURE_NOTE_REMOVAL_SCHEMA_VERSION, convertFailureNoteRow } from "./failure-note-removal-migration.js";
import { ASSISTANT_GRANT_RETIREMENT_VERSION, RETIRED_ASSISTANT_GRANT_TABLE, assertAssistantHistoryRetirable } from "./assistant-grant-retirement.js";
import { assistantAttachmentFromRow } from "./assistant-attachments.js";
import { ASSISTANT_HISTORY_PAYLOAD_SCHEMA_VERSION, ASSISTANT_PHASE_ONE_SCHEMA_VERSION, BUILD_ID_ENVELOPE_SCHEMA_VERSION, COMMAND_ROW_STATE_SCHEMA_VERSION, CURRENT_AUTHORITY_SCHEMA_VERSION, type WORKER_CUSTODY_DROPPED_TABLES, WORKER_CUSTODY_SCHEMA_VERSION, isWorkerCustodyDroppedTable, migrationTableNames } from "./migrations.js";
import { AUTHORITY_RECORD_SCHEMA_REGISTRY } from "./storage-records.js";
import { readIntPragma, CountRowSchema, errorMessage, readMetaRow } from "./authority-connection.js";
import { authorityIntegrityError } from "./authority-errors.js";
import { type StoredReaders, PREDECESSOR_CUSTODY_READERS, CURRENT_READERS, inspectionRunReader, readTimelineRun, assertTimelineOwner, assertTerminalEvidenceOwner, assertRefreshedReceiptSettlement, authenticateStoredWriteResolution, assertConfirmationPublication, authenticateStoredResolutionAudit } from "./authority-run-evidence.js";

/** A confirmed Pause all and quit of the bound runtime generation (`held`) that no application-admission release names; binds the generation twice. */
export function unreleasedQuitHoldSql(indexed = false): string { return `held.family='application'
  ${indexed ? "AND json_extract(held.request_json,'$.family')='application'" : ""}
  AND json_extract(held.request_json,'$.type')='pause-all-and-quit'
  AND json_extract(held.request_json,'$.payload.confirmed')=1
  AND json_extract(held.request_json,'$.target.runtimeGeneration')=?
  AND NOT EXISTS(SELECT 1 FROM commands release WHERE release.state='succeeded' AND release.family='run-lifecycle'
    AND json_extract(release.request_json,'$.operation')='application-admission'
    AND json_extract(release.request_json,'$.request.runtimeGeneration')=?
    AND json_extract(release.request_json,'$.request.releases')=held.id
    ${indexed ? "AND json_extract(release.request_json,'$.family') IS NULL" : ""})`; }

/** Each invariant declares the key kind it is grouped by; `scoped` limits it to the rows of the given keys, bound as one JSON array. */
export function invariantQueries(schemaVersion = CURRENT_AUTHORITY_SCHEMA_VERSION, scoped = false) {
  const only = (column: string) => scoped ? `${column} IN (SELECT value FROM json_each(?))` : "1";
  return Object.freeze([
  { name: "run-owner-exclusivity", scope: "run", sql: `SELECT count(*) AS count FROM runs JOIN deleted_runs ON deleted_runs.run_id=runs.id WHERE ${only("runs.id")}` },
{
    name: "run-completion-revisions", scope: "run",
    sql: `SELECT count(*) AS count FROM runs AS run
      WHERE ${only("run.id")} AND json_type(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion') IS 'object'
        AND run.version - json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.expectedVersion') - 1 <> (
          SELECT count(DISTINCT json_extract(audit.payload_json, '$.result.appliedVersion')) FROM ${schemaVersion >= CHANGE_LOG_SCHEMA_VERSION
            ? `${RUN_REFERENCES_TABLE} AS reference JOIN command_audits AS audit ON audit.id = json_extract(reference.row_key, '$[0]')
          WHERE reference.run_id = run.id AND reference.table_name = 'command_audits' AND`
            : "command_audits AS audit WHERE"} json_extract(audit.payload_json, '$.kind') = 'run-lifecycle'
            AND json_extract(audit.payload_json, '$.result.kind') = 'run'
            AND json_extract(audit.payload_json, '$.result.runId') = run.id
            AND json_extract(audit.payload_json, '$.request.operation') IN ('transition')
            AND json_extract(audit.payload_json, '$.request.fence.kind') = 'version'
            AND json_extract(audit.payload_json, '$.request.fence.expectedVersion') = json_extract(audit.payload_json, '$.result.appliedVersion') - 1
            AND json_extract(audit.payload_json, '$.result.appliedVersion') > json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.expectedVersion') + 1
            AND json_extract(audit.payload_json, '$.result.appliedVersion') <= run.version)` ,
  },
{
    name: "run-completion-consequences", scope: "run",
    sql: `SELECT count(*) AS count FROM runs AS run
      LEFT JOIN run_results AS result ON result.run_id = run.id AND ${schemaVersion >= 20 ? CURRENT_RUN_SETTLEMENT_SQL.replaceAll("settlement.","result.") : "1"}
      LEFT JOIN run_failures AS failure ON failure.run_id = run.id
        ${schemaVersion >= 21 ? "AND failure.id=json_extract(run.lifecycle_json,'$.completion.failureId')" : ""}
      WHERE ${only("run.id")} AND (COALESCE(json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.outcome') IN ('done','failed'), 0)
        IS NOT (json_type(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion') IS 'object')
        OR (json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.kind') = 'done' AND (
          result.run_id IS NULL OR failure.id IS NOT NULL
          OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.resultDigest') IS NOT result.result_digest))
        OR (json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.kind') = 'failed' AND (
          failure.id IS NULL OR result.run_id IS NULL
          OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.completion.failureId') IS NOT failure.id
          OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.errorSummary') IS NOT json_extract(failure.payload_json, '$.summary')
          OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.diagnosticSafetyVersion') IS NOT json_extract(failure.payload_json, '$.diagnosticSafetyVersion'))))` ,
  },
{
    name: "final-runs-bind-result-owner", scope: "run",
    sql: `SELECT count(*) AS count FROM runs AS run
      LEFT JOIN run_results AS result ON result.run_id=run.id AND ${schemaVersion >= 20 ? CURRENT_RUN_SETTLEMENT_SQL.replaceAll("settlement.","result.") : "1"}
      WHERE ${only("run.id")} AND run.state='terminal' AND run.outcome<>'interrupted' AND result.run_id IS NULL`,
  },
{
    name: "failed-runs-bind-failure", scope: "run",
    sql: `
      SELECT count(*) AS count FROM runs AS run
      WHERE ${only("run.id")} AND json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.outcome') = 'failed'
        AND NOT EXISTS (
          SELECT 1 FROM run_failures AS failure
          WHERE failure.id = json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.lifecycle.failureId')
            AND failure.run_id = run.id
        )
    `,
  },
{
    name: "failures-bind-failed-run", scope: "run",
    sql: `
      SELECT count(*) AS count FROM run_failures AS failure
      JOIN runs AS run ON run.id = failure.run_id
      WHERE ${only("run.id")} AND (${schemaVersion >= 21 ? `NOT EXISTS (
        SELECT 1 FROM run_results result WHERE result.run_id=run.id
          AND json_extract(result.terminal_run_json,'$.lifecycle.outcome')='failed'
          AND json_extract(result.terminal_run_json,'$.lifecycle.failureId')=failure.id
          AND json_extract(result.terminal_run_json,'$.completion.failureId')=failure.id
          AND json_extract(result.payload_json,'$.result.value.kind')='failed-evidence'
          AND json_extract(result.payload_json,'$.result.value.authorization.failureId')=failure.id
          AND result.settlement_version=json_extract(result.terminal_run_json,'$.completion.expectedVersion')+1
      )` : `json_extract(run.lifecycle_json, '$.lifecycle.outcome') IS NOT 'failed'
        OR json_extract(run.lifecycle_json, '$.lifecycle.failureId') IS NOT failure.id`})
    `,
  },
{
    name: "failure-identity-matches-run", scope: "run",
    sql: `
      SELECT count(*) AS count FROM run_failures AS failure
      JOIN runs AS run ON run.id = failure.run_id
      WHERE ${only("run.id")} AND (json_extract(failure.payload_json, '$.workflowId') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.workflow')
        OR json_extract(failure.payload_json, '$.traceId') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.traceId')
        OR json_extract(failure.payload_json, '$.attempt') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.attempt'))
    `,
  },
{
    name: "run-result-identity-matches-run", scope: "run",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      JOIN runs AS run ON run.id = result.run_id
      WHERE ${only("run.id")} AND (json_extract(result.payload_json, '$.workflowId') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.workflow')
        OR json_extract(result.payload_json, '$.attempt') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.attempt')
        OR json_extract(result.payload_json, '$.descriptorVersion') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.descriptorVersion')
        OR json_extract(result.payload_json, '$.contractFingerprint') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.contractFingerprint')
        OR json_extract(result.payload_json, '$.configFingerprint') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.configFingerprint')
        OR json_extract(result.payload_json, '$.configSnapshotId') <> json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.configSnapshotId'))
    `,
  },
{
    name: "results-bind-terminal-run", scope: "run",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      JOIN runs AS run ON run.id = result.run_id
      WHERE ${only("run.id")} AND (${schemaVersion >= 20 ? "json_extract(result.terminal_run_json,'$.lifecycle.state')" : "run.state"} IS NOT 'terminal' OR ${schemaVersion >= 20 ? "json_extract(result.terminal_run_json,'$.lifecycle.outcome')" : "run.outcome"} IS 'interrupted'
        OR (${schemaVersion >= 20 ? "json_extract(result.terminal_run_json,'$.lifecycle.outcome')" : "run.outcome"} = 'done' AND json_extract(result.payload_json,'$.result.value.kind') IN ('failed-evidence','lifecycle-evidence'))
        OR (${schemaVersion >= 20 ? "json_extract(result.terminal_run_json,'$.lifecycle.outcome')" : "run.outcome"} = 'failed' AND json_extract(result.payload_json,'$.result.value.kind') IS NOT 'failed-evidence')
        OR (${schemaVersion >= 20 ? "json_extract(result.terminal_run_json,'$.lifecycle.outcome')" : "run.outcome"} IN ('cancelled','discarded','superseded') AND json_extract(result.payload_json,'$.result.value.kind') IS NOT 'lifecycle-evidence'))
    `,
  },
{
    // Check one-active-run ownership before claiming; a second active row is a loop defect.
    name: "worker-owns-at-most-one-active-run", scope: "worker",
    sql: `
      SELECT count(*) AS count FROM (
        SELECT owner_worker_id FROM runs
        WHERE ${only("owner_worker_id")} AND state IN ('claimed','validating','running')
        GROUP BY owner_worker_id HAVING count(*) > 1
      )
    `,
  },
{
    name: "diagnostic-attachment-binds-its-bundle", scope: "snapshot",
    sql: `
      SELECT count(*) AS count FROM diagnostic_files AS attachment
      LEFT JOIN diagnostic_snapshots AS bundle ON bundle.id = attachment.snapshot_id
      WHERE ${only("attachment.snapshot_id")} AND (bundle.id IS NULL
        OR attachment.id IS NOT (attachment.snapshot_id || ':' || attachment.artifact_id)
        OR attachment.snapshot_id IS NOT json_extract(attachment.payload_json, '$.bundleId')
        OR attachment.artifact_id IS NOT json_extract(attachment.payload_json, '$.attachment.artifactId')
        OR attachment.digest IS NOT json_extract(attachment.payload_json, '$.attachment.digest'))
    `,
  },
{
    name: "diagnostic-bundle-attachments-are-indexed", scope: "snapshot",
    sql: `
      SELECT count(*) AS count FROM diagnostic_snapshots AS bundle
      WHERE ${only("bundle.id")} AND json_array_length(bundle.payload_json, '$.attachments')
        <> (SELECT count(*) FROM diagnostic_files AS attachment WHERE attachment.snapshot_id = bundle.id)
    `,
  },
{
    name: "started-dry-run-scenario-result-binds-run", scope: "run",
    sql: `
      SELECT count(*) AS count FROM dryrun_results AS result
      LEFT JOIN runs AS run ON run.id = result.run_id
      WHERE ${only("result.run_id")} AND result.execution_state = 'started' AND (
        run.id IS NULL
        OR result.workflow IS NOT run.workflow
        OR result.trace_id IS NOT json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.traceId')
        OR json_extract(json_set(run.lifecycle_json,'$.envelope',json(run.envelope_json)), '$.envelope.dryRun') IS NOT (
          CASE WHEN json_extract(result.payload_json, '$.execution.arm') = 'live-read' THEN 0 ELSE 1 END
        )
      )
    `,
  },
{
    name: "attempting-write-has-current-attempt", scope: "intent",
    sql: `
      SELECT count(*) AS count FROM write_intents AS intent
      WHERE ${only("intent.id")} AND intent.status = 'attempting' AND NOT EXISTS (
        SELECT 1 FROM write_attempts AS attempt
        WHERE attempt.id = json_extract(intent.payload_json, '$.currentAttemptId')
          AND attempt.intent_id = intent.id
          AND attempt.generation = json_extract(intent.payload_json, '$.generation')
      )
    `,
  }
] as const); }

/** The keys an invariant check is limited to, by the kind each invariant is grouped by; omitted, every row is checked. */
type InvariantScope = Readonly<{ run: ReadonlySet<string>; worker: ReadonlySet<string>; snapshot: ReadonlySet<string>; intent: ReadonlySet<string>;
  /** Commands whose group links are re-derived: changed commands, and the children of changed parents. */
  command: ReadonlySet<string> }>;

export function invariantViolations(database: DatabaseSync, scope?: InvariantScope): readonly string[] {
  const violations = invariantQueries(readIntPragma(database,"user_version"), scope !== undefined).flatMap(({ name, scope: kind, sql }) => {
    if (scope !== undefined && scope[kind].size === 0) return [];
    const statement = database.prepare(sql);
    const { count } = CountRowSchema.parse(scope === undefined ? statement.get() : statement.get(JSON.stringify([...scope[kind]])));
    return count === 0 ? [] : [`${name} failed for ${String(count)} row(s)`];
  });
  return [...violations, ...commandGroupLinkViolations(database, scope)];
}

/**
 * Validate both declared links and missing links from each immutable parent selection; `scope` limits the links checked to its
 * commands. A child's request names the run its parent targets, so the parents that could claim a scoped command are the bulk
 * parents referencing a scoped run, and the scope's runs include every run a scoped command referenced before or after.
 */
function commandGroupLinkViolations(database: DatabaseSync, scope?: Readonly<{ command: ReadonlySet<string>; run: ReadonlySet<string> }>): readonly string[] {
  if (scope?.command.size === 0) return [];
  const commands = scope?.command;
  const rowSchema = z.strictObject({ id: z.string(), request_json: z.string(), parent_id: z.string().nullable() });
  const rows = scope === undefined
    ? database.prepare("SELECT id, request_json, parent_id FROM commands ORDER BY id").all().map((row) => rowSchema.parse(row))
    : database.prepare(`SELECT id, request_json, parent_id FROM commands WHERE id IN (SELECT value FROM json_each(?1)) OR parent_id IN (SELECT value FROM json_each(?1))
        OR id IN (SELECT parent_id FROM commands WHERE id IN (SELECT value FROM json_each(?1)))
      UNION SELECT parent.id, parent.request_json, parent.parent_id FROM ${RUN_REFERENCES_TABLE} AS reference JOIN commands AS parent ON parent.id = json_extract(reference.row_key, '$[0]')
        WHERE reference.run_id IN (SELECT value FROM json_each(?2)) AND reference.table_name = 'commands' AND parent.family = 'bulk-parent'
      ORDER BY id`).all(JSON.stringify([...scope.command]), JSON.stringify([...scope.run])).map((row) => rowSchema.parse(row));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const checked = (id: string) => commands === undefined || commands.has(id) || commands.has(byId.get(id)?.parent_id ?? "");
  const expected = new Map<string, string>();
  for (const row of rows) {
    const raw: unknown = JSON.parse(row.request_json);
    if (typeof raw !== "object" || raw === null || !("kind" in raw) || raw.kind !== "bulk-parent") continue;
    const parent = BulkParentCommandRecordSchema.parse(raw);
    for (const target of parent.acceptance.request.targets) {
      const child = deriveBulkChildCommand(parent.acceptance.request, target);
      const saved = byId.get(child.commandId);
      if (saved === undefined || !(checked(child.commandId) || checked(parent.commandId))) continue;
      if (expected.has(child.commandId) && expected.get(child.commandId) !== parent.commandId) return ["command-group ambiguous child ownership"];
      if (canonicalJsonStringify(JSON.parse(saved.request_json) as unknown) !== canonicalJsonStringify(child)) return ["command-group child request mismatch"];
      expected.set(child.commandId, parent.commandId);
    }
  }
  return rows.flatMap((row) => !checked(row.id) || row.parent_id === (expected.get(row.id) ?? null)
    ? [] : ["command-group child linkage mismatch"]);
}

export function nativeTableKey(table: AuthorityTableName | "explorer_overrides" | typeof WORKER_CUSTODY_DROPPED_TABLES[number] | typeof RETIRED_ASSISTANT_GRANT_TABLE, database: DatabaseSync): string {
  if (table === "run_results" && readIntPragma(database, "user_version") < 20) return "run_id";
  if (table === "workbook_library_history" && readIntPragma(database, "user_version") < 13) return "workbook_id,version,payload_json";
  if (table === "worker_controls") return "command_id";
  const current = AuthorityTableNameSchema.safeParse(table);
  return current.success ? currentRowKey(current.data).join(",") : "id";
}

/** What validating one stored row needs: the store, its schema's readers and the row conversions of the schemas above it. */
type StoredRowContext = Readonly<{ database: DatabaseSync; read: StoredReaders; expectedSchemaVersion: number; predecessorCustody: boolean;
  convertPreferences: (table: string, row: unknown) => unknown; commandOutcomeInSnapshot?: StatementSync;
  timelineOwnerInSnapshot?: (id: string) => ReturnType<typeof readTimelineRun> }>;

const CommandOutcomeRowSchema = z.object({ outcome_json: z.string() });

export function storedRowContext(database: DatabaseSync, expectedSchemaVersion: number): StoredRowContext {
  const predecessorCustody = expectedSchemaVersion < WORKER_CUSTODY_SCHEMA_VERSION;
  const read: StoredReaders = { ...(predecessorCustody ? PREDECESSOR_CUSTODY_READERS : CURRENT_READERS), run: inspectionRunReader(expectedSchemaVersion) };
  const readSettings = expectedSchemaVersion < SETTINGS_RECORD_CONVERSION_VERSION ? readSettingsRecordConversion(database) : undefined;
  const convertPreferences = (table: string, row: unknown) => {
    const person = readSettings === undefined ? row : readSettings(table, row);
    const effort = expectedSchemaVersion < ASSISTANT_EFFORT_SCALE_VERSION ? convertAssistantEffortRow(table, person) : person;
    const state = expectedSchemaVersion < COMMAND_ROW_STATE_SCHEMA_VERSION ? convertPredecessorCommandRowState(table, effort) : effort;
    return expectedSchemaVersion < FAILURE_NOTE_REMOVAL_SCHEMA_VERSION ? convertFailureNoteRow(table, state) : state;
  };
  return { database, read, expectedSchemaVersion, predecessorCustody, convertPreferences };
}

/** Tables validated as a whole family (workbooks) or by a conversion (retired and custody-dropped tables), never row by row. */
export function validatedRowByRow(table: AuthorityTableName | "explorer_overrides" | typeof WORKER_CUSTODY_DROPPED_TABLES[number] | typeof RETIRED_ASSISTANT_GRANT_TABLE): table is AuthorityTableName {
  return !(table.startsWith("workbook_") || table === "explorer_overrides" || table === RETIRED_ASSISTANT_GRANT_TABLE || isWorkerCustodyDroppedTable(table));
}

export function validateAuthorityRecordSchemas(database: DatabaseSync, validateSearch = true, expectedSchemaVersion: number = CURRENT_AUTHORITY_SCHEMA_VERSION,
  workbookPayloads = true, fingerprint?: Readonly<{ table(name: string): void; row(row: Record<string, unknown>): void }>): number {
  return withoutNativeRecordReadMemo(() => {
    const readers = storedRowContext(database, expectedSchemaVersion);
    // The full current-schema scan validates every command, including the binding between its request and outcome.
    const commandOutcomeInSnapshot = database.isTransaction && expectedSchemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION
      ? database.prepare("SELECT outcome_json FROM commands WHERE id=?") : undefined;
    // All timeline owners are read and strictly parsed against this scan's SQLite snapshot.
    const owners = new Map<string, ReturnType<StoredReaders["run"]>>();
    const timelineOwnerInSnapshot = !database.isTransaction ? undefined : (id: string) => {
      const prior = owners.get(id);
      if (prior !== undefined) return prior;
      const owner = readTimelineRun(database, id, readers.read);
      if (owner !== undefined && owners.size < 256) owners.set(id, owner);
      return owner;
    };
    const context = { ...readers, commandOutcomeInSnapshot, timelineOwnerInSnapshot };
    if (expectedSchemaVersion >= 8 && expectedSchemaVersion < ASSISTANT_GRANT_RETIREMENT_VERSION) assertAssistantHistoryRetirable(database, nativeOrdinaryRecordFromRow);
    let validated = 0;
    const searchReady = z.object({search_state:z.string()}).parse(database.prepare("SELECT search_state FROM database_states WHERE id=1").get()).search_state === "ready";
    for (const table of migrationTableNames(expectedSchemaVersion)) {
      // The custody conversion validates the tables it drops.
      const validate = validatedRowByRow(table) && !(table === "assistant_actions" && expectedSchemaVersion < ASSISTANT_GRANT_RETIREMENT_VERSION)
        && !(table === "run_search" && (!validateSearch || !searchReady));
      if (!validate && fingerprint === undefined) continue;
      fingerprint?.table(table);
      const retained = expectedSchemaVersion >= 10 ? "" : table === "commands" ? " WHERE family<>'explorer'"
        : table === "command_audits" ? " WHERE command_id NOT IN (SELECT id FROM commands WHERE family='explorer')" : "";
      for (const raw of database.prepare(`SELECT * FROM ${table}${retained} ORDER BY ${nativeTableKey(table, database)}`).iterate()) {
        if (validate) { validateStoredRow(context, table, raw); validated++; }
        fingerprint?.row(raw);
      }
    }
    return validated + validateAuthorityFamilies(context, workbookPayloads);
  });
}

/** The library, the assistant preference and settings are each validated as one family; returns the library rows validated. */
/** `payloadDigests` limits the workbook payload check to those rows; omitted, every payload is checked. */
export function validateAuthorityFamilies(context: StoredRowContext, workbookPayloads = true, families: ReadonlySet<AuthorityFamily> = ALL_AUTHORITY_FAMILIES,
  payloadDigests?: ReadonlySet<string>): number {
  const { database, expectedSchemaVersion, convertPreferences } = context;
  let validated = 0;
  if (families.has("workbook") && workbookPayloads && expectedSchemaVersion >= 4) validated += validateWorkbookLibrary(database, expectedSchemaVersion >= 13, expectedSchemaVersion >= 18,
    expectedSchemaVersion >= WORKBOOK_LIBRARY_PIN_TAGS_MIGRATION.version, expectedSchemaVersion >= WORKBOOK_LIBRARY_SYNC_STATUS_MIGRATION.version, expectedSchemaVersion >= WORKBOOK_PAYLOAD_MIGRATION.version, payloadDigests);
  // Below schema 27 the stored effort is converted only by the upgrade; the upgraded copy is inspected again at the current version.
  if (families.has("assistant-preference") && expectedSchemaVersion >= ASSISTANT_EFFORT_SCALE_VERSION) createAssistantModelPreferenceRepository({ database, read: work => work(), mutate: () => { throw new Error("assistant-preference-readonly"); } }).get();
  if (families.has("settings")) try{readAppSettings(database, convertPreferences);}catch(error){throw new Error(`authority table settings failed native record validation: ${errorMessage(error)}`,{cause:error});}
  return validated;
}

/** Validates one stored row exactly as the whole-store check does. */
export function validateStoredRow(context: StoredRowContext, table: AuthorityTableName, raw: Record<string, unknown>): void {
  const { database, read, expectedSchemaVersion, predecessorCustody, convertPreferences } = context;
      try {
        if (table === "database_states") {
          const row = z.strictObject({id:z.literal(1),schema_version:z.literal(expectedSchemaVersion),authority_generation:z.number().int().nonnegative(),updated_at:IsoInstantSchema,
            search_generation:z.number().int().nonnegative().nullable(),search_state:SearchStateColumnSchema,
            ...(expectedSchemaVersion >= 7 ? { installation_id: z.uuid(), profile_id: z.uuid() } : {}) }).parse(raw);
          if (row.search_state === "ready" && row.search_generation !== row.authority_generation) throw authorityIntegrityError("search-generation-mismatch");
        } else if (table === "runs") read.run(raw);
        else if (table === "commands") {
          if (predecessorCustody && isPredecessorWorkerHistory(raw)) assertPredecessorWorkerHistory(raw);
          else read.command(convertPreferences(table, raw));
        }
        else if (table === "run_search") {
          const id = z.object({run_id:z.string()}).parse(raw).run_id;
          const run = readTimelineRun(database,id,read);
          if (run === undefined) throw authorityIntegrityError("run-search-owner-missing");
          runSearchIndexFromRow(raw,run,z.object({search_state:z.string()}).parse(database.prepare("SELECT search_state FROM database_states WHERE id=1").get()).search_state === "ready");
        }
        else if (table === "deleted_runs") deletedRunFromRow(raw);
        else if (table === "settings") readAppSettings(database, convertPreferences);
        else if (table === "worker_slots") (predecessorCustody ? predecessorWorkerSlotFromRow : workerSlotFromRow)(raw);
        else if (table === "exclusive_session_leases") exclusiveSessionLeaseFromRow(raw);
        else if (table === "assistant_conversations") assistantConversationFromRow(raw);
        else if (table === "assistant_messages") {
          const payload: unknown = expectedSchemaVersion >= ASSISTANT_PHASE_ONE_SCHEMA_VERSION && typeof raw.payload_json === "string" ? JSON.parse(raw.payload_json) : undefined;
          if (expectedSchemaVersion >= ASSISTANT_HISTORY_PAYLOAD_SCHEMA_VERSION || payload !== null && typeof payload === "object" && Object.hasOwn(payload, "recording")) assistantM1MessageFromRow(raw);
          else assistantMessageFromRow(raw);
        }
        else if (table === "assistant_attachments") assistantAttachmentFromRow(raw);
        else if (table === "assistant_proposals") {
          const row = AUTHORITY_RECORD_SCHEMA_REGISTRY[table].parse(raw);
          if (row.snapshot_json.profileId !== readMetaRow(database).profile_id) throw authorityIntegrityError("assistant-proposal-profile-mismatch");
        }
        else if (table === "assistant_proposal_rows") AUTHORITY_RECORD_SCHEMA_REGISTRY[table].parse(raw);
        else if (table === "assistant_applied_edits") {
          const row = AUTHORITY_RECORD_SCHEMA_REGISTRY[table].parse(raw);
          if (row.payload_json.turn.profileId !== readMetaRow(database).profile_id) throw authorityIntegrityError("assistant-edit-profile-mismatch");
        }
        else if (table === "assistant_session_claims") {
          const row = AUTHORITY_RECORD_SCHEMA_REGISTRY[table].parse(raw);
          if (row.claim_json.acceptedTurn.profileId !== readMetaRow(database).profile_id) throw authorityIntegrityError("assistant-session-claim-profile-mismatch");
        }
        else if (table === "timeline_events") assertTimelineOwner(database,(expectedSchemaVersion < DEBUG_EVENTS_MIGRATION.version ? predecessorTimelineEventFromRow : timelineEventFromRow)(raw),false,read,context.timelineOwnerInSnapshot);
        else if (table === "debug_events") assertTimelineOwner(database,debugEventFromRow(raw),false,read,context.timelineOwnerInSnapshot);
        else if (table === "artifacts") {
          const {kind} = z.object({kind:z.enum(["imported","generated","extracted"])}).parse(raw);
          if (kind === "imported") importedArtifactFromRow(raw);
          else if (kind === "generated") generatedArtifactFromRow(raw);
          else if (expectedSchemaVersion < 12) {
            const row = z.object({ id: z.string(), payload_json: z.string() }).parse(raw);
            const extraction: unknown = JSON.parse(row.payload_json);
            extractedArtifactFromRow({ ...raw, payload_json: canonicalJsonStringify({ binding: "unbound-source",
              extractionId: row.id, extraction }) });
          } else extractedArtifactFromRow(raw);
        } else if (table === "command_audits" && predecessorCustody && isPredecessorWorkerHistory(database.prepare("SELECT * FROM commands WHERE id=?").get(String(raw.command_id)))) {
          assertPredecessorWorkerHistory(database.prepare("SELECT * FROM commands WHERE id=?").get(String(raw.command_id)), raw);
        } else if (isNativeOrdinaryTable(table)) {
          let inspected = convertPreferences(table, raw);
          if (table === "run_requests" && expectedSchemaVersion < 6) {
            const row = z.object({ payload_json: z.string() }).parse(raw);
            const payload = z.record(z.string(), z.unknown()).parse(JSON.parse(row.payload_json));
            if (expectedSchemaVersion < 5 && Object.hasOwn(payload, "workers")) throw authorityIntegrityError("pre-v5-start-plan-workers-unexpected");
            if (expectedSchemaVersion === 5) z.union([z.literal("auto"), z.number().int().min(1).max(8)]).parse(payload.workers);
            const { workers: _removed, ...plan } = payload;
            inspected = { ...raw, payload_json: canonicalJsonStringify(plan) };
          }
          const record = nativeOrdinaryRecordFromRow(table,inspected,expectedSchemaVersion);
          if (table === "assistant_chats") {
            if (AssistantChatRecordSchema.parse(record).profileId !== readMetaRow(database).profile_id) throw authorityIntegrityError("assistant-chat-profile-mismatch");
          }
          if (table === "assistant_actions") {
            const action = AssistantActionRecordSchema.parse(record);
            const rawChat = database.prepare("SELECT * FROM assistant_chats WHERE id=?").get(action.chatId);
            const chat = AssistantChatRecordSchema.parse(nativeOrdinaryRecordFromRow("assistant_chats", rawChat));
            if (chat.profileId !== action.binding.profileId || chat.epoch !== action.binding.accountSessionEpoch) throw authorityIntegrityError("assistant-action-chat-mismatch");
          }
          if (table === "run_results") assertTerminalEvidenceOwner(database,RunResultRecordSchema.parse(record),read,expectedSchemaVersion >= 20 ? expectedSchemaVersion < BUILD_ID_ENVELOPE_SCHEMA_VERSION ? runSettlementContext(raw, PredecessorRunRecordSchema) : runSettlementContext(raw) : undefined, new Set(), expectedSchemaVersion);
          if (table === "run_receipts" && expectedSchemaVersion >= 20) assertRefreshedReceiptSettlement(database,RunEvidenceReceiptSchema.parse(record),raw,expectedSchemaVersion);
          if (table === "write_intents") { authenticateStoredWriteResolution(database,record,read); assertConfirmationPublication(database,z.object({writeIntentId:z.string()}).parse(record).writeIntentId,read); }
          if (table === "command_audits") {
            const audit = authenticateStoredResolutionAudit(database,record,read);
            let commandOutcome: unknown;
            if (context.commandOutcomeInSnapshot !== undefined) {
              commandOutcome = context.commandOutcomeInSnapshot.get(audit.request.commandId);
            } else {
              const row = database.prepare("SELECT * FROM commands WHERE id=?").get(audit.request.commandId);
              if (row === undefined) throw authorityIntegrityError("command-audit-settlement-mismatch");
              commandOutcome = convertPreferences("commands", row);
              if (canonicalJsonStringify(read.command(commandOutcome)) !== canonicalJsonStringify(audit.request))
                throw authorityIntegrityError("command-audit-settlement-mismatch");
            }
            if (commandOutcome === undefined || CommandOutcomeRowSchema.parse(commandOutcome).outcome_json !== canonicalJsonStringify(audit))
              throw authorityIntegrityError("command-audit-settlement-mismatch");
          }
        } else throw new Error("native row admission is undefined");
      } catch (error) { throw new Error(`authority table ${table} failed native record validation: ${errorMessage(error)}`,{cause:error}); }
}

type AuthorityFamily = "workbook" | "assistant-preference" | "settings";
const ALL_AUTHORITY_FAMILIES: ReadonlySet<AuthorityFamily> = new Set(["workbook", "assistant-preference", "settings"]);
export type StoredRow = Record<string, unknown>;

const ReferenceRowsSchema = z.array(z.object({ run_id: z.string(), table_name: z.string(), row_key: z.string() }));

/** Every stored link must equal the set the source rows imply. */
export function assertRunReferences(database: DatabaseSync): void {
  // Each side is a subquery: a bare `a EXCEPT b UNION c` groups as `(a EXCEPT b) UNION c`.
  const expected = `SELECT * FROM (${RunReferenceSourceSchema.options.map(table => expectedRunReferences(table)).join(" UNION ")})`;
  const stored = `SELECT * FROM (SELECT run_id,table_name,row_key FROM ${RUN_REFERENCES_TABLE})`;
  const differing = ReferenceRowsSchema.parse(database.prepare(`SELECT * FROM (${stored} EXCEPT ${expected}) UNION ALL SELECT * FROM (${expected} EXCEPT ${stored}) LIMIT 1`).all());
  if (differing.length > 0) throw authorityIntegrityError("run-references-mismatch");
}
