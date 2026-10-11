import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { buildRunResult } from "../../../src/backend/runs/lifecycle/run-result.js";
import { completionFromAuthorization } from "../../../src/models/run/completion.js";
import {
deriveRunResultDigest
} from "../../../src/models/run/result.js";
import { TerminalAuthorizationRecordSchema } from "../../../src/models/run/terminal-authorization.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { PersonLookupCanonicalInput } from "../../../src/workflows/person-lookup/workflow.js";
import {
HASH_B,
HASH_C,
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

function failure(run: ReturnType<typeof startRunning>) {
  return {
    failureId: UUID_6,
    fingerprint: HASH_C,
    runId: run.envelope.runId,
    traceId: run.envelope.traceId,
    attempt: run.envelope.attempt,
    workflowId: run.envelope.workflow,
    nodeId: "crm-dates",
    taskId: "crm/read-onboarding-dates",
    code: "CRM_UNAVAILABLE",
    summary: "CRM onboarding dates were unavailable",
    transient: true,
    writeState: "not-attempted",
    causeChain: [{
      code: "CRM_UNAVAILABLE",
      summary: "CRM returned an unavailable response",
      role: "primary",
      transient: true,
    }],
    remediation: [{ kind: "retry-when-served", message: "Retry after CRM is available" }],
    occurredAt: LATER,
  } as const;
}

function failureAuthorization(run: ReturnType<typeof startRunning>) {
  return {
    kind: "failed" as const,
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    attempt: run.envelope.attempt,
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    expectedVersion: run.version,
    claim: CLAIM,
    authorizedAt: LATER,
    failureId: UUID_6,
  };
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

describe("atomic failure terminal authority", () => {
  it("inserts the exact failure, transitions failed, lists by run, and replays byte-exactly", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const record = failure(running);
    const request = {
      failure: record,
      authorization: failureAuthorization(running),
    } as const;
    const applied = database.terminalizeFailure(personLookupDescriptor, request);
    assert.equal(applied.state, "applied");
    assert.deepEqual(applied.run.lifecycle, {
      state: "terminal",
      outcome: "failed",
      endedAt: LATER,
      failureId: UUID_6,
      errorSummary: record.summary,
    });
    assert.deepEqual(database.authority.failures.get(UUID_6), record);
    assert.deepEqual(database.authority.failures.listByRun(RUN_ID), [record]);
    assert.deepEqual(database.authority.runs.get(RUN_ID)?.completion, completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(request.authorization)));
    assert.equal(database.terminalizeFailure(personLookupDescriptor, request).state, "replayed");
    assert.throws(
      () => database.terminalizeFailure(personLookupDescriptor, {
        ...request,
        authorization: {
          ...request.authorization,
          expectedVersion: request.authorization.expectedVersion - 1,
        },
      }),
      /original pre-terminal claim/,
    );
    assert.throws(
      () => database.terminalizeFailure(personLookupDescriptor, {
        ...request,
        authorization: {
          ...request.authorization,
          claim: { workerId: "worker-2", claimGeneration: 1 },
        },
      }),
      /original pre-terminal claim/,
    );
    assert.throws(
      () => database.terminalizeFailure(personLookupDescriptor, {
        ...request,
        failure: { ...record, summary: "different safe summary" },
      }),
      /different content/,
    );
  });
});

describe("atomic success terminal authority", () => {

  it("inserts result and same-row completion without outbox, transitions done, and replays byte-exactly", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, authorization, factoryAuthorization } = resultRequest(database, running);
    const request = { result, authorization };
    const applied = database.terminalizeSuccess(request, factoryAuthorization);
    assert.equal(applied.state, "applied");
    assert.deepEqual(applied.run.lifecycle, { state: "terminal", outcome: "done", endedAt: LATER });
    assert.deepEqual(database.authority.runResults.get(RUN_ID), result);
    assert.deepEqual(database.authority.runs.get(RUN_ID)?.completion, completionFromAuthorization(TerminalAuthorizationRecordSchema.parse(authorization)));
    assert.equal(database.terminalizeSuccess(request).state, "replayed");
    assert.throws(
      () => database.terminalizeSuccess({
        ...request,
        authorization: { ...authorization, expectedVersion: authorization.expectedVersion - 1 },
      }),
      /original pre-terminal claim/,
    );
    assert.throws(
      () => database.terminalizeSuccess({
        ...request,
        authorization: {
          ...authorization,
          claim: { workerId: "worker-2", claimGeneration: 1 },
        },
      }),
      /original pre-terminal claim/,
    );
    const changedResultValue = {
      schemaHash: result.result.schemaHash,
      value: {
        activeStatus: { ...ACTIVE, reason: "a different derived reason" },
        crmDates: { state: "not-requested" },
      },
    };
    const changedResult = {
      ...result,
      result: changedResultValue,
      resultDigest: deriveRunResultDigest(changedResultValue),
    };
    assert.throws(
      () => database.terminalizeSuccess({
        ...request,
        result: changedResult,
        authorization: { ...authorization, resultDigest: changedResult.resultDigest },
      }),
      /original pre-terminal claim/,
    );

  });
});
