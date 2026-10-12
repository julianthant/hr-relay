import { authorityMutationCases, type MutationCase } from "../../support/helpers/backend/authority-accounting-world.js";
import { default as assert } from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { AUTHORITY_RECORD_SCHEMA_REGISTRY } from "../../../src/backend/storage/sqlite/storage-records.js";
import { AUTHORITY_TABLE_REGISTRY } from "../../../src/models/config/authority.js";
import { DryRunScenarioResultSchema } from "../../../src/models/trust/dry-run-scenario-result.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { join } from "node:path";
import { buildRunResult } from "../../../src/backend/runs/lifecycle/run-result.js";
import { admitDirectWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { OPERATOR_XLSX_MEDIA_TYPE } from "../../../src/models/dashboard/xlsx-export.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import { COMMAND_FIXTURES } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { DELEGATION_MANIFEST } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { DEPENDENCY_RECORD } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { HASH_A } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { HASH_B } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { HASH_C } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_ATOMIC_WRITE_COMMIT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { LATER } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_1 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_2 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_3 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_5 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_6 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_7 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_8 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";
import { RUN_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { WORKER_START_REQUEST } from "../../support/fixtures/phase1f-run-fixtures.js";
import { WORKFLOW_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { currentAtomicWriteFixture } from "../../support/helpers/timeline-write-fixture.js";

{
describe("dry-run scenario result authority repository", () => {
  it("registers the table and its boot-time record schema", () => {
    assert.equal(
      AUTHORITY_TABLE_REGISTRY.find(({ name }) => name === "dryrun_results")?.classification,
      "authority",
    );
    assert.equal(AUTHORITY_RECORD_SCHEMA_REGISTRY.dryrun_results, DryRunScenarioResultSchema);
  });
});
}

{
const ATOMIC_WRITE_COMMIT = currentAtomicWriteFixture(HISTORICAL_ATOMIC_WRITE_COMMIT);

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const databasePaths = new WeakMap<AuthorityDatabase, string>();
const CLOCK = manualClock(new Date(NOW));
const SCHEMA_BOUND_VALUE = { schemaHash: HASH_A, value: { verified: true } };

const OPERATOR_XLSX_EXPORT = {
  exportId: UUID_7,
  workbookVersion: 3 as const,
  requestedBy: LOCAL_OPERATOR_ACTOR_ID,
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
      order: "match-strength/enqueued-desc/run-id-asc:v2" as const,
      totalMatches: 1,
      coverage: { matched: 1, subjectUnavailable: 0, actorUnavailable: 0, candidateLimit: 10000 as const },
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

function databasePath(name = "authority.sqlite"): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-rebuild-sqlite-"));
  roots.push(root);
  return join(root, name);
}

function openDatabase(path = databasePath(), busyTimeoutMs = 250): AuthorityDatabase {
  const database = AuthorityDatabase.open({ path, busyTimeoutMs, migrationOwner: "unit-test" }, CLOCK);
  openDatabases.push(database);
  databasePaths.set(database, path);
  return database;
}

function claimedWorkerId(run: ReturnType<typeof prepareRunning>): string {
  if (run.lifecycle.state !== "claimed" && run.lifecycle.state !== "validating" && run.lifecycle.state !== "running") {
    throw new Error("fixture-run-not-held");
  }
  return run.lifecycle.workerId;
}

function prepareWorkerSlot(database: AuthorityDatabase) {
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const path = databasePaths.get(database);
  if (path === undefined) throw new Error("fixture-authority-path-missing");
  const slot = database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
    commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex: 1,
    expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID)?.version ?? 0,
    processId: process.pid, processAcquisitionId: randomUUID(), authorityPath: path,
    processLockRoot: join(dirname(path), "locks"), now: NOW,
  }, randomUUID()));
  return slot;
}

function prepareRunning(database: AuthorityDatabase) {
  const slot = prepareWorkerSlot(database);
  assert.equal(database.authority.workerLeases.start({ ...WORKER_START_REQUEST, workerId: slot.workerId }).state, "started");
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
        protectedBindings: [],
      },
    },
  });
  const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: slot.workerId, now: NOW });
  if (claimed.state !== "claimed") throw new Error("generation fixture did not claim a run");
  const validating = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: claimed.run.version,
    claim: { workerId: slot.workerId, claimGeneration: 1 },
    lifecycle: { state: "validating", workerId: slot.workerId, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (validating.state !== "applied") throw new Error("generation fixture did not validate");
  const running = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: validating.run.version,
    claim: { workerId: slot.workerId, claimGeneration: 1 },
    lifecycle: { state: "running", workerId: slot.workerId, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (running.state !== "applied") throw new Error("generation fixture did not run");
  return running.run;
}

function prepareDelegationOwners(database: AuthorityDatabase): void {
  database.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope,
    runId: DELEGATION_MANIFEST.parentRunId, itemId: UUID_6, traceId: "pl-120000-0003", shape: "operation" } });
  database.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope,
    runId: DEPENDENCY_RECORD.childRunId, itemId: DEPENDENCY_RECORD.childItemId, traceId: "pl-120000-0004",
    parent: { runId: DELEGATION_MANIFEST.parentRunId, edgeId: DELEGATION_MANIFEST.edgeId, tracePrefix: "pl-120000-0003" } } });
}

function terminalizeForTrust(database: AuthorityDatabase): void {
  const run = prepareRunning(database);
  database.terminalizeFailure(personLookupDescriptor, terminalFailureRequest(run));
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
      claim: { workerId: claimedWorkerId(run), claimGeneration: 1 },
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
  return {
    request: {
      result: built.record,
      authorization: {
        kind: "done" as const,
        runId: built.record.runId,
        workflowId: built.record.workflowId,
        attempt: built.record.attempt,
        descriptorVersion: built.record.descriptorVersion,
        contractFingerprint: built.record.contractFingerprint,
        expectedVersion: run.version,
        claim: { workerId: claimedWorkerId(run), claimGeneration: 1 },
        authorizedAt: LATER,
        resultDigest: built.record.resultDigest,
      },
    },
    factoryAuthorization: built.authorization,
  };
}
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
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
  const cases: readonly MutationCase[] = authorityMutationCases({ prepareRunning, terminalFailureRequest, terminalSuccessRequest, terminalizeForTrust, DIAGNOSTIC_BUNDLE, FAILURE_RECORD, DRY_RUN_SCENARIO_RESULT, OPERATOR_XLSX_EXPORT, CLOCK, ATOMIC_WRITE_COMMIT, databasePaths, INTAKE_MANIFEST, OCR_EXTRACTION, prepareWorkerSlot, claimedWorkerId, prepareDelegationOwners, COMMAND_AUDIT, RUN_CHECKPOINT, OBSERVED_PRESENT_WRITE_INTENT });

  it("accounts for every authority table and increments once per outer authority mutation", () => {
    assert.deepEqual([...new Set(cases.map(({ table }) => table))].sort(), AUTHORITY_TABLE_REGISTRY
      .filter(({ classification, name }) => classification === "authority"
        && !["database_states", "database_upgrades"].includes(name))
      .map(({ name }) => name)
      .sort());
    for (const mutation of cases) {
      const database = openDatabase();
      if (mutation.table !== "settings" && mutation.table !== "settings_snapshots" && database.authority.runtimeConfig.get() === undefined) {
        database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      }
      mutation.prepare?.(database);
      const before = database.getMeta().authorityGeneration;
      mutation.mutate(database);
      assert.equal(database.getMeta().authorityGeneration, before + 1, mutation.table);
      database.close();
    }
  });
});
}
