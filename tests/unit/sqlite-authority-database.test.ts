import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { AUTHORITY_TABLE_REGISTRY, type AuthorityTableName } from "../../src/domain/authority.js";
import { buildRunResult } from "../../src/core/run-result.js";
import { manualClock } from "../../src/domain/clock.js";
import {
  CommandRequestSchema,
  deriveBulkRunCommandFingerprint,
  deriveSettingsCommandFingerprint,
  markSettingsCommand,
} from "../../src/domain/commands.js";
import { derivePersistedSettingsFingerprint } from "../../src/domain/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../src/domain/config/protected-settings.js";
import { ReadActiveStatus } from "../../src/domain/contracts/person-lookup/read-active-status.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { OPERATOR_XLSX_MEDIA_TYPE } from "../../src/domain/dashboard/xlsx-export.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../src/domain/ids.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { deriveIdempotencyKeyDigest } from "../../src/domain/write-safety.js";
import { createActivityPersonPseudonymDomain } from "../../src/domain/trust/activity-person-pseudonym.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
  requiresStoppedSystemAuthorityUpgrade,
} from "../../src/infra/sqlite/migrations.js";
import {
  COMMAND_FIXTURES,
  ATOMIC_WRITE_COMMIT,
  CONFIG_SNAPSHOT,
  DELEGATION_MANIFEST,
  DEPENDENCY_RECORD,
  GATE_RESULT,
  HASH_A,
  HASH_B,
  HASH_C,
  IDEMPOTENCY_KEY,
  LATER,
  NOTIFICATION,
  NOW,
  UUID_1,
  UUID_2,
  UUID_3,
  UUID_4,
  UUID_5,
  UUID_6,
  UUID_7,
  UUID_8,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "../fixtures/phase1c-contract-fixtures.js";
import {
  QUEUED_RUN,
  RUN_ID,
  RUN_SESSION,
  START_PLAN,
  WORKER_ID,
  WORKER_START_REQUEST,
  WORKFLOW_ID,
} from "../fixtures/phase1f-run-fixtures.js";
import {
  ARCHIVE_RELAUNCH,
  ARCHIVED_RUN,
  VERSION_BUMP_APPLICATION,
  VERSION_PLAN_ROW,
} from "../fixtures/archive-fixtures.js";
import {
  ACTIVITY_PERSON_PSEUDONYM_KEY_HEX,
  seedTerminalSeparationsResult,
  TERMINAL_SEPARATIONS_RUN,
} from "./fixtures/activity-person-pseudonym-fixtures.js";
import { compositionQueuedRun } from "../helpers/separations-composition-fixtures.js";
import { DCC4_SUPERSEDED_V19_MIGRATION } from "./fixtures/dcc4-superseded-migration.js";
import { PersonLookupCanonicalInput } from "../../src/workflows/person-lookup/workflow.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";
import { withAuthorityBuildVariant } from "./fixtures/authority-build-variant.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const databasePaths = new WeakMap<AuthorityDatabase, string>();
const CLOCK = manualClock(new Date(NOW));
const SCHEMA_BOUND_VALUE = { schemaHash: HASH_A, value: { verified: true } };
const OPAQUE_RECORD = { recordId: UUID_8, payload: SCHEMA_BOUND_VALUE, createdAt: NOW };
/** A second logical item, so the relaunched run is not a duplicate of its source. */
const RELAUNCH_ITEM_ID = UUID_7;
const BULK_COMMAND_REQUEST = {
  commandId: UUID_8,
  requestedAt: NOW,
  requestedBy: "local-operator",
  source: "dashboard",
  family: "run",
  type: "cancel",
  bulkCommandId: UUID_8,
  targets: [{ runId: RUN_ID, expectedVersion: 1 }],
  mode: "best-effort",
} as const;
const BULK_COMMAND_ACCEPTANCE = {
  bulkCommandId: UUID_8,
  requestFingerprint: deriveBulkRunCommandFingerprint(BULK_COMMAND_REQUEST),
  request: BULK_COMMAND_REQUEST,
};

const ARTIFACT_OUTBOX = {
  outboxId: UUID_7,
  artifactId: UUID_8,
  projectionId: "retention-record",
  stableKeyFingerprint: HASH_B,
  keyValues: [{ field: "subject.eid", value: "10456712" }],
  sinkId: "xlsx-retention",
  sourceRunId: UUID_2,
  sourceNodeId: "extract",
  state: "pending",
  payload: SCHEMA_BOUND_VALUE,
  createdAt: NOW,
};
const ARTIFACT_SINK_HEAD_REQUEST = {
  sinkId: "xlsx-retention",
  contentSha256: HASH_C,
  lastOutboxId: UUID_7,
  projectedAt: NOW,
};
const PROJECTION_RECORD = { projectionKey: HASH_A, payload: SCHEMA_BOUND_VALUE, updatedAt: NOW };
const OPERATOR_XLSX_EXPORT = {
  exportId: UUID_7,
  workbookVersion: 1,
  createdAt: NOW,
  selection: {
    kind: "search" as const,
    query: {
      q: "separations",
      scope: "workflow" as const,
      facets: { day: "2026-07-31", dryRun: true as const },
      limit: 20,
    },
    snapshot: {
      generatedAt: NOW,
      sourceIdentity: HASH_C,
      authorityGeneration: 3,
      order: "match-strength/enqueued-desc/run-id-asc:v1" as const,
      totalMatches: 1,
    },
  },
  workbook: { sheetNames: ["Read Me", "Runs"] as const, rowCount: 1 },
  artifact: {
    id: UUID_8,
    sha256: HASH_A,
    bytes: 1_024,
    mediaType: OPERATOR_XLSX_MEDIA_TYPE,
  },
  download: {
    filename: "hr-run-search-2026-07-31-g3.xlsx",
    mediaType: OPERATOR_XLSX_MEDIA_TYPE,
    contentDisposition: "attachment; filename=\"hr-run-search-2026-07-31-g3.xlsx\"",
    byteLength: 1_024,
    sha256: HASH_A,
  },
};
const OPERATOR_XLSX_EXPORT_V2_SEARCH = {
  ...OPERATOR_XLSX_EXPORT,
  exportId: UUID_6,
  workbookVersion: 2 as const,
  requestedBy: LOCAL_OPERATOR_ACTOR_ID,
};
const OPERATOR_XLSX_EXPORT_V2_ACTIVITY = {
  ...OPERATOR_XLSX_EXPORT,
  exportId: UUID_5,
  workbookVersion: 2 as const,
  requestedBy: LOCAL_OPERATOR_ACTOR_ID,
  selection: {
    kind: "activity" as const,
    snapshot: {
      from: "2026-07-01",
      to: "2026-07-31",
      generatedAt: NOW,
      sourceIdentity: HASH_C,
      totalRuns: 1,
    },
  },
  workbook: {
    sheetNames: [
      "Read Me",
      "Summary",
      "By Day",
      "By Workflow",
      "By Category",
      "By Status",
      "By Outcome",
      "Failures",
      "Ledger",
    ] as const,
    rowCount: 1,
  },
  download: {
    ...OPERATOR_XLSX_EXPORT.download,
    filename: "hr-activity-2026-07-01_2026-07-31.xlsx",
    contentDisposition: "attachment; filename=\"hr-activity-2026-07-01_2026-07-31.xlsx\"",
  },
};
const ACTIVE_STATUS = {
  state: "active" as const,
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};
const FAILURE_RECORD = {
  failureId: UUID_6,
  fingerprint: HASH_C,
  runId: RUN_ID,
  traceId: QUEUED_RUN.envelope.traceId,
  attempt: 1,
  workflowId: WORKFLOW_ID,
  code: "UNEXPECTED_PAGE_STATE",
  summary: "The current page state was not recognized",
  transient: false,
  writeState: "not-attempted",
  causeChain: [{
    code: "UNEXPECTED_PAGE_STATE",
    summary: "The current page state was not recognized",
    role: "primary",
    transient: false,
  }],
  remediation: [{ kind: "code-change", message: "Map the verified page state" }],
  occurredAt: LATER,
};
const DIAGNOSTIC_BUNDLE = {
  bundleId: UUID_5,
  runId: RUN_ID,
  origin: { kind: "failure", failureId: FAILURE_RECORD.failureId },
  createdAt: LATER,
  contentDigest: HASH_A,
  configFingerprint: HASH_B,
  descriptorFingerprint: HASH_C,
  redaction: {
    fields: [{ state: "redacted", key: "input.ssn", classification: "sensitive-hr", transform: "drop" }],
    warnings: [],
  },
  attachments: [{
    kind: "accessibility-excerpt",
    artifactId: UUID_7,
    mediaType: "text/yaml",
    byteLength: 128,
    digest: HASH_B,
    sensitivity: "redacted",
  }],
  retention: { kind: "pinned", reason: "write-recovery" },
};
const EVIDENCE_RECEIPT = {
  receiptId: UUID_5,
  runId: RUN_ID,
  traceId: QUEUED_RUN.envelope.traceId,
  workflowId: WORKFLOW_ID,
  attempt: 1,
  generatedAt: LATER,
  descriptorFingerprint: HASH_A,
  configFingerprint: HASH_B,
  retryOf: { state: "absent" },
  failure: { state: "present", value: FAILURE_RECORD.failureId },
  input: [],
  observations: [],
  decisions: [],
  actions: [],
  verification: [],
  output: [],
  reuse: [],
  warnings: [],
  confidence: "unknown",
  result: "failed",
};
const KNOWLEDGE_RECORD = {
  id: UUID_5,
  status: "active",
  scope: { system: "ucpath" },
  title: "Person Org Summary loses its accessible name under $op",
  symptom: "The heading is present but unnamed",
  trigger: "Navigating with the $op query parameter",
  rootCause: "PeopleSoft renders the label in a sibling frame",
  invariant: "Anchor on the RECORD_FIELD id, never the accessible name",
  fix: "Read the field id",
  regressionScenarios: ["ucpath/person-org-summary-named-heading"],
  evidence: [`observation:${UUID_7}`],
  verifiedAt: LATER,
};
const FIX_RECORD = {
  id: UUID_5,
  failureFingerprint: HASH_C,
  status: "draft",
  requestedBy: "claude",
  summary: "Anchor the person-org heading on its record field id",
  affected: ["ucpath.person-org-summary.heading"],
  files: ["src/stores/ucpath/tasks/read-person-org.ts"],
  scenarios: ["ucpath/person-org-summary-named-heading"],
  verification: [],
  createdAt: NOW,
};
const RUN_CHECKPOINT = {
  workflowId: "person-lookup",
  itemId: UUID_3,
  nodeId: "searching",
  attempt: 1,
  claimGeneration: 1,
  runId: UUID_1,
  output: SCHEMA_BOUND_VALUE,
  descriptorVersion: 1,
  contractFingerprint: HASH_A,
  implFingerprint: HASH_B,
  provenance: [{ path: "verified", source: "live", observedAt: NOW, originalObservedAt: NOW }],
  writtenAt: NOW,
};
const COMMAND_AUDIT = {
  auditId: UUID_2,
  request: COMMAND_FIXTURES[0],
  result: {
    state: "applied",
    commandId: UUID_1,
    affectedTargets: [{ family: "start", workflowId: "onboarding", startPlanId: UUID_3, expectedVersion: 1 }],
  },
  completedAt: NOW,
  versionChanges: [],
  affectedDependencyIds: [],
};
const SETTINGS_CURRENT_COMMAND = CommandRequestSchema.parse(COMMAND_FIXTURES[14]);
if (SETTINGS_CURRENT_COMMAND.family !== "settings") {
  throw new Error("settings current fixture does not name apply-settings");
}
const SETTINGS_CURRENT_AUDIT = {
  auditId: UUID_8,
  request: SETTINGS_CURRENT_COMMAND,
  result: {
    state: "applied" as const,
    commandId: SETTINGS_CURRENT_COMMAND.commandId,
    affectedTargets: [{ family: "settings" as const, revision: 2 }],
    restartRequired: true as const,
    settingsRevision: 2,
    settingsFingerprint: derivePersistedSettingsFingerprint({}),
  },
  completedAt: NOW,
  versionChanges: [{
    target: { family: "settings" as const, revision: 2 },
    before: 1,
    after: 2,
  }],
  affectedDependencyIds: [],
};
const OBSERVED_PRESENT_WRITE_INTENT = {
  writeIntentId: UUID_7,
  workflowId: "separation",
  itemId: UUID_5,
  taskId: "ucpath/terminate-person",
  system: "ucpath",
  idempotencyKey: "10001573|termination|2026-08-02",
  idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", "10001573|termination|2026-08-02"),
  generation: 1,
  status: "observed-present",
  observedProof: { schemaHash: HASH_A, value: "receipt-seen-during-recovery" },
  observedAt: NOW,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};
const {
  ingressSchemaHash: _legacyIngressSchemaHash,
  canonicalInputSchemaHash: _legacyCanonicalInputSchemaHash,
  inputFingerprint: _legacyInputFingerprint,
  ...LEGACY_V5_START_PLAN_BASE
} = START_PLAN;
const LEGACY_V5_START_PLAN = {
  ...LEGACY_V5_START_PLAN_BASE,
  planned: START_PLAN.planned.map(({ rawInput: _rawInput, canonicalInputDigest: _canonicalInputDigest, ...planned }) => planned),
};

function databasePath(name = "authority.sqlite"): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-rebuild-sqlite-"));
  roots.push(root);
  return join(root, name);
}

function openDatabase(path = databasePath(), busyTimeoutMs = 250): AuthorityDatabase {
  const database = AuthorityDatabase.open({ path, busyTimeoutMs, migrationOwner: "unit-test" }, CLOCK);
  openDatabases.push(database);
  databasePaths.set(database, path);
  return database;
}

function openDatabaseWithoutMigration(
  path: string,
  openMode:
    | "storage-backup-read-only-no-migrate"
    | "storage-doctor-read-only-no-migrate"
    | "storage-upgrade-preflight-read-only-no-migrate",
): AuthorityDatabase {
  const database = AuthorityDatabase.open({
    path,
    busyTimeoutMs: 250,
    migrationOwner: "unit-test",
    openMode,
  }, CLOCK);
  openDatabases.push(database);
  databasePaths.set(database, path);
  return database;
}

/**
 * Historical migration tests exercise the immutable SQL bytes directly now
 * that production open is forbidden from crossing the v30 floor. Task 6's
 * stopped-system upgrade is the production owner of this same chain.
 */
function applyReleasedMigrationChainForTest(path: string, fromVersion: number): void {
  const database = new DatabaseSync(path);
  database.exec("BEGIN EXCLUSIVE");
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version > fromVersion)) {
      for (const statement of migration.statements) database.exec(statement);
      database.prepare(`
        UPDATE authority_meta
        SET schema_version = ?, updated_at = ?
        WHERE singleton_id = 1
      `).run(migration.version, NOW);
      database.exec(`PRAGMA user_version = ${String(migration.version)}`);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

function createExactV18Database(path: string): void {
  const source = new DatabaseSync(path);
  source.exec("BEGIN EXCLUSIVE");
  for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 18)) {
    for (const statement of migration.statements) source.exec(statement);
  }
  source.prepare(`
    INSERT INTO authority_meta (
      singleton_id, schema_version, authority_generation, updated_at,
      migration_owner, migration_started_at
    ) VALUES (1, 18, 0, ?, NULL, NULL)
  `).run(NOW);
  source.exec("PRAGMA application_id = 1217249861");
  source.exec("PRAGMA user_version = 18");
  source.exec("COMMIT");
  source.close();
}

function createExactIntegratedSuffixDatabase(
  path: string,
  sourceVersion: number,
  integratedStartVersion: number,
): void {
  createExactV18Database(path);
  const source = new DatabaseSync(path);
  source.exec("BEGIN EXCLUSIVE");
  const migrationCount = sourceVersion - 18;
  for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => (
    version >= integratedStartVersion && version < integratedStartVersion + migrationCount
  ))) {
    for (const statement of migration.statements) source.exec(statement);
  }
  source.prepare(`
    UPDATE authority_meta
    SET schema_version = ?, updated_at = ?
    WHERE singleton_id = 1
  `).run(sourceVersion, NOW);
  source.exec(`PRAGMA user_version = ${String(sourceVersion)}`);
  source.exec("COMMIT");
  source.close();
}

function createExactV27Database(path: string): void {
  createExactIntegratedSuffixDatabase(path, 27, 19);
}

function createExactReleasedDatabase(path: string, version: 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36): void {
  const source = new DatabaseSync(path);
  source.exec("BEGIN EXCLUSIVE");
  for (const migration of SQLITE_MIGRATIONS.filter(({ version: candidate }) => candidate <= version)) {
    for (const statement of migration.statements) source.exec(statement);
  }
  source.prepare(`
    INSERT INTO authority_meta (
      singleton_id, schema_version, authority_generation, updated_at,
      migration_owner, migration_started_at
    ) VALUES (1, ?, 0, ?, NULL, NULL)
  `).run(version, NOW);
  source.exec("PRAGMA application_id = 1217249861");
  source.exec(`PRAGMA user_version = ${String(version)}`);
  source.exec("COMMIT");
  source.close();
}

function createExactDcc4SourceDatabase(path: string): void {
  createExactV18Database(path);
  const source = new DatabaseSync(path);
  source.exec("BEGIN EXCLUSIVE");
  for (const statement of DCC4_SUPERSEDED_V19_MIGRATION.statements) source.exec(statement);
  source.prepare(`
    UPDATE authority_meta
    SET schema_version = 19, updated_at = ?
    WHERE singleton_id = 1
  `).run(NOW);
  source.exec("PRAGMA user_version = 19");
  source.exec("COMMIT");
  source.close();
}

function assertD290RefusalWithoutMutation(path: string, source: "DCR" | "DCC1" | "DCC4", version: number): void {
  const before = readFileSync(path);
  assert.throws(
    () => openDatabase(path),
    new RegExp(`D290 divergent post-v18 migration suffix: ${source} v${String(version)}`),
  );
  assert.deepEqual(readFileSync(path), before);
}

type RetiredPhoneCaptureDependency =
  | "capture_sessions"
  | "capture_photo_order"
  | "capture_finalization_outboxes"
  | "capture-command"
  | "capture-command-audit"
  | "capture-handoff-session"
  | "capture-intake-manifest";

function seedRetiredPhoneCaptureDependency(path: string, dependency: RetiredPhoneCaptureDependency): void {
  const database = new DatabaseSync(path);
  try {
    const captureRequest = { family: "capture", type: "capture-finalize" };
    if (dependency === "capture-command" || dependency === "capture-command-audit") {
      database.prepare(`
        INSERT INTO commands (record_key, family, record_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(UUID_1, "capture", JSON.stringify(captureRequest), NOW);
      if (dependency === "capture-command-audit") {
        database.prepare(`
          INSERT INTO command_audits (record_key, command_id, record_json, created_at)
          VALUES (?, ?, ?, ?)
        `).run(UUID_2, UUID_1, JSON.stringify({ request: captureRequest }), NOW);
      }
      return;
    }
    if (dependency === "capture-handoff-session") {
      database.prepare(`
        INSERT INTO run_sessions (record_key, workflow, started_at, record_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(UUID_1, "person-lookup", NOW, JSON.stringify({ origin: { kind: "capture-handoff" } }), NOW);
      return;
    }
    if (dependency === "capture-intake-manifest") {
      database.prepare(`
        INSERT INTO intake_manifests
          (record_key, workflow, source_sha256, workflow_contract_fingerprint, record_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(UUID_1, "person-lookup", HASH_A, HASH_B, JSON.stringify({ capture: { retired: true } }), NOW);
      return;
    }
    database.prepare(`
      INSERT INTO ${dependency} (record_key, record_json, created_at)
      VALUES (?, ?, ?)
    `).run(UUID_1, JSON.stringify({ retired: true }), NOW);
  } finally {
    database.close();
  }
}

function assertD294RefusalWithoutMutation(path: string, dependency: RetiredPhoneCaptureDependency): void {
  assert.throws(
    () => applyReleasedMigrationChainForTest(path, 27),
    /phone capture retirement refuses a database containing capture authority/u,
  );
  // SQLite may advance a file-header change counter while rolling back the
  // exclusive migration transaction. Atomicity here is durable authority
  // semantics: the schema/version and every dependent row remain unchanged.
  const unchanged = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(Reflect.get(unchanged.prepare("PRAGMA user_version").get() ?? {}, "user_version"), 27);
    assert.equal(Reflect.get(unchanged.prepare(`
      SELECT schema_version FROM authority_meta WHERE singleton_id = 1
    `).get() ?? {}, "schema_version"), 27);
    for (const table of ["capture_sessions", "capture_photo_order", "capture_finalization_outboxes"]) {
      assert.notEqual(unchanged.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table), undefined);
    }
    if (dependency === "capture-command") {
      assert.equal(Reflect.get(unchanged.prepare("SELECT count(*) AS count FROM commands").get() ?? {}, "count"), 1);
    } else if (dependency === "capture-command-audit") {
      assert.equal(Reflect.get(unchanged.prepare("SELECT count(*) AS count FROM commands").get() ?? {}, "count"), 1);
      assert.equal(Reflect.get(unchanged.prepare("SELECT count(*) AS count FROM command_audits").get() ?? {}, "count"), 1);
    } else if (dependency === "capture-handoff-session") {
      assert.equal(Reflect.get(unchanged.prepare("SELECT count(*) AS count FROM run_sessions").get() ?? {}, "count"), 1);
    } else if (dependency === "capture-intake-manifest") {
      assert.equal(Reflect.get(unchanged.prepare("SELECT count(*) AS count FROM intake_manifests").get() ?? {}, "count"), 1);
    } else {
      assert.equal(Reflect.get(unchanged.prepare(`SELECT count(*) AS count FROM ${dependency}`).get() ?? {}, "count"), 1);
    }
  } finally {
    unchanged.close();
  }
}

function seedExactLegacyPseudonymEvidence(legacy: DatabaseSync) {
  const run = RunRecordSchema.parse(compositionQueuedRun());
  legacy.prepare(`
    INSERT INTO tasks (
      record_key, workflow, item_id, state, priority, attempt, not_before,
      owner_worker_id, claim_generation, heartbeat_at, parent_run_id, run_number,
      session_id, version, record_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.envelope.runId,
    run.envelope.workflow,
    run.envelope.itemId,
    run.lifecycle.state,
    run.envelope.priority,
    run.envelope.attempt,
    run.lifecycle.state === "queued" ? run.lifecycle.notBefore ?? null : null,
    null,
    run.claimGeneration,
    null,
    run.envelope.parent?.runId ?? null,
    run.runNumber ?? null,
    run.sessionId ?? null,
    run.version,
    JSON.stringify(run),
    run.createdAt,
  );
  const domain = createActivityPersonPseudonymDomain({
    keyGeneration: "activity-person-g1",
    keyHex: ACTIVITY_PERSON_PSEUDONYM_KEY_HEX,
  });
  const evidence = domain.deriveEvidence({
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    canonicalSubject: "10873698",
  });
  legacy.prepare(`
    INSERT INTO activity_person_pseudonyms
      (record_key, run_id, workflow, key_generation, pseudonym, derivation, record_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `${evidence.runId}:${evidence.keyGeneration}`,
    evidence.runId,
    evidence.workflowId,
    evidence.keyGeneration,
    evidence.pseudonym,
    evidence.derivation,
    JSON.stringify(evidence),
    NOW,
  );
  return domain;
}

function createExactV21Database(path: string, withPseudonymEvidence: boolean): void {
  const legacy = new DatabaseSync(path);
  legacy.exec("BEGIN EXCLUSIVE");
  for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 21)) {
    for (const statement of migration.statements) legacy.exec(statement);
  }
  if (withPseudonymEvidence) seedExactLegacyPseudonymEvidence(legacy);
  legacy.prepare(`
    INSERT INTO authority_meta (
      singleton_id, schema_version, authority_generation, updated_at,
      migration_owner, migration_started_at
    ) VALUES (1, 21, 0, ?, NULL, NULL)
  `).run(NOW);
  legacy.exec("PRAGMA application_id = 1217249861");
  legacy.exec("PRAGMA user_version = 21");
  legacy.exec("COMMIT");
  legacy.close();
}

function createExactV22Database(path: string, state: "bound" | "orphaned"): void {
  const legacy = new DatabaseSync(path);
  legacy.exec("BEGIN EXCLUSIVE");
  for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 21)) {
    for (const statement of migration.statements) legacy.exec(statement);
  }
  const domain = seedExactLegacyPseudonymEvidence(legacy);
  const migration22 = SQLITE_MIGRATIONS.find(({ version }) => version === 22);
  if (migration22 === undefined) throw new Error("pinned pseudonym generation migration v22 is missing");
  for (const statement of migration22.statements) legacy.exec(statement);
  if (state === "bound") {
    const binding = domain.generationBinding;
    legacy.prepare(`
      INSERT INTO activity_person_pseudonym_generations
        (record_key, key_generation, key_commitment, derivation, record_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      binding.keyGeneration,
      binding.keyGeneration,
      binding.keyCommitment,
      binding.derivation,
      JSON.stringify(binding),
      NOW,
    );
  }
  legacy.prepare(`
    INSERT INTO authority_meta (
      singleton_id, schema_version, authority_generation, updated_at,
      migration_owner, migration_started_at
    ) VALUES (1, 22, 0, ?, NULL, NULL)
  `).run(NOW);
  legacy.exec("PRAGMA application_id = 1217249861");
  legacy.exec("PRAGMA user_version = 22");
  legacy.exec("COMMIT");
  legacy.close();
}

function prepareRunning(database: AuthorityDatabase) {
  database.authority.runs.enqueue({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
    },
  });
  const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW });
  if (claimed.state !== "claimed") throw new Error("generation fixture did not claim a run");
  const validating = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: claimed.run.version,
    claim: { workerId: WORKER_ID, claimGeneration: 1 },
    lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (validating.state !== "applied") throw new Error("generation fixture did not validate");
  const running = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: validating.run.version,
    claim: { workerId: WORKER_ID, claimGeneration: 1 },
    lifecycle: { state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (running.state !== "applied") throw new Error("generation fixture did not run");
  return running.run;
}

function prepareProviderRunning(database: AuthorityDatabase) {
  database.authority.configSnapshots.insert({
    ...CONFIG_SNAPSHOT,
    configSnapshotId: UUID_4,
    fingerprint: HASH_B,
  });
  const run = prepareRunning(database);
  const updated = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: run.version,
    claim: { workerId: WORKER_ID, claimGeneration: 1 },
    lifecycle: { ...run.lifecycle, currentNodeId: "searching" },
    now: NOW,
  });
  if (updated.state !== "applied") throw new Error("provider generation fixture did not select a node");
}

function reserveProvider(database: AuthorityDatabase) {
  database.authority.providerAdmissions.reserve({
    admissionId: UUID_8,
    execution: { runId: RUN_ID, attempt: 1, nodeId: "searching", taskId: "ocr/extract-page" },
    capability: "ocr.extract",
    configSnapshotId: UUID_4,
    configFingerprint: HASH_B,
    requestFingerprint: HASH_A,
    estimate: { maximumCostUsdMicros: 0 },
    deadlineAt: LATER,
    leaseExpiresAt: LATER,
    now: NOW,
  });
}

const LEDGER_PARTITION = { system: "ucpath" as const, date: "2026-07-31" };
const LEDGER_PROJECTOR_ID = "generation-fixture";

/** Ref operator-trust's trust records hang off a real terminal run and its durable failure. */
function terminalizeForTrust(database: AuthorityDatabase): void {
  const run = prepareRunning(database);
  database.terminalizeFailure(personLookupDescriptor, terminalFailureRequest(run));
}

function acquireLedgerLease(database: AuthorityDatabase): number {
  const lease = database.authority.ledgerProjection.acquireLease({
    ...LEDGER_PARTITION,
    projectorId: LEDGER_PROJECTOR_ID,
    now: NOW,
    expiresAt: LATER,
  });
  if (lease.state !== "acquired") throw new Error("ledger generation fixture did not take its lease");
  return lease.partition.leaseGeneration;
}

function terminalFailureRequest(run: ReturnType<typeof prepareRunning>) {
  return {
    failure: FAILURE_RECORD,
    authorization: {
      kind: "failed" as const,
      runId: run.envelope.runId,
      workflowId: run.envelope.workflow,
      attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      expectedVersion: run.version,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      authorizedAt: LATER,
      failureId: FAILURE_RECORD.failureId,
    },
  };
}

function terminalSuccessRequest(database: AuthorityDatabase, run: ReturnType<typeof prepareRunning>) {
  const checkpoint = RunCheckpointRecordSchema.parse({
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    nodeId: "active-status",
    attempt: run.envelope.attempt,
    claimGeneration: run.claimGeneration,
    runId: run.envelope.runId,
    output: {
      schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"),
      value: ACTIVE_STATUS,
    },
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    implFingerprint: HASH_B,
    provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
  if (database.authority.runCheckpoints.get(
    checkpoint.workflowId,
    checkpoint.itemId,
    checkpoint.nodeId,
    checkpoint.attempt,
    checkpoint.claimGeneration,
  ) === undefined) {
    database.authority.runCheckpoints.insert(checkpoint);
  }
  const built = buildRunResult(personLookupDescriptor, run, [
    { state: "resolved", nodeId: "active-status", checkpoint },
    { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
  ], CLOCK);
  const outbox = {
    outboxId: UUID_7,
    payload: {
      kind: "run-terminal-result" as const,
      runId: built.record.runId,
      workflowId: built.record.workflowId,
      attempt: built.record.attempt,
      resultDigest: built.record.resultDigest,
    },
    projection: { state: "pending" as const },
    createdAt: LATER,
  };
  return {
    request: {
      result: built.record,
      outbox,
      authorization: {
        kind: "done" as const,
        runId: built.record.runId,
        workflowId: built.record.workflowId,
        attempt: built.record.attempt,
        descriptorVersion: built.record.descriptorVersion,
        contractFingerprint: built.record.contractFingerprint,
        expectedVersion: run.version,
        claim: { workerId: WORKER_ID, claimGeneration: 1 },
        authorizedAt: LATER,
        resultDigest: built.record.resultDigest,
        outboxId: UUID_7,
      },
    },
    factoryAuthorization: built.authorization,
  };
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("native SQLite authority schema", () => {
  it("requires stopped conversion through v35 and admits v36 directly", () => {
    assert.equal(requiresStoppedSystemAuthorityUpgrade(29), true);
    assert.equal(requiresStoppedSystemAuthorityUpgrade(30), true);
    assert.equal(requiresStoppedSystemAuthorityUpgrade(31), true);
    assert.equal(requiresStoppedSystemAuthorityUpgrade(32), true);
    assert.equal(requiresStoppedSystemAuthorityUpgrade(33), true);
    assert.equal(requiresStoppedSystemAuthorityUpgrade(35), true);
    assert.equal(requiresStoppedSystemAuthorityUpgrade(36), false);
  });

  it("creates a fresh authority at the current schema with one baseline journal row", () => {
    const path = databasePath("fresh-v32.sqlite");
    openDatabase(path).close();

    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(raw.prepare("PRAGMA user_version").get() ?? {}, "user_version"), CURRENT_AUTHORITY_SCHEMA_VERSION);
      const row = raw.prepare(`
        SELECT record_key, upgrade_id, phase, record_json
        FROM authority_upgrades
      `).get() ?? {};
      const record = JSON.parse(String(Reflect.get(row, "record_json"))) as Record<string, unknown>;
      assert.deepEqual({
        recordKey: record.recordKey,
        upgradeId: record.upgradeId,
        phase: record.phase,
        fromSchemaVersion: record.fromSchemaVersion,
        toSchemaVersion: record.toSchemaVersion,
        by: record.by,
        recordedAt: record.recordedAt,
      }, {
        recordKey: Reflect.get(row, "record_key"),
        upgradeId: "fresh",
        phase: "baseline",
        fromSchemaVersion: 0,
        toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
        by: "local-operator",
        recordedAt: NOW,
      });
      assert.equal(Reflect.get(row, "upgrade_id"), "fresh");
      assert.equal(Reflect.get(row, "phase"), "baseline");
    } finally {
      raw.close();
    }
  });

  it("A3 drops only the dead v33 mirror and preserves canonical bytes and generation across reopen", () => {
    const path = databasePath("a3-v33.sqlite");
    createExactReleasedDatabase(path, 33);
    const raw = new DatabaseSync(path);
    const run = QUEUED_RUN;
    raw.prepare(`INSERT INTO workflow_runs (
      record_key, workflow, item_id, state, priority, attempt, not_before,
      owner_worker_id, claim_generation, heartbeat_at, parent_run_id, run_number, session_id,
      version, record_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`).run(
      run.envelope.runId, run.envelope.workflow, run.envelope.itemId, run.lifecycle.state,
      run.envelope.priority, run.envelope.attempt, run.claimGeneration, run.version,
      JSON.stringify(run), run.createdAt,
    );
    const before = raw.prepare("SELECT record_json FROM workflow_runs").all();
    assert.ok(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'runs_view'").get());
    raw.close();
    applyReleasedMigrationChainForTest(path, 33);
    const migrated = openDatabase(path);
    assert.equal(migrated.getMeta().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(migrated.getMeta().authorityGeneration, 0);
    assert.equal(migrated.inspectSchema().tables.some(({ name }) => String(name) === "runs_view"), false);
    assert.deepEqual(migrated.authority.runs.get(run.envelope.runId), run);
    migrated.close();
    const reopened = openDatabase(path);
    assert.equal(reopened.getMeta().authorityGeneration, 0);
    reopened.close();
    const verify = new DatabaseSync(path, { readOnly: true });
    assert.deepEqual(verify.prepare("SELECT record_json FROM workflow_runs").all(), before);
    assert.equal(verify.prepare("SELECT name FROM sqlite_master WHERE name = 'runs_view'").get(), undefined);
    verify.close();
  });

  it("upgrades v30 lineage so source deletion preserves it and only the new run tombstone removes it", () => {
    const path = databasePath("v30-lineage-to-v31.sqlite");
    createExactReleasedDatabase(path, 30);
    const source = QUEUED_RUN;
    const relaunched = {
      ...QUEUED_RUN,
      envelope: {
        ...QUEUED_RUN.envelope,
        runId: ARCHIVE_RELAUNCH.runId,
        itemId: RELAUNCH_ITEM_ID,
        traceId: "pl-170001-3333",
      },
    };
    const seed = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    const insertRun = seed.prepare(`
      INSERT INTO tasks (
        record_key, workflow, item_id, state, priority, attempt, not_before,
        owner_worker_id, claim_generation, heartbeat_at, parent_run_id, run_number, session_id, version,
        record_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, NULL, ?, ?, ?)
    `);
    for (const run of [source, relaunched]) {
      insertRun.run(
        run.envelope.runId, run.envelope.workflow, run.envelope.itemId, run.lifecycle.state,
        run.envelope.priority, run.envelope.attempt, run.claimGeneration, null,
        run.version, JSON.stringify(run), run.createdAt,
      );
    }
    seed.prepare("INSERT INTO version_plans (record_key, record_json, created_at) VALUES (?, ?, ?)")
      .run(VERSION_PLAN_ROW.versionPlanId, JSON.stringify(VERSION_PLAN_ROW), VERSION_PLAN_ROW.createdAt);
    seed.prepare(`
      INSERT INTO version_bump_applications
        (record_key, version_plan_id, scope_kind, target_version, applied_app_version, archived_count, record_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      VERSION_BUMP_APPLICATION.applicationId, VERSION_BUMP_APPLICATION.versionPlanId,
      VERSION_BUMP_APPLICATION.scope.kind, VERSION_BUMP_APPLICATION.targetVersion,
      VERSION_BUMP_APPLICATION.appliedAppVersion, VERSION_BUMP_APPLICATION.archivedRunIds.length,
      JSON.stringify(VERSION_BUMP_APPLICATION), VERSION_BUMP_APPLICATION.appliedAt,
    );
    seed.prepare(`
      INSERT INTO archived_runs
        (record_key, application_id, workflow, descriptor_version, contract_fingerprint, app_version,
         content_digest, record_json, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(
      ARCHIVED_RUN.runId, ARCHIVED_RUN.applicationId, ARCHIVED_RUN.workflowId,
      ARCHIVED_RUN.archivedIdentity.descriptorVersion, ARCHIVED_RUN.archivedIdentity.contractFingerprint,
      ARCHIVED_RUN.contentDigest, JSON.stringify(ARCHIVED_RUN), ARCHIVED_RUN.archivedAt,
    );
    seed.prepare(`
      INSERT INTO archive_relaunches (record_key, archived_run_id, record_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      ARCHIVE_RELAUNCH.runId, ARCHIVE_RELAUNCH.archivedRunId,
      JSON.stringify(ARCHIVE_RELAUNCH), ARCHIVE_RELAUNCH.relaunchedAt,
    );
    seed.close();

    applyReleasedMigrationChainForTest(path, 30);
    const upgraded = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      assert.equal(Reflect.get(upgraded.prepare("PRAGMA user_version").get() ?? {}, "user_version"), CURRENT_AUTHORITY_SCHEMA_VERSION);
      const foreignKeys = upgraded.prepare("PRAGMA foreign_key_list(archive_relaunches)").all() as Array<{ from: string; table: string }>;
      assert.deepEqual(foreignKeys.map(({ from, table }) => ({ from, table })), [{ from: "record_key", table: "workflow_runs" }]);
      const tombstone = (run: typeof source) => upgraded.prepare(`
        INSERT INTO deleted_runs
          (record_key, workflow, trace_id, origin, command_id, deleted_at, record_json, created_at,
           item_id, attempt, run_number, ordinal_source)
        VALUES (?, ?, ?, 'archive', ?, ?, '{}', ?, ?, ?, ?, 'tombstone')
      `).run(
        run.envelope.runId, run.envelope.workflow, run.envelope.traceId, UUID_7, NOW, NOW,
        run.envelope.itemId, run.envelope.attempt, null,
      );
      tombstone(source);
      upgraded.prepare("DELETE FROM archived_runs WHERE record_key = ?").run(source.envelope.runId);
      assert.equal(Reflect.get(upgraded.prepare(
        "SELECT count(*) AS count FROM archive_relaunches WHERE archived_run_id = ?",
      ).get(source.envelope.runId) ?? {}, "count"), 1);
      assert.throws(
        () => upgraded.prepare("DELETE FROM archive_relaunches WHERE record_key = ?").run(relaunched.envelope.runId),
        /outside its new run D308 tombstone/u,
      );
      tombstone(relaunched);
      assert.equal(upgraded.prepare("DELETE FROM archive_relaunches WHERE record_key = ?")
        .run(relaunched.envelope.runId).changes, 1);
    } finally {
      upgraded.close();
    }
  });

  it("refuses an at-floor authority whose immutable baseline claims another target", () => {
    const path = databasePath("invalid-baseline-target.sqlite");
    createExactReleasedDatabase(path, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const raw = new DatabaseSync(path);
    raw.prepare(`
      INSERT INTO authority_upgrades (
        record_key, upgrade_id, phase, record_json, created_at
      ) VALUES (?, 'fresh', 'baseline', ?, ?)
    `).run(UUID_1, JSON.stringify({
      recordKey: UUID_1,
      upgradeId: "fresh",
      phase: "baseline",
      fromSchemaVersion: 0,
      toSchemaVersion: 1,
      by: "local-operator",
      recordedAt: NOW,
    }), NOW);
    raw.close();

    assert.throws(
      () => openDatabase(path),
      /authority table authority_upgrades record .* failed strict record schema validation/u,
    );
  });

  it.each([
    "storage-backup-read-only-no-migrate",
    "storage-doctor-read-only-no-migrate",
    "storage-upgrade-preflight-read-only-no-migrate",
  ] as const)("admits v29 through %s without migrating or changing its bytes", (openMode) => {
    const path = databasePath(`${openMode}.sqlite`);
    createExactReleasedDatabase(path, 29);
    const before = readFileSync(path);

    const database = openDatabaseWithoutMigration(path, openMode);
    assert.equal(database.getMeta().schemaVersion, 29);
    database.close();

    assert.deepEqual(readFileSync(path), before);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(raw.prepare("PRAGMA user_version").get() ?? {}, "user_version"), 29);
      assert.equal(raw.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'authority_upgrades'
      `).get(), undefined);
    } finally {
      raw.close();
    }
  });

  it("refuses an ordinary v29 open with upgrade-required before any migration", () => {
    const path = databasePath("ordinary-v29.sqlite");
    createExactReleasedDatabase(path, 29);
    const before = readFileSync(path);

    assert.throws(
      () => openDatabase(path),
      /upgrade-required \{ schemaVersion: 29, floor: 35 \}/u,
    );
    assert.deepEqual(readFileSync(path), before);
  });

  it.each([30, 31] as const)("reads populated v%s ordinary/protected metadata with the released schemas and refuses corruption", (version) => {
    const path = databasePath(`historical-settings-v${String(version)}.sqlite`);
    createExactReleasedDatabase(path, version);
    const raw = new DatabaseSync(path);
    const command = SETTINGS_CURRENT_COMMAND;
    const audit = SETTINGS_CURRENT_AUDIT;
    raw.prepare("INSERT INTO commands (record_key, family, record_json, created_at) VALUES (?, ?, ?, ?)")
      .run(command.commandId, command.family, JSON.stringify(command), command.requestedAt);
    raw.prepare("INSERT INTO command_audits (record_key, command_id, record_json, created_at) VALUES (?, ?, ?, ?)")
      .run(audit.auditId, command.commandId, JSON.stringify(audit), audit.completedAt);
    const common = { revision: 2, commandId: command.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(command), auditId: audit.auditId, committedAt: NOW };
    const settings = { ...common, settingsFingerprint: derivePersistedSettingsFingerprint({}) };
    const protectedSettings = { ...common, entries: [] };
    raw.prepare("INSERT INTO settings_current (record_key, revision, settings_fingerprint, command_id, command_fingerprint, audit_id, record_json, created_at) VALUES ('current', 2, ?, ?, ?, ?, ?, ?)")
      .run(settings.settingsFingerprint, common.commandId, common.commandFingerprint, common.auditId, JSON.stringify(settings), NOW);
    raw.prepare("INSERT INTO protected_settings_current (record_key, revision, command_id, command_fingerprint, audit_id, record_json, created_at) VALUES ('current', 2, ?, ?, ?, ?, ?)")
      .run(common.commandId, common.commandFingerprint, common.auditId, JSON.stringify(protectedSettings), NOW);
    raw.close();
    const before = readFileSync(path);
    for (const openMode of ["storage-backup-read-only-no-migrate", "storage-doctor-read-only-no-migrate", "storage-upgrade-preflight-read-only-no-migrate"] as const) {
      const admitted = openDatabaseWithoutMigration(path, openMode);
      assert.equal(admitted.getMeta().schemaVersion, version);
      admitted.close();
      assert.deepEqual(readFileSync(path), before);
    }
    const corrupt = new DatabaseSync(path);
    // The legacy update trigger is deliberately obeyed: invalid metadata must
    // fail the reader even when SQL's revision fence accepts the row.
    corrupt.prepare("UPDATE protected_settings_current SET revision = 3, record_json = ?")
      .run(JSON.stringify({ ...protectedSettings, revision: 3, privateUnknown: "must-refuse" }));
    corrupt.close();
    const corruptBytes = readFileSync(path);
    assert.throws(() => openDatabaseWithoutMigration(path, "storage-doctor-read-only-no-migrate"), /strict record schema validation/u);
    assert.deepEqual(readFileSync(path), corruptBytes);
  });

  it.each([27, 28, 29, 30, 31, 32, 33, 34, 35] as const)("admits the frozen integrated v%s layout for upgrade preflight", (version) => {
    const path = databasePath(`integrated-v${String(version)}.sqlite`);
    createExactReleasedDatabase(path, version);
    const before = readFileSync(path);

    const database = openDatabaseWithoutMigration(path, "storage-upgrade-preflight-read-only-no-migrate");
    assert.equal(database.getMeta().schemaVersion, version);
    database.close();
    assert.deepEqual(readFileSync(path), before);
  });

  it.each([27, 28, 29] as const)("M21 admits exact v%s before traversing the released chain to the floor", (version) => {
    const path = databasePath(`m21-chain-v${String(version)}.sqlite`);
    createExactReleasedDatabase(path, version);
    const before = readFileSync(path);
    const admitted = openDatabaseWithoutMigration(path, "storage-upgrade-preflight-read-only-no-migrate");
    assert.equal(admitted.getMeta().schemaVersion, version);
    admitted.close();
    assert.deepEqual(readFileSync(path), before);

    // Task 6 owns the production upgrade command. This test-only seam runs
    // the ordinary immutable chain only AFTER real read-only admission.
    applyReleasedMigrationChainForTest(path, version);
    const upgraded = openDatabase(path);
    assert.equal(upgraded.getMeta().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(upgraded.inspectSchema().tables.map(({ name }) => name),
      AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort());
  });

  it("M21 refuses an extra table in exact v29 before admission or migration changes any bytes", () => {
    const path = databasePath("m21-extra-table-v29.sqlite");
    createExactReleasedDatabase(path, 29);
    const raw = new DatabaseSync(path);
    raw.exec("CREATE TABLE unreviewed_v29_suffix (record_key TEXT PRIMARY KEY) STRICT");
    raw.close();
    const before = readFileSync(path);
    assert.throws(
      () => openDatabaseWithoutMigration(path, "storage-upgrade-preflight-read-only-no-migrate"),
      /D290 divergent post-v18 migration suffix: DCC1 v29/u,
    );
    assert.deepEqual(readFileSync(path), before);
  });

  it.each([27, 28, 29] as const)("M21 negative control: live-DDL-derived lists reject the admitted v%s fixture", async (version) => {
    const path = databasePath(`m21-derived-v${String(version)}.sqlite`);
    createExactReleasedDatabase(path, version);
    const admitted = openDatabaseWithoutMigration(path, "storage-upgrade-preflight-read-only-no-migrate");
    assert.equal(admitted.getMeta().schemaVersion, version);
    admitted.close();
    const before = readFileSync(path);
    await withAuthorityBuildVariant("ddl-derived-layouts", async () => {
      const { AuthorityDatabase: brokenBuild } = await import("../../src/infra/sqlite/authority-database.js");
      assert.throws(() => brokenBuild.open({
        path, busyTimeoutMs: 250, migrationOwner: "m21-negative-control",
        openMode: "storage-upgrade-preflight-read-only-no-migrate",
      }, CLOCK), new RegExp(`D290 divergent post-v18 migration suffix: DCC1 v${String(version)}`, "u"));
    });
    assert.deepEqual(readFileSync(path), before);
  });

  it("creates the complete v32 schema and preserves journal append semantics", () => {
    const path = databasePath("v30-schema-floor.sqlite");
    openDatabase(path).close();
    const raw = new DatabaseSync(path);
    try {
      const deletedColumns = (raw.prepare("PRAGMA table_info(deleted_runs)").all() as Array<{ name: string }>)
        .map(({ name }) => name);
      for (const column of ["item_id", "attempt", "run_number", "ordinal_source"]) {
        assert.equal(deletedColumns.includes(column), true, column);
      }
      const immutableSql = String(Reflect.get(raw.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'deleted_runs_immutable_update'
      `).get() ?? {}, "sql"));
      for (const column of ["item_id", "attempt", "run_number", "ordinal_source"]) {
        assert.match(immutableSql, new RegExp(`NEW\\.${column} IS OLD\\.${column}`, "u"));
      }
      const checkpointTriggerSql = String(Reflect.get(raw.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'checkpoint_payloads_never_deleted'
      `).get() ?? {}, "sql"));
      assert.match(checkpointTriggerSql, /substr\(OLD\.record_key, 1, 36\)/u);
      assert.match(checkpointTriggerSql, /substr\(OLD\.record_key, 37, 1\) <> ':'/u);
      assert.equal(raw.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'protected_settings_current'
      `).get(), undefined);

      const planned = (recordKey: string) => ({
        record_key: recordKey,
        upgrade_id: HASH_A,
        phase: "planned",
        record_json: "{}",
        created_at: NOW,
      });
      for (const row of [planned(UUID_1), planned(UUID_2)]) {
        raw.prepare(`
          INSERT INTO authority_upgrades
            (record_key, upgrade_id, phase, record_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(row.record_key, row.upgrade_id, row.phase, row.record_json, row.created_at);
      }
      assert.equal(Reflect.get(raw.prepare(`
        SELECT count(*) AS count FROM authority_upgrades WHERE upgrade_id = ? AND phase = 'planned'
      `).get(HASH_A) ?? {}, "count"), 2);
      assert.throws(() => raw.prepare(`
        INSERT INTO authority_upgrades
          (record_key, upgrade_id, phase, record_json, created_at)
        VALUES (?, 'fresh', 'baseline', '{}', ?)
      `).run(UUID_3, NOW), /UNIQUE constraint failed/u);
    } finally {
      raw.close();
    }
  });

  it("creates every registered table with its exact authority classification and required pragmas", () => {
    const database = openDatabase();
    const inspection = database.inspectSchema();
    assert.deepEqual(inspection.tables, [...AUTHORITY_TABLE_REGISTRY]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, classification }) => ({ name, classification })));
    assert.equal(inspection.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(inspection.authorityGeneration, 0);
    assert.deepEqual(inspection.pragmas, {
      journalMode: "wal",
      foreignKeys: 1,
      synchronous: 2,
      busyTimeoutMs: 250,
    });
  });

  it("keeps the released migration chain from the exact common v18 authority", () => {
    const path = databasePath("common-v18.sqlite");
    createExactV18Database(path);

    applyReleasedMigrationChainForTest(path, 18);
    const upgraded = openDatabase(path);

    assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(upgraded.inspectSchema().tables.some(({ name }) => name === "operator_xlsx_exports"), true);
    assert.equal(upgraded.inspectSchema().tables.some(({ name }) => name === "runtime_config"), true);
    assert.equal(upgraded.inspectSchema().tables.some(({ name }) => name === "settings_current"), true);
    assert.equal(upgraded.inspectSchema().tables.some(({ name }) => name === "bulk_command_acceptances"), true);
  });

  it("keeps the released v28 phone-capture retirement over an empty exact v27 authority", () => {
    const path = databasePath("phone-capture-empty-v27.sqlite");
    createExactV27Database(path);

    applyReleasedMigrationChainForTest(path, 27);
    const upgraded = openDatabase(path);

    assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    for (const table of ["capture_sessions", "capture_photo_order", "capture_finalization_outboxes"]) {
      assert.equal(upgraded.inspectSchema().tables.some(({ name }) => name === table), false, table);
    }
  });

  it("refuses a v27 authority whose table set is no longer the exact integrated lineage", () => {
    const path = databasePath("phone-capture-extra-table-v27.sqlite");
    createExactV27Database(path);
    const altered = new DatabaseSync(path);
    altered.exec("CREATE TABLE unreviewed_v27_suffix (record_key TEXT PRIMARY KEY) STRICT");
    altered.close();

    assertD290RefusalWithoutMutation(path, "DCC1", 27);
  });

  it.each([
    "capture_sessions",
    "capture_photo_order",
    "capture_finalization_outboxes",
    "capture-command",
    "capture-command-audit",
    "capture-handoff-session",
    "capture-intake-manifest",
  ] as const)("refuses a v27 authority with %s atomically", (dependency) => {
    const path = databasePath(`phone-capture-${dependency}.sqlite`);
    createExactV27Database(path);
    seedRetiredPhoneCaptureDependency(path, dependency);

    assertD294RefusalWithoutMutation(path, dependency);
  });

  it("refuses the exact complete DCR v24 suffix before migration or mutation", () => {
    const path = databasePath("dcc1-source-dcr-v24.sqlite");
    createExactIntegratedSuffixDatabase(path, 24, 19);
    assertD290RefusalWithoutMutation(path, "DCR", 24);
  });

  it("refuses an exact DCR v21 evidence-bearing suffix without v22 residue", () => {
    const path = databasePath("pseudonym-evidence-v21.sqlite");
    createExactV21Database(path, true);

    assertD290RefusalWithoutMutation(path, "DCR", 21);

    const unchanged = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(unchanged.prepare("PRAGMA user_version").get() ?? {}, "user_version"), 21);
      const meta = unchanged.prepare(`
        SELECT schema_version, migration_owner, migration_started_at
        FROM authority_meta WHERE singleton_id = 1
      `).get() ?? {};
      assert.deepEqual({
        schema_version: Reflect.get(meta, "schema_version"),
        migration_owner: Reflect.get(meta, "migration_owner"),
        migration_started_at: Reflect.get(meta, "migration_started_at"),
      }, {
        schema_version: 21,
        migration_owner: null,
        migration_started_at: null,
      });
      assert.equal(unchanged.prepare(`
        SELECT name FROM sqlite_master
        WHERE name = 'activity_person_pseudonym_generations'
      `).get(), undefined);
      assert.equal(Reflect.get(unchanged.prepare(`
        SELECT count(*) AS count FROM sqlite_master
        WHERE name LIKE 'activity_person_pseudonym_generations_%'
           OR name = 'activity_person_pseudonyms_require_generation_binding'
      `).get() ?? {}, "count"), 0);
      assert.equal(unchanged.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'activity_person_pseudonym_v21_upgrade_guard'
      `).get(), undefined);
      assert.equal(unchanged.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger' AND name = 'activity_person_pseudonym_v21_upgrade_guard_refusal'
      `).get(), undefined);
    } finally {
      unchanged.close();
    }
  });

  it("refuses an empty exact DCR v21 suffix instead of converting it", () => {
    const path = databasePath("empty-pseudonym-v21.sqlite");
    createExactV21Database(path, false);

    assertD290RefusalWithoutMutation(path, "DCR", 21);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(raw.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'activity_person_pseudonym_generations'
      `).get(), undefined);
    } finally {
      raw.close();
    }
  });

  it("refuses an exact DCR v22 suffix with matching generation authority", () => {
    const path = databasePath("bound-pseudonym-v22.sqlite");
    createExactV22Database(path, "bound");

    assertD290RefusalWithoutMutation(path, "DCR", 22);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(raw.prepare(`
        SELECT count(*) AS count FROM activity_person_pseudonyms
      `).get() ?? {}, "count"), 1);
      assert.equal(Reflect.get(raw.prepare(`
        SELECT count(*) AS count
        FROM activity_person_pseudonyms AS evidence
        JOIN activity_person_pseudonym_generations AS generation
          ON generation.key_generation = evidence.key_generation
      `).get() ?? {}, "count"), 1);
      assert.equal(Reflect.get(raw.prepare(`
        SELECT count(*) AS count FROM sqlite_master
        WHERE name IN (
          'activity_person_pseudonym_v21_upgrade_guard',
          'activity_person_pseudonym_v21_upgrade_guard_refusal'
        )
      `).get() ?? {}, "count"), 0);
    } finally {
      raw.close();
    }
  });

  it("refuses exact DCR v23 XLSX evidence without backfilling actor attribution", () => {
    const path = databasePath("operator-xlsx-v23.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec("BEGIN EXCLUSIVE");
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 23)) {
      for (const statement of migration.statements) legacy.exec(statement);
    }
    legacy.prepare(`
      INSERT INTO authority_meta (
        singleton_id, schema_version, authority_generation, updated_at,
        migration_owner, migration_started_at
      ) VALUES (1, 23, 0, ?, NULL, NULL)
    `).run(NOW);
    legacy.prepare(`
      INSERT INTO operator_xlsx_exports (
        record_key, selection_kind, artifact_id, digest, byte_length,
        media_type, filename, record_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      OPERATOR_XLSX_EXPORT.exportId,
      OPERATOR_XLSX_EXPORT.selection.kind,
      OPERATOR_XLSX_EXPORT.artifact.id,
      OPERATOR_XLSX_EXPORT.download.sha256,
      OPERATOR_XLSX_EXPORT.download.byteLength,
      OPERATOR_XLSX_EXPORT.download.mediaType,
      OPERATOR_XLSX_EXPORT.download.filename,
      JSON.stringify(OPERATOR_XLSX_EXPORT),
      OPERATOR_XLSX_EXPORT.createdAt,
    );
    legacy.exec("PRAGMA application_id = 1217249861");
    legacy.exec("PRAGMA user_version = 23");
    legacy.exec("COMMIT");
    legacy.close();

    assertD290RefusalWithoutMutation(path, "DCR", 23);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const columns = raw.prepare("PRAGMA table_info(operator_xlsx_exports)").all() as Array<{ readonly name: string }>;
      const columnNames = columns.map(({ name }) => name);
      assert.equal(columnNames.includes("requested_by"), false);
    } finally {
      raw.close();
    }
  });

  it("refuses orphaned exact v22 evidence and leaves v22 without guard residue", () => {
    const path = databasePath("orphaned-pseudonym-v22.sqlite");
    createExactV22Database(path, "orphaned");

    assertD290RefusalWithoutMutation(path, "DCR", 22);

    const unchanged = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(unchanged.prepare("PRAGMA user_version").get() ?? {}, "user_version"), 22);
      const meta = unchanged.prepare(`
        SELECT schema_version, migration_owner, migration_started_at
        FROM authority_meta WHERE singleton_id = 1
      `).get() ?? {};
      assert.deepEqual({
        schema_version: Reflect.get(meta, "schema_version"),
        migration_owner: Reflect.get(meta, "migration_owner"),
        migration_started_at: Reflect.get(meta, "migration_started_at"),
      }, {
        schema_version: 22,
        migration_owner: null,
        migration_started_at: null,
      });
      assert.equal(Reflect.get(unchanged.prepare(`
        SELECT count(*) AS count FROM activity_person_pseudonyms
      `).get() ?? {}, "count"), 1);
      assert.equal(Reflect.get(unchanged.prepare(`
        SELECT count(*) AS count FROM activity_person_pseudonym_generations
      `).get() ?? {}, "count"), 0);
      assert.equal(Reflect.get(unchanged.prepare(`
        SELECT count(*) AS count FROM sqlite_master
        WHERE name IN (
          'activity_person_pseudonym_v21_upgrade_guard',
          'activity_person_pseudonym_v21_upgrade_guard_refusal'
        )
      `).get() ?? {}, "count"), 0);
    } finally {
      unchanged.close();
    }
  });

  it("keeps the released migration chain over the exact committed Stage-B v1 shape", () => {
    const path = databasePath("stage-b-v1.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec("BEGIN EXCLUSIVE");
    for (const statement of SQLITE_MIGRATIONS[0].statements) legacy.exec(statement);
    legacy.prepare(`
      INSERT INTO authority_meta (
        singleton_id, schema_version, authority_generation, updated_at,
        migration_owner, migration_started_at
      ) VALUES (1, 1, 0, ?, NULL, NULL)
    `).run(NOW);
    legacy.prepare(`
      INSERT INTO commands (record_key, family, record_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(UUID_1, "start", JSON.stringify(COMMAND_FIXTURES[0]), NOW);
    legacy.prepare(`
      INSERT INTO write_intents (
        record_key, idempotency_key_digest, status, record_json, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      OBSERVED_PRESENT_WRITE_INTENT.writeIntentId,
      OBSERVED_PRESENT_WRITE_INTENT.idempotencyKeyDigest,
      OBSERVED_PRESENT_WRITE_INTENT.status,
      JSON.stringify(OBSERVED_PRESENT_WRITE_INTENT),
      NOW,
    );
    legacy.exec("PRAGMA application_id = 1217249861");
    legacy.exec("PRAGMA user_version = 1");
    legacy.exec("COMMIT");
    assert.deepEqual(
      (legacy.prepare("PRAGMA table_info(write_intents)").all() as Array<{ name: string }>).map(({ name }) => name),
      ["record_key", "idempotency_key_digest", "status", "record_json", "created_at"],
    );
    legacy.close();

    applyReleasedMigrationChainForTest(path, 1);
    const upgraded = openDatabase(path);
    assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(upgraded.authority.commands.get(UUID_1), COMMAND_FIXTURES[0]);
    assert.equal(
      upgraded.authority.writeIntents.findByPermanentKey(
        OBSERVED_PRESENT_WRITE_INTENT.system,
        OBSERVED_PRESENT_WRITE_INTENT.idempotencyKey,
      )?.writeIntentId,
      OBSERVED_PRESENT_WRITE_INTENT.writeIntentId,
    );
    assert.equal(upgraded.authority.writeIntents.fenceAttempt({
      intent: WRITE_INTENT_ATTEMPTING,
      attempt: WRITE_ATTEMPT,
    }).state, "fenced");
    upgraded.commitWriteAttempt(ATOMIC_WRITE_COMMIT);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
  });

  it("invalidates exact v5 start plans that cannot retain D109 raw ingress and boots requiring re-plan", () => {
    const path = databasePath("d109-v5-start-plan.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec("BEGIN EXCLUSIVE");
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 5)) {
      for (const statement of migration.statements) legacy.exec(statement);
    }
    legacy.prepare(`
      INSERT INTO authority_meta (
        singleton_id, schema_version, authority_generation, updated_at,
        migration_owner, migration_started_at
      ) VALUES (1, 5, 0, ?, NULL, NULL)
    `).run(NOW);
    legacy.prepare(`
      INSERT INTO start_plans (
        record_key, workflow, consumed_by, expires_at, version, record_json, created_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?)
    `).run(
      LEGACY_V5_START_PLAN.startPlanId,
      LEGACY_V5_START_PLAN.workflowId,
      LATER,
      LEGACY_V5_START_PLAN.version,
      JSON.stringify(LEGACY_V5_START_PLAN),
      NOW,
    );
    legacy.exec("PRAGMA application_id = 1217249861");
    legacy.exec("PRAGMA user_version = 5");
    legacy.exec("COMMIT");
    assert.equal(
      legacy.prepare("SELECT record_json FROM start_plans WHERE record_key = ?")
        .get(LEGACY_V5_START_PLAN.startPlanId)?.record_json,
      JSON.stringify(LEGACY_V5_START_PLAN),
    );
    legacy.close();

    applyReleasedMigrationChainForTest(path, 5);
    const upgraded = openDatabase(path);
    assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(upgraded.authority.startPlans.get(LEGACY_V5_START_PLAN.startPlanId), undefined);
    assert.throws(
      () => upgraded.authority.startPlans.consume({
        startPlanId: LEGACY_V5_START_PLAN.startPlanId,
        expectedVersion: 1,
        commandId: UUID_1,
        descriptorFingerprint: HASH_A,
        configFingerprint: HASH_B,
        ingressSchemaHash: HASH_A,
        canonicalInputSchemaHash: HASH_B,
        inputFingerprint: HASH_A,
        now: NOW,
      }),
      /does not exist/,
      "a v5 confirmation must re-plan; canonical input is never fabricated as raw ingress",
    );
  });

  it("keeps the released chain from v6 without changing existing authority", () => {
    const path = databasePath("d110-d114-v6.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec("BEGIN EXCLUSIVE");
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 6)) {
      for (const statement of migration.statements) legacy.exec(statement);
    }
    legacy.prepare(`
      INSERT INTO authority_meta (
        singleton_id, schema_version, authority_generation, updated_at,
        migration_owner, migration_started_at
      ) VALUES (1, 6, 0, ?, NULL, NULL)
    `).run(NOW);
    legacy.prepare(`
      INSERT INTO start_plans (
        record_key, workflow, consumed_by, expires_at, version, record_json, created_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?)
    `).run(
      START_PLAN.startPlanId,
      START_PLAN.workflowId,
      START_PLAN.expiresAt,
      START_PLAN.version,
      JSON.stringify(START_PLAN),
      START_PLAN.createdAt,
    );
    legacy.exec("PRAGMA application_id = 1217249861");
    legacy.exec("PRAGMA user_version = 6");
    legacy.exec("COMMIT");
    const beforeTables = (legacy.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `).all() as Array<{ name: string }>).map(({ name }) => name);
    assert.equal(beforeTables.includes("failures"), false);
    assert.equal(beforeTables.includes("run_results"), false);
    assert.equal(beforeTables.includes("run_terminal_outbox"), false);
    legacy.close();

    applyReleasedMigrationChainForTest(path, 6);
    const upgraded = openDatabase(path);
    assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(upgraded.authority.startPlans.get(START_PLAN.startPlanId), START_PLAN);
    assert.equal(upgraded.authority.failures.listByRun(RUN_ID).length, 0);
    assert.equal(upgraded.authority.runResults.get(RUN_ID), undefined);
    assert.equal(upgraded.authority.runTerminalOutbox.findByRun(RUN_ID), undefined);
    assert.equal(upgraded.authority.terminalAuthorizations.get(RUN_ID), undefined);
  });

  it("keeps the released chain from v7, reopens, and validates read-only", () => {
    const path = databasePath("d110-d114-v7.sqlite");
    const releasedV7 = SQLITE_MIGRATIONS.find(({ version }) => version === 7);
    assert.notEqual(releasedV7, undefined);
    assert.equal(releasedV7?.statements.length, 5);
    assert.equal(
      releasedV7?.statements.some((statement) => statement.includes("run_terminal_authorizations")),
      false,
      "the digest guard pins exact bytes/order; this fixture pins that released v7 cannot create the v8 table",
    );

    const legacy = new DatabaseSync(path);
    legacy.exec("BEGIN EXCLUSIVE");
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 7)) {
      for (const statement of migration.statements) legacy.exec(statement);
    }
    legacy.prepare(`
      INSERT INTO authority_meta (
        singleton_id, schema_version, authority_generation, updated_at,
        migration_owner, migration_started_at
      ) VALUES (1, 7, 0, ?, NULL, NULL)
    `).run(NOW);
    legacy.prepare(`
      INSERT INTO commands (record_key, family, record_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(UUID_1, "start", JSON.stringify(COMMAND_FIXTURES[0]), NOW);
    legacy.exec("PRAGMA application_id = 1217249861");
    legacy.exec("PRAGMA user_version = 7");
    legacy.exec("COMMIT");
    const v7Tables = (legacy.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all() as Array<{ name: string }>).map(({ name }) => name);
    assert.equal(v7Tables.includes("run_terminal_authorizations"), false);
    legacy.close();

    applyReleasedMigrationChainForTest(path, 7);
    const upgraded = openDatabase(path);
    assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(upgraded.authority.commands.get(UUID_1), COMMAND_FIXTURES[0]);
    assert.equal(upgraded.authority.terminalAuthorizations.get(RUN_ID), undefined);
    assert.equal(upgraded.authority.providerAdmissions.get(UUID_8), undefined);
    upgraded.close();

    const migrated = new DatabaseSync(path, { readOnly: true });
    assert.equal(
      migrated.prepare(`
        SELECT count(*) AS count FROM sqlite_master
        WHERE type = 'index' AND name = 'run_terminal_authorizations_kind_idx'
      `).get()?.count,
      1,
    );
    assert.equal(
      migrated.prepare(`
        SELECT count(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN ('provider_budget_counters', 'provider_admissions')
      `).get()?.count,
      2,
    );
    migrated.close();
    const reopened = openDatabase(path);
    assert.equal(reopened.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    reopened.close();
    assert.equal(
      AuthorityDatabase.inspectExistingReadOnly(path).schemaVersion,
      CURRENT_AUTHORITY_SCHEMA_VERSION,
    );
  });

  it("reopens an already-current database without rerunning the migration", () => {
    const path = databasePath();
    const first = openDatabase(path);
    first.authority.commands.insert(COMMAND_FIXTURES[0]);
    const before = first.getMeta();
    first.close();
    const reopened = openDatabase(path);
    assert.deepEqual(reopened.getMeta(), before);
    assert.deepEqual(reopened.authority.commands.get(UUID_1), COMMAND_FIXTURES[0]);
  });

  it("refuses the exact complete divergent DCC1 v21 suffix before migration or mutation", () => {
    const path = databasePath("dcc1-source-v21.sqlite");
    createExactIntegratedSuffixDatabase(path, 21, 25);
    assertD290RefusalWithoutMutation(path, "DCC1", 21);
  });

  it("refuses the exact superseded DCC4 v19 suffix before migration or mutation", () => {
    const path = databasePath("dcc4-source-v19.sqlite");
    createExactDcc4SourceDatabase(path);
    assertD290RefusalWithoutMutation(path, "DCC4", 19);
  });

  it("fails loud for empty, foreign, newer, locked, and structurally invalid databases", () => {
    const emptyPath = databasePath("empty.sqlite");
    writeFileSync(emptyPath, "");
    assert.throws(() => openDatabase(emptyPath), /exists but is empty/);

    const foreignPath = databasePath("foreign.sqlite");
    writeFileSync(foreignPath, "not a sqlite database");
    const foreignBytes = readFileSync(foreignPath);
    assert.throws(() => openDatabase(foreignPath), /failed to open authority database/);
    assert.deepEqual(readFileSync(foreignPath), foreignBytes);

    const newerPath = databasePath("newer.sqlite");
    openDatabase(newerPath).close();
    const newer = new DatabaseSync(newerPath);
    newer.exec(`PRAGMA user_version = ${String(CURRENT_AUTHORITY_SCHEMA_VERSION + 1)}`);
    newer.close();
    assert.throws(() => openDatabase(newerPath), /newer than supported/);

    const markedPath = databasePath("marked.sqlite");
    openDatabase(markedPath).close();
    const marked = new DatabaseSync(markedPath);
    marked.prepare(`
      UPDATE authority_meta
      SET migration_owner = ?, migration_started_at = ?
      WHERE singleton_id = 1
    `).run("other-process", NOW);
    marked.close();
    assert.throws(() => openDatabase(markedPath), /locked by migration owner other-process/);

    const malformedPath = databasePath("malformed.sqlite");
    openDatabase(malformedPath).close();
    const malformed = new DatabaseSync(malformedPath);
    malformed.exec("DROP TABLE notes");
    malformed.close();
    assert.throws(() => openDatabase(malformedPath), /tables do not match registry/);

    const badForeignKeyPath = databasePath("bad-foreign-key.sqlite");
    openDatabase(badForeignKeyPath).close();
    const badForeignKey = new DatabaseSync(badForeignKeyPath, { enableForeignKeyConstraints: false });
    badForeignKey.prepare(`
      INSERT INTO command_audits (record_key, command_id, record_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(UUID_2, UUID_8, JSON.stringify(COMMAND_AUDIT), NOW);
    badForeignKey.close();
    assert.throws(() => openDatabase(badForeignKeyPath), /foreign-key validation failed/);
  });

  it("fails when another connection holds the migration/write lease", () => {
    const path = databasePath();
    openDatabase(path).close();
    const locker = new DatabaseSync(path);
    locker.exec("BEGIN EXCLUSIVE");
    const contender = openDatabase(path, 10);
    assert.throws(() => contender.authority.commands.insert(COMMAND_FIXTURES[0]), /database is locked/);
    assert.equal(contender.getMeta().authorityGeneration, 0);
    locker.exec("ROLLBACK");
    locker.close();
  });
});

const INTAKE_SESSION = {
  intakeSessionId: "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5e",
  actorId: "local-operator",
  workflow: "person-lookup",
  artifact: {
    id: "11111111-2222-4333-8444-555555555555",
    sha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
    bytes: 2048,
    mediaType: "text/csv",
  },
  sheet: "default",
  headerRowIndex: null,
  bindings: [],
  constants: [],
  corrections: [],
  exclusions: [],
  state: "mapping",
  validation: { state: "none" },
  reservedManifestId: "8e7d6c5b-4a39-4827-9615-0f1e2d3c4b5a",
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};
const INTAKE_MANIFEST = {
  version: 1,
  manifestId: "9f8a1c2d-4b5e-4a6f-9c8d-0e1f2a3b4c5d",
  workflow: "work-study",
  source: {
    artifactId: "11111111-2222-4333-8444-555555555555",
    sha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
    originalName: "WorkStudy_July.xlsx",
  },
  mappingFingerprint: "a".repeat(64),
  mappingSnapshotHash: "b".repeat(64),
  intakeProjectionFingerprint: "c".repeat(64),
  workflowContractFingerprint: "d".repeat(64),
  canonicalInputSchemaHash: "e".repeat(64),
  createdAt: "2026-08-07T09:00:00.000Z",
  totals: { sourceRows: 1, valid: 1, rejected: 0, rejectionEvents: 0, excluded: 0, corrected: 0 },
  sourceRowDispositions: [{
    sourceRow: 1,
    disposition: "valid",
    itemId: "22222222-3333-4444-8555-666666666666",
    currentRejectIds: [],
  }],
  validRows: [{
    sourceRow: 1,
    itemId: "22222222-3333-4444-8555-666666666666",
    inputHash: "f".repeat(64),
    parsedInput: { emplId: "10456712" },
  }],
  rejectedRows: [],
  corrections: [],
  exclusions: [],
};

const OCR_EXTRACTION = {
  formType: "oath",
  source: { kind: "local-agent", agentId: "claude-code", invocation: "read page1.png" },
  readAt: "2026-08-07T09:00:00.000Z",
  sourceSha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
  sourcePage: 1,
  pageKind: "emergency-contact",
  record: null,
  pageFingerprint: "1".repeat(64),
};
const DRY_RUN_SCENARIO_RESULT = {
  resultId: UUID_8,
  scenarioId: "person-lookup/dry-run",
  workflow: "person-lookup",
  subjectLabel: "ordinary-canary",
  manifestDigest: HASH_A,
  verdict: "blocked",
  assertions: [{
    assertionId: "subject-available",
    verdict: "blocked",
    reason: "subject-unavailable",
  }],
  wallTimeMs: 0,
  recordedAt: NOW,
  execution: { state: "not-started", reason: "subject-unavailable" },
};

describe("authority generation accounting", () => {
  it("keeps one read snapshot while another connection commits without waiting", () => {
    const path = databasePath("concurrent-read-snapshot.sqlite");
    const reader = openDatabase(path, 10);
    const writer = openDatabase(path, 10);

    const during = reader.withAuthorityReadSnapshot(() => {
      const generation = reader.getMeta().authorityGeneration;
      writer.authority.notifications.create(NOTIFICATION);
      return {
        generation,
        generationAfterWriterCommit: reader.getMeta().authorityGeneration,
        notification: reader.authority.notifications.get(NOTIFICATION.notificationId),
      };
    });

    assert.deepEqual({
      during,
      generationAfterSnapshot: reader.getMeta().authorityGeneration,
      notificationAfterSnapshot: reader.authority.notifications.get(NOTIFICATION.notificationId),
    }, {
      during: {
        generation: 0,
        generationAfterWriterCommit: 0,
        notification: undefined,
      },
      generationAfterSnapshot: 1,
      notificationAfterSnapshot: NOTIFICATION,
    });
  });

  type MutationCase = Readonly<{
    table: Exclude<AuthorityTableName, "authority_meta">;
    prepare?: (database: AuthorityDatabase) => void;
    mutate: (database: AuthorityDatabase) => void;
  }>;

  const cases: readonly MutationCase[] = [
    { table: "workflow_runs", mutate: (db) => { db.authority.runs.enqueue(QUEUED_RUN); } },
    {
      table: "failures",
      prepare: (db) => { prepareRunning(db); },
      mutate: (db) => {
        const run = db.authority.runs.get(RUN_ID);
        if (run === undefined) throw new Error("failure generation fixture lost its run");
        db.terminalizeFailure(personLookupDescriptor, terminalFailureRequest(run));
      },
    },
    {
      table: "run_terminal_authorizations",
      prepare: (db) => { prepareRunning(db); },
      mutate: (db) => {
        const run = db.authority.runs.get(RUN_ID);
        if (run === undefined) throw new Error("authorization generation fixture lost its run");
        db.terminalizeFailure(personLookupDescriptor, terminalFailureRequest(run));
      },
    },
    {
      table: "run_results",
      prepare: (db) => {
        const run = prepareRunning(db);
        terminalSuccessRequest(db, run);
      },
      mutate: (db) => {
        const run = db.authority.runs.get(RUN_ID);
        if (run === undefined) throw new Error("result generation fixture lost its run");
        const terminal = terminalSuccessRequest(db, run);
        db.terminalizeSuccess(terminal.request, terminal.factoryAuthorization);
      },
    },
    {
      table: "run_terminal_outbox",
      prepare: (db) => {
        const run = prepareRunning(db);
        terminalSuccessRequest(db, run);
      },
      mutate: (db) => {
        const run = db.authority.runs.get(RUN_ID);
        if (run === undefined) throw new Error("outbox generation fixture lost its run");
        const terminal = terminalSuccessRequest(db, run);
        db.terminalizeSuccess(terminal.request, terminal.factoryAuthorization);
      },
    },
    {
      table: "diagnostic_bundles",
      prepare: (db) => { terminalizeForTrust(db); },
      mutate: (db) => { db.authority.diagnosticBundles.insert(DIAGNOSTIC_BUNDLE); },
    },
    {
      table: "diagnostic_attachments",
      prepare: (db) => { terminalizeForTrust(db); },
      mutate: (db) => { db.authority.diagnosticBundles.insert(DIAGNOSTIC_BUNDLE); },
    },
    {
      table: "evidence_receipts",
      prepare: (db) => { terminalizeForTrust(db); },
      mutate: (db) => { db.authority.evidenceReceipts.insert(EVIDENCE_RECEIPT); },
    },
    {
      table: "dry_run_scenario_results",
      mutate: (db) => { db.authority.dryRunScenarioResults.insert(DRY_RUN_SCENARIO_RESULT); },
    },
    {
      table: "operator_xlsx_exports",
      mutate: (db) => { db.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT); },
    },
    {
      table: "activity_person_pseudonyms",
      prepare: (db) => {
        const path = databasePaths.get(db);
        if (path === undefined) throw new Error("pseudonym generation fixture lost its database path");
        seedTerminalSeparationsResult(db, path);
      },
      mutate: (db) => {
        const domain = createActivityPersonPseudonymDomain({
          keyGeneration: "activity-person-g1",
          keyHex: ACTIVITY_PERSON_PSEUDONYM_KEY_HEX,
        });
        db.createActivityPersonPseudonymBackfillWriteCapability(domain)
          .reviewAndInsert([TERMINAL_SEPARATIONS_RUN.envelope.runId]);
      },
    },
    {
      table: "activity_person_pseudonym_generations",
      prepare: (db) => {
        const path = databasePaths.get(db);
        if (path === undefined) throw new Error("pseudonym generation fixture lost its database path");
        seedTerminalSeparationsResult(db, path);
      },
      mutate: (db) => {
        const domain = createActivityPersonPseudonymDomain({
          keyGeneration: "activity-person-g1",
          keyHex: ACTIVITY_PERSON_PSEUDONYM_KEY_HEX,
        });
        db.createActivityPersonPseudonymBackfillWriteCapability(domain)
          .reviewAndInsert([TERMINAL_SEPARATIONS_RUN.envelope.runId]);
      },
    },
    { table: "intake_manifests", mutate: (db) => { db.authority.intakeManifests.insert(INTAKE_MANIFEST); } },
    { table: "intake_sessions", mutate: (db) => { db.authority.intakeSessions.create(INTAKE_SESSION); } },
    { table: "ocr_extractions", mutate: (db) => { db.authority.ocrExtractions.insert(OCR_EXTRACTION); } },
    { table: "knowledge_records", mutate: (db) => { db.authority.knowledgeRecords.insert(KNOWLEDGE_RECORD); } },
    { table: "fix_records", mutate: (db) => { db.authority.fixRecords.insert(FIX_RECORD); } },
    { table: "ledger_partitions", mutate: (db) => { acquireLedgerLease(db); } },
    {
      table: "ledger_projections",
      prepare: (db) => {
        db.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
        db.commitWriteAttempt(ATOMIC_WRITE_COMMIT);
        acquireLedgerLease(db);
      },
      mutate: (db) => {
        const partition = db.authority.ledgerProjection.getPartition(LEDGER_PARTITION.system, LEDGER_PARTITION.date);
        if (partition === undefined) throw new Error("ledger generation fixture lost its partition");
        db.authority.ledgerProjection.assignSequence({
          ...LEDGER_PARTITION,
          projectorId: LEDGER_PROJECTOR_ID,
          leaseGeneration: partition.leaseGeneration,
          outboxId: UUID_7,
          lineDigest: HASH_A,
          assignedAt: NOW,
        });
      },
    },
    { table: "provider_budget_counters", prepare: prepareProviderRunning, mutate: reserveProvider },
    { table: "provider_admissions", prepare: prepareProviderRunning, mutate: reserveProvider },
    { table: "workflow_workers", mutate: (db) => { db.authority.workerLeases.start(WORKER_START_REQUEST); } },
    {
      table: "worker_auth",
      mutate: (db) => {
        db.authority.duoCeremonyLeases.acquire({
          credentialKey: "ab".repeat(32), workerId: "worker-a", system: "ucpath",
          now: "2026-08-21T10:00:00.000Z", ttlMs: 80_000,
        });
      },
    },
    {
      table: "worker_pools",
      mutate: (db) => {
        db.authority.workerPools.plan({
          workflow: WORKFLOW_ID, expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: NOW,
        });
      },
    },
    { table: "workflow_run_batches", mutate: (db) => { db.authority.runSessions.insert(RUN_SESSION); } },
    {
      // D308 — the tombstone is written by the delete cascade and by nothing else.
      table: "deleted_runs",
      prepare: (db) => {
        const run = prepareRunning(db);
        const settled = db.authority.runs.transition({
          runId: RUN_ID,
          expectedVersion: run.version,
          claim: { workerId: WORKER_ID, claimGeneration: 1 },
          lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
          now: NOW,
        });
        if (settled.state !== "applied") throw new Error("deleted_runs fixture could not settle its run");
      },
      mutate: (db) => { db.authority.runs.delete({ runId: RUN_ID, origin: "queue", commandId: UUID_7, now: NOW }); },
    },
    { table: "delegation_manifests", mutate: (db) => { db.authority.delegationManifests.insert(DELEGATION_MANIFEST); } },
    { table: "dependencies", prepare: (db) => { db.authority.delegationManifests.insert(DELEGATION_MANIFEST); }, mutate: (db) => { db.authority.dependencies.insert(DEPENDENCY_RECORD); } },
    { table: "commands", mutate: (db) => { db.authority.commands.insert(COMMAND_FIXTURES[0]); } },
    { table: "command_audits", prepare: (db) => { db.authority.commands.insert(COMMAND_FIXTURES[0]); }, mutate: (db) => { db.authority.commandAudits.insert(COMMAND_AUDIT); } },
    {
      table: "bulk_command_acceptances",
      mutate: (db) => { db.authority.bulkCommandAcceptances.insert(BULK_COMMAND_ACCEPTANCE); },
    },
    { table: "notifications", mutate: (db) => { db.authority.notifications.create(NOTIFICATION); } },
    { table: "config_snapshots", mutate: (db) => { db.authority.configSnapshots.insert(CONFIG_SNAPSHOT); } },
    {
      table: "settings_current",
      prepare: (db) => {
        db.authority.commands.insert(SETTINGS_CURRENT_COMMAND);
        db.authority.commandAudits.insert(SETTINGS_CURRENT_AUDIT);
      },
      mutate: (db) => {
        db.authority.settingsCurrent.advance({
          revision: 2,
          settings: {},
          settingsFingerprint: derivePersistedSettingsFingerprint({}),
          commandId: SETTINGS_CURRENT_COMMAND.commandId,
          commandFingerprint: deriveSettingsCommandFingerprint(SETTINGS_CURRENT_COMMAND),
          auditId: SETTINGS_CURRENT_AUDIT.auditId,
          committedAt: NOW,
        });
      },
    },
    {
      table: "runtime_config",
      prepare: (db) => { db.authority.configSnapshots.insert(CONFIG_SNAPSHOT); },
      mutate: (db) => {
        db.authority.runtimeConfig.activate({
          settingsRevision: 1,
          settingsFingerprint: HASH_A,
          configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
          configFingerprint: CONFIG_SNAPSHOT.fingerprint,
          activatedAt: NOW,
        });
      },
    },
    { table: "version_plans", mutate: (db) => { db.authority.versionPlans.insert(VERSION_PLAN_ROW); } },
    // D179: the archive's three durable facts. Each needs the row it references
    // to exist first — the FKs are `ON DELETE RESTRICT` on purpose, so an
    // archived run can never outlive the run row it describes.
    {
      table: "version_bump_applications",
      prepare: (db) => { db.authority.versionPlans.insert(VERSION_PLAN_ROW); },
      mutate: (db) => { db.authority.versionBumpApplications.insert(VERSION_BUMP_APPLICATION); },
    },
    {
      table: "archived_runs",
      prepare: (db) => {
        db.authority.runs.enqueue(QUEUED_RUN);
        db.authority.versionPlans.insert(VERSION_PLAN_ROW);
        db.authority.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
      },
      mutate: (db) => { db.authority.archivedRuns.insert(ARCHIVED_RUN); },
    },
    {
      table: "archive_relaunches",
      prepare: (db) => {
        db.authority.runs.enqueue(QUEUED_RUN);
        db.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId: ARCHIVE_RELAUNCH.runId, itemId: RELAUNCH_ITEM_ID, traceId: "pl-170001-3333" } });
        db.authority.versionPlans.insert(VERSION_PLAN_ROW);
        db.authority.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
        db.authority.archivedRuns.insert(ARCHIVED_RUN);
      },
      mutate: (db) => { db.authority.archiveRelaunches.insert(ARCHIVE_RELAUNCH); },
    },
    { table: "checkpoint_payloads", mutate: (db) => { db.authority.gateResults.insert(GATE_RESULT); } },
    { table: "run_checkpoints", mutate: (db) => { db.authority.runCheckpoints.insert(RUN_CHECKPOINT); } },
    { table: "workflow_run_requests", mutate: (db) => { db.authority.startPlans.create(START_PLAN); } },
    { table: "ocr_approvals", mutate: (db) => { db.authority.opaque.ocrApprovals.insert(OPAQUE_RECORD); } },
    { table: "run_operations", mutate: (db) => { db.authority.writeIntents.recordObservedPresent(OBSERVED_PRESENT_WRITE_INTENT); } },
    { table: "run_operation_attempts", mutate: (db) => { db.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }); } },
    {
      table: "operation_outbox",
      prepare: (db) => { db.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }); },
      mutate: (db) => { db.commitWriteAttempt(ATOMIC_WRITE_COMMIT); },
    },
    { table: "artifact_outbox", mutate: (db) => { db.authority.artifactOutbox.insert(ARTIFACT_OUTBOX); } },
    { table: "artifact_sink_heads", mutate: (db) => { db.authority.artifactSinkHeads.record(ARTIFACT_SINK_HEAD_REQUEST); } },
  ];

  it("accounts for every authority table and increments once per outer authority mutation", () => {
    assert.deepEqual(cases.map(({ table }) => table).sort(), AUTHORITY_TABLE_REGISTRY
      .filter(({ classification, name }) => classification === "authority"
        && !["authority_meta", "authority_upgrades"].includes(name))
      .map(({ name }) => name)
      .sort());
    for (const mutation of cases) {
      const database = openDatabase();
      mutation.prepare?.(database);
      const before = database.getMeta().authorityGeneration;
      mutation.mutate(database);
      assert.equal(database.getMeta().authorityGeneration, before + 1, mutation.table);
      database.close();
    }
  });

  it("#16 enumerates every current never-delete trigger and each aborts without a tombstone", () => {
    const currentTriggerNames = new Set<string>();
    const triggerTables = new Map<string, string>();
    for (const { statements } of SQLITE_MIGRATIONS) {
      for (const statement of statements) {
        for (const match of statement.matchAll(/DROP TRIGGER(?: IF EXISTS)?\s+([a-z0-9_]+_never_deleted)\b/gu)) currentTriggerNames.delete(match[1]);
        for (const match of statement.matchAll(/CREATE TRIGGER\s+([a-z0-9_]+_never_deleted)\s+BEFORE DELETE ON ([a-z0-9_]+)/gu)) {
          currentTriggerNames.add(match[1]);
          triggerTables.set(match[1], match[2]);
        }
        for (const match of statement.matchAll(/DROP TABLE\s+([a-z0-9_]+)/gu)) {
          for (const [trigger, table] of triggerTables) if (table === match[1]) currentTriggerNames.delete(trigger);
        }
      }
    }
    const expectedTriggerNames = [...currentTriggerNames].sort();
    const inventoryDatabase = openDatabase();
    const inventoryPath = databasePaths.get(inventoryDatabase);
    if (inventoryPath === undefined) throw new Error("never-delete inventory fixture lost its path");
    const inventorySqlite = new DatabaseSync(inventoryPath);
    const triggers = inventorySqlite.prepare(`
      SELECT name, tbl_name AS tableName
      FROM sqlite_master
      WHERE type = 'trigger' AND name GLOB '*_never_deleted'
      ORDER BY name
    `).all() as { name: string; tableName: string }[];
    inventorySqlite.close();
    assert.deepEqual(triggers.map(({ name }) => name), expectedTriggerNames);

    for (const trigger of triggers) {
      assert.match(trigger.tableName, /^[a-z0-9_]+$/u);
      const database = openDatabase();
      const path = databasePaths.get(database);
      if (path === undefined) throw new Error(`${trigger.name} fixture lost its path`);
      const mutation = cases.find(({ table }) => table === trigger.tableName);
      if (mutation !== undefined) {
        mutation.prepare?.(database);
        mutation.mutate(database);
      } else {
        assert.equal(trigger.tableName, "authority_upgrades", `${trigger.name} has no fixture`);
      }
      const sqlite = new DatabaseSync(path);
      const count = sqlite.prepare(`SELECT count(*) AS count FROM "${trigger.tableName}"`).get() as { count: number };
      assert.ok(count.count > 0, `${trigger.name} must be driven against a real row`);
      assert.throws(
        () => sqlite.exec(`DELETE FROM "${trigger.tableName}"`),
        /never deleted/u,
        trigger.name,
      );
      sqlite.close();
    }
  });

  it("shares nested authority transactions and increments exactly once", () => {
    const database = openDatabase();
    database.withAuthorityTransaction((authority) => {
      authority.commands.insert(COMMAND_FIXTURES[0]);
      database.withAuthorityTransaction((nested) => {
        nested.notifications.create(NOTIFICATION);
      });
    });
    assert.equal(database.getMeta().authorityGeneration, 1);
  });

  it("rolls back a caught nested fence failure to its savepoint without leaking an intent", () => {
    const database = openDatabase();
    database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    const generationBefore = database.getMeta().authorityGeneration;
    const competingKey = "10001573|termination|2026-08-03";
    const competingIntent = {
      ...WRITE_INTENT_ATTEMPTING,
      writeIntentId: UUID_8,
      idempotencyKey: competingKey,
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", competingKey),
    };
    const competingAttempt = { ...WRITE_ATTEMPT, writeIntentId: UUID_8 };

    database.withAuthorityTransaction(() => {
      assert.throws(
        () => database.authority.writeIntents.fenceAttempt({ intent: competingIntent, attempt: competingAttempt }),
        /UNIQUE constraint failed: run_operation_attempts.record_key/,
      );
    });

    assert.equal(database.authority.writeIntents.get(UUID_8), undefined);
    assert.equal(database.authority.writeIntents.get(UUID_1)?.status, "attempting");
    assert.equal(database.getMeta().authorityGeneration, generationBefore);
  });

  it("rolls back a caught nested atomic outbox failure while committing unrelated outer work once", () => {
    const path = databasePath();
    const database = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
      CLOCK,
      { afterStorageStep: (step) => { if (step === "ledger-outbox") throw new Error("injected nested outbox failure"); } },
    );
    openDatabases.push(database);
    database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT });
    const generationBefore = database.getMeta().authorityGeneration;

    database.withAuthorityTransaction((authority) => {
      authority.notifications.create(NOTIFICATION);
      assert.throws(() => database.commitWriteAttempt(ATOMIC_WRITE_COMMIT), /injected nested outbox failure/);
    });

    assert.deepEqual(database.authority.notifications.get(UUID_3), NOTIFICATION);
    assert.equal(database.authority.writeIntents.get(UUID_1)?.status, "attempting");
    assert.equal(database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId)?.outcome.state, "attempting");
    assert.equal(database.authority.durableOutbox.get(UUID_7), undefined);
    assert.equal(database.authority.durableOutbox.get(UUID_8), undefined);
    assert.equal(database.getMeta().authorityGeneration, generationBefore + 1);
  });

  it("leaves generation unchanged for empty, projection-only, idempotent, and rolled-back work", () => {
    const database = openDatabase();
    database.withAuthorityTransaction(() => undefined);
    assert.equal(database.getMeta().authorityGeneration, 0);

    database.projections.spans.upsert(PROJECTION_RECORD);
    database.projections.spans.clear();
    assert.equal(database.getMeta().authorityGeneration, 0);

    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "inserted");
    assert.equal(database.getMeta().authorityGeneration, 1);
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "existing");
    assert.equal(database.getMeta().authorityGeneration, 1);

    assert.throws(() => database.withAuthorityTransaction((authority) => {
      authority.notifications.create(NOTIFICATION);
      throw new Error("roll back the authority unit");
    }), /roll back the authority unit/);
    assert.equal(database.getMeta().authorityGeneration, 1);
    assert.equal(database.authority.notifications.get(UUID_3), undefined);
  });

  it("never increments authority generation for projection upsert or clear", () => {
    const database = openDatabase();
    for (const repository of [
      database.projections.spans,
      database.projections.gates,
      database.projections.notes,
    ]) {
      repository.upsert(PROJECTION_RECORD);
      assert.deepEqual(repository.get(HASH_A), PROJECTION_RECORD);
      assert.equal(repository.clear(), 1);
    }
    assert.equal(database.getMeta().authorityGeneration, 0);
  });
});

describe("authority persistence invariants", () => {
  it("reopens v1 XLSX evidence unchanged and unattributed beside exact attributed v2 arms", () => {
    const path = databasePath("operator-xlsx-versions.sqlite");
    const database = openDatabase(path);
    database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT);
    database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT_V2_SEARCH);
    database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT_V2_ACTIVITY);
    database.close();

    const reopened = openDatabase(path);
    const v1 = reopened.authority.operatorXlsxExports.get(UUID_7);
    assert.deepEqual(v1, OPERATOR_XLSX_EXPORT);
    assert.equal(v1?.workbookVersion, 1);
    assert.equal(v1 !== undefined && "requestedBy" in v1, false);
    assert.deepEqual(
      reopened.authority.operatorXlsxExports.get(UUID_6),
      OPERATOR_XLSX_EXPORT_V2_SEARCH,
    );
    assert.deepEqual(
      reopened.authority.operatorXlsxExports.get(UUID_5),
      OPERATOR_XLSX_EXPORT_V2_ACTIVITY,
    );

    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const row = raw.prepare(
        "SELECT requested_by FROM operator_xlsx_exports WHERE record_key = ?",
      ).get(UUID_7);
      assert.equal(Reflect.get(row ?? {}, "requested_by"), null);
    } finally {
      raw.close();
    }
  });

  it.each([
    {
      label: "actor column",
      sql: "UPDATE operator_xlsx_exports SET requested_by = ? WHERE record_key = ?",
      values: ["other-operator", UUID_6] as const,
    },
    {
      label: "record JSON actor",
      sql: "UPDATE operator_xlsx_exports SET record_json = json_set(record_json, '$.requestedBy', ?) WHERE record_key = ?",
      values: ["other-operator", UUID_6] as const,
    },
  ])("refuses a v2 XLSX $label mismatch at read and boot", ({ label, sql, values }) => {
    const path = databasePath(`operator-xlsx-${label.replaceAll(" ", "-")}.sqlite`);
    const database = openDatabase(path);
    database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT_V2_SEARCH);
    const corruptor = new DatabaseSync(path);
    try {
      corruptor.exec("DROP TRIGGER operator_xlsx_exports_immutable_update");
      corruptor.prepare(sql).run(...values);
    } finally {
      corruptor.close();
    }

    assert.throws(
      () => database.authority.operatorXlsxExports.get(UUID_6),
      /operator XLSX export .* mirrored columns disagree with its strict record JSON/,
    );
    database.close();
    assert.throws(
      () => openDatabase(path),
      /operator-xlsx-export-columns-match-record failed for 1 row\(s\)/,
    );
  });

  it("refuses an XLSX artifact index that disagrees with its strict evidence record", () => {
    const path = databasePath();
    const database = openDatabase(path);
    database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT);
    const corruptor = new DatabaseSync(path);
    try {
      corruptor.exec("DROP TRIGGER operator_xlsx_exports_immutable_update");
      corruptor.prepare("UPDATE operator_xlsx_exports SET artifact_id = ? WHERE record_key = ?")
        .run(UUID_6, UUID_7);
    } finally {
      corruptor.close();
    }

    assert.throws(
      () => database.authority.operatorXlsxExports.listByArtifact(UUID_8),
      /operator XLSX export .* mirrored columns disagree with its strict record JSON/,
    );
  });

  it("reconciles every mirrored XLSX evidence column during boot inspection", () => {
    const corruptions = [
      { name: "record key", sql: "UPDATE operator_xlsx_exports SET record_key = ?", value: UUID_6 },
      { name: "selection kind", sql: "UPDATE operator_xlsx_exports SET selection_kind = ?", value: "activity" },
      { name: "artifact id", sql: "UPDATE operator_xlsx_exports SET artifact_id = ?", value: UUID_6 },
      { name: "digest", sql: "UPDATE operator_xlsx_exports SET digest = ?", value: HASH_B },
      { name: "byte length", sql: "UPDATE operator_xlsx_exports SET byte_length = ?", value: 2_048 },
      { name: "media type", sql: "UPDATE operator_xlsx_exports SET media_type = ?", value: "application/pdf" },
      {
        name: "filename",
        sql: "UPDATE operator_xlsx_exports SET filename = ?",
        value: "hr-run-search-2026-07-31-g4.xlsx",
      },
      { name: "created at", sql: "UPDATE operator_xlsx_exports SET created_at = ?", value: LATER },
    ] as const;

    for (const corruption of corruptions) {
      const path = databasePath(`${corruption.name.replaceAll(" ", "-")}.sqlite`);
      const database = openDatabase(path);
      database.authority.operatorXlsxExports.insert(OPERATOR_XLSX_EXPORT);
      database.close();
      const corruptor = new DatabaseSync(path);
      try {
        corruptor.exec("DROP TRIGGER operator_xlsx_exports_immutable_update");
        corruptor.prepare(corruption.sql).run(corruption.value);
      } finally {
        corruptor.close();
      }

      assert.throws(
        () => openDatabase(path),
        /operator-xlsx-export-columns-match-record failed for 1 row\(s\)/,
        corruption.name,
      );
    }
  });

  it("makes command insertion idempotent but rejects command-id content reuse", () => {
    const database = openDatabase();
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "inserted");
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "existing");
    assert.throws(() => database.authority.commands.insert({
      ...(COMMAND_FIXTURES[0] as Record<string, unknown>),
      requestedBy: "different-operator",
    }), /reused with different content/);
    assert.equal(database.getMeta().authorityGeneration, 1);
  });

  it("finds a protected write-id owner after restart while excluding the replaying command", () => {
    const path = databasePath("protected-write-id.sqlite");
    const ownerCommandId = UUID_6;
    const writeId = UUID_7;
    const first = openDatabase(path);
    first.authority.commands.insert(markSettingsCommand({
      commandId: ownerCommandId,
      requestedAt: NOW,
      requestedBy: LOCAL_OPERATOR_ACTOR_ID,
      source: "settings-surface",
      family: "settings",
      type: "apply-protected-settings",
      target: { expectedRevision: 1 },
      payload: {
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId,
        entries: { ucpathPassword: { set: "synthetic-protected-value" } },
      },
    }));
    first.close();

    const reopened = openDatabase(path);
    const lookup: unknown = Reflect.get(
      reopened.authority.commands,
      "findProtectedSettingsCommandIdByWriteId",
    );
    assert.equal(typeof lookup, "function");
    const findOwner = lookup as (input: unknown) => string | undefined;
    assert.equal(findOwner({ writeId, excludingCommandId: ownerCommandId }), undefined);
    assert.equal(findOwner({ writeId, excludingCommandId: UUID_8 }), ownerCommandId);
    assert.equal(findOwner({ writeId: UUID_5, excludingCommandId: UUID_8 }), undefined);
  });

  it("keeps committed and observed-present idempotency keys permanent", () => {
    const database = openDatabase();
    assert.equal(database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }).state, "fenced");
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT);
    const committedReplay = {
      intent: { ...WRITE_INTENT_ATTEMPTING, writeIntentId: UUID_8, currentAttemptId: UUID_6 },
      attempt: { ...WRITE_ATTEMPT, writeIntentId: UUID_8, writeAttemptId: UUID_6 },
    };
    assert.equal(database.authority.writeIntents.fenceAttempt(committedReplay).state, "existing");
    assert.equal(database.authority.writeIntents.findByPermanentKey("ucpath", IDEMPOTENCY_KEY)?.writeIntentId, UUID_1);

    assert.equal(database.authority.writeIntents.recordObservedPresent(OBSERVED_PRESENT_WRITE_INTENT).state, "recorded-observed-present");
    const observedReplay = { ...OBSERVED_PRESENT_WRITE_INTENT, writeIntentId: UUID_6 };
    assert.equal(database.authority.writeIntents.recordObservedPresent(observedReplay).state, "existing");
    assert.equal(database.authority.writeIntents.findByPermanentKey("ucpath", OBSERVED_PRESENT_WRITE_INTENT.idempotencyKey)?.writeIntentId, UUID_7);
    assert.equal(database.getMeta().authorityGeneration, 3);
  });

  it("enforces command, delegation, write-attempt, and outbox foreign keys", () => {
    const database = openDatabase();
    assert.throws(() => database.authority.commandAudits.insert(COMMAND_AUDIT), /FOREIGN KEY constraint failed/);
    assert.throws(() => database.authority.dependencies.insert(DEPENDENCY_RECORD), /FOREIGN KEY constraint failed/);
    assert.throws(
      () => database.commitWriteAttempt(ATOMIC_WRITE_COMMIT),
      /write intent .* does not exist/,
    );
    assert.equal(database.getMeta().authorityGeneration, 0);
  });

  it("rejects authority mutation inside a projection transaction", () => {
    const database = openDatabase();
    assert.throws(() => database.withProjectionTransaction(() => {
      database.authority.commands.insert(COMMAND_FIXTURES[0]);
    }), /authority mutation cannot run inside a projection transaction/);
    assert.equal(database.getMeta().authorityGeneration, 0);
  });
});

/**
 * D230 — the run ORDINAL a queue footer prints as `#N`.
 *
 * The counter has exactly the shape D221's item attempt has one scope up, and
 * these cases pin the three properties that make it usable as a name: it is
 * per-WORKFLOW, it is reserved inside the inserting transaction, and a number
 * a workflow has spent can never be handed out twice. The read-forward arm is
 * the fourth: a record carrying no ordinal is accepted, stored as SQL NULL, and
 * does not move the counter — because back-filling one would mint a number that
 * was never true of that run.
 */
describe("D230 run ordinals", () => {
  const RUN_ID_2 = "aaaaaaaa-0002-4000-8000-000200000000";
  const RUN_ID_3 = "aaaaaaaa-0003-4000-8000-000300000000";

  function queuedRunAt(
    runId: string,
    overrides: Readonly<{ workflow?: string; itemId?: string; traceId?: string; runNumber?: number }>,
  ): Record<string, unknown> {
    const { runNumber, ...envelopeOverrides } = overrides;
    return {
      ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, runId, ...envelopeOverrides },
      ...(runNumber === undefined ? {} : { runNumber }),
    };
  }

  it("hands out consecutive ordinals per workflow and refuses a spent one", () => {
    const database = openDatabase();
    assert.equal(database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID), 1);
    database.authority.runs.enqueue(queuedRunAt(RUN_ID, { runNumber: 1 }));
    assert.equal(database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID), 2);
    database.authority.runs.enqueue(queuedRunAt(RUN_ID_2, {
      itemId: UUID_6, traceId: "pl-170002-0002", runNumber: 2,
    }));
    assert.equal(database.authority.runs.get(RUN_ID)?.runNumber, 1);
    assert.equal(database.authority.runs.get(RUN_ID_2)?.runNumber, 2);

    // A stale reader that re-uses #2 is refused by NAME, not by an index error.
    assert.throws(
      () => database.authority.runs.enqueue(queuedRunAt(RUN_ID_3, {
        itemId: UUID_8, traceId: "pl-170003-0003", runNumber: 2,
      })),
      /already spent \(its next unspent number is #3\)/,
    );
    // …and nothing landed, so the counter did not move either.
    assert.equal(database.authority.runs.get(RUN_ID_3), undefined);
    assert.equal(database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID), 3);
  });

  it("counts each workflow separately and tolerates a gap", () => {
    const database = openDatabase();
    database.authority.runs.enqueue(queuedRunAt(RUN_ID, { runNumber: 1 }));
    // A different workflow starts at 1 again — the ordinal names a run WITHIN
    // one workflow's history, and a global sequence would make `#1` unreadable.
    assert.equal(database.authority.runs.nextWorkflowRunNumber("separations"), 1);
    // A gap is legal: a refused fan-out entry leaves nothing behind, and the
    // numbers around the gap still name the runs they always named.
    database.authority.runs.enqueue(queuedRunAt(RUN_ID_2, {
      itemId: UUID_6, traceId: "pl-170002-0002", runNumber: 7,
    }));
    assert.equal(database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID), 8);
  });

  it("reads an unstamped pre-v15 row forward without back-filling it", () => {
    const path = databasePath();
    const database = openDatabase(path);
    // QUEUED_RUN carries no ordinal — the exact shape of every row enqueued
    // before schema v15.
    database.authority.runs.enqueue(QUEUED_RUN);
    assert.equal(database.authority.runs.get(RUN_ID)?.runNumber, undefined);
    // The absent ordinal is SQL NULL, so it neither collides with another
    // unstamped row nor advances the counter a stamped run will read.
    assert.equal(database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID), 1);
    database.authority.runs.enqueue(queuedRunAt(RUN_ID_2, {
      itemId: UUID_6, traceId: "pl-170002-0002",
    }));
    assert.equal(database.authority.runs.get(RUN_ID_2)?.runNumber, undefined);
    assert.equal(database.authority.runs.nextWorkflowRunNumber(WORKFLOW_ID), 1);
    // A later stamped run takes #1 and the column/record agreement still holds.
    database.authority.runs.enqueue(queuedRunAt(RUN_ID_3, {
      itemId: UUID_8, traceId: "pl-170003-0003", runNumber: 1,
    }));
    assert.equal(database.authority.runs.get(RUN_ID_3)?.runNumber, 1);
    // Re-opening runs the whole invariant sweep, which now includes the
    // null-safe `run_number IS NOT json_extract(record_json, '$.runNumber')`
    // comparison — so a stamped row, an unstamped row and the column mirror
    // are proven to agree rather than assumed to.
    database.close();
    openDatabase(path);
  });
});


describe("workflow batch migration and presentation persistence", () => {
  it("renames retained tables without inventing grouping, preserves foreign keys, and survives reopen", () => {
    const path = databasePath("workflow-batches-v32.sqlite");
    createExactReleasedDatabase(path, 32);
    const raw = new DatabaseSync(path);
    raw.prepare("INSERT INTO run_sessions(record_key,workflow,started_at,record_json,created_at) VALUES (?,?,?,?,?)")
      .run(RUN_SESSION.sessionId, RUN_SESSION.workflow, RUN_SESSION.startedAt, JSON.stringify(RUN_SESSION), RUN_SESSION.createdAt);
    raw.close();
    applyReleasedMigrationChainForTest(path, 32);
    const db = openDatabase(path);
    const migrated = db.authority.runSessions.get(RUN_SESSION.sessionId);
    assert.equal(migrated?.groupInQueue, false);
    assert.equal(migrated?.version, 1);
    assert.equal(migrated?.sessionId, RUN_SESSION.sessionId);
    const before = db.getMeta().authorityGeneration;
    db.authority.runSessions.setGrouping(RUN_SESSION.sessionId, 1, true);
    assert.equal(db.getMeta().authorityGeneration, before + 1);
    assert.throws(() => db.authority.runSessions.setGrouping(RUN_SESSION.sessionId, 1, false), /version conflict/u);
    assert.throws(() => db.authority.runSessions.setGrouping(UUID_4, 1, false), /does not exist/u);
    db.close();
    const reopened = openDatabase(path);
    assert.equal(reopened.authority.runSessions.get(RUN_SESSION.sessionId)?.groupInQueue, true);
    assert.equal(reopened.authority.runSessions.get(RUN_SESSION.sessionId)?.version, 2);
    const sql = new DatabaseSync(path);
    assert.equal(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks','run_sessions')").get(), undefined);
    assert.deepEqual(sql.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(() => sql.exec("UPDATE workflow_run_batches SET workflow='other'"), /identity is immutable/u);
    assert.throws(() => sql.exec("UPDATE workflow_run_batches SET group_in_queue=0"), /presentation must advance/u);
    sql.close();
  });
});
