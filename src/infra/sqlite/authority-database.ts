import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  assertWorkflowRunResultAuthorization,
  descriptorRuntimeNodes,
  type AnyWorkflowDescriptor,
} from "../../base/workflow.js";
import type { ProviderAdmissionRepository } from "../../base/providers.js";
import {
  AUTHORITY_TABLE_REGISTRY,
  AuthorityTableNameSchema,
  ProjectionTableNameSchema,
  type AuthorityTableName,
  type ProjectionTableName,
  type TableName,
} from "../../domain/authority.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { CommandAuditRecordSchema, CommandRequestSchema } from "../../domain/commands.js";
import { providerBudget, type ProviderBudget } from "../../domain/config/schema.js";
import {
  ConfigSnapshotRecordSchema,
  ConfigSnapshotWriteSchema,
  type ConfigSnapshotRecord,
} from "../../domain/config/snapshot.js";
import { DelegationManifestSchema, DependencyRecordSchema } from "../../domain/dependencies.js";
import { GateResultRecordSchema } from "../../domain/gates.js";
import {
  BrowserSystemIdSchema,
  ProviderAdmissionIdSchema,
  ProviderCapabilityIdSchema,
  RunIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../domain/ids.js";
import { nextAttemptEnvelope } from "../../domain/run/envelope.js";
import {
  RunRecordSchema,
  runClaim,
  runTransitionViolation,
  type RunRecord,
} from "../../domain/run/record.js";
import {
  RunResultRecordSchema,
  deriveCheckpointOutputDigest,
  deriveCheckpointProvenanceDigest,
  type RunResultRecord,
} from "../../domain/run/result.js";
import {
  TerminalAuthorizationRecordSchema,
  type TerminalAuthorizationRecord,
} from "../../domain/run/terminal-authorization.js";
import {
  StartPlanRecordSchema,
  isStartPlanExpired,
  type StartPlanRecord,
} from "../../domain/run/start-plan.js";
import {
  RunTerminalOutboxRecordSchema,
  type RunTerminalOutboxRecord,
} from "../../domain/run/terminal-outbox.js";
import { FailureRecordSchema, type FailureRecord } from "../../domain/trust/failure.js";
import {
  LIVE_WORKER_STATES,
  WorkerLeaseRecordSchema,
  isLiveWorker,
  type WorkerLeaseRecord,
} from "../../domain/run/worker.js";
import {
  RunClaimOutcomeSchema,
  RunClaimRequestSchema,
  RunClaimSweepOutcomeSchema,
  RunClaimSweepRequestSchema,
  RunClaimTokenSchema,
  RunHeartbeatOutcomeSchema,
  RunHeartbeatRequestSchema,
  RunItemQuerySchema,
  RunPresentationRequestSchema,
  RunPriorityBumpRequestSchema,
  RunRequeueRequestSchema,
  RunResumeRequestSchema,
  RunTransitionRequestSchema,
  RunUpdateOutcomeSchema,
  StartPlanConsumeOutcomeSchema,
  StartPlanConsumeRequestSchema,
  WorkerControlRequestSchema,
  WorkerLifecycleRequestSchema,
  WorkerStartOutcomeSchema,
  WorkerStartRequestSchema,
  WorkerSweepRequestSchema,
  WorkerUpdateOutcomeSchema,
  type RunClaimOutcome,
  type RunHeartbeatOutcome,
  type RunUpdateOutcome,
  type StartPlanConsumeOutcome,
  type WorkerStartOutcome,
  type WorkerUpdateOutcome,
} from "./run-store-contracts.js";
import {
  FailureTerminalizationReportSchema,
  FailureTerminalizationRequestSchema,
  SuccessTerminalizationReportSchema,
  SuccessTerminalizationRequestSchema,
  type FailureTerminalizationReport,
  type FailureTerminalizationStorageStep,
  type SuccessTerminalizationReport,
  type SuccessTerminalizationStorageStep,
} from "./run-terminal-contracts.js";
import {
  RunCheckpointRecordSchema,
  checkpointLookupKey,
  checkpointRecordKey,
  type RunCheckpointRecord,
} from "../../domain/workflow/checkpoint.js";
import { AtomicOutboxRecordSchema } from "../../domain/outbox.js";
import { NotificationRecordSchema } from "../../domain/notifications.js";
import {
  ProviderAdmissionDenyRequestSchema,
  ProviderAdmissionInterruptRequestSchema,
  ProviderAdmissionMutationOutcomeSchema,
  ProviderAdmissionRecordSchema,
  ProviderAdmissionReserveOutcomeSchema,
  ProviderAdmissionReserveRequestSchema,
  ProviderAdmissionSettleRequestSchema,
  ProviderAdmissionSweepOutcomeSchema,
  ProviderAdmissionSweepRequestSchema,
  ProviderBudgetCounterSchema,
  ProviderUnavailableReasonSchema,
  type ProviderAdmissionRecord,
  type ProviderBudgetCounter,
} from "../../domain/provider-admission.js";
import {
  IdempotencyKeySchema,
  WriteAttemptRecordSchema,
  WriteIntentRecordSchema,
  type WriteAttemptRecord,
  type WriteIntentRecord,
} from "../../domain/write-safety.js";
import {
  AUTHORITY_APPLICATION_ID,
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
  auditMigrationTableCoverage,
  tableClassification,
} from "./migrations.js";
import {
  AuthorityCopyInspectionSchema,
  type AuthorityCopyInspection,
} from "./recovery-contracts.js";
import {
  ArtifactOutboxStorageRecordSchema,
  AUTHORITY_RECORD_SCHEMA_REGISTRY,
  OpaqueAuthorityRecordSchema,
  ProjectionStorageRecordSchema,
  VersionPlanStorageRecordSchema,
  type ArtifactOutboxStorageRecord,
  type OpaqueAuthorityRecord,
  type ProjectionStorageRecord,
  type VersionPlanStorageRecord,
} from "./storage-records.js";
import {
  AtomicWriteCommitInputSchema,
  AtomicWriteCommitReportSchema,
  PermanentWriteResolutionSchema,
  WriteFenceInputSchema,
  WriteIntentParkRequestSchema,
  WriteIntentReopenRequestSchema,
  WriteIntentRetrySettlementRequestSchema,
  WriteRefenceInputSchema,
  type AtomicWriteCommitReport,
  type AtomicWriteCommitStorageStep,
  type PermanentWriteResolution,
} from "./write-commit-contracts.js";

export const AuthorityDatabaseOptionsSchema = z.strictObject({
  path: z.string().min(1),
  busyTimeoutMs: z.number().int().positive(),
  migrationOwner: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export const AuthorityMetaSchema = z.strictObject({
  schemaVersion: z.number().int().positive(),
  authorityGeneration: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const AuthoritySchemaInspectionSchema = z.strictObject({
  applicationId: z.literal(AUTHORITY_APPLICATION_ID),
  schemaVersion: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
  authorityGeneration: z.number().int().nonnegative(),
  pragmas: z.strictObject({
    journalMode: z.literal("wal"),
    foreignKeys: z.literal(1),
    synchronous: z.literal(2),
    busyTimeoutMs: z.number().int().positive(),
  }),
  tables: z.array(z.strictObject({
    name: z.union([AuthorityTableNameSchema, ProjectionTableNameSchema]),
    classification: z.enum(["authority", "projection"]),
  })),
});

export const ImmutableInsertDispositionSchema = z.enum(["inserted", "existing"]);

type ImmutableInsertResult<RecordValue> = Readonly<{
  state: z.infer<typeof ImmutableInsertDispositionSchema>;
  record: RecordValue;
}>;

type ImmutableRepository<RecordValue> = Readonly<{
  insert(input: unknown): ImmutableInsertResult<RecordValue>;
  get(recordKey: string): RecordValue | undefined;
}>;

type ReadRepository<RecordValue> = Readonly<{
  get(recordKey: string): RecordValue | undefined;
}>;

type CommandRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof CommandRequestSchema>>;
  get(commandId: string): z.infer<typeof CommandRequestSchema> | undefined;
}>;

/**
 * D113 replay reads the recorded outcome by COMMAND id: one journaled command
 * has exactly one recorded audit, and re-delivery must return that exact
 * result rather than re-executing. Two audits for one command is corruption.
 */
type CommandAuditRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof CommandAuditRecordSchema>>;
  get(auditId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
  findByCommand(commandId: string): z.infer<typeof CommandAuditRecordSchema> | undefined;
}>;

/**
 * Cancel-tree resolution (doc 03 §2.4) reads every delegation edge under a
 * parent from authority. A child run whose edge row cannot be found makes the
 * tree inconsistent, and an inconsistent tree cancels nothing.
 */
type DependencyRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<z.infer<typeof DependencyRecordSchema>>;
  get(dependencyId: string): z.infer<typeof DependencyRecordSchema> | undefined;
  listByParentRun(parentRunId: string): readonly z.infer<typeof DependencyRecordSchema>[];
}>;

type WriteIntentRepository = Readonly<{
  recordObservedPresent(input: unknown): PermanentWriteResolution;
  fenceAttempt(input: unknown): PermanentWriteResolution;
  /** D111: CAS a `retryable` permanent row to `attempting` generation+1 with a FRESH binding proof. */
  refenceRetryable(input: unknown): PermanentWriteResolution;
  /** Doc 09 §4 arm 3: CAS `attempting` → `parked` on intent AND current attempt. */
  parkAttempt(input: unknown): z.infer<typeof WriteIntentRecordSchema>;
  /** Doc 09 §4 arm 2 / §4.1.2: CAS `attempting`|`parked` → `retryable` with a typed settlement. */
  settleRetryable(input: unknown): z.infer<typeof WriteIntentRecordSchema>;
  /** Doc 09 §4.1.1: CAS `parked` → `attempting` so beat ⑦ can accept confirmed-present. */
  reopenParkedAttempt(input: unknown): z.infer<typeof WriteIntentRecordSchema>;
  get(writeIntentId: string): z.infer<typeof WriteIntentRecordSchema> | undefined;
  findByPermanentKey(system: unknown, idempotencyKey: unknown): z.infer<typeof WriteIntentRecordSchema> | undefined;
}>;

export interface AuthorityWriteCommitHooks {
  afterStorageStep(step: AtomicWriteCommitStorageStep): void;
}

export interface AuthorityTerminalizationHooks {
  afterFailureStorageStep?(step: FailureTerminalizationStorageStep): void;
  afterSuccessStorageStep?(step: SuccessTerminalizationStorageStep): void;
}

/**
 * Doc 02 §5.7. `latest` answers "latest compatible attempt wins" — it returns
 * the highest-numbered attempt for a logical item's node, and returns
 * `undefined` rather than an empty record when nothing was written, so the
 * caller's discriminated `loadCheckpoint` branch is the only way forward.
 */
type RunCheckpointRepository = Readonly<{
  insert(input: unknown): ImmutableInsertResult<RunCheckpointRecord>;
  get(workflowId: string, itemId: string, nodeId: string, attempt: number): RunCheckpointRecord | undefined;
  latest(workflowId: string, itemId: string, nodeId: string): RunCheckpointRecord | undefined;
}>;

/**
 * Doc 05 §3's claim authority. `claimNext` and `renewClaim` are the only ways a
 * worker gains or keeps a row, and both are CAS: the row moves out of `queued`
 * in the same transaction that reads it, and a heartbeat that no longer matches
 * `(workerId, claimGeneration)` reports `lost` instead of quietly succeeding.
 */
type RunRepository = Readonly<{
  enqueue(input: unknown): ImmutableInsertResult<RunRecord>;
  get(runId: string): RunRecord | undefined;
  listByItem(input: unknown): readonly RunRecord[];
  listByWorker(workerId: string): readonly RunRecord[];
  listChildren(parentRunId: string): readonly RunRecord[];
  claimNext(input: unknown): RunClaimOutcome;
  renewClaim(input: unknown): RunHeartbeatOutcome;
  transition(input: unknown): RunUpdateOutcome;
  requeue(input: unknown): RunUpdateOutcome;
  resume(input: unknown): RunUpdateOutcome;
  updatePresentation(input: unknown): RunUpdateOutcome;
  /** D95 run-priority `bump`: elevate one QUEUED row's claim class; never a requeue. */
  bumpPriority(input: unknown): RunUpdateOutcome;
  /** D118: an `attempting` write intent routes to recovery, never to requeue. */
  sweepExpiredClaims(input: unknown): readonly z.infer<typeof RunClaimSweepOutcomeSchema>[];
}>;

type FailureRepository = Readonly<{
  get(failureId: string): FailureRecord | undefined;
  listByRun(runId: string): readonly FailureRecord[];
}>;

type RunResultRepository = Readonly<{
  get(runId: string): RunResultRecord | undefined;
}>;

type RunTerminalOutboxRepository = Readonly<{
  get(outboxId: string): RunTerminalOutboxRecord | undefined;
  findByRun(runId: string): RunTerminalOutboxRecord | undefined;
}>;

type TerminalAuthorizationRepository = Readonly<{
  get(runId: string): TerminalAuthorizationRecord | undefined;
}>;

type StartPlanRepository = Readonly<{
  create(input: unknown): ImmutableInsertResult<StartPlanRecord>;
  get(startPlanId: string): StartPlanRecord | undefined;
  consume(input: unknown): StartPlanConsumeOutcome;
}>;

type WorkerLeaseRepository = Readonly<{
  start(input: unknown): WorkerStartOutcome;
  get(workerId: string): WorkerLeaseRecord | undefined;
  listLive(workflow?: string): readonly WorkerLeaseRecord[];
  reportLifecycle(input: unknown): WorkerUpdateOutcome;
  control(input: unknown): WorkerUpdateOutcome;
  sweepExpired(input: unknown): readonly WorkerLeaseRecord[];
}>;

type OpaqueAuthorityRepositories = Readonly<{
  ocrApprovals: ImmutableRepository<OpaqueAuthorityRecord>;
  captureSessions: ImmutableRepository<OpaqueAuthorityRecord>;
  capturePhotoOrder: ImmutableRepository<OpaqueAuthorityRecord>;
  captureFinalizationOutboxes: ImmutableRepository<OpaqueAuthorityRecord>;
  artifactSinkHeads: ImmutableRepository<OpaqueAuthorityRecord>;
}>;

export type AuthorityRepositories = Readonly<{
  runs: RunRepository;
  terminalAuthorizations: TerminalAuthorizationRepository;
  failures: FailureRepository;
  runResults: RunResultRepository;
  runTerminalOutbox: RunTerminalOutboxRepository;
  providerAdmissions: ProviderAdmissionRepository;
  startPlans: StartPlanRepository;
  workerLeases: WorkerLeaseRepository;
  commands: CommandRepository;
  commandAudits: CommandAuditRepository;
  dependencies: DependencyRepository;
  delegationManifests: ImmutableRepository<z.infer<typeof DelegationManifestSchema>>;
  gateResults: ImmutableRepository<z.infer<typeof GateResultRecordSchema>>;
  runCheckpoints: RunCheckpointRepository;
  notifications: ImmutableRepository<z.infer<typeof NotificationRecordSchema>>;
  configSnapshots: ImmutableRepository<z.infer<typeof ConfigSnapshotRecordSchema>>;
  versionPlans: ImmutableRepository<VersionPlanStorageRecord>;
  writeIntents: WriteIntentRepository;
  writeAttempts: ReadRepository<z.infer<typeof WriteAttemptRecordSchema>>;
  durableOutbox: ReadRepository<z.infer<typeof AtomicOutboxRecordSchema>>;
  artifactOutbox: ImmutableRepository<ArtifactOutboxStorageRecord>;
  opaque: OpaqueAuthorityRepositories;
}>;

type ProjectionRepository = Readonly<{
  upsert(input: unknown): ProjectionStorageRecord;
  get(projectionKey: string): ProjectionStorageRecord | undefined;
  clear(): number;
}>;

export type ProjectionRepositories = Readonly<{
  spans: ProjectionRepository;
  gates: ProjectionRepository;
  notes: ProjectionRepository;
  runsView: ProjectionRepository;
}>;

const OpaqueAuthorityTableSchema = z.enum([
  "ocr_approvals",
  "capture_sessions",
  "capture_photo_order",
  "capture_finalization_outboxes",
  "artifact_sink_heads",
]);

const JsonRowSchema = z.strictObject({ record_json: z.string() });
const NextEligibleRowSchema = z.strictObject({ next_eligible_at: z.string().nullable() });
const HeldRunRowSchema = z.strictObject({ run_id: z.string().nullable() });
const IntPragmaRowSchema = z.record(z.string(), z.number().int());
const TextPragmaRowSchema = z.record(z.string(), z.string());
const MetaRowSchema = z.strictObject({
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
  updated_at: z.string(),
  migration_owner: z.string().nullable(),
  migration_started_at: z.string().nullable(),
});
const TableNameRowSchema = z.strictObject({ name: z.string() });
const CountRowSchema = z.strictObject({ count: z.number().int().nonnegative() });
const PageCountRowSchema = z.strictObject({ page_count: z.number().int().positive() });
const QuickCheckRowSchema = z.strictObject({ quick_check: z.literal("ok") });
const AuthorityRecordFingerprintRowSchema = z.strictObject({ record_key: z.string(), record_json: z.string() });
const AuthorityMetaFingerprintRowSchema = z.strictObject({
  singleton_id: z.literal(1),
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
  updated_at: z.string(),
  migration_owner: z.string().nullable(),
  migration_started_at: z.string().nullable(),
});

function parseJsonRecord<Schema extends z.ZodType>(schema: Schema, text: string): z.output<Schema> {
  return schema.parse(JSON.parse(text));
}

function sqliteChanges(value: number | bigint): number {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  return z.number().int().nonnegative().parse(parsed);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fixedUtcMinuteStart(instant: string): string {
  const milliseconds = Date.parse(instant);
  return new Date(Math.floor(milliseconds / 60_000) * 60_000).toISOString();
}

function fixedUtcDayStart(instant: string): string {
  const at = new Date(Date.parse(instant));
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())).toISOString();
}

function nextFixedWindow(start: string, milliseconds: number): string {
  return new Date(Date.parse(start) + milliseconds).toISOString();
}

function readIntPragma(
  database: DatabaseSync,
  name: "application_id" | "user_version" | "foreign_keys" | "synchronous" | "busy_timeout",
): number {
  const row = IntPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name === "busy_timeout" ? "timeout" : name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

function readTextPragma(database: DatabaseSync, name: "journal_mode"): string {
  const row = TextPragmaRowSchema.parse(database.prepare(`PRAGMA ${name}`).get());
  const value = row[name];
  if (value === undefined) throw new Error(`PRAGMA ${name} returned no value`);
  return value;
}

function tableNames(database: DatabaseSync): TableName[] {
  const rows = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  return z.array(z.union([AuthorityTableNameSchema, ProjectionTableNameSchema])).parse(
    rows.map((row) => TableNameRowSchema.parse(row).name),
  );
}

function readMetaRow(database: DatabaseSync): z.infer<typeof MetaRowSchema> {
  return MetaRowSchema.parse(database.prepare(`
    SELECT schema_version, authority_generation, updated_at, migration_owner, migration_started_at
    FROM authority_meta WHERE singleton_id = 1
  `).get());
}

const INVARIANT_QUERIES = Object.freeze([
  {
    name: "run-columns-match-record",
    sql: "SELECT count(*) AS count FROM tasks WHERE workflow <> json_extract(record_json, '$.envelope.workflow') OR item_id <> json_extract(record_json, '$.envelope.itemId') OR state <> json_extract(record_json, '$.lifecycle.state') OR priority <> json_extract(record_json, '$.envelope.priority') OR attempt <> json_extract(record_json, '$.envelope.attempt') OR version <> json_extract(record_json, '$.version') OR claim_generation <> json_extract(record_json, '$.claimGeneration')",
  },
  {
    name: "run-claim-owner-matches-record",
    sql: "SELECT count(*) AS count FROM tasks WHERE state IN ('claimed','validating','running') AND (owner_worker_id <> json_extract(record_json, '$.lifecycle.workerId') OR heartbeat_at <> json_extract(record_json, '$.lifecycle.heartbeatAt'))",
  },
  {
    name: "failure-columns-match-record",
    sql: "SELECT count(*) AS count FROM failures WHERE run_id <> json_extract(record_json, '$.runId')",
  },
  {
    name: "terminal-authorization-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_terminal_authorizations WHERE record_key IS NOT json_extract(record_json, '$.runId') OR kind IS NOT json_extract(record_json, '$.kind') OR expected_version IS NOT json_extract(record_json, '$.expectedVersion') OR worker_id IS NOT json_extract(record_json, '$.claim.workerId') OR claim_generation IS NOT json_extract(record_json, '$.claim.claimGeneration') OR created_at IS NOT json_extract(record_json, '$.authorizedAt')",
  },
  {
    name: "failed-runs-bind-failure",
    sql: `
      SELECT count(*) AS count FROM tasks AS run
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') = 'failed'
        AND NOT EXISTS (
          SELECT 1 FROM failures AS failure
          WHERE failure.record_key = json_extract(run.record_json, '$.lifecycle.failureId')
            AND failure.run_id = run.record_key
        )
    `,
  },
  {
    name: "failures-bind-failed-run",
    sql: `
      SELECT count(*) AS count FROM failures AS failure
      JOIN tasks AS run ON run.record_key = failure.run_id
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') IS NOT 'failed'
        OR json_extract(run.record_json, '$.lifecycle.failureId') IS NOT failure.record_key
    `,
  },
  {
    name: "failure-identity-matches-run",
    sql: `
      SELECT count(*) AS count FROM failures AS failure
      JOIN tasks AS run ON run.record_key = failure.run_id
      WHERE json_extract(failure.record_json, '$.workflowId') <> json_extract(run.record_json, '$.envelope.workflow')
        OR json_extract(failure.record_json, '$.traceId') <> json_extract(run.record_json, '$.envelope.traceId')
        OR json_extract(failure.record_json, '$.attempt') <> json_extract(run.record_json, '$.envelope.attempt')
    `,
  },
  {
    name: "failed-runs-bind-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM tasks AS run
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') = 'failed'
        AND NOT EXISTS (
          SELECT 1 FROM run_terminal_authorizations AS authorization
          WHERE authorization.record_key = run.record_key
            AND authorization.kind = 'failed'
            AND json_extract(authorization.record_json, '$.failureId')
              = json_extract(run.record_json, '$.lifecycle.failureId')
        )
    `,
  },
  {
    name: "failures-bind-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM failures AS failure
      LEFT JOIN run_terminal_authorizations AS authorization
        ON authorization.record_key = failure.run_id
      WHERE authorization.record_key IS NULL
        OR authorization.kind IS NOT 'failed'
        OR json_extract(authorization.record_json, '$.failureId') IS NOT failure.record_key
    `,
  },
  {
    name: "run-result-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_results WHERE workflow <> json_extract(record_json, '$.workflowId') OR attempt <> json_extract(record_json, '$.attempt') OR result_digest <> json_extract(record_json, '$.resultDigest') OR record_key <> json_extract(record_json, '$.runId')",
  },
  {
    name: "run-terminal-outbox-columns-match-record",
    sql: "SELECT count(*) AS count FROM run_terminal_outbox WHERE run_id <> json_extract(record_json, '$.payload.runId') OR state <> json_extract(record_json, '$.projection.state')",
  },
  {
    name: "run-result-identity-matches-run",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      JOIN tasks AS run ON run.record_key = result.record_key
      WHERE json_extract(result.record_json, '$.workflowId') <> json_extract(run.record_json, '$.envelope.workflow')
        OR json_extract(result.record_json, '$.attempt') <> json_extract(run.record_json, '$.envelope.attempt')
        OR json_extract(result.record_json, '$.descriptorVersion') <> json_extract(run.record_json, '$.envelope.descriptorVersion')
        OR json_extract(result.record_json, '$.contractFingerprint') <> json_extract(run.record_json, '$.envelope.contractFingerprint')
        OR json_extract(result.record_json, '$.configFingerprint') <> json_extract(run.record_json, '$.envelope.configFingerprint')
        OR json_extract(result.record_json, '$.configSnapshotId') <> json_extract(run.record_json, '$.envelope.configSnapshotId')
    `,
  },
  {
    name: "run-terminal-outbox-binds-result",
    sql: `
      SELECT count(*) AS count FROM run_terminal_outbox AS outbox
      LEFT JOIN run_results AS result ON result.record_key = outbox.run_id
      WHERE result.record_key IS NULL
        OR json_extract(outbox.record_json, '$.payload.workflowId') IS NOT json_extract(result.record_json, '$.workflowId')
        OR json_extract(outbox.record_json, '$.payload.attempt') IS NOT json_extract(result.record_json, '$.attempt')
        OR json_extract(outbox.record_json, '$.payload.resultDigest') IS NOT result.result_digest
    `,
  },
  {
    name: "done-runs-bind-result-and-outbox",
    sql: `
      SELECT count(*) AS count FROM tasks AS run
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') = 'done'
        AND NOT EXISTS (
          SELECT 1 FROM run_results AS result
          JOIN run_terminal_outbox AS outbox ON outbox.run_id = result.record_key
          WHERE result.record_key = run.record_key
            AND json_extract(outbox.record_json, '$.payload.resultDigest') = result.result_digest
        )
    `,
  },
  {
    name: "results-bind-done-run",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      JOIN tasks AS run ON run.record_key = result.record_key
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') IS NOT 'done'
    `,
  },
  {
    name: "done-runs-bind-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM tasks AS run
      WHERE json_extract(run.record_json, '$.lifecycle.outcome') = 'done'
        AND NOT EXISTS (
          SELECT 1 FROM run_terminal_authorizations AS authorization
          WHERE authorization.record_key = run.record_key
            AND authorization.kind = 'done'
        )
    `,
  },
  {
    name: "results-bind-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM run_results AS result
      LEFT JOIN run_terminal_authorizations AS authorization
        ON authorization.record_key = result.record_key
      WHERE authorization.record_key IS NULL
        OR authorization.kind IS NOT 'done'
        OR json_extract(authorization.record_json, '$.resultDigest') IS NOT result.result_digest
    `,
  },
  {
    name: "terminal-outbox-binds-terminal-authorization",
    sql: `
      SELECT count(*) AS count FROM run_terminal_outbox AS outbox
      LEFT JOIN run_terminal_authorizations AS authorization
        ON authorization.record_key = outbox.run_id
      WHERE authorization.record_key IS NULL
        OR authorization.kind IS NOT 'done'
        OR json_extract(authorization.record_json, '$.outboxId') IS NOT outbox.record_key
    `,
  },
  {
    name: "terminal-authorization-binds-exact-terminal-authority",
    sql: `
      SELECT count(*) AS count FROM run_terminal_authorizations AS authorization
      LEFT JOIN tasks AS run ON run.record_key = authorization.record_key
      LEFT JOIN failures AS failure
        ON failure.run_id = authorization.record_key
          AND failure.record_key = json_extract(authorization.record_json, '$.failureId')
      LEFT JOIN run_results AS result ON result.record_key = authorization.record_key
      LEFT JOIN run_terminal_outbox AS outbox
        ON outbox.run_id = authorization.record_key
          AND outbox.record_key = json_extract(authorization.record_json, '$.outboxId')
      WHERE run.record_key IS NULL
        OR authorization.created_at IS NOT json_extract(authorization.record_json, '$.authorizedAt')
        OR json_extract(authorization.record_json, '$.workflowId')
          IS NOT json_extract(run.record_json, '$.envelope.workflow')
        OR json_extract(authorization.record_json, '$.attempt')
          IS NOT json_extract(run.record_json, '$.envelope.attempt')
        OR json_extract(authorization.record_json, '$.descriptorVersion')
          IS NOT json_extract(run.record_json, '$.envelope.descriptorVersion')
        OR json_extract(authorization.record_json, '$.contractFingerprint')
          IS NOT json_extract(run.record_json, '$.envelope.contractFingerprint')
        OR run.version IS NOT authorization.expected_version + 1
        OR run.claim_generation IS NOT authorization.claim_generation
        OR json_extract(run.record_json, '$.lifecycle.state') IS NOT 'terminal'
        OR json_extract(run.record_json, '$.lifecycle.endedAt')
          IS NOT json_extract(authorization.record_json, '$.authorizedAt')
        OR json_extract(run.record_json, '$.updatedAt')
          IS NOT json_extract(authorization.record_json, '$.authorizedAt')
        OR (authorization.kind = 'failed' AND (
          json_extract(run.record_json, '$.lifecycle.outcome') IS NOT 'failed'
          OR json_extract(run.record_json, '$.lifecycle.failureId')
            IS NOT json_extract(authorization.record_json, '$.failureId')
          OR failure.record_key IS NULL
          OR json_extract(run.record_json, '$.lifecycle.errorSummary')
            IS NOT json_extract(failure.record_json, '$.summary')
        ))
        OR (authorization.kind = 'done' AND (
          json_extract(run.record_json, '$.lifecycle.outcome') IS NOT 'done'
          OR result.record_key IS NULL
          OR json_extract(authorization.record_json, '$.resultDigest') IS NOT result.result_digest
          OR outbox.record_key IS NULL
        ))
    `,
  },
  {
    name: "provider-counter-columns-match-record",
    sql: "SELECT count(*) AS count FROM provider_budget_counters WHERE record_key IS NOT capability OR capability IS NOT json_extract(record_json, '$.capability') OR minute_window_started_at IS NOT json_extract(record_json, '$.minuteWindowStartedAt') OR minute_requests IS NOT json_extract(record_json, '$.minuteRequests') OR day_window_started_at IS NOT json_extract(record_json, '$.dayWindowStartedAt') OR day_requests IS NOT json_extract(record_json, '$.dayRequests') OR day_reserved_cost_usd_micros IS NOT json_extract(record_json, '$.dayReservedCostUsdMicros') OR active_reservations IS NOT json_extract(record_json, '$.activeReservations') OR blocked_by_admission_id IS NOT json_extract(record_json, '$.blockedByAdmissionId') OR version IS NOT json_extract(record_json, '$.version')",
  },
  {
    name: "provider-admission-columns-match-record",
    sql: "SELECT count(*) AS count FROM provider_admissions WHERE record_key IS NOT json_extract(record_json, '$.admissionId') OR run_id IS NOT json_extract(record_json, '$.execution.runId') OR capability IS NOT json_extract(record_json, '$.capability') OR config_snapshot_id IS NOT json_extract(record_json, '$.configSnapshotId') OR config_fingerprint IS NOT json_extract(record_json, '$.configFingerprint') OR request_fingerprint IS NOT json_extract(record_json, '$.requestFingerprint') OR state IS NOT json_extract(record_json, '$.lifecycle.state') OR reserved_cost_usd_micros IS NOT json_extract(record_json, '$.reservation.maximumCostUsdMicros') OR actual_cost_usd_micros IS NOT json_extract(record_json, '$.lifecycle.actualUsage.costUsdMicros') OR lease_expires_at IS NOT json_extract(record_json, '$.lifecycle.leaseExpiresAt') OR deadline_at IS NOT json_extract(record_json, '$.lifecycle.deadlineAt') OR version IS NOT json_extract(record_json, '$.version')",
  },
  {
    name: "provider-active-reservations-match",
    sql: "SELECT count(*) AS count FROM provider_budget_counters AS counter WHERE counter.active_reservations <> (SELECT count(*) FROM provider_admissions AS admission WHERE admission.capability = counter.capability AND admission.state = 'reserved')",
  },
  {
    name: "worker-lease-columns-match-record",
    sql: "SELECT count(*) AS count FROM leases WHERE worker_id <> record_key OR worker_id <> json_extract(record_json, '$.workerId') OR workflow <> json_extract(record_json, '$.workflow') OR lease_generation <> json_extract(record_json, '$.leaseGeneration') OR state <> json_extract(record_json, '$.lifecycle.state') OR directive <> json_extract(record_json, '$.control.directive') OR version <> json_extract(record_json, '$.version')",
  },
  {
    // One worker owns at most one active run (doc 05 §0.3). This is the
    // invariant the whole claim protocol exists to hold, so it is checked in
    // the database rather than trusted from the loop that maintains it.
    name: "worker-owns-at-most-one-active-run",
    sql: `
      SELECT count(*) AS count FROM (
        SELECT owner_worker_id FROM tasks
        WHERE state IN ('claimed','validating','running')
        GROUP BY owner_worker_id HAVING count(*) > 1
      )
    `,
  },
  {
    name: "commands-family-column-matches-record",
    sql: "SELECT count(*) AS count FROM commands WHERE family <> json_extract(record_json, '$.family')",
  },
  {
    name: "command-audit-parent-column-matches-record",
    sql: "SELECT count(*) AS count FROM command_audits WHERE command_id <> json_extract(record_json, '$.request.commandId')",
  },
  {
    name: "dependency-manifest-column-matches-record",
    sql: "SELECT count(*) AS count FROM dependencies WHERE manifest_id <> json_extract(record_json, '$.manifestId')",
  },
  {
    name: "write-intent-columns-match-record",
    sql: "SELECT count(*) AS count FROM write_intents WHERE system <> json_extract(record_json, '$.system') OR idempotency_key <> json_extract(record_json, '$.idempotencyKey') OR idempotency_key_digest <> json_extract(record_json, '$.idempotencyKeyDigest') OR status <> json_extract(record_json, '$.status')",
  },
  {
    name: "write-attempt-columns-match-record",
    sql: "SELECT count(*) AS count FROM write_attempts WHERE write_intent_id <> json_extract(record_json, '$.writeIntentId') OR generation <> json_extract(record_json, '$.generation')",
  },
  {
    name: "durable-outbox-columns-match-record",
    sql: "SELECT count(*) AS count FROM durable_outbox WHERE write_intent_id <> json_extract(record_json, '$.aggregate.writeIntentId') OR generation <> json_extract(record_json, '$.aggregate.generation') OR kind <> json_extract(record_json, '$.payload.kind')",
  },
  {
    name: "attempting-write-has-current-attempt",
    sql: `
      SELECT count(*) AS count FROM write_intents AS intent
      WHERE intent.status = 'attempting' AND NOT EXISTS (
        SELECT 1 FROM write_attempts AS attempt
        WHERE attempt.record_key = json_extract(intent.record_json, '$.currentAttemptId')
          AND attempt.write_intent_id = intent.record_key
          AND attempt.generation = json_extract(intent.record_json, '$.generation')
      )
    `,
  },
] as const);

function invariantViolations(database: DatabaseSync): readonly string[] {
  return INVARIANT_QUERIES.flatMap(({ name, sql }) => {
    const { count } = CountRowSchema.parse(database.prepare(sql).get());
    return count === 0 ? [] : [`${name} failed for ${String(count)} row(s)`];
  });
}

function validateAuthorityRecordSchemas(database: DatabaseSync): number {
  let validated = 0;
  for (const [table, schema] of Object.entries(AUTHORITY_RECORD_SCHEMA_REGISTRY)) {
    const rows = z.array(AuthorityRecordFingerprintRowSchema).parse(database.prepare(`
      SELECT record_key, record_json FROM ${table} ORDER BY record_key
    `).all());
    for (const row of rows) {
      try {
        parseJsonRecord(schema, row.record_json);
      } catch (error) {
        throw new Error(
          `authority table ${table} record ${row.record_key} failed strict record schema validation: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      validated += 1;
    }
  }
  return validated;
}

function authorityContentFingerprint(database: DatabaseSync): string {
  const authorityRows = AuthorityTableNameSchema.options.map((name) => {
    if (name === "authority_meta") {
      const row = AuthorityMetaFingerprintRowSchema.parse(database.prepare(`
        SELECT singleton_id, schema_version, authority_generation, updated_at,
               migration_owner, migration_started_at
        FROM authority_meta WHERE singleton_id = 1
      `).get());
      return [name, row] as const;
    }
    const rows = z.array(AuthorityRecordFingerprintRowSchema).parse(database.prepare(`
      SELECT record_key, record_json FROM ${name} ORDER BY record_key
    `).all());
    return [name, rows] as const;
  });
  return createHash("sha256").update(canonicalJsonStringify(authorityRows)).digest("hex");
}

function pendingCounts(database: DatabaseSync) {
  const count = (sql: string): number => CountRowSchema.parse(database.prepare(sql).get()).count;
  return {
    pendingCommands: count("SELECT count(*) AS count FROM commands AS command WHERE NOT EXISTS (SELECT 1 FROM command_audits AS audit WHERE audit.command_id = command.record_key)"),
    unresolvedWriteIntents: count("SELECT count(*) AS count FROM write_intents WHERE status NOT IN ('committed', 'observed-present')"),
    leases: count("SELECT count(*) AS count FROM leases"),
    durableOutbox: count("SELECT count(*) AS count FROM durable_outbox WHERE json_extract(record_json, '$.projection.state') = 'pending'"),
    runTerminalOutbox: count("SELECT count(*) AS count FROM run_terminal_outbox WHERE state = 'pending'"),
    providerReservations: count("SELECT count(*) AS count FROM provider_admissions WHERE state = 'reserved'"),
    artifactOutbox: count("SELECT count(*) AS count FROM artifact_outbox WHERE json_extract(record_json, '$.state') = 'pending'"),
    captureFinalizationOutboxes: count("SELECT count(*) AS count FROM capture_finalization_outboxes"),
  };
}

function inspectOpenDatabase(database: DatabaseSync, requireOperationalPragmas: boolean): AuthorityCopyInspection {
  const applicationId = readIntPragma(database, "application_id");
  if (applicationId !== AUTHORITY_APPLICATION_ID) {
    throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
  }
  const schemaVersion = readIntPragma(database, "user_version");
  if (schemaVersion > CURRENT_AUTHORITY_SCHEMA_VERSION) {
    throw new Error(`authority schema ${String(schemaVersion)} is newer than supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  }
  if (schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
    throw new Error(`authority schema ${String(schemaVersion)} does not match supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  }
  QuickCheckRowSchema.parse(database.prepare("PRAGMA quick_check(1)").get());
  const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) throw new Error(`authority database foreign-key validation failed for ${String(foreignKeyFailures.length)} row(s)`);
  const names = tableNames(database);
  const expected = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort();
  if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
    throw new Error(`authority database tables do not match registry: actual=${names.join(",")} expected=${expected.join(",")}`);
  }
  const meta = readMetaRow(database);
  if (meta.schema_version !== schemaVersion) {
    throw new Error(`authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(schemaVersion)}`);
  }
  if (meta.migration_owner !== null || meta.migration_started_at !== null) {
    throw new Error(`authority database is locked by migration owner ${String(meta.migration_owner)}`);
  }
  validateAuthorityRecordSchemas(database);
  const violations = invariantViolations(database);
  if (violations.length > 0) throw new Error(`authority database invariant validation failed: ${violations.join("; ")}`);
  if (readIntPragma(database, "foreign_keys") !== 1) throw new Error("authority database foreign keys are disabled");
  if (requireOperationalPragmas) {
    if (readTextPragma(database, "journal_mode") !== "wal") throw new Error("authority database is not using WAL mode");
    if (readIntPragma(database, "synchronous") !== 2) throw new Error("authority database synchronous mode is not FULL");
  }
  return AuthorityCopyInspectionSchema.parse({
    applicationId,
    schemaVersion,
    pageCount: PageCountRowSchema.parse(database.prepare("PRAGMA page_count").get()).page_count,
    authorityGeneration: meta.authority_generation,
    authorityContentFingerprint: authorityContentFingerprint(database),
    quickCheck: "ok",
    foreignKeyViolations: 0,
    invariants: { state: "valid", violations: [] },
    tables: names.map((name) => ({ name, classification: tableClassification(name) })),
    counts: pendingCounts(database),
  });
}

function inspectExistingDatabaseReadOnly(path: string, busyTimeoutMs: number): AuthorityCopyInspection {
  const parsedPath = z.string().min(1).parse(path);
  if (!existsSync(parsedPath) || statSync(parsedPath).size === 0) {
    throw new Error(`authority database ${parsedPath} is missing or empty`);
  }
  const database = new DatabaseSync(parsedPath, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: z.number().int().positive().parse(busyTimeoutMs),
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA query_only = ON");
    return inspectOpenDatabase(database, false);
  } finally {
    database.close();
  }
}

export class AuthorityDatabase implements Disposable {
  #database: DatabaseSync;
  #clock: Clock;
  #path: string;
  #busyTimeoutMs: number;
  #closed = false;
  #transactionDepth = 0;
  #savepointSequence = 0;
  #transactionMode: "authority" | "projection" | undefined;
  #authorityDirty = false;
  #writeCommitHooks: AuthorityWriteCommitHooks | undefined;
  #terminalizationHooks: AuthorityTerminalizationHooks | undefined;

  readonly authority: AuthorityRepositories;
  readonly projections: ProjectionRepositories;

  private constructor(
    input: unknown,
    clock: Clock,
    writeCommitHooks?: AuthorityWriteCommitHooks,
    terminalizationHooks?: AuthorityTerminalizationHooks,
  ) {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    const existed = options.path !== ":memory:" && existsSync(options.path);
    if (existed && statSync(options.path).size === 0) {
      throw new Error(`authority database ${options.path} exists but is empty; refusing to replace it`);
    }
    this.#clock = clock;
    this.#writeCommitHooks = writeCommitHooks;
    this.#terminalizationHooks = terminalizationHooks;
    this.#path = options.path;
    this.#busyTimeoutMs = options.busyTimeoutMs;
    this.#database = new DatabaseSync(options.path, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      timeout: options.busyTimeoutMs,
      readBigInts: false,
      returnArrays: false,
      allowBareNamedParameters: false,
      allowUnknownNamedParameters: false,
      defensive: true,
    });

    try {
      this.#configureConnection();
      this.#initializeSchema(existed, options.migrationOwner);
      this.#validateDatabase();
    } catch (error) {
      this.#database.close();
      throw new Error(`failed to open authority database ${options.path}: ${errorMessage(error)}`, { cause: error });
    }

    this.authority = this.#buildAuthorityRepositories();
    this.projections = this.#buildProjectionRepositories();
  }

  static open(
    input: unknown,
    clock: Clock = systemClock,
    writeCommitHooks?: AuthorityWriteCommitHooks,
    terminalizationHooks?: AuthorityTerminalizationHooks,
  ): AuthorityDatabase {
    return new AuthorityDatabase(input, clock, writeCommitHooks, terminalizationHooks);
  }

  static sourceDatabaseIdentity(path: string): string {
    return createHash("sha256")
      .update(`${String(AUTHORITY_APPLICATION_ID)}:${resolve(z.string().min(1).parse(path))}`)
      .digest("hex");
  }

  static inspectExistingReadOnly(path: string, busyTimeoutMs = 250): AuthorityCopyInspection {
    return inspectExistingDatabaseReadOnly(path, busyTimeoutMs);
  }

  getSourceDatabaseIdentity(): string {
    return AuthorityDatabase.sourceDatabaseIdentity(this.#path);
  }

  async onlineBackupTo(destinationPath: string): Promise<number> {
    this.#assertOpen();
    const destination = z.string().min(1).parse(destinationPath);
    return sqliteBackup(this.#database, destination, { rate: 100 });
  }

  close(): void {
    if (this.#closed) return;
    if (this.#transactionDepth !== 0) throw new Error("cannot close authority database during a transaction");
    this.#database.close();
    this.#closed = true;
  }

  [Symbol.dispose](): void {
    this.close();
  }

  getMeta(): z.infer<typeof AuthorityMetaSchema> {
    this.#assertOpen();
    const row = this.#readMetaRow();
    return AuthorityMetaSchema.parse({
      schemaVersion: row.schema_version,
      authorityGeneration: row.authority_generation,
      updatedAt: row.updated_at,
    });
  }

  inspectSchema(): z.infer<typeof AuthoritySchemaInspectionSchema> {
    this.#assertOpen();
    const meta = this.getMeta();
    const names = this.#tableNames();
    return AuthoritySchemaInspectionSchema.parse({
      applicationId: this.#readIntPragma("application_id"),
      schemaVersion: meta.schemaVersion,
      authorityGeneration: meta.authorityGeneration,
      pragmas: {
        journalMode: this.#readTextPragma("journal_mode"),
        foreignKeys: this.#readIntPragma("foreign_keys"),
        synchronous: this.#readIntPragma("synchronous"),
        busyTimeoutMs: this.#readIntPragma("busy_timeout"),
      },
      tables: names.map((name) => ({ name, classification: tableClassification(name) })),
    });
  }

  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result {
    return this.#withTransaction("authority", () => work(this.authority));
  }

  withProjectionTransaction<Result>(work: (repositories: ProjectionRepositories) => Result): Result {
    return this.#withTransaction("projection", () => work(this.projections));
  }

  terminalizeFailure(descriptor: AnyWorkflowDescriptor, input: unknown): FailureTerminalizationReport {
    const request = FailureTerminalizationRequestSchema.parse(input);
    descriptorRuntimeNodes(descriptor);
    return this.withAuthorityTransaction(() => {
      const current = this.#readRunRow(request.failure.runId);
      if (current === undefined) throw new Error(`run ${request.failure.runId} does not exist`);
      this.#assertFailureMatchesRun(request.failure, current, descriptor);
      this.#assertTerminalAuthorizationMatchesRun(request.authorization, current);
      const existingAuthorization = this.#readRecord(
        "run_terminal_authorizations",
        request.failure.runId,
        TerminalAuthorizationRecordSchema,
      );
      const existing = this.#readRecord("failures", request.failure.failureId, FailureRecordSchema);
      if (existingAuthorization !== undefined || existing !== undefined) {
        if (existingAuthorization === undefined || existing === undefined) {
          throw new Error(`run ${request.failure.runId} has a partial failure terminal settlement`);
        }
        if (canonicalJsonStringify(existingAuthorization)
          !== canonicalJsonStringify(request.authorization)) {
          throw new Error(
            `run ${request.failure.runId} terminal authorization does not match the original pre-terminal claim`,
          );
        }
        if (canonicalJsonStringify(existing) !== canonicalJsonStringify(request.failure)) {
          throw new Error(`failure ${request.failure.failureId} already exists with different content`);
        }
        this.#assertTerminalAuthorizationConsequence(existingAuthorization, current);
        if (current.lifecycle.state !== "terminal"
          || current.lifecycle.errorSummary !== request.failure.summary) {
          throw new Error(`failure ${request.failure.failureId} exists without its exact terminal run transition`);
        }
        return FailureTerminalizationReportSchema.parse({
          state: "replayed",
          authorization: existingAuthorization,
          failure: existing,
          run: current,
        });
      }
      if (current.lifecycle.state === "terminal") {
        throw new Error(`run ${request.failure.runId} is already terminal without failure ${request.failure.failureId}`);
      }
      this.#assertFailureWasCurrentExecution(request.failure, current);
      this.#assertTerminalClaim(
        current,
        request.authorization.expectedVersion,
        request.authorization.claim,
      );

      const terminal = RunRecordSchema.parse({
        ...current,
        lifecycle: {
          state: "terminal",
          outcome: "failed",
          endedAt: request.authorization.authorizedAt,
          failureId: request.failure.failureId,
          errorSummary: request.failure.summary,
        },
        version: current.version + 1,
        updatedAt: request.authorization.authorizedAt,
      });
      const violation = runTransitionViolation(current.lifecycle, terminal.lifecycle);
      if (violation !== undefined) throw new Error(`run ${request.failure.runId}: ${violation}`);
      this.#assertTerminalAuthorizationConsequence(request.authorization, terminal);
      this.#insertTerminalAuthorization(request.authorization);
      this.#terminalizationHooks?.afterFailureStorageStep?.("authorization");
      this.#insertFailure(request.failure);
      this.#terminalizationHooks?.afterFailureStorageStep?.("failure");
      this.#writeRunRow(terminal, "update");
      this.#terminalizationHooks?.afterFailureStorageStep?.("run");
      return FailureTerminalizationReportSchema.parse({
        state: "applied",
        authorization: request.authorization,
        failure: request.failure,
        run: terminal,
      });
    });
  }

  terminalizeSuccess(input: unknown, factoryAuthorization?: object): SuccessTerminalizationReport {
    const request = SuccessTerminalizationRequestSchema.parse(input);
    return this.withAuthorityTransaction(() => {
      const current = this.#readRunRow(request.result.runId);
      if (current === undefined) throw new Error(`run ${request.result.runId} does not exist`);
      this.#assertResultMatchesRun(request.result, request.outbox, current);
      this.#assertTerminalAuthorizationMatchesRun(request.authorization, current);
      const existingAuthorization = this.#readRecord(
        "run_terminal_authorizations",
        request.result.runId,
        TerminalAuthorizationRecordSchema,
      );
      const existingResult = this.#readRecord("run_results", request.result.runId, RunResultRecordSchema);
      const existingOutbox = this.#findRunTerminalOutboxByRun(request.result.runId);
      if (existingAuthorization !== undefined || existingResult !== undefined || existingOutbox !== undefined) {
        if (existingAuthorization === undefined || existingResult === undefined || existingOutbox === undefined) {
          throw new Error(`run ${request.result.runId} has a partial terminal authorization/result/outbox settlement`);
        }
        if (canonicalJsonStringify(existingAuthorization)
          !== canonicalJsonStringify(request.authorization)) {
          throw new Error(
            `run ${request.result.runId} terminal authorization does not match the original pre-terminal claim`,
          );
        }
        if (canonicalJsonStringify(existingResult) !== canonicalJsonStringify(request.result)) {
          throw new Error(`run result ${request.result.runId} already exists with different content`);
        }
        if (canonicalJsonStringify(existingOutbox) !== canonicalJsonStringify(request.outbox)) {
          throw new Error(`run terminal outbox for ${request.result.runId} already exists with different content`);
        }
        this.#assertTerminalAuthorizationConsequence(existingAuthorization, current);
        return SuccessTerminalizationReportSchema.parse({
          state: "replayed",
          authorization: existingAuthorization,
          result: existingResult,
          outbox: existingOutbox,
          run: current,
        });
      }
      if (current.lifecycle.state === "terminal") {
        throw new Error(`run ${request.result.runId} is already terminal without a result`);
      }
      if (current.lifecycle.state !== "running") {
        throw new Error(`run ${request.result.runId} is ${current.lifecycle.state}; only running may finish done`);
      }
      assertWorkflowRunResultAuthorization(factoryAuthorization, request.result, current);
      this.#assertStoredTerminalDependencies(request.result, current);
      this.#assertTerminalClaim(
        current,
        request.authorization.expectedVersion,
        request.authorization.claim,
      );
      const terminal = RunRecordSchema.parse({
        ...current,
        lifecycle: {
          state: "terminal",
          outcome: "done",
          endedAt: request.authorization.authorizedAt,
        },
        version: current.version + 1,
        updatedAt: request.authorization.authorizedAt,
      });
      const violation = runTransitionViolation(current.lifecycle, terminal.lifecycle);
      if (violation !== undefined) throw new Error(`run ${request.result.runId}: ${violation}`);
      this.#assertTerminalAuthorizationConsequence(request.authorization, terminal);

      this.#insertTerminalAuthorization(request.authorization);
      this.#terminalizationHooks?.afterSuccessStorageStep?.("authorization");
      this.#insertRunResult(request.result);
      this.#terminalizationHooks?.afterSuccessStorageStep?.("result");
      this.#insertRunTerminalOutbox(request.outbox);
      this.#terminalizationHooks?.afterSuccessStorageStep?.("outbox");
      this.#writeRunRow(terminal, "update");
      this.#terminalizationHooks?.afterSuccessStorageStep?.("run");
      return SuccessTerminalizationReportSchema.parse({
        state: "applied",
        authorization: request.authorization,
        result: request.result,
        outbox: request.outbox,
        run: terminal,
      });
    });
  }

  commitWriteAttempt(input: unknown): AtomicWriteCommitReport {
    const parsed = AtomicWriteCommitInputSchema.parse(input);
    return this.withAuthorityTransaction(() => {
      const currentIntent = this.#readRecord("write_intents", parsed.writeIntentId, WriteIntentRecordSchema);
      if (currentIntent === undefined) throw new Error(`write intent ${parsed.writeIntentId} does not exist`);
      if (currentIntent.status !== "attempting") {
        throw new Error(`write intent ${parsed.writeIntentId} is ${currentIntent.status}; only attempting may commit`);
      }
      if (currentIntent.generation !== parsed.generation) {
        throw new Error(`write intent ${parsed.writeIntentId} generation ${String(currentIntent.generation)} does not match commit generation ${String(parsed.generation)}`);
      }
      const currentAttempt = this.#readRecord("write_attempts", currentIntent.currentAttemptId, WriteAttemptRecordSchema);
      if (currentAttempt === undefined) throw new Error(`current write attempt ${currentIntent.currentAttemptId} does not exist`);
      if (currentAttempt.outcome.state !== "attempting") {
        throw new Error(`write attempt ${currentAttempt.writeAttemptId} is ${currentAttempt.outcome.state}; only attempting may commit`);
      }
      WriteFenceInputSchema.parse({ intent: currentIntent, attempt: currentAttempt });
      this.#assertAtomicCommitMatchesIntent(parsed, currentIntent);

      const committedIntent = WriteIntentRecordSchema.parse({
        ...currentIntent,
        status: "committed",
        completionProof: parsed.completionProof,
        confirmedAt: parsed.confirmedAt,
        version: currentIntent.version + 1,
        updatedAt: parsed.confirmedAt,
      });
      const committedAttempt = WriteAttemptRecordSchema.parse({
        ...currentAttempt,
        outcome: {
          state: "committed",
          completionProof: parsed.completionProof,
          confirmedAt: parsed.confirmedAt,
        },
        recordedAt: parsed.confirmedAt,
      });

      this.#replaceWriteIntent(committedIntent);
      this.#writeCommitHooks?.afterStorageStep("intent-state");
      this.#replaceWriteAttempt(committedAttempt);
      this.#writeCommitHooks?.afterStorageStep("attempt-state");
      this.#insertDurableOutbox(parsed.ledgerOutbox);
      this.#writeCommitHooks?.afterStorageStep("ledger-outbox");
      this.#insertDurableOutbox(parsed.terminalSpanOutbox);
      this.#writeCommitHooks?.afterStorageStep("terminal-span-outbox");

      return AtomicWriteCommitReportSchema.parse({
        state: "committed",
        intent: committedIntent,
        attempt: committedAttempt,
        ledgerOutbox: parsed.ledgerOutbox,
        terminalSpanOutbox: parsed.terminalSpanOutbox,
      });
    });
  }

  #assertTerminalClaim(
    current: RunRecord,
    expectedVersion: number,
    claim: z.infer<typeof RunClaimTokenSchema>,
  ): void {
    if (current.version !== expectedVersion) {
      throw new Error(
        `run ${current.envelope.runId} is at version ${String(current.version)}, not ${String(expectedVersion)}`,
      );
    }
    const held = runClaim(current);
    if (held === undefined
      || held.workerId !== claim.workerId
      || held.claimGeneration !== claim.claimGeneration) {
      throw new Error(
        `run ${current.envelope.runId} is no longer claimed by ${claim.workerId} `
        + `at generation ${String(claim.claimGeneration)}`,
      );
    }
  }

  #assertFailureMatchesRun(
    failure: FailureRecord,
    current: RunRecord,
    descriptor: AnyWorkflowDescriptor,
  ): void {
    const envelope = current.envelope;
    if (failure.runId !== envelope.runId
      || failure.traceId !== envelope.traceId
      || failure.attempt !== envelope.attempt
      || failure.workflowId !== envelope.workflow) {
      throw new Error(`failure ${failure.failureId} identity does not match current run ${envelope.runId}`);
    }
    if (descriptor.id !== envelope.workflow
      || descriptor.version !== envelope.descriptorVersion
      || descriptor.contractFingerprint !== envelope.contractFingerprint) {
      throw new Error(`failure ${failure.failureId} descriptor does not match current run ${envelope.runId}`);
    }
    if (failure.nodeId === undefined) {
      if (failure.taskId !== undefined) {
        throw new Error(`failure ${failure.failureId} carries task ${failure.taskId} without a node`);
      }
      return;
    }
    const node = descriptorRuntimeNodes(descriptor).find(({ id }) => id === failure.nodeId);
    if (node === undefined) {
      throw new Error(`failure ${failure.failureId} names node ${failure.nodeId} absent from descriptor`);
    }
    const allowedTaskIds = node.kind === "task"
      ? [node.uses.id]
      : node.kind === "transaction" ? [node.prepare.uses.id, node.commit.uses.id] : [];
    if (allowedTaskIds.length === 0 && failure.taskId !== undefined) {
      throw new Error(`failure ${failure.failureId} node ${failure.nodeId} owns no task ${failure.taskId}`);
    }
    if (allowedTaskIds.length > 0
      && (failure.taskId === undefined || !allowedTaskIds.includes(failure.taskId))) {
      throw new Error(
        `failure ${failure.failureId} task ${failure.taskId ?? "absent"} does not match `
        + `descriptor node ${failure.nodeId} (${allowedTaskIds.join(" or ")})`,
      );
    }
  }

  #assertFailureWasCurrentExecution(failure: FailureRecord, current: RunRecord): void {
    if (failure.nodeId === undefined) return;
    if (current.lifecycle.state !== "running"
      || current.lifecycle.currentNodeId !== failure.nodeId) {
      throw new Error(
        `failure ${failure.failureId} names node ${failure.nodeId}, `
        + `but run ${failure.runId} is not executing that node`,
      );
    }
  }

  #assertTerminalAuthorizationMatchesRun(
    authorization: TerminalAuthorizationRecord,
    current: RunRecord,
  ): void {
    const envelope = current.envelope;
    if (authorization.runId !== envelope.runId
      || authorization.workflowId !== envelope.workflow
      || authorization.attempt !== envelope.attempt
      || authorization.descriptorVersion !== envelope.descriptorVersion
      || authorization.contractFingerprint !== envelope.contractFingerprint) {
      throw new Error(
        `terminal authorization for ${authorization.runId} does not match current run ${envelope.runId}`,
      );
    }
  }

  #assertTerminalAuthorizationConsequence(
    authorization: TerminalAuthorizationRecord,
    run: RunRecord,
  ): void {
    const exactCommonConsequence = Number(run.version) === Number(authorization.expectedVersion) + 1
      && Number(run.claimGeneration) === Number(authorization.claim.claimGeneration)
      && run.lifecycle.state === "terminal"
      && run.lifecycle.outcome === authorization.kind
      && run.lifecycle.endedAt === authorization.authorizedAt
      && run.updatedAt === authorization.authorizedAt;
    const exactArmConsequence = authorization.kind === "done"
      || (run.lifecycle.state === "terminal"
        && run.lifecycle.outcome === "failed"
        && run.lifecycle.failureId === authorization.failureId);
    if (!exactCommonConsequence || !exactArmConsequence) {
      throw new Error(
        `run ${authorization.runId} does not match its exact ${authorization.kind} terminal authorization consequence`,
      );
    }
  }

  #assertResultMatchesRun(
    result: RunResultRecord,
    outbox: RunTerminalOutboxRecord,
    current: RunRecord,
  ): void {
    const envelope = current.envelope;
    if (result.runId !== envelope.runId
      || result.workflowId !== envelope.workflow
      || result.attempt !== envelope.attempt
      || result.descriptorVersion !== envelope.descriptorVersion
      || result.contractFingerprint !== envelope.contractFingerprint
      || result.configFingerprint !== envelope.configFingerprint
      || result.configSnapshotId !== envelope.configSnapshotId) {
      throw new Error(`run result ${result.runId} identity or fingerprint does not match current run ${envelope.runId}`);
    }
    if (outbox.payload.runId !== result.runId
      || outbox.payload.workflowId !== result.workflowId
      || outbox.payload.attempt !== result.attempt
      || outbox.payload.resultDigest !== result.resultDigest
      || outbox.projection.state !== "pending") {
      throw new Error(`run terminal outbox ${outbox.outboxId} does not bind the exact result for ${result.runId}`);
    }
  }

  #assertStoredTerminalDependencies(result: RunResultRecord, current: RunRecord): void {
    for (const dependency of result.dependencies) {
      if (dependency.state === "not-run") {
        const currentAttemptCheckpoint = this.#readRecord(
          "run_checkpoints",
          checkpointLookupKey(
            result.workflowId,
            current.envelope.itemId,
            dependency.nodeId,
            result.attempt,
          ),
          RunCheckpointRecordSchema,
        );
        if (currentAttemptCheckpoint !== undefined) {
          throw new Error(
            `terminal dependency ${dependency.nodeId} is marked ${dependency.reason} `
            + "but has a stored checkpoint for the terminal attempt",
          );
        }
        continue;
      }
      const stored = this.#readRecord(
        "run_checkpoints",
        checkpointLookupKey(
          dependency.checkpoint.workflowId,
          dependency.checkpoint.itemId,
          dependency.nodeId,
          dependency.checkpoint.attempt,
        ),
        RunCheckpointRecordSchema,
      );
      if (stored === undefined) {
        throw new Error(`terminal dependency ${dependency.nodeId} has no exact stored checkpoint`);
      }
      if (stored.runId !== dependency.checkpoint.runId
        || stored.output.schemaHash !== dependency.outputSchemaHash
        || stored.descriptorVersion !== dependency.descriptorVersion
        || stored.contractFingerprint !== dependency.contractFingerprint
        || stored.implFingerprint !== dependency.implFingerprint
        || deriveCheckpointOutputDigest(stored.output) !== dependency.outputDigest
        || deriveCheckpointProvenanceDigest(stored.provenance) !== dependency.provenanceDigest) {
        throw new Error(`terminal dependency ${dependency.nodeId} does not match its exact stored checkpoint`);
      }
    }
  }

  #insertTerminalAuthorization(record: TerminalAuthorizationRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_terminal_authorizations", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_terminal_authorizations
          (record_key, kind, expected_version, worker_id, claim_generation, record_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.runId,
        record.kind,
        record.expectedVersion,
        record.claim.workerId,
        record.claim.claimGeneration,
        json,
        record.authorizedAt,
      );
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #insertFailure(record: FailureRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("failures", () => {
      const result = this.#database.prepare(`
        INSERT INTO failures (record_key, run_id, record_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(record.failureId, record.runId, json, record.occurredAt);
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #insertRunResult(record: RunResultRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_results", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_results
          (record_key, workflow, attempt, result_digest, record_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        record.runId, record.workflowId, record.attempt,
        record.resultDigest, json, record.createdAt,
      );
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #insertRunTerminalOutbox(record: RunTerminalOutboxRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("run_terminal_outbox", () => {
      const result = this.#database.prepare(`
        INSERT INTO run_terminal_outbox
          (record_key, run_id, state, record_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(record.outboxId, record.payload.runId, record.projection.state, json, record.createdAt);
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #findRunTerminalOutboxByRun(runId: string): RunTerminalOutboxRecord | undefined {
    const row = this.#database.prepare(`
      SELECT record_json FROM run_terminal_outbox WHERE run_id = ?
    `).get(RunIdSchema.parse(runId));
    if (row === undefined) return undefined;
    return parseJsonRecord(RunTerminalOutboxRecordSchema, JsonRowSchema.parse(row).record_json);
  }

  #assertOpen(): void {
    if (this.#closed || !this.#database.isOpen) throw new Error("authority database is closed");
  }

  #configureConnection(): void {
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA synchronous = FULL");
    this.#database.exec(`PRAGMA busy_timeout = ${String(this.#busyTimeoutMs)}`);
  }

  #initializeSchema(existed: boolean, migrationOwner: string): void {
    if (!existed) {
      this.#runMigrations(0, migrationOwner);
      return;
    }
    const applicationId = this.#readIntPragma("application_id");
    if (applicationId !== AUTHORITY_APPLICATION_ID) {
      throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
    }
    const userVersion = this.#readIntPragma("user_version");
    if (userVersion > CURRENT_AUTHORITY_SCHEMA_VERSION) {
      throw new Error(`authority schema ${String(userVersion)} is newer than supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
    }
    if (userVersion < 1) throw new Error("existing authority database has no recognized schema version");
    const meta = this.#readMetaRow();
    if (meta.schema_version !== userVersion) {
      throw new Error(`authority schema metadata ${String(meta.schema_version)} disagrees with user_version ${String(userVersion)}`);
    }
    if (meta.migration_owner !== null || meta.migration_started_at !== null) {
      throw new Error(`authority database is locked by migration owner ${String(meta.migration_owner)}`);
    }
    if (userVersion < CURRENT_AUTHORITY_SCHEMA_VERSION) this.#runMigrations(userVersion, migrationOwner);
  }

  #runMigrations(fromVersion: number, migrationOwner: string): void {
    this.#database.exec("BEGIN EXCLUSIVE");
    try {
      const migrations = SQLITE_MIGRATIONS.filter(({ version }) => version > fromVersion);
      for (const migration of migrations) {
        for (const statement of migration.statements) this.#database.exec(statement);
        if (migration.version === 1) {
          this.#database.prepare(`
            INSERT INTO authority_meta (
              singleton_id, schema_version, authority_generation, updated_at,
              migration_owner, migration_started_at
            ) VALUES (1, ?, 0, ?, ?, ?)
          `).run(migration.version, this.#now(), migrationOwner, this.#now());
        } else {
          this.#database.prepare(`
            UPDATE authority_meta
            SET schema_version = ?, migration_owner = ?, migration_started_at = ?, updated_at = ?
            WHERE singleton_id = 1
          `).run(migration.version, migrationOwner, this.#now(), this.#now());
        }
        this.#database.exec(`PRAGMA user_version = ${String(migration.version)}`);
      }
      this.#database.exec(`PRAGMA application_id = ${String(AUTHORITY_APPLICATION_ID)}`);
      this.#database.prepare(`
        UPDATE authority_meta
        SET migration_owner = NULL, migration_started_at = NULL, updated_at = ?
        WHERE singleton_id = 1
      `).run(this.#now());
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #validateDatabase(): void {
    const migrationViolations = auditMigrationTableCoverage();
    if (migrationViolations.length > 0) throw new Error(migrationViolations.join("; "));
    inspectOpenDatabase(this.#database, true);
  }

  #tableNames(): TableName[] {
    return tableNames(this.#database);
  }

  #readMetaRow(): z.infer<typeof MetaRowSchema> {
    return readMetaRow(this.#database);
  }

  #readIntPragma(name: "application_id" | "user_version" | "foreign_keys" | "synchronous" | "busy_timeout"): number {
    return readIntPragma(this.#database, name);
  }

  #readTextPragma(name: "journal_mode"): string {
    return readTextPragma(this.#database, name);
  }

  #now(): string {
    return this.#clock.now().toISOString();
  }

  #withTransaction<Result>(mode: "authority" | "projection", work: () => Result): Result {
    this.#assertOpen();
    if (this.#transactionDepth > 0) {
      if (this.#transactionMode === "projection" && mode === "authority") {
        throw new Error("authority mutation cannot run inside a projection transaction");
      }
      const savepoint = `authority_nested_${String(this.#savepointSequence += 1)}`;
      const dirtyBefore = this.#authorityDirty;
      this.#database.exec(`SAVEPOINT ${savepoint}`);
      this.#transactionDepth += 1;
      try {
        const result = work();
        this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        this.#database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.#database.exec(`RELEASE SAVEPOINT ${savepoint}`);
        this.#authorityDirty = dirtyBefore;
        throw error;
      } finally {
        this.#transactionDepth -= 1;
      }
    }

    this.#database.exec("BEGIN IMMEDIATE");
    this.#transactionDepth = 1;
    this.#transactionMode = mode;
    this.#authorityDirty = false;
    try {
      const result = work();
      if (this.#authorityDirty) {
        const update = this.#database.prepare(`
          UPDATE authority_meta
          SET authority_generation = authority_generation + 1, updated_at = ?
          WHERE singleton_id = 1
        `).run(this.#now());
        if (sqliteChanges(update.changes) !== 1) throw new Error("authority generation update did not affect the singleton metadata row");
      }
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    } finally {
      this.#transactionDepth = 0;
      this.#transactionMode = undefined;
      this.#authorityDirty = false;
    }
  }

  #authorityWrite<Outcome extends Readonly<{ result: unknown; changes: number }>>(
    table: AuthorityTableName,
    operation: () => Outcome,
  ): Outcome["result"] {
    if (table === "authority_meta") throw new Error("authority_meta is mutated only by the generation and migration protocols");
    return this.#withTransaction("authority", () => {
      const outcome = operation();
      if (outcome.changes > 0) this.#authorityDirty = true;
      return outcome.result;
    });
  }

  #projectionWrite<Result>(table: ProjectionTableName, operation: () => Result): Result {
    ProjectionTableNameSchema.parse(table);
    return this.#withTransaction("projection", operation);
  }

  #readRecord<Schema extends z.ZodType>(table: TableName, recordKey: string, schema: Schema): z.output<Schema> | undefined {
    const row = this.#database.prepare(`SELECT record_json FROM ${table} WHERE record_key = ?`).get(recordKey);
    if (row === undefined) return undefined;
    return parseJsonRecord(schema, JsonRowSchema.parse(row).record_json);
  }

  #insertSimpleRecord<Schema extends z.ZodType>(
    table: Exclude<AuthorityTableName, "authority_meta">,
    recordKey: string,
    input: unknown,
    schema: Schema,
    createdAt: string,
  ): ImmutableInsertResult<z.output<Schema>> {
    const record = schema.parse(input);
    const json = canonicalJsonStringify(record);
    return this.#authorityWrite(table, () => {
      const existing = this.#readRecord(table, recordKey, schema);
      if (existing !== undefined) {
        if (canonicalJsonStringify(existing) !== json) throw new Error(`${table} key ${recordKey} already exists with different content`);
        return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
      }
      const result = this.#database.prepare(`
        INSERT INTO ${table} (record_key, record_json, created_at) VALUES (?, ?, ?)
      `).run(recordKey, json, createdAt);
      return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
    });
  }

  #buildAuthorityRepositories(): AuthorityRepositories {
    const opaque = (tableInput: z.input<typeof OpaqueAuthorityTableSchema>): ImmutableRepository<OpaqueAuthorityRecord> => {
      const table = OpaqueAuthorityTableSchema.parse(tableInput);
      return Object.freeze({
        insert: (input: unknown) => {
          const record = OpaqueAuthorityRecordSchema.parse(input);
          return this.#insertSimpleRecord(table, record.recordId, record, OpaqueAuthorityRecordSchema, record.createdAt);
        },
        get: (recordKey: string) => this.#readRecord(table, recordKey, OpaqueAuthorityRecordSchema),
      });
    };

    return Object.freeze({
      runs: this.#buildRunRepository(),
      terminalAuthorizations: Object.freeze({
        get: (runId: string) => this.#readRecord(
          "run_terminal_authorizations",
          RunIdSchema.parse(runId),
          TerminalAuthorizationRecordSchema,
        ),
      }),
      failures: Object.freeze({
        get: (failureId: string) => this.#readRecord("failures", failureId, FailureRecordSchema),
        listByRun: (runId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM failures WHERE run_id = ? ORDER BY created_at, record_key
          `).all(RunIdSchema.parse(runId));
          return Object.freeze(rows.map((row) => parseJsonRecord(
            FailureRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
      }),
      runResults: Object.freeze({
        get: (runId: string) => this.#readRecord(
          "run_results",
          RunIdSchema.parse(runId),
          RunResultRecordSchema,
        ),
      }),
      runTerminalOutbox: Object.freeze({
        get: (outboxId: string) => this.#readRecord(
          "run_terminal_outbox",
          outboxId,
          RunTerminalOutboxRecordSchema,
        ),
        findByRun: (runId: string) => this.#findRunTerminalOutboxByRun(runId),
      }),
      providerAdmissions: this.#buildProviderAdmissionRepository(),
      startPlans: this.#buildStartPlanRepository(),
      workerLeases: this.#buildWorkerLeaseRepository(),
      commands: Object.freeze({
        insert: (input: unknown) => {
          const record = CommandRequestSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("commands", () => {
            const existing = this.#readRecord("commands", record.commandId, CommandRequestSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`command id ${record.commandId} was reused with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO commands (record_key, family, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.commandId, record.family, json, record.requestedAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (commandId: string) => this.#readRecord("commands", commandId, CommandRequestSchema),
      }),
      commandAudits: Object.freeze({
        insert: (input: unknown) => {
          const record = CommandAuditRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("command_audits", () => {
            const existing = this.#readRecord("command_audits", record.auditId, CommandAuditRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`command audit ${record.auditId} already exists with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO command_audits (record_key, command_id, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.auditId, record.request.commandId, json, record.completedAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (auditId: string) => this.#readRecord("command_audits", auditId, CommandAuditRecordSchema),
        findByCommand: (commandId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM command_audits WHERE command_id = ? ORDER BY record_key
          `).all(commandId);
          if (rows.length > 1) {
            throw new Error(`command ${commandId} has ${String(rows.length)} recorded audits; exactly one outcome may exist`);
          }
          const row = rows[0];
          if (row === undefined) return undefined;
          return parseJsonRecord(CommandAuditRecordSchema, JsonRowSchema.parse(row).record_json);
        },
      }),
      dependencies: Object.freeze({
        insert: (input: unknown) => {
          const record = DependencyRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          return this.#authorityWrite("dependencies", () => {
            const existing = this.#readRecord("dependencies", record.dependencyId, DependencyRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) throw new Error(`dependency ${record.dependencyId} already exists with different content`);
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO dependencies (record_key, manifest_id, record_json, created_at) VALUES (?, ?, ?, ?)
            `).run(record.dependencyId, record.manifestId, json, record.createdAt);
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (dependencyId: string) => this.#readRecord("dependencies", dependencyId, DependencyRecordSchema),
        listByParentRun: (parentRunId: string) => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM dependencies
            WHERE json_extract(record_json, '$.parentRunId') = ?
            ORDER BY created_at, record_key
          `).all(RunIdSchema.parse(parentRunId));
          return Object.freeze(rows.map((row) => parseJsonRecord(
            DependencyRecordSchema,
            JsonRowSchema.parse(row).record_json,
          )));
        },
      }),
      delegationManifests: Object.freeze({
        insert: (input: unknown) => {
          const record = DelegationManifestSchema.parse(input);
          return this.#insertSimpleRecord("delegation_manifests", record.manifestId, record, DelegationManifestSchema, record.createdAt);
        },
        get: (manifestId: string) => this.#readRecord("delegation_manifests", manifestId, DelegationManifestSchema),
      }),
      gateResults: Object.freeze({
        insert: (input: unknown) => {
          const record = GateResultRecordSchema.parse(input);
          return this.#insertSimpleRecord("checkpoint_payloads", `${record.runId}:${record.gateId}`, record, GateResultRecordSchema, record.resolvedAt);
        },
        get: (recordKey: string) => this.#readRecord("checkpoint_payloads", recordKey, GateResultRecordSchema),
      }),
      runCheckpoints: Object.freeze({
        insert: (input: unknown) => {
          const record = RunCheckpointRecordSchema.parse(input);
          const json = canonicalJsonStringify(record);
          const recordKey = checkpointRecordKey(record);
          return this.#authorityWrite("run_checkpoints", () => {
            const existing = this.#readRecord("run_checkpoints", recordKey, RunCheckpointRecordSchema);
            if (existing !== undefined) {
              if (canonicalJsonStringify(existing) !== json) {
                throw new Error(`run checkpoint ${recordKey} already exists with different content`);
              }
              return { result: Object.freeze({ state: "existing" as const, record: existing }), changes: 0 };
            }
            const result = this.#database.prepare(`
              INSERT INTO run_checkpoints
                (record_key, workflow, item_id, node_id, attempt, run_id, record_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              recordKey, record.workflowId, record.itemId, record.nodeId,
              record.attempt, record.runId, json, record.writtenAt,
            );
            return { result: Object.freeze({ state: "inserted" as const, record }), changes: sqliteChanges(result.changes) };
          });
        },
        get: (workflowId: string, itemId: string, nodeId: string, attempt: number) => this.#readRecord(
          "run_checkpoints",
          checkpointLookupKey(workflowId, itemId, nodeId, attempt),
          RunCheckpointRecordSchema,
        ),
        latest: (workflowId: string, itemId: string, nodeId: string) => {
          const row = this.#database.prepare(`
            SELECT record_json FROM run_checkpoints
            WHERE workflow = ? AND item_id = ? AND node_id = ?
            ORDER BY attempt DESC LIMIT 1
          `).get(workflowId, itemId, nodeId);
          if (row === undefined) return undefined;
          return parseJsonRecord(RunCheckpointRecordSchema, JsonRowSchema.parse(row).record_json);
        },
      }),
      notifications: Object.freeze({
        insert: (input: unknown) => {
          const record = NotificationRecordSchema.parse(input);
          return this.#insertSimpleRecord("notifications", record.notificationId, record, NotificationRecordSchema, record.createdAt);
        },
        get: (notificationId: string) => this.#readRecord("notifications", notificationId, NotificationRecordSchema),
      }),
      configSnapshots: Object.freeze({
        insert: (input: unknown) => {
          // The WRITE schema, not the read schema: an older generation is read
          // forward, never minted (`src/domain/config/snapshot-generations.ts`).
          const record = ConfigSnapshotWriteSchema.parse(input);
          return this.#insertSimpleRecord("config_snapshots", record.configSnapshotId, record, ConfigSnapshotRecordSchema, record.capturedAt);
        },
        get: (snapshotId: string) => this.#readRecord("config_snapshots", snapshotId, ConfigSnapshotRecordSchema),
      }),
      versionPlans: Object.freeze({
        insert: (input: unknown) => {
          const record = VersionPlanStorageRecordSchema.parse(input);
          return this.#insertSimpleRecord("version_plans", record.versionPlanId, record, VersionPlanStorageRecordSchema, record.createdAt);
        },
        get: (versionPlanId: string) => this.#readRecord("version_plans", versionPlanId, VersionPlanStorageRecordSchema),
      }),
      writeIntents: Object.freeze({
        recordObservedPresent: (input: unknown) => {
          const record = WriteIntentRecordSchema.parse(input);
          if (record.status !== "observed-present") {
            throw new Error(`recordObservedPresent requires observed-present status, received ${record.status}`);
          }
          return this.withAuthorityTransaction(() => {
            const existing = this.#findPermanentWriteIntent(record.system, record.idempotencyKey);
            if (existing !== undefined) {
              return PermanentWriteResolutionSchema.parse({ state: "existing", intent: existing });
            }
            this.#insertWriteIntent(record);
            return PermanentWriteResolutionSchema.parse({ state: "recorded-observed-present", intent: record });
          });
        },
        fenceAttempt: (input: unknown) => {
          const { intent, attempt } = WriteFenceInputSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const existing = this.#findPermanentWriteIntent(intent.system, intent.idempotencyKey);
            if (existing !== undefined) {
              return PermanentWriteResolutionSchema.parse({ state: "existing", intent: existing });
            }
            this.#insertWriteIntent(intent);
            this.#insertWriteAttempt(attempt);
            return PermanentWriteResolutionSchema.parse({ state: "fenced", intent, attempt });
          });
        },
        refenceRetryable: (input: unknown) => {
          const { expectedVersion, intent, attempt } = WriteRefenceInputSchema.parse(input);
          if (intent.status !== "attempting") {
            throw new Error(`re-fence of ${intent.writeIntentId} must present an attempting intent, not ${intent.status}`);
          }
          return this.withAuthorityTransaction(() => {
            const current = this.#requireWriteIntent(intent.writeIntentId);
            if (current.status !== "retryable") {
              throw new Error(`write intent ${intent.writeIntentId} is ${current.status}; only a retryable intent may re-fence`);
            }
            if (current.version !== expectedVersion) {
              throw new Error(`write intent ${intent.writeIntentId} is at version ${String(current.version)}, not ${String(expectedVersion)}; the re-fence is stale`);
            }
            if (intent.generation !== current.generation + 1) {
              throw new Error(`re-fence of ${intent.writeIntentId} must advance generation ${String(current.generation)} by exactly one, not to ${String(intent.generation)}`);
            }
            for (const [field, currentValue, nextValue] of [
              ["system", current.system, intent.system],
              ["idempotencyKey", current.idempotencyKey, intent.idempotencyKey],
              ["idempotencyKeyDigest", current.idempotencyKeyDigest, intent.idempotencyKeyDigest],
              ["workflowId", current.workflowId, intent.workflowId],
              ["itemId", current.itemId, intent.itemId],
              ["taskId", current.taskId, intent.taskId],
              ["createdAt", current.createdAt, intent.createdAt],
            ] as const) {
              if (currentValue !== nextValue) {
                throw new Error(`re-fence of ${intent.writeIntentId} may not change permanent ${field}`);
              }
            }
            if (intent.version !== current.version + 1) {
              throw new Error(`re-fence of ${intent.writeIntentId} must advance version ${String(current.version)} by exactly one`);
            }
            if (canonicalJsonStringify(intent.bindingProof) === canonicalJsonStringify(current.bindingProof)) {
              throw new Error(`re-fence of ${intent.writeIntentId} must carry a FRESH binding proof; reusing generation ${String(current.generation)}'s proof is refused`);
            }
            this.#replaceWriteIntent(intent);
            this.#insertWriteAttempt(attempt);
            return PermanentWriteResolutionSchema.parse({ state: "fenced", intent, attempt });
          });
        },
        parkAttempt: (input: unknown) => {
          const request = WriteIntentParkRequestSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const current = this.#requireAttemptBearingWriteIntent(request.writeIntentId, request.generation, request.expectedVersion);
            if (current.status !== "attempting") {
              throw new Error(`write intent ${request.writeIntentId} is ${current.status}; only an attempting intent may park`);
            }
            const parked = WriteIntentRecordSchema.parse({
              ...current,
              status: "parked",
              parkedCode: request.code,
              message: request.message,
              version: current.version + 1,
              updatedAt: request.now,
            });
            const currentAttempt = this.#requireAttemptingWriteAttempt(current.currentAttemptId);
            const parkedAttempt = WriteAttemptRecordSchema.parse({
              ...currentAttempt,
              outcome: { state: "parked", code: request.code, message: request.message },
              recordedAt: request.now,
            });
            this.#replaceWriteIntent(parked);
            this.#replaceWriteAttempt(parkedAttempt);
            return parked;
          });
        },
        settleRetryable: (input: unknown) => {
          const request = WriteIntentRetrySettlementRequestSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const current = this.#requireAttemptBearingWriteIntent(request.writeIntentId, request.generation, request.expectedVersion);
            if (current.status !== "attempting" && current.status !== "parked") {
              throw new Error(`write intent ${request.writeIntentId} is ${current.status}; only attempting or parked may settle retryable`);
            }
            const { parkedCode: _parkedCode, message: _message, ...base } = {
              parkedCode: undefined,
              message: undefined,
              ...current,
            };
            const retryable = WriteIntentRecordSchema.parse({
              ...base,
              status: "retryable",
              settlement: request.settlement,
              resolvedAt: request.now,
              version: current.version + 1,
              updatedAt: request.now,
            });
            const currentAttempt = this.#requireWriteAttempt(current.currentAttemptId);
            if (currentAttempt.outcome.state !== "attempting" && currentAttempt.outcome.state !== "parked") {
              throw new Error(`write attempt ${currentAttempt.writeAttemptId} is ${currentAttempt.outcome.state}; it cannot settle retryable`);
            }
            const settledAttempt = WriteAttemptRecordSchema.parse({
              ...currentAttempt,
              outcome: { state: "safe-to-retry", settlement: request.settlement },
              recordedAt: request.now,
            });
            this.#replaceWriteIntent(retryable);
            this.#replaceWriteAttempt(settledAttempt);
            return retryable;
          });
        },
        reopenParkedAttempt: (input: unknown) => {
          const request = WriteIntentReopenRequestSchema.parse(input);
          return this.withAuthorityTransaction(() => {
            const current = this.#requireAttemptBearingWriteIntent(request.writeIntentId, request.generation, request.expectedVersion);
            if (current.status !== "parked") {
              throw new Error(`write intent ${request.writeIntentId} is ${current.status}; only a parked intent may reopen for resolution`);
            }
            const { parkedCode: _parkedCode, message: _message, ...base } = current;
            const attempting = WriteIntentRecordSchema.parse({
              ...base,
              status: "attempting",
              version: current.version + 1,
              updatedAt: request.now,
            });
            const currentAttempt = this.#requireWriteAttempt(current.currentAttemptId);
            if (currentAttempt.outcome.state !== "parked") {
              throw new Error(`write attempt ${currentAttempt.writeAttemptId} is ${currentAttempt.outcome.state}; only a parked attempt may reopen`);
            }
            const reopenedAttempt = WriteAttemptRecordSchema.parse({
              ...currentAttempt,
              outcome: { state: "attempting" },
              recordedAt: request.now,
            });
            this.#replaceWriteIntent(attempting);
            this.#replaceWriteAttempt(reopenedAttempt);
            return attempting;
          });
        },
        get: (writeIntentId: string) => this.#readRecord("write_intents", writeIntentId, WriteIntentRecordSchema),
        findByPermanentKey: (system: unknown, idempotencyKey: unknown) => this.#findPermanentWriteIntent(
          BrowserSystemIdSchema.parse(system),
          IdempotencyKeySchema.parse(idempotencyKey),
        ),
      }),
      writeAttempts: Object.freeze({
        get: (writeAttemptId: string) => this.#readRecord("write_attempts", writeAttemptId, WriteAttemptRecordSchema),
      }),
      durableOutbox: Object.freeze({
        get: (outboxId: string) => this.#readRecord("durable_outbox", outboxId, AtomicOutboxRecordSchema),
      }),
      artifactOutbox: Object.freeze({
        insert: (input: unknown) => {
          const record = ArtifactOutboxStorageRecordSchema.parse(input);
          return this.#insertSimpleRecord("artifact_outbox", record.outboxId, record, ArtifactOutboxStorageRecordSchema, record.createdAt);
        },
        get: (outboxId: string) => this.#readRecord("artifact_outbox", outboxId, ArtifactOutboxStorageRecordSchema),
      }),
      opaque: Object.freeze({
        ocrApprovals: opaque("ocr_approvals"),
        captureSessions: opaque("capture_sessions"),
        capturePhotoOrder: opaque("capture_photo_order"),
        captureFinalizationOutboxes: opaque("capture_finalization_outboxes"),
        artifactSinkHeads: opaque("artifact_sink_heads"),
      }),
    });
  }

  #readRunRow(runId: string): RunRecord | undefined {
    return this.#readRecord("tasks", runId, RunRecordSchema);
  }

  #writeRunRow(record: RunRecord, mode: "insert" | "update"): void {
    const claim = runClaim(record);
    const json = canonicalJsonStringify(record);
    const notBefore = record.lifecycle.state === "queued" ? record.lifecycle.notBefore ?? null : null;
    this.#authorityWrite("tasks", () => {
      const statement = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO tasks (
            record_key, workflow, item_id, state, priority, attempt, not_before,
            owner_worker_id, claim_generation, heartbeat_at, parent_run_id, version,
            record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        : this.#database.prepare(`
          UPDATE tasks SET
            workflow = ?, item_id = ?, state = ?, priority = ?, attempt = ?, not_before = ?,
            owner_worker_id = ?, claim_generation = ?, heartbeat_at = ?, parent_run_id = ?,
            version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `);
      const shared = [
        record.envelope.workflow,
        record.envelope.itemId,
        record.lifecycle.state,
        record.envelope.priority,
        record.envelope.attempt,
        notBefore,
        claim?.workerId ?? null,
        record.claimGeneration,
        claim?.heartbeatAt ?? null,
        record.envelope.parent?.runId ?? null,
        record.version,
      ] as const;
      const result = mode === "insert"
        ? statement.run(record.envelope.runId, ...shared, json, record.createdAt)
        : statement.run(...shared, json, record.envelope.runId, record.version - 1);
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) {
        throw new Error(`run ${record.envelope.runId} ${mode} affected ${String(changes)} rows`);
      }
      return { result: undefined, changes };
    });
  }

  /**
   * One compare-and-swap over a run row. Every mutation funnels through here so
   * the version check, the claim check, and the legality check cannot be
   * bypassed by a caller that "knows" its update is safe.
   */
  #mutateRun(
    runId: string,
    expectedVersion: number,
    now: string,
    claim: z.infer<typeof RunClaimTokenSchema> | undefined,
    next: (current: RunRecord) => RunRecord,
  ): RunUpdateOutcome {
    return this.withAuthorityTransaction(() => {
      const current = this.#readRunRow(runId);
      if (current === undefined) throw new Error(`run ${runId} does not exist`);
      if (current.version !== expectedVersion) {
        return RunUpdateOutcomeSchema.parse({
          state: "conflict",
          currentVersion: current.version,
          currentState: current.lifecycle.state,
          message: `run ${runId} is at version ${String(current.version)}, not ${String(expectedVersion)}`,
        });
      }
      if (claim !== undefined) {
        const held = runClaim(current);
        if (held === undefined
          || held.workerId !== claim.workerId
          || held.claimGeneration !== claim.claimGeneration) {
          return RunUpdateOutcomeSchema.parse({
            state: "conflict",
            currentVersion: current.version,
            currentState: current.lifecycle.state,
            message: `run ${runId} is no longer claimed by ${claim.workerId} at generation ${String(claim.claimGeneration)}`,
          });
        }
      }
      const candidate = next(current);
      const violation = runTransitionViolation(current.lifecycle, candidate.lifecycle);
      if (violation !== undefined) throw new Error(`run ${runId}: ${violation}`);
      const updated = RunRecordSchema.parse({ ...candidate, version: current.version + 1, updatedAt: now });
      this.#writeRunRow(updated, "update");
      return RunUpdateOutcomeSchema.parse({ state: "applied", run: updated });
    });
  }

  #buildRunRepository(): RunRepository {
    return Object.freeze({
      enqueue: (input: unknown) => {
        const record = RunRecordSchema.parse(input);
        if (record.lifecycle.state !== "queued") {
          throw new Error(`run ${record.envelope.runId} must be enqueued in the queued state, not ${record.lifecycle.state}`);
        }
        const json = canonicalJsonStringify(record);
        return this.withAuthorityTransaction(() => {
          const existing = this.#readRunRow(record.envelope.runId);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`run id ${record.envelope.runId} already exists with different content`);
            }
            return Object.freeze({ state: "existing" as const, record: existing });
          }
          this.#writeRunRow(record, "insert");
          return Object.freeze({ state: "inserted" as const, record });
        });
      },
      get: (runId: string) => this.#readRunRow(runId),
      listByItem: (input: unknown) => {
        const query = RunItemQuerySchema.parse(input);
        const rows = this.#database.prepare(`
          SELECT record_json FROM tasks WHERE workflow = ? AND item_id = ? ORDER BY created_at, record_key
        `).all(query.workflow, query.itemId);
        return Object.freeze(rows.map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json)));
      },
      listByWorker: (workerId: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM tasks WHERE owner_worker_id = ? ORDER BY created_at, record_key
        `).all(WorkerIdSchema.parse(workerId));
        return Object.freeze(rows.map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json)));
      },
      listChildren: (parentRunId: string) => {
        const rows = this.#database.prepare(`
          SELECT record_json FROM tasks WHERE parent_run_id = ? ORDER BY created_at, record_key
        `).all(RunIdSchema.parse(parentRunId));
        return Object.freeze(rows.map((row) => parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json)));
      },
      claimNext: (input: unknown) => {
        const request = RunClaimRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          // One worker, one active item (doc 05 §0.3). A worker asking for a
          // second row is a bug in the loop, not a state to serve — and serving
          // it would put two runs and two browser-session sets under one owner.
          const held = HeldRunRowSchema.parse(this.#database.prepare(`
            SELECT record_key AS run_id FROM tasks
            WHERE owner_worker_id = ? AND state IN ('claimed', 'validating', 'running')
            LIMIT 1
          `).get(request.workerId) ?? { run_id: null });
          if (held.run_id !== null) {
            throw new Error(`worker ${request.workerId} already holds active run ${held.run_id}`);
          }
          const row = this.#database.prepare(`
            SELECT record_json FROM tasks
            WHERE workflow = ? AND state = 'queued'
              AND (not_before IS NULL OR not_before <= ?)
            ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END, created_at, record_key
            LIMIT 1
          `).get(request.workflow, request.now);
          if (row === undefined) {
            const deferred = NextEligibleRowSchema.parse(this.#database.prepare(`
              SELECT min(not_before) AS next_eligible_at FROM tasks
              WHERE workflow = ? AND state = 'queued' AND not_before > ?
            `).get(request.workflow, request.now));
            if (deferred.next_eligible_at === null) return RunClaimOutcomeSchema.parse({ state: "idle" });
            return RunClaimOutcomeSchema.parse({ state: "deferred", nextEligibleAt: deferred.next_eligible_at });
          }
          const current = parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json);
          const claimed = RunRecordSchema.parse({
            ...current,
            lifecycle: {
              state: "claimed",
              workerId: request.workerId,
              claimedAt: request.now,
              heartbeatAt: request.now,
            },
            claimGeneration: current.claimGeneration + 1,
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeRunRow(claimed, "update");
          return RunClaimOutcomeSchema.parse({ state: "claimed", run: claimed });
        });
      },
      renewClaim: (input: unknown) => {
        const request = RunHeartbeatRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const current = this.#readRunRow(request.runId);
          if (current === undefined) throw new Error(`run ${request.runId} does not exist`);
          const held = runClaim(current);
          if (held === undefined
            || held.workerId !== request.claim.workerId
            || held.claimGeneration !== request.claim.claimGeneration) {
            return RunHeartbeatOutcomeSchema.parse({
              state: "lost",
              message: `run ${request.runId} is ${current.lifecycle.state} at claim generation `
                + `${String(current.claimGeneration)}; ${request.claim.workerId} held generation `
                + `${String(request.claim.claimGeneration)}`,
            });
          }
          const renewed = RunRecordSchema.parse({
            ...current,
            lifecycle: { ...current.lifecycle, heartbeatAt: request.now },
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeRunRow(renewed, "update");
          return RunHeartbeatOutcomeSchema.parse({ state: "renewed", run: renewed });
        });
      },
      transition: (input: unknown) => {
        const request = RunTransitionRequestSchema.parse(input);
        if (request.lifecycle.state === "terminal"
          && (request.lifecycle.outcome === "done" || request.lifecycle.outcome === "failed")) {
          throw new Error(
            `run ${request.runId} outcome ${request.lifecycle.outcome} requires atomic terminal authority`,
          );
        }
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          request.claim,
          (current) => RunRecordSchema.parse({ ...current, lifecycle: request.lifecycle }),
        );
      },
      requeue: (input: unknown) => {
        const request = RunRequeueRequestSchema.parse(input);
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          request.claim,
          (current) => RunRecordSchema.parse({
            ...current,
            // A new attempt drops every single-resume affordance: a freshness
            // override authorized ONE attempt (doc 02 §5.5), and injected
            // patches have already been persisted as checkpoints by the
            // executor that applied them.
            envelope: nextAttemptEnvelope(current.envelope),
            lifecycle: {
              state: "queued",
              requeuedFrom: request.cause,
              ...(request.notBefore === undefined ? {} : { notBefore: request.notBefore }),
            },
          }),
        );
      },
      resume: (input: unknown) => {
        const request = RunResumeRequestSchema.parse(input);
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          undefined,
          (current) => {
            if (current.lifecycle.state !== "parked-gate" && current.lifecycle.state !== "parked-write") {
              throw new Error(`run ${request.runId} is ${current.lifecycle.state}; only a parked run resumes`);
            }
            return RunRecordSchema.parse({
              ...current,
              envelope: { ...current.envelope, startAt: request.startAt },
              lifecycle: { state: "queued" },
            });
          },
        );
      },
      updatePresentation: (input: unknown) => {
        const request = RunPresentationRequestSchema.parse(input);
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          undefined,
          (current) => RunRecordSchema.parse({
            ...current,
            ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
            ...(request.hidden === undefined ? {} : { hidden: request.hidden }),
          }),
        );
      },
      bumpPriority: (input: unknown) => {
        const request = RunPriorityBumpRequestSchema.parse(input);
        return this.#mutateRun(
          request.runId,
          request.expectedVersion,
          request.now,
          undefined,
          (current) => {
            if (current.lifecycle.state !== "queued") {
              throw new Error(
                `run ${request.runId} is ${current.lifecycle.state}; only a queued run's claim order can be bumped`,
              );
            }
            return RunRecordSchema.parse({
              ...current,
              envelope: { ...current.envelope, priority: "interactive" },
            });
          },
        );
      },
      sweepExpiredClaims: (input: unknown) => {
        const request = RunClaimSweepRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const rows = request.workflow === undefined
            ? this.#database.prepare(`
              SELECT record_json FROM tasks
              WHERE state IN ('claimed', 'validating', 'running') AND heartbeat_at < ?
              ORDER BY heartbeat_at, record_key
            `).all(request.staleBefore)
            : this.#database.prepare(`
              SELECT record_json FROM tasks
              WHERE state IN ('claimed', 'validating', 'running') AND heartbeat_at < ? AND workflow = ?
              ORDER BY heartbeat_at, record_key
            `).all(request.staleBefore, request.workflow);
          const outcomes: z.infer<typeof RunClaimSweepOutcomeSchema>[] = [];
          for (const row of rows) {
            const current = parseJsonRecord(RunRecordSchema, JsonRowSchema.parse(row).record_json);
            // D118 (doc 05 §3): before any queued/claimable transition, check
            // the authoritative write-intent set for this logical item. An
            // unfinished `attempting` intent means a write may have landed —
            // the run routes to doc 09 recovery, never to ordinary requeue.
            // The lookup runs inside this same transaction; if it throws, the
            // whole sweep unwinds rather than defaulting to "no unfinished
            // write".
            const intents = this.#database.prepare(`
              SELECT record_json FROM write_intents
              WHERE status = 'attempting'
                AND json_extract(record_json, '$.workflowId') = ?
                AND json_extract(record_json, '$.itemId') = ?
              ORDER BY record_key
            `).all(current.envelope.workflow, current.envelope.itemId);
            const attempting = intents.map((intentRow) =>
              parseJsonRecord(WriteIntentRecordSchema, JsonRowSchema.parse(intentRow).record_json));
            const unfinished = attempting[0];
            if (unfinished !== undefined) {
              if (unfinished.status !== "attempting") {
                throw new Error(
                  `write intent ${unfinished.writeIntentId} matched the attempting scan as ${unfinished.status}; `
                  + "the intent index is inconsistent and the sweep refuses to requeue over it",
                );
              }
              const message = `run ${current.envelope.runId} (${current.envelope.workflow}) has an unfinished `
                + `attempting write intent ${unfinished.writeIntentId} (generation `
                + `${String(unfinished.generation)}, task ${unfinished.taskId}); doc 09 recovery must settle it `
                + "before this run can be released";
              if (current.lifecycle.state === "running") {
                const parked = RunRecordSchema.parse({
                  ...current,
                  lifecycle: {
                    state: "parked-write",
                    writeIntentId: unfinished.writeIntentId,
                    intentGeneration: unfinished.generation,
                    parkedAt: request.now,
                    code: "unknown",
                    message,
                  },
                  version: current.version + 1,
                  updatedAt: request.now,
                });
                const violation = runTransitionViolation(current.lifecycle, parked.lifecycle);
                if (violation !== undefined) {
                  throw new Error(`run ${current.envelope.runId}: ${violation}`);
                }
                this.#writeRunRow(parked, "update");
                outcomes.push(RunClaimSweepOutcomeSchema.parse({
                  state: "recovery-required",
                  run: parked,
                  writeIntentId: unfinished.writeIntentId,
                  intentGeneration: unfinished.generation,
                  parked: true,
                  message,
                }));
                continue;
              }
              // A claimed/validating row has no legal parked-write edge; it
              // stays under its expired claim — unclaimable, loud in the
              // report — until recovery resolves the intent.
              outcomes.push(RunClaimSweepOutcomeSchema.parse({
                state: "recovery-required",
                run: current,
                writeIntentId: unfinished.writeIntentId,
                intentGeneration: unfinished.generation,
                parked: false,
                message,
              }));
              continue;
            }
            const requeued = RunRecordSchema.parse({
              ...current,
              envelope: nextAttemptEnvelope(current.envelope),
              lifecycle: { state: "queued", requeuedFrom: "recovery" },
              version: current.version + 1,
              updatedAt: request.now,
            });
            this.#writeRunRow(requeued, "update");
            outcomes.push(RunClaimSweepOutcomeSchema.parse({ state: "requeued", run: requeued }));
          }
          return Object.freeze(outcomes);
        });
      },
    });
  }

  #readProviderCounter(capability: string): ProviderBudgetCounter | undefined {
    return this.#readRecord(
      "provider_budget_counters",
      ProviderCapabilityIdSchema.parse(capability),
      ProviderBudgetCounterSchema,
    );
  }

  #writeProviderCounter(record: ProviderBudgetCounter, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("provider_budget_counters", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO provider_budget_counters (
            record_key, capability, minute_window_started_at, minute_requests,
            day_window_started_at, day_requests, day_reserved_cost_usd_micros,
            active_reservations, blocked_by_admission_id, version, record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.capability, record.capability, record.minuteWindowStartedAt,
          record.minuteRequests, record.dayWindowStartedAt, record.dayRequests,
          record.dayReservedCostUsdMicros, record.activeReservations,
          record.blockedByAdmissionId ?? null, record.version, json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE provider_budget_counters SET
            minute_window_started_at = ?, minute_requests = ?,
            day_window_started_at = ?, day_requests = ?,
            day_reserved_cost_usd_micros = ?, active_reservations = ?,
            blocked_by_admission_id = ?, version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `).run(
          record.minuteWindowStartedAt, record.minuteRequests,
          record.dayWindowStartedAt, record.dayRequests,
          record.dayReservedCostUsdMicros, record.activeReservations,
          record.blockedByAdmissionId ?? null, record.version, json,
          record.capability, record.version - 1,
        );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) {
        throw new Error(`provider counter ${record.capability} ${mode} affected ${String(changes)} rows`);
      }
      return { result: undefined, changes };
    });
  }

  #writeProviderAdmission(record: ProviderAdmissionRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    const lifecycle = record.lifecycle;
    const actualCost = lifecycle.state === "settled" ? lifecycle.actualUsage.costUsdMicros : null;
    const leaseExpiresAt = lifecycle.state === "reserved" ? lifecycle.leaseExpiresAt : null;
    const deadlineAt = lifecycle.state === "reserved" ? lifecycle.deadlineAt : null;
    this.#authorityWrite("provider_admissions", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO provider_admissions (
            record_key, run_id, capability, config_snapshot_id, config_fingerprint,
            request_fingerprint, state, reserved_cost_usd_micros,
            actual_cost_usd_micros, lease_expires_at, deadline_at, version,
            record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.admissionId, record.execution.runId, record.capability,
          record.configSnapshotId, record.configFingerprint, record.requestFingerprint,
          lifecycle.state, record.reservation.maximumCostUsdMicros, actualCost,
          leaseExpiresAt, deadlineAt, record.version, json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE provider_admissions SET
            state = ?, actual_cost_usd_micros = ?, lease_expires_at = ?,
            deadline_at = ?, version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `).run(
          lifecycle.state, actualCost, leaseExpiresAt, deadlineAt,
          record.version, json, record.admissionId, record.version - 1,
        );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) {
        throw new Error(`provider admission ${record.admissionId} ${mode} affected ${String(changes)} rows`);
      }
      return { result: undefined, changes };
    });
  }

  #providerAdmissionContext(request: z.infer<typeof ProviderAdmissionReserveRequestSchema>
    | z.infer<typeof ProviderAdmissionDenyRequestSchema>): ConfigSnapshotRecord {
    const run = this.#readRunRow(request.execution.runId);
    if (run === undefined) throw new Error(`provider admission run ${request.execution.runId} does not exist`);
    if (run.envelope.attempt !== request.execution.attempt
      || run.envelope.configSnapshotId !== request.configSnapshotId
      || run.envelope.configFingerprint !== request.configFingerprint) {
      throw new Error(`provider admission ${request.admissionId} does not match run ${request.execution.runId} execution/config identity`);
    }
    if (run.lifecycle.state !== "running" || run.lifecycle.currentNodeId !== request.execution.nodeId) {
      throw new Error(`provider admission ${request.admissionId} run ${request.execution.runId} is not executing node ${request.execution.nodeId}`);
    }
    const snapshot = this.#readRecord(
      "config_snapshots",
      request.configSnapshotId,
      ConfigSnapshotRecordSchema,
    );
    if (snapshot === undefined) throw new Error(`provider config snapshot ${request.configSnapshotId} does not exist`);
    if (snapshot.fingerprint !== request.configFingerprint) {
      throw new Error(`provider config snapshot ${request.configSnapshotId} fingerprint mismatch`);
    }
    return snapshot;
  }

  #assertProviderAdmissionRequestMatches(
    existing: ProviderAdmissionRecord,
    request: z.infer<typeof ProviderAdmissionReserveRequestSchema>
      | z.infer<typeof ProviderAdmissionDenyRequestSchema>,
  ): void {
    const expected = {
      admissionId: request.admissionId,
      execution: request.execution,
      capability: request.capability,
      configSnapshotId: request.configSnapshotId,
      configFingerprint: request.configFingerprint,
      requestFingerprint: request.requestFingerprint,
      estimate: request.estimate,
    };
    const actual = {
      admissionId: existing.admissionId,
      execution: existing.execution,
      capability: existing.capability,
      configSnapshotId: existing.configSnapshotId,
      configFingerprint: existing.configFingerprint,
      requestFingerprint: existing.requestFingerprint,
      estimate: existing.estimate,
    };
    if (canonicalJsonStringify(actual) !== canonicalJsonStringify(expected)) {
      throw new Error(`provider admission id ${request.admissionId} was reused with different content`);
    }
  }

  #createProviderCounter(capability: z.infer<typeof ProviderCapabilityIdSchema>, now: string): ProviderBudgetCounter {
    const record = ProviderBudgetCounterSchema.parse({
      capability,
      minuteWindowStartedAt: fixedUtcMinuteStart(now),
      minuteRequests: 0,
      dayWindowStartedAt: fixedUtcDayStart(now),
      dayRequests: 0,
      dayReservedCostUsdMicros: 0,
      activeReservations: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    this.#writeProviderCounter(record, "insert");
    return record;
  }

  #rollProviderCounter(counter: ProviderBudgetCounter, now: string): ProviderBudgetCounter {
    const minuteWindowStartedAt = fixedUtcMinuteStart(now);
    const dayWindowStartedAt = fixedUtcDayStart(now);
    const minuteRolled = minuteWindowStartedAt !== counter.minuteWindowStartedAt;
    const dayRolled = dayWindowStartedAt !== counter.dayWindowStartedAt;
    if (!minuteRolled && !dayRolled) return counter;
    const rolled = ProviderBudgetCounterSchema.parse({
      ...counter,
      minuteWindowStartedAt,
      minuteRequests: minuteRolled ? 0 : counter.minuteRequests,
      dayWindowStartedAt,
      dayRequests: dayRolled ? 0 : counter.dayRequests,
      dayReservedCostUsdMicros: dayRolled ? 0 : counter.dayReservedCostUsdMicros,
      ...(dayRolled ? { blockedByAdmissionId: undefined } : {}),
      version: counter.version + 1,
      updatedAt: now,
    });
    this.#writeProviderCounter(rolled, "update");
    return rolled;
  }

  #expireProviderLeases(counter: ProviderBudgetCounter, now: string): {
    readonly counter: ProviderBudgetCounter;
    readonly expired: readonly ProviderAdmissionRecord[];
  } {
    const rows = this.#database.prepare(`
      SELECT record_json FROM provider_admissions
      WHERE capability = ? AND state = 'reserved' AND lease_expires_at <= ?
      ORDER BY lease_expires_at, record_key
    `).all(counter.capability, now);
    if (rows.length === 0) return { counter, expired: Object.freeze([]) };
    const expired: ProviderAdmissionRecord[] = [];
    for (const row of rows) {
      const current = parseJsonRecord(
        ProviderAdmissionRecordSchema,
        JsonRowSchema.parse(row).record_json,
      );
      const record = ProviderAdmissionRecordSchema.parse({
        ...current,
        lifecycle: {
          state: "lease-expired",
          expiredAt: now,
          accounting: "full-reservation-retained",
        },
        version: current.version + 1,
        updatedAt: now,
      });
      this.#writeProviderAdmission(record, "update");
      expired.push(record);
    }
    if (counter.activeReservations < expired.length) {
      throw new Error(`provider counter ${counter.capability} cannot release ${String(expired.length)} expired leases from ${String(counter.activeReservations)} active reservations`);
    }
    const updated = ProviderBudgetCounterSchema.parse({
      ...counter,
      activeReservations: counter.activeReservations - expired.length,
      version: counter.version + 1,
      updatedAt: now,
    });
    this.#writeProviderCounter(updated, "update");
    return { counter: updated, expired: Object.freeze(expired) };
  }

  #prepareProviderCounter(capability: z.infer<typeof ProviderCapabilityIdSchema>, now: string): ProviderBudgetCounter {
    const initial = this.#readProviderCounter(capability) ?? this.#createProviderCounter(capability, now);
    const expired = this.#expireProviderLeases(initial, now).counter;
    return this.#rollProviderCounter(expired, now);
  }

  #providerBudgetDenial(
    counter: ProviderBudgetCounter,
    budget: ProviderBudget,
    estimate: number,
  ): z.infer<typeof ProviderUnavailableReasonSchema> | undefined {
    if (counter.activeReservations >= budget.concurrency) {
      const row = this.#database.prepare(`
        SELECT MIN(lease_expires_at) AS next_eligible_at FROM provider_admissions
        WHERE capability = ? AND state = 'reserved'
      `).get(counter.capability);
      const retryAt = NextEligibleRowSchema.parse(row).next_eligible_at;
      if (retryAt === null) throw new Error(`provider counter ${counter.capability} reports exhausted concurrency without an active lease`);
      return ProviderUnavailableReasonSchema.parse({
        code: "concurrency-exhausted",
        message: `${counter.capability} concurrency is exhausted`,
        retryAt,
      });
    }
    if (counter.minuteRequests >= budget.requestsPerMinute) {
      return ProviderUnavailableReasonSchema.parse({
        code: "rate-exhausted",
        message: `${counter.capability} fixed UTC-minute request budget is exhausted`,
        retryAt: nextFixedWindow(counter.minuteWindowStartedAt, 60_000),
      });
    }
    if (counter.dayRequests >= budget.dailyRequestLimit) {
      return ProviderUnavailableReasonSchema.parse({
        code: "daily-request-exhausted",
        message: `${counter.capability} fixed UTC-day request budget is exhausted`,
        retryAt: nextFixedWindow(counter.dayWindowStartedAt, 86_400_000),
      });
    }
    if (counter.blockedByAdmissionId !== undefined
      || counter.dayReservedCostUsdMicros + estimate > budget.costLimitUsdMicros) {
      return ProviderUnavailableReasonSchema.parse({
        code: "daily-cost-exhausted",
        message: counter.blockedByAdmissionId === undefined
          ? `${counter.capability} fixed UTC-day cost budget is exhausted`
          : `${counter.capability} admission ${counter.blockedByAdmissionId} breached its maximum cost estimate`,
        retryAt: nextFixedWindow(counter.dayWindowStartedAt, 86_400_000),
      });
    }
    return undefined;
  }

  #newProviderAdmission(
    request: z.infer<typeof ProviderAdmissionReserveRequestSchema>
      | z.infer<typeof ProviderAdmissionDenyRequestSchema>,
    snapshot: ConfigSnapshotRecord,
    lifecycle: ProviderAdmissionRecord["lifecycle"],
  ): ProviderAdmissionRecord {
    const budget = providerBudget(snapshot.config, request.capability);
    return ProviderAdmissionRecordSchema.parse({
      admissionId: request.admissionId,
      execution: request.execution,
      capability: request.capability,
      configSnapshotId: request.configSnapshotId,
      configFingerprint: request.configFingerprint,
      requestFingerprint: request.requestFingerprint,
      budget,
      estimate: request.estimate,
      reservation: { requestCount: 1, maximumCostUsdMicros: request.estimate.maximumCostUsdMicros },
      lifecycle,
      version: 1,
      createdAt: request.now,
      updatedAt: request.now,
    });
  }

  #buildProviderAdmissionRepository(): ProviderAdmissionRepository {
    return Object.freeze({
      reserve: (input: unknown) => {
        const request = ProviderAdmissionReserveRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const existing = this.#readRecord(
            "provider_admissions",
            request.admissionId,
            ProviderAdmissionRecordSchema,
          );
          if (existing !== undefined) {
            this.#assertProviderAdmissionRequestMatches(existing, request);
            return ProviderAdmissionReserveOutcomeSchema.parse({ state: "existing", admission: existing });
          }
          const snapshot = this.#providerAdmissionContext(request);
          let counter = this.#prepareProviderCounter(request.capability, request.now);
          const budget = providerBudget(snapshot.config, request.capability);
          const denial = this.#providerBudgetDenial(
            counter,
            budget,
            request.estimate.maximumCostUsdMicros,
          );
          if (denial !== undefined) {
            const admission = this.#newProviderAdmission(request, snapshot, {
              state: "denied", deniedAt: request.now, reason: denial,
            });
            this.#writeProviderAdmission(admission, "insert");
            return ProviderAdmissionReserveOutcomeSchema.parse({ state: "denied", admission, counter });
          }
          counter = ProviderBudgetCounterSchema.parse({
            ...counter,
            minuteRequests: counter.minuteRequests + 1,
            dayRequests: counter.dayRequests + 1,
            dayReservedCostUsdMicros:
              counter.dayReservedCostUsdMicros + request.estimate.maximumCostUsdMicros,
            activeReservations: counter.activeReservations + 1,
            version: counter.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderCounter(counter, "update");
          const admission = this.#newProviderAdmission(request, snapshot, {
            state: "reserved",
            reservedAt: request.now,
            leaseExpiresAt: request.leaseExpiresAt,
            deadlineAt: request.deadlineAt,
          });
          this.#writeProviderAdmission(admission, "insert");
          return ProviderAdmissionReserveOutcomeSchema.parse({ state: "reserved", admission, counter });
        });
      },
      deny: (input: unknown) => {
        const request = ProviderAdmissionDenyRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const existing = this.#readRecord(
            "provider_admissions",
            request.admissionId,
            ProviderAdmissionRecordSchema,
          );
          if (existing !== undefined) {
            this.#assertProviderAdmissionRequestMatches(existing, request);
            if (existing.lifecycle.state !== "denied"
              || canonicalJsonStringify(existing.lifecycle.reason) !== canonicalJsonStringify(request.reason)) {
              throw new Error(`provider admission id ${request.admissionId} was reused with a different denial`);
            }
            return ProviderAdmissionReserveOutcomeSchema.parse({ state: "existing", admission: existing });
          }
          const snapshot = this.#providerAdmissionContext(request);
          const counter = this.#prepareProviderCounter(request.capability, request.now);
          const admission = this.#newProviderAdmission(request, snapshot, {
            state: "denied", deniedAt: request.now, reason: request.reason,
          });
          this.#writeProviderAdmission(admission, "insert");
          return ProviderAdmissionReserveOutcomeSchema.parse({ state: "denied", admission, counter });
        });
      },
      settle: (input: unknown) => {
        const request = ProviderAdmissionSettleRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const current = this.#readRecord(
            "provider_admissions", request.admissionId, ProviderAdmissionRecordSchema,
          );
          if (current === undefined) throw new Error(`provider admission ${request.admissionId} does not exist`);
          let counter = this.#prepareProviderCounter(current.capability, request.now);
          if (current.lifecycle.state === "settled") {
            const exact = current.version === request.expectedVersion + 1
              && current.lifecycle.adapterDisposition === request.adapterDisposition
              && canonicalJsonStringify(current.lifecycle.actualUsage) === canonicalJsonStringify(request.actualUsage)
              && canonicalJsonStringify(current.lifecycle.evidence) === canonicalJsonStringify(request.evidence)
              && current.lifecycle.settledAt === request.now;
            if (!exact) throw new Error(`provider admission ${request.admissionId} settlement replay differs from durable content`);
            return ProviderAdmissionMutationOutcomeSchema.parse({ admission: current, counter });
          }
          if (current.lifecycle.state !== "reserved" || current.version !== request.expectedVersion) {
            throw new Error(`provider admission ${request.admissionId} is ${current.lifecycle.state} at version ${String(current.version)}`);
          }
          if (request.actualUsage.costUsdMicros > current.estimate.maximumCostUsdMicros) {
            throw new Error(`provider admission ${request.admissionId} actual cost exceeds its conservative maximum estimate`);
          }
          const sameDay = fixedUtcDayStart(current.lifecycle.reservedAt) === counter.dayWindowStartedAt;
          if (counter.activeReservations < 1) throw new Error(`provider counter ${current.capability} has no active reservation to settle`);
          counter = ProviderBudgetCounterSchema.parse({
            ...counter,
            activeReservations: counter.activeReservations - 1,
            dayReservedCostUsdMicros: sameDay
              ? counter.dayReservedCostUsdMicros
                - (current.estimate.maximumCostUsdMicros - request.actualUsage.costUsdMicros)
              : counter.dayReservedCostUsdMicros,
            version: counter.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderCounter(counter, "update");
          const admission = ProviderAdmissionRecordSchema.parse({
            ...current,
            lifecycle: {
              state: "settled",
              settledAt: request.now,
              adapterDisposition: request.adapterDisposition,
              actualUsage: request.actualUsage,
              evidence: request.evidence,
            },
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderAdmission(admission, "update");
          return ProviderAdmissionMutationOutcomeSchema.parse({ admission, counter });
        });
      },
      interrupt: (input: unknown) => {
        const request = ProviderAdmissionInterruptRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const current = this.#readRecord(
            "provider_admissions", request.admissionId, ProviderAdmissionRecordSchema,
          );
          if (current === undefined) throw new Error(`provider admission ${request.admissionId} does not exist`);
          let counter = this.#prepareProviderCounter(current.capability, request.now);
          if (current.lifecycle.state === "interrupted") {
            const exact = current.version === request.expectedVersion + 1
              && current.lifecycle.code === request.code
              && current.lifecycle.message === request.message
              && canonicalJsonStringify(current.lifecycle.evidence) === canonicalJsonStringify(request.evidence)
              && current.lifecycle.interruptedAt === request.now;
            if (!exact) throw new Error(`provider admission ${request.admissionId} interruption replay differs from durable content`);
            return ProviderAdmissionMutationOutcomeSchema.parse({ admission: current, counter });
          }
          if (current.lifecycle.state !== "reserved" || current.version !== request.expectedVersion) {
            throw new Error(`provider admission ${request.admissionId} is ${current.lifecycle.state} at version ${String(current.version)}`);
          }
          if (counter.activeReservations < 1) throw new Error(`provider counter ${current.capability} has no active reservation to interrupt`);
          counter = ProviderBudgetCounterSchema.parse({
            ...counter,
            activeReservations: counter.activeReservations - 1,
            ...(request.code === "cost-estimate-breach"
              ? { blockedByAdmissionId: current.admissionId }
              : {}),
            version: counter.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderCounter(counter, "update");
          const admission = ProviderAdmissionRecordSchema.parse({
            ...current,
            lifecycle: {
              state: "interrupted",
              interruptedAt: request.now,
              code: request.code,
              message: request.message,
              accounting: "full-reservation-retained",
              ...(request.evidence === undefined ? {} : { evidence: request.evidence }),
            },
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeProviderAdmission(admission, "update");
          return ProviderAdmissionMutationOutcomeSchema.parse({ admission, counter });
        });
      },
      sweepExpired: (input: unknown) => {
        const request = ProviderAdmissionSweepRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const rows = this.#database.prepare(`
            SELECT record_json FROM provider_budget_counters ORDER BY capability
          `).all();
          const expired: ProviderAdmissionRecord[] = [];
          const counters: ProviderBudgetCounter[] = [];
          for (const row of rows) {
            const initial = parseJsonRecord(
              ProviderBudgetCounterSchema,
              JsonRowSchema.parse(row).record_json,
            );
            const swept = this.#expireProviderLeases(initial, request.now);
            expired.push(...swept.expired);
            counters.push(this.#rollProviderCounter(swept.counter, request.now));
          }
          return ProviderAdmissionSweepOutcomeSchema.parse({ expired, counters });
        });
      },
      get: (admissionId: string) => this.#readRecord(
        "provider_admissions",
        ProviderAdmissionIdSchema.parse(admissionId),
        ProviderAdmissionRecordSchema,
      ),
      getCounter: (capability: string) => this.#readProviderCounter(capability),
    });
  }

  #writeStartPlan(record: StartPlanRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("start_plans", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO start_plans (
            record_key, workflow, consumed_by, expires_at, version, record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.startPlanId, record.workflowId, record.consumedBy?.commandId ?? null,
          record.expiresAt, record.version, json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE start_plans SET consumed_by = ?, expires_at = ?, version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `).run(
          record.consumedBy?.commandId ?? null, record.expiresAt, record.version, json,
          record.startPlanId, record.version - 1,
        );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) throw new Error(`start plan ${record.startPlanId} ${mode} affected ${String(changes)} rows`);
      return { result: undefined, changes };
    });
  }

  #buildStartPlanRepository(): StartPlanRepository {
    return Object.freeze({
      create: (input: unknown) => {
        const record = StartPlanRecordSchema.parse(input);
        if (record.consumedBy !== undefined) {
          throw new Error(`start plan ${record.startPlanId} cannot be created already consumed`);
        }
        const json = canonicalJsonStringify(record);
        return this.withAuthorityTransaction(() => {
          const existing = this.#readRecord("start_plans", record.startPlanId, StartPlanRecordSchema);
          if (existing !== undefined) {
            if (canonicalJsonStringify(existing) !== json) {
              throw new Error(`start plan id ${record.startPlanId} already exists with different content`);
            }
            return Object.freeze({ state: "existing" as const, record: existing });
          }
          this.#writeStartPlan(record, "insert");
          return Object.freeze({ state: "inserted" as const, record });
        });
      },
      get: (startPlanId: string) => this.#readRecord("start_plans", startPlanId, StartPlanRecordSchema),
      consume: (input: unknown) => {
        const request = StartPlanConsumeRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const plan = this.#readRecord("start_plans", request.startPlanId, StartPlanRecordSchema);
          if (plan === undefined) throw new Error(`start plan ${request.startPlanId} does not exist`);
          const mismatched = [
            ["descriptor", plan.descriptorFingerprint, request.descriptorFingerprint],
            ["config", plan.configFingerprint, request.configFingerprint],
            ["ingress schema", plan.ingressSchemaHash, request.ingressSchemaHash],
            ["canonical-input schema", plan.canonicalInputSchemaHash, request.canonicalInputSchemaHash],
            ["input", plan.inputFingerprint, request.inputFingerprint],
          ].find(([, planned, presented]) => planned !== presented);
          if (mismatched !== undefined) {
            return StartPlanConsumeOutcomeSchema.parse({
              state: "refused",
              code: "fingerprint-mismatch",
              message: `start plan ${request.startPlanId} was planned against a different ${String(mismatched[0])}; re-plan before starting`,
            });
          }
          /*
           * Consuming advances the durable record from its confirmation revision
           * by exactly one. A retry must present that original revision so it
           * confirms the same body, while an unconsumed plan uses its current
           * revision normally.
           */
          const confirmationVersion = plan.consumedBy === undefined ? plan.version : plan.version - 1;
          if (request.expectedVersion !== confirmationVersion) {
            return StartPlanConsumeOutcomeSchema.parse({
              state: "refused",
              code: "version-mismatch",
              message: `start plan ${request.startPlanId} confirmation expected revision ${String(confirmationVersion)} but received ${String(request.expectedVersion)}; re-plan before starting`,
            });
          }
          if (plan.consumedBy !== undefined) {
            // The same command retrying is idempotent; a different one is a
            // second start wearing the first confirmation's clothes. This runs
            // only after all immutable confirmation bindings revalidated.
            return StartPlanConsumeOutcomeSchema.parse(plan.consumedBy.commandId === request.commandId
              ? { state: "already-consumed", plan }
              : {
                state: "refused",
                code: "spent",
                message: `start plan ${request.startPlanId} was already consumed by command ${plan.consumedBy.commandId}`,
              });
          }
          if (isStartPlanExpired(plan, Date.parse(request.now))) {
            return StartPlanConsumeOutcomeSchema.parse({
              state: "refused",
              code: "expired",
              message: `start plan ${request.startPlanId} expired at ${plan.expiresAt}`,
            });
          }
          const consumed = StartPlanRecordSchema.parse({
            ...plan,
            consumedBy: { commandId: request.commandId, consumedAt: request.now },
            version: plan.version + 1,
            updatedAt: request.now,
          });
          this.#writeStartPlan(consumed, "update");
          return StartPlanConsumeOutcomeSchema.parse({ state: "consumed", plan: consumed });
        });
      },
    });
  }

  #readWorkerLease(workerId: string): WorkerLeaseRecord | undefined {
    return this.#readRecord("leases", workerId, WorkerLeaseRecordSchema);
  }

  #writeWorkerLease(record: WorkerLeaseRecord, mode: "insert" | "update"): void {
    const json = canonicalJsonStringify(record);
    const heartbeatAt = "heartbeatAt" in record.lifecycle ? record.lifecycle.heartbeatAt : null;
    this.#authorityWrite("leases", () => {
      const result = mode === "insert"
        ? this.#database.prepare(`
          INSERT INTO leases (
            record_key, worker_id, workflow, lease_generation, state, directive,
            heartbeat_at, version, record_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.workerId, record.workerId, record.workflow, record.leaseGeneration,
          record.lifecycle.state, record.control.directive, heartbeatAt, record.version,
          json, record.createdAt,
        )
        : this.#database.prepare(`
          UPDATE leases SET
            workflow = ?, lease_generation = ?, state = ?, directive = ?,
            heartbeat_at = ?, version = ?, record_json = ?
          WHERE record_key = ? AND version = ?
        `).run(
          record.workflow, record.leaseGeneration, record.lifecycle.state,
          record.control.directive, heartbeatAt, record.version, json,
          record.workerId, record.version - 1,
        );
      const changes = sqliteChanges(result.changes);
      if (changes !== 1) throw new Error(`worker lease ${record.workerId} ${mode} affected ${String(changes)} rows`);
      return { result: undefined, changes };
    });
  }

  #buildWorkerLeaseRepository(): WorkerLeaseRepository {
    return Object.freeze({
      start: (input: unknown) => {
        const request = WorkerStartRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const existing = this.#readWorkerLease(request.workerId);
          if (existing !== undefined && isLiveWorker(existing)) {
            return WorkerStartOutcomeSchema.parse({
              state: "conflict",
              lease: existing,
              message: `worker ${request.workerId} already holds a live lease in state ${existing.lifecycle.state}`,
            });
          }
          const lease = WorkerLeaseRecordSchema.parse({
            workerId: request.workerId,
            workflow: request.workflow,
            processId: request.processId,
            leaseGeneration: (existing?.leaseGeneration ?? 0) + 1,
            lifecycle: { state: "starting", startedAt: request.now },
            control: { directive: "run", requestedAt: request.now, requestedBy: request.requestedBy },
            version: (existing?.version ?? 0) + 1,
            createdAt: existing?.createdAt ?? request.now,
            updatedAt: request.now,
          });
          this.#writeWorkerLease(lease, existing === undefined ? "insert" : "update");
          return WorkerStartOutcomeSchema.parse({ state: "started", lease });
        });
      },
      get: (workerId: string) => this.#readWorkerLease(workerId),
      listLive: (workflow?: string) => {
        const states = LIVE_WORKER_STATES.map(() => "?").join(", ");
        const rows = workflow === undefined
          ? this.#database.prepare(`
            SELECT record_json FROM leases WHERE state IN (${states}) ORDER BY record_key
          `).all(...LIVE_WORKER_STATES)
          : this.#database.prepare(`
            SELECT record_json FROM leases WHERE state IN (${states}) AND workflow = ? ORDER BY record_key
          `).all(...LIVE_WORKER_STATES, WorkflowIdSchema.parse(workflow));
        return Object.freeze(rows.map((row) => parseJsonRecord(WorkerLeaseRecordSchema, JsonRowSchema.parse(row).record_json)));
      },
      reportLifecycle: (input: unknown) => {
        const request = WorkerLifecycleRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const current = this.#readWorkerLease(request.workerId);
          if (current === undefined) throw new Error(`worker lease ${request.workerId} does not exist`);
          if (current.leaseGeneration !== request.leaseGeneration) {
            return WorkerUpdateOutcomeSchema.parse({
              state: "conflict",
              currentVersion: current.version,
              message: `worker ${request.workerId} lease generation is ${String(current.leaseGeneration)}, `
                + `not ${String(request.leaseGeneration)}`,
            });
          }
          const updated = WorkerLeaseRecordSchema.parse({
            ...current,
            lifecycle: request.lifecycle,
            // A worker reporting that it has stopped also settles the directive:
            // a stopped lease carrying "run" would read as a worker that should
            // be running and is not.
            control: request.lifecycle.state === "stopped" && current.control.directive === "run"
              ? { ...current.control, directive: "stop", requestedAt: request.now }
              : current.control,
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeWorkerLease(updated, "update");
          return WorkerUpdateOutcomeSchema.parse({ state: "applied", lease: updated });
        });
      },
      control: (input: unknown) => {
        const request = WorkerControlRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const current = this.#readWorkerLease(request.workerId);
          if (current === undefined) throw new Error(`worker lease ${request.workerId} does not exist`);
          if (current.version !== request.expectedVersion) {
            return WorkerUpdateOutcomeSchema.parse({
              state: "conflict",
              currentVersion: current.version,
              message: `worker ${request.workerId} is at version ${String(current.version)}, not ${String(request.expectedVersion)}`,
            });
          }
          const updated = WorkerLeaseRecordSchema.parse({
            ...current,
            control: request.control,
            version: current.version + 1,
            updatedAt: request.now,
          });
          this.#writeWorkerLease(updated, "update");
          return WorkerUpdateOutcomeSchema.parse({ state: "applied", lease: updated });
        });
      },
      sweepExpired: (input: unknown) => {
        const request = WorkerSweepRequestSchema.parse(input);
        return this.withAuthorityTransaction(() => {
          const states = LIVE_WORKER_STATES.map(() => "?").join(", ");
          const rows = this.#database.prepare(`
            SELECT record_json FROM leases
            WHERE state IN (${states}) AND heartbeat_at IS NOT NULL AND heartbeat_at < ?
            ORDER BY record_key
          `).all(...LIVE_WORKER_STATES, request.staleBefore);
          const expired: WorkerLeaseRecord[] = [];
          for (const row of rows) {
            const current = parseJsonRecord(WorkerLeaseRecordSchema, JsonRowSchema.parse(row).record_json);
            const stopped = WorkerLeaseRecordSchema.parse({
              ...current,
              lifecycle: {
                state: "stopped",
                startedAt: current.lifecycle.startedAt,
                stoppedAt: request.now,
                reason: "lease-expired",
              },
              control: { ...current.control, directive: "stop", requestedAt: request.now },
              version: current.version + 1,
              updatedAt: request.now,
            });
            this.#writeWorkerLease(stopped, "update");
            expired.push(stopped);
          }
          return Object.freeze(expired);
        });
      },
    });
  }

  #requireWriteIntent(writeIntentId: string): WriteIntentRecord {
    const current = this.#readRecord("write_intents", writeIntentId, WriteIntentRecordSchema);
    if (current === undefined) throw new Error(`write intent ${writeIntentId} does not exist`);
    return current;
  }

  #requireAttemptBearingWriteIntent(
    writeIntentId: string,
    generation: number,
    expectedVersion: number,
  ): Exclude<WriteIntentRecord, { status: "observed-present" }> {
    const current = this.#requireWriteIntent(writeIntentId);
    if (current.status === "observed-present") {
      throw new Error(`write intent ${writeIntentId} is observed-present; it carries no automation attempt to transition`);
    }
    if (current.generation !== generation) {
      throw new Error(`write intent ${writeIntentId} is at generation ${String(current.generation)}, not ${String(generation)}; the transition is stale`);
    }
    if (current.version !== expectedVersion) {
      throw new Error(`write intent ${writeIntentId} is at version ${String(current.version)}, not ${String(expectedVersion)}; the transition is stale`);
    }
    return current;
  }

  #requireWriteAttempt(writeAttemptId: string): WriteAttemptRecord {
    const attempt = this.#readRecord("write_attempts", writeAttemptId, WriteAttemptRecordSchema);
    if (attempt === undefined) throw new Error(`write attempt ${writeAttemptId} does not exist`);
    return attempt;
  }

  #requireAttemptingWriteAttempt(writeAttemptId: string): WriteAttemptRecord {
    const attempt = this.#requireWriteAttempt(writeAttemptId);
    if (attempt.outcome.state !== "attempting") {
      throw new Error(`write attempt ${writeAttemptId} is ${attempt.outcome.state}; only an attempting attempt may transition`);
    }
    return attempt;
  }

  #findPermanentWriteIntent(system: string, idempotencyKey: string): WriteIntentRecord | undefined {
    const row = this.#database.prepare(`
      SELECT record_json FROM write_intents WHERE system = ? AND idempotency_key = ?
    `).get(system, idempotencyKey);
    if (row === undefined) return undefined;
    return parseJsonRecord(WriteIntentRecordSchema, JsonRowSchema.parse(row).record_json);
  }

  #insertWriteIntent(record: WriteIntentRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("write_intents", () => {
      const existingById = this.#readRecord("write_intents", record.writeIntentId, WriteIntentRecordSchema);
      if (existingById !== undefined) throw new Error(`write intent id ${record.writeIntentId} already exists with a different permanent key`);
      const digestCollision = this.#database.prepare(`
        SELECT system, idempotency_key FROM write_intents WHERE idempotency_key_digest = ?
      `).get(record.idempotencyKeyDigest);
      if (digestCollision !== undefined) {
        throw new Error(`write intent digest ${record.idempotencyKeyDigest} is already bound to a different permanent key`);
      }
      const result = this.#database.prepare(`
        INSERT INTO write_intents (
          record_key, system, idempotency_key, idempotency_key_digest, status, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.writeIntentId,
        record.system,
        record.idempotencyKey,
        record.idempotencyKeyDigest,
        record.status,
        json,
        record.createdAt,
      );
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #insertWriteAttempt(record: WriteAttemptRecord): void {
    const json = canonicalJsonStringify(record);
    this.#authorityWrite("write_attempts", () => {
      const result = this.#database.prepare(`
        INSERT INTO write_attempts (
          record_key, write_intent_id, generation, record_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(record.writeAttemptId, record.writeIntentId, record.generation, json, record.recordedAt);
      return { result: undefined, changes: sqliteChanges(result.changes) };
    });
  }

  #replaceWriteIntent(record: WriteIntentRecord): void {
    const result = this.#database.prepare(`
      UPDATE write_intents
      SET status = ?, record_json = ?
      WHERE record_key = ? AND idempotency_key_digest = ?
    `).run(record.status, canonicalJsonStringify(record), record.writeIntentId, record.idempotencyKeyDigest);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`write intent ${record.writeIntentId} atomic state update affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #replaceWriteAttempt(record: WriteAttemptRecord): void {
    const result = this.#database.prepare(`
      UPDATE write_attempts SET record_json = ?
      WHERE record_key = ? AND write_intent_id = ? AND generation = ?
    `).run(canonicalJsonStringify(record), record.writeAttemptId, record.writeIntentId, record.generation);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`write attempt ${record.writeAttemptId} atomic state update affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #insertDurableOutbox(record: z.infer<typeof AtomicOutboxRecordSchema>): void {
    const json = canonicalJsonStringify(record);
    const result = this.#database.prepare(`
      INSERT INTO durable_outbox (
        record_key, write_intent_id, generation, kind, record_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(record.outboxId, record.aggregate.writeIntentId, record.aggregate.generation, record.payload.kind, json, record.createdAt);
    const changes = sqliteChanges(result.changes);
    if (changes !== 1) throw new Error(`durable outbox ${record.outboxId} insertion affected ${String(changes)} rows`);
    this.#authorityDirty = true;
  }

  #assertAtomicCommitMatchesIntent(
    input: z.infer<typeof AtomicWriteCommitInputSchema>,
    intent: Extract<WriteIntentRecord, { status: "attempting" }>,
  ): void {
    const ledger = input.ledgerOutbox.payload;
    const span = input.terminalSpanOutbox.payload;
    if (ledger.kind !== "ledger-entry" || span.kind !== "write-committed-span" || input.outcome.disposition !== "committed") {
      throw new Error("atomic write commit payload arms were not narrowed after strict parsing");
    }
    const expected = {
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
      workflowId: intent.workflowId,
      itemId: intent.itemId,
      system: intent.system,
      idempotencyKey: intent.idempotencyKey,
      idempotencyKeyDigest: intent.idempotencyKeyDigest,
      bindingProofDigest: intent.bindingProofDigest,
      runId: intent.runId,
      attempt: intent.runAttempt,
    };
    for (const [field, value] of Object.entries(expected)) {
      const ledgerValue = ledger.entry[field as keyof typeof ledger.entry];
      const spanValue = span[field as keyof typeof span];
      if (ledgerValue !== value || spanValue !== value) {
        throw new Error(`atomic write outboxes ${field} do not match intent ${intent.writeIntentId}`);
      }
    }
    if (ledger.entry.fencedAt !== intent.fencedAt
      || ledger.entry.confirmedAt !== input.confirmedAt
      || ledger.entry.proofSource !== input.outcome.proofSource
      || span.occurredAt !== input.confirmedAt
      || canonicalJsonStringify(ledger.entry.proof) !== canonicalJsonStringify(input.completionProof)) {
      throw new Error(`atomic write outboxes do not match proof/timing for intent ${intent.writeIntentId}`);
    }
    if (ledger.entry.traceId !== span.traceId) {
      throw new Error(`atomic write outboxes do not share trace identity for intent ${intent.writeIntentId}`);
    }
    if (intent.bindingProof.kind === "subject-match") {
      if (ledger.entry.subject.state !== "present"
        || canonicalJsonStringify(ledger.entry.subject.value) !== canonicalJsonStringify(intent.bindingProof.expected)) {
        throw new Error(`ledger subject does not match the fenced binding proof for intent ${intent.writeIntentId}`);
      }
    } else if (ledger.entry.subject.state !== "absent") {
      throw new Error(`ledger subject must be absent for unscoped binding proof on intent ${intent.writeIntentId}`);
    }
    if (input.ledgerOutbox.projection.state !== "pending"
      || input.terminalSpanOutbox.projection.state !== "pending"
      || input.ledgerOutbox.createdAt !== input.confirmedAt
      || input.terminalSpanOutbox.createdAt !== input.confirmedAt) {
      throw new Error(`atomic write outboxes must begin pending at confirmation time for intent ${intent.writeIntentId}`);
    }
  }

  #buildProjectionRepositories(): ProjectionRepositories {
    const repository = (table: ProjectionTableName): ProjectionRepository => Object.freeze({
      upsert: (input: unknown) => {
        const record = ProjectionStorageRecordSchema.parse(input);
        return this.#projectionWrite(table, () => {
          this.#database.prepare(`
            INSERT INTO ${table} (record_key, record_json, created_at) VALUES (?, ?, ?)
            ON CONFLICT(record_key) DO UPDATE SET
              record_json = excluded.record_json,
              created_at = excluded.created_at
          `).run(record.projectionKey, canonicalJsonStringify(record), record.updatedAt);
          return record;
        });
      },
      get: (projectionKey: string) => this.#readRecord(table, projectionKey, ProjectionStorageRecordSchema),
      clear: () => this.#projectionWrite(table, () => {
        const result = this.#database.prepare(`DELETE FROM ${table}`).run();
        return sqliteChanges(result.changes);
      }),
    });
    return Object.freeze({
      spans: repository("spans"),
      gates: repository("gates"),
      notes: repository("notes"),
      runsView: repository("runs_view"),
    });
  }
}
