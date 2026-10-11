import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { buildRunResult } from "../../../src/backend/runs/lifecycle/run-result.js";
import {
deriveRunResultDigest,
deriveTerminalDependencyDigest,
} from "../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import {
HASH_A,
HASH_B,
LATER,
NOW,
UUID_6
} from "../../support/fixtures/phase1c-contract-fixtures.js";
import {
QUEUED_RUN,
RUN_ID,
WORKFLOW_ID,
} from "../../support/fixtures/phase1f-run-fixtures.js";
import { testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";
import type {
AuthorityTerminalizationHooks,
} from "../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const CLOCK = manualClock(new Date(LATER));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const WORKER_ID = "person-lookup-worker-1";
const CLAIM = { workerId: WORKER_ID, claimGeneration: 1 };
const ACTIVE = {
  state: "active" as const,
  reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
  hdh: true,
};

function openDatabase(hooks?: AuthorityTerminalizationHooks): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-run-terminal-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
    undefined,
    hooks,
  );
  testWorkerPorts(database, CLOCK, { path: join(root, "authority.sqlite"), descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
  return database;
}

function startRunning(database: AuthorityDatabase, nodeId = "crm-dates") {
  database.authority.runs.enqueue({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        ...QUEUED_RUN.input.parsed,
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
    },
  });
  const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now: NOW });
  if (claimed.state !== "claimed") throw new Error("run was not claimed");
  const validating = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: claimed.run.version,
    claim: CLAIM,
    lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (validating.state !== "applied") throw new Error("run did not enter validating");
  const running = database.authority.runs.transition({
    runId: RUN_ID,
    expectedVersion: validating.run.version,
    claim: CLAIM,
    lifecycle: {
      state: "running",
      workerId: WORKER_ID,
      claimedAt: NOW,
      heartbeatAt: NOW,
      currentNodeId: nodeId,
    },
    now: NOW,
  });
  if (running.state !== "applied") throw new Error("run did not enter running");
  return running.run;
}

function resultRequest(database: AuthorityDatabase, run: ReturnType<typeof startRunning>) {
  const activeCheckpoint = RunCheckpointRecordSchema.parse({
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    nodeId: "active-status",
    attempt: run.envelope.attempt,
    claimGeneration: 1,
    runId: run.envelope.runId,
    output: { schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"), value: ACTIVE },
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
    implFingerprint: HASH_B,
    provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
  database.authority.runCheckpoints.insert(activeCheckpoint);
  const built = buildRunResult(
    personLookupDescriptor,
    run,
    [
      { state: "resolved", nodeId: "active-status", checkpoint: activeCheckpoint },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ],
    CLOCK,
  );
  const result = built.record;
  const authorization = {
    kind: "done" as const,
    runId: result.runId,
    workflowId: result.workflowId,
    attempt: result.attempt,
    descriptorVersion: result.descriptorVersion,
    contractFingerprint: result.contractFingerprint,
    expectedVersion: run.version,
    claim: CLAIM,
    authorizedAt: LATER,
    resultDigest: result.resultDigest,
  };
  return { result, authorization, factoryAuthorization: built.authorization };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("atomic success terminal authority", () => {
  it("rejects the former schema-valid complete/empty-dependencies fabrication bypass", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const resultValue = { schemaHash: HASH_A, value: { complete: true } };
    const fabricated = {
      runId: running.envelope.runId,
      attempt: running.envelope.attempt,
      workflowId: running.envelope.workflow,
      descriptorVersion: running.envelope.descriptorVersion,
      contractFingerprint: running.envelope.contractFingerprint,
      configFingerprint: running.envelope.configFingerprint,
      configSnapshotId: running.envelope.configSnapshotId,
      resultSchemaHash: HASH_A,
      result: resultValue,
      resultDigest: deriveRunResultDigest(resultValue),
      dependencies: [],
      dependencyDigest: deriveTerminalDependencyDigest([]),
      createdAt: LATER,
    };
    const authorization = {
      kind: "done" as const,
      runId: fabricated.runId,
      workflowId: fabricated.workflowId,
      attempt: fabricated.attempt,
      descriptorVersion: fabricated.descriptorVersion,
      contractFingerprint: fabricated.contractFingerprint,
      expectedVersion: running.version,
      claim: CLAIM,
      authorizedAt: LATER,
      resultDigest: fabricated.resultDigest,
      };
    assert.throws(
      () => database.terminalizeSuccess({ result: fabricated, authorization }, {}),
      /lacks factory-authenticated/,
    );
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
  });

  it("rejects run/outbox identity, stale claim/version, generic done, and non-running success", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, authorization, factoryAuthorization } = resultRequest(database, running);
    assert.throws(() => database.terminalizeSuccess({
      result: { ...result, runId: UUID_6 },
      authorization,
    }), /must bind the exact result identity/);
    assert.throws(() => database.terminalizeSuccess({
      result,
      authorization: { ...authorization, expectedVersion: running.version - 1 },
    }, factoryAuthorization), /not/);
    assert.throws(() => database.terminalizeSuccess({
      result,
      authorization: {
        ...authorization,
        claim: { workerId: "worker-2", claimGeneration: 1 },
      },
    }, factoryAuthorization), /no longer claimed/);
    assert.throws(
      () => database.terminalizeSuccess({ result, authorization }),
      /lacks factory-authenticated/,
    );
    const fabricatedResult = {
      ...result,
      dependencies: [],
      dependencyDigest: deriveTerminalDependencyDigest([]),
    };
    assert.throws(
      () => database.terminalizeSuccess({
        result: fabricatedResult,
          authorization,
      }, {}),
      /lacks factory-authenticated/,
    );
    assert.throws(() => database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.version,
      claim: CLAIM,
      lifecycle: { state: "terminal", outcome: "done", endedAt: LATER },
      now: LATER,
    }), /requires atomic terminal authority/);
    const cancelled = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.version,
      claim: CLAIM,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: LATER },
      now: LATER,
    });
    assert.equal(cancelled.state, "applied");
    assert.throws(() => database.terminalizeSuccess({
      result,
      authorization,
    }), /already terminal without a result/);
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
  });
});
