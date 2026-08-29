import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { AUTHORITY_TABLE_REGISTRY, type AuthorityTableName } from "../../src/domain/authority.js";
import { buildRunResult } from "../../src/core/run-result.js";
import { manualClock } from "../../src/domain/clock.js";
import { ReadActiveStatus } from "../../src/domain/contracts/person-lookup/read-active-status.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { OPERATOR_XLSX_MEDIA_TYPE } from "../../src/domain/dashboard/xlsx-export.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../src/domain/ids.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { deriveIdempotencyKeyDigest } from "../../src/domain/write-safety.js";
import { createActivityPersonPseudonymDomain } from "../../src/domain/trust/activity-person-pseudonym.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
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
} from "./fixtures/phase1c-contract-fixtures.js";
import {
  QUEUED_RUN,
  RUN_ID,
  RUN_SESSION,
  START_PLAN,
  WORKER_ID,
  WORKER_START_REQUEST,
  WORKFLOW_ID,
} from "./fixtures/phase1f-run-fixtures.js";
import {
  ARCHIVE_RELAUNCH,
  ARCHIVED_RUN,
  VERSION_BUMP_APPLICATION,
  VERSION_PLAN_ROW,
} from "./fixtures/archive-fixtures.js";
import {
  ACTIVITY_PERSON_PSEUDONYM_KEY_HEX,
  seedTerminalSeparationsResult,
  TERMINAL_SEPARATIONS_RUN,
} from "./fixtures/activity-person-pseudonym-fixtures.js";
import { compositionQueuedRun } from "./fixtures/separations-composition-fixtures.js";
import {
  PersonLookupCanonicalInput,
  personLookupDescriptor,
} from "../../src/workflows/person-lookup/descriptor.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const databasePaths = new WeakMap<AuthorityDatabase, string>();
const CLOCK = manualClock(new Date(NOW));
const SCHEMA_BOUND_VALUE = { schemaHash: HASH_A, value: { verified: true } };
const OPAQUE_RECORD = { recordId: UUID_8, payload: SCHEMA_BOUND_VALUE, createdAt: NOW };
/** A second logical item, so the relaunched run is not a duplicate of its source. */
const RELAUNCH_ITEM_ID = UUID_7;

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
const CAPTURE_ARTIFACT = {
  id: UUID_8,
  sha256: HASH_B,
  bytes: 1024,
  mediaType: "image/jpeg",
};
const CAPTURE_SESSION = {
  sessionId: UUID_7,
  tokenDigest: HASH_A,
  workflow: "person-lookup",
  state: "open",
  photoRefs: [{ photoId: UUID_8, artifact: CAPTURE_ARTIFACT, ordinal: 1, originalMediaType: "image/heic" }],
  handoff: { state: "pending" },
  finalizationGeneration: 0,
  version: 1,
  createdAt: NOW,
  expiresAt: LATER,
};
const CAPTURE_OUTBOX = {
  outboxId: UUID_7,
  sessionId: UUID_8,
  generation: 1,
  stableKey: HASH_C,
  orderedPhotoArtifacts: [CAPTURE_ARTIFACT],
  workflow: "person-lookup",
  state: "pending",
  createdAt: NOW,
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

  it("rolls an exact v21 evidence-bearing database back without v22 residue", () => {
    const path = databasePath("pseudonym-evidence-v21.sqlite");
    createExactV21Database(path, true);

    assert.throws(
      () => openDatabase(path),
      /v21 activity person pseudonym evidence has no truthful key commitment/u,
    );

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

  it("upgrades an empty exact v21 database through the generation-binding schema", () => {
    const path = databasePath("empty-pseudonym-v21.sqlite");
    createExactV21Database(path, false);

    const upgraded = openDatabase(path);

    assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(raw.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'activity_person_pseudonym_generations'
      `).get() ?? {}, "name"), "activity_person_pseudonym_generations");
      assert.equal(Reflect.get(raw.prepare(`
        SELECT count(*) AS count FROM activity_person_pseudonym_generations
      `).get() ?? {}, "count"), 0);
    } finally {
      raw.close();
    }
  });

  it("upgrades exact v22 matching generation authority and evidence to v23", () => {
    const path = databasePath("bound-pseudonym-v22.sqlite");
    createExactV22Database(path, "bound");

    const upgraded = openDatabase(path);

    assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
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

  it("upgrades exact v23 XLSX v1 evidence without backfilling actor attribution", () => {
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

    const upgraded = openDatabase(path);
    assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(
      upgraded.authority.operatorXlsxExports.get(OPERATOR_XLSX_EXPORT.exportId),
      OPERATOR_XLSX_EXPORT,
    );
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      const row = raw.prepare(`
        SELECT requested_by, json_type(record_json, '$.requestedBy') AS json_actor_type
        FROM operator_xlsx_exports WHERE record_key = ?
      `).get(OPERATOR_XLSX_EXPORT.exportId) ?? {};
      assert.deepEqual({
        requestedBy: Reflect.get(row, "requested_by"),
        jsonActorType: Reflect.get(row, "json_actor_type"),
      }, {
        requestedBy: null,
        jsonActorType: null,
      });
    } finally {
      raw.close();
    }
  });

  it("refuses orphaned exact v22 evidence and leaves v22 without guard residue", () => {
    const path = databasePath("orphaned-pseudonym-v22.sqlite");
    createExactV22Database(path, "orphaned");

    assert.throws(
      () => openDatabase(path),
      /v21 activity person pseudonym evidence has no truthful key commitment/u,
    );

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

  it("upgrades the exact committed Stage-B v1 shape and preserves read/write authority", () => {
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

  it("upgrades the exact committed v6 shape through v7 and v8 without changing existing authority", () => {
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

    const upgraded = openDatabase(path);
    assert.equal(upgraded.inspectSchema().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(upgraded.authority.startPlans.get(START_PLAN.startPlanId), START_PLAN);
    assert.equal(upgraded.authority.failures.listByRun(RUN_ID).length, 0);
    assert.equal(upgraded.authority.runResults.get(RUN_ID), undefined);
    assert.equal(upgraded.authority.runTerminalOutbox.findByRun(RUN_ID), undefined);
    assert.equal(upgraded.authority.terminalAuthorizations.get(RUN_ID), undefined);
  });

  it("upgrades the exact released v7 shape through v8 and v9, reopens, and validates read-only", () => {
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
    { table: "tasks", mutate: (db) => { db.authority.runs.enqueue(QUEUED_RUN); } },
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
    { table: "leases", mutate: (db) => { db.authority.workerLeases.start(WORKER_START_REQUEST); } },
    {
      table: "duo_ceremony_leases",
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
    { table: "run_sessions", mutate: (db) => { db.authority.runSessions.insert(RUN_SESSION); } },
    { table: "delegation_manifests", mutate: (db) => { db.authority.delegationManifests.insert(DELEGATION_MANIFEST); } },
    { table: "dependencies", prepare: (db) => { db.authority.delegationManifests.insert(DELEGATION_MANIFEST); }, mutate: (db) => { db.authority.dependencies.insert(DEPENDENCY_RECORD); } },
    { table: "commands", mutate: (db) => { db.authority.commands.insert(COMMAND_FIXTURES[0]); } },
    { table: "command_audits", prepare: (db) => { db.authority.commands.insert(COMMAND_FIXTURES[0]); }, mutate: (db) => { db.authority.commandAudits.insert(COMMAND_AUDIT); } },
    { table: "notifications", mutate: (db) => { db.authority.notifications.create(NOTIFICATION); } },
    { table: "config_snapshots", mutate: (db) => { db.authority.configSnapshots.insert(CONFIG_SNAPSHOT); } },
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
    { table: "start_plans", mutate: (db) => { db.authority.startPlans.create(START_PLAN); } },
    { table: "ocr_approvals", mutate: (db) => { db.authority.opaque.ocrApprovals.insert(OPAQUE_RECORD); } },
    { table: "capture_sessions", mutate: (db) => { db.authority.captureSessions.create(CAPTURE_SESSION); } },
    { table: "capture_photo_order", mutate: (db) => { db.authority.opaque.capturePhotoOrder.insert(OPAQUE_RECORD); } },
    { table: "capture_finalization_outboxes", mutate: (db) => { db.authority.captureFinalizationOutboxes.insert(CAPTURE_OUTBOX); } },
    { table: "write_intents", mutate: (db) => { db.authority.writeIntents.recordObservedPresent(OBSERVED_PRESENT_WRITE_INTENT); } },
    { table: "write_attempts", mutate: (db) => { db.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }); } },
    {
      table: "durable_outbox",
      prepare: (db) => { db.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }); },
      mutate: (db) => { db.commitWriteAttempt(ATOMIC_WRITE_COMMIT); },
    },
    { table: "artifact_outbox", mutate: (db) => { db.authority.artifactOutbox.insert(ARTIFACT_OUTBOX); } },
    { table: "artifact_sink_heads", mutate: (db) => { db.authority.artifactSinkHeads.record(ARTIFACT_SINK_HEAD_REQUEST); } },
  ];

  it("covers every classified authority table mutator and increments once per outer mutation", () => {
    assert.deepEqual(cases.map(({ table }) => table).sort(), AUTHORITY_TABLE_REGISTRY
      .filter(({ classification, name }) => classification === "authority" && name !== "authority_meta")
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
        /UNIQUE constraint failed: write_attempts.record_key/,
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
      database.projections.runsView,
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
