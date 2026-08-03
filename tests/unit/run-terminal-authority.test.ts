import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { buildRunResult } from "../../src/core/run-result.js";
import { manualClock } from "../../src/domain/clock.js";
import { ReadActiveStatus } from "../../src/domain/contracts/person-lookup/read-active-status.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { deriveRunResultDigest } from "../../src/domain/run/result.js";
import {
  RunTerminalOutboxRecordSchema,
} from "../../src/domain/run/terminal-outbox.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import type {
  AuthorityTerminalizationHooks,
} from "../../src/infra/sqlite/index.js";
import { personLookupDescriptor } from "../../src/workflows/person-lookup/descriptor.js";
import {
  HASH_A,
  HASH_B,
  HASH_C,
  LATER,
  NOW,
  UUID_6,
  UUID_7,
} from "./fixtures/phase1c-contract-fixtures.js";
import {
  QUEUED_RUN,
  RUN_ID,
  WORKER_ID,
  WORKFLOW_ID,
} from "./fixtures/phase1f-run-fixtures.js";

const CLOCK = manualClock(new Date(LATER));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
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

function resultAndOutbox(run: ReturnType<typeof startRunning>) {
  const activeCheckpoint = RunCheckpointRecordSchema.parse({
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    nodeId: "active-status",
    attempt: run.envelope.attempt,
    runId: run.envelope.runId,
    output: { schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"), value: ACTIVE },
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: HASH_A,
    implFingerprint: HASH_B,
    provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
  const result = buildRunResult(
    personLookupDescriptor,
    run,
    [
      { state: "resolved", nodeId: "active-status", checkpoint: activeCheckpoint },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ],
    { activeStatus: ACTIVE, crmDates: { state: "not-requested" } },
    CLOCK,
  );
  const outbox = RunTerminalOutboxRecordSchema.parse({
    outboxId: UUID_7,
    payload: {
      kind: "run-terminal-result",
      runId: result.runId,
      workflowId: result.workflowId,
      attempt: result.attempt,
      resultDigest: result.resultDigest,
    },
    projection: { state: "pending" },
    createdAt: result.createdAt,
  });
  return { result, outbox };
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
      execution: { kind: "node", nodeId: "crm-dates", taskId: "crm/read-onboarding-dates" },
      expectedVersion: running.version,
      claim: CLAIM,
      now: LATER,
    } as const;
    const applied = database.terminalizeFailure(request);
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
    assert.equal(database.terminalizeFailure(request).state, "replayed");
    assert.throws(
      () => database.terminalizeFailure({
        ...request,
        failure: { ...record, summary: "different safe summary" },
      }),
      /different content/,
    );
  });

  it("rejects identity, execution, version, claim, and generic failed bypasses", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const record = failure(running);
    assert.throws(() => database.terminalizeFailure({
      failure: { ...record, traceId: "pl-170001-1111" },
      execution: { kind: "node", nodeId: "crm-dates", taskId: "crm/read-onboarding-dates" },
      expectedVersion: running.version,
      claim: CLAIM,
      now: LATER,
    }), /identity does not match/);
    assert.throws(() => database.terminalizeFailure({
      failure: record,
      execution: { kind: "node", nodeId: "active-status", taskId: "crm/read-onboarding-dates" },
      expectedVersion: running.version,
      claim: CLAIM,
      now: LATER,
    }), /failure node\/task identity/);
    assert.throws(() => database.terminalizeFailure({
      failure: record,
      execution: { kind: "node", nodeId: "crm-dates", taskId: "crm/read-onboarding-dates" },
      expectedVersion: running.version - 1,
      claim: CLAIM,
      now: LATER,
    }), /not/);
    assert.throws(() => database.terminalizeFailure({
      failure: record,
      execution: { kind: "node", nodeId: "crm-dates", taskId: "crm/read-onboarding-dates" },
      expectedVersion: running.version,
      claim: { workerId: "worker-2", claimGeneration: 1 },
      now: LATER,
    }), /no longer claimed/);
    assert.throws(() => database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.version,
      claim: CLAIM,
      lifecycle: { state: "terminal", outcome: "failed", endedAt: LATER, failureId: UUID_6 },
      now: LATER,
    }), /requires atomic terminal authority/);
    assert.equal(database.authority.failures.get(UUID_6), undefined);
  });

  for (const injectedStep of ["failure", "run"] as const) {
    it(`rolls back every failure terminal write when ${injectedStep} persistence fails`, () => {
      const database = openDatabase({
        afterFailureStorageStep: (step) => {
          if (step === injectedStep) throw new Error(`injected ${step} failure`);
        },
      });
      const running = startRunning(database);
      const record = failure(running);
      const generation = database.getMeta().authorityGeneration;
      assert.throws(() => database.terminalizeFailure({
        failure: record,
        execution: { kind: "node", nodeId: "crm-dates", taskId: "crm/read-onboarding-dates" },
        expectedVersion: running.version,
        claim: CLAIM,
        now: LATER,
      }), /injected/);
      assert.equal(database.authority.failures.get(UUID_6), undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.equal(database.getMeta().authorityGeneration, generation);
    });
  }
});

describe("atomic success terminal authority", () => {
  it("inserts result and pending outbox, transitions done, and replays byte-exactly", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, outbox } = resultAndOutbox(running);
    const request = { result, outbox, expectedVersion: running.version, claim: CLAIM, now: LATER };
    const applied = database.terminalizeSuccess(request);
    assert.equal(applied.state, "applied");
    assert.deepEqual(applied.run.lifecycle, { state: "terminal", outcome: "done", endedAt: LATER });
    assert.deepEqual(database.authority.runResults.get(RUN_ID), result);
    assert.deepEqual(database.authority.runTerminalOutbox.get(UUID_7), outbox);
    assert.deepEqual(database.authority.runTerminalOutbox.findByRun(RUN_ID), outbox);
    assert.equal(database.terminalizeSuccess(request).state, "replayed");
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
    const changedOutbox = {
      ...outbox,
      payload: { ...outbox.payload, resultDigest: changedResult.resultDigest },
    };
    assert.throws(
      () => database.terminalizeSuccess({ ...request, result: changedResult, outbox: changedOutbox }),
      /result .*different content/,
    );
    assert.throws(
      () => database.terminalizeSuccess({ ...request, outbox: { ...outbox, outboxId: UUID_6 } }),
      /different content/,
    );
  });

  it("rejects run/outbox identity, stale claim/version, generic done, and non-running success", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, outbox } = resultAndOutbox(running);
    assert.throws(() => database.terminalizeSuccess({
      result,
      outbox: { ...outbox, payload: { ...outbox.payload, resultDigest: HASH_C } },
      expectedVersion: running.version,
      claim: CLAIM,
      now: LATER,
    }), /does not bind the exact result/);
    assert.throws(() => database.terminalizeSuccess({
      result,
      outbox,
      expectedVersion: running.version - 1,
      claim: CLAIM,
      now: LATER,
    }), /not/);
    assert.throws(() => database.terminalizeSuccess({
      result,
      outbox,
      expectedVersion: running.version,
      claim: { workerId: "worker-2", claimGeneration: 1 },
      now: LATER,
    }), /no longer claimed/);
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
      outbox,
      expectedVersion: running.version,
      claim: CLAIM,
      now: LATER,
    }), /already terminal without a result/);
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(database.authority.runTerminalOutbox.findByRun(RUN_ID), undefined);
  });

  for (const injectedStep of ["result", "outbox", "run"] as const) {
    it(`rolls back every success terminal write when ${injectedStep} persistence fails`, () => {
      const database = openDatabase({
        afterSuccessStorageStep: (step) => {
          if (step === injectedStep) throw new Error(`injected ${step} failure`);
        },
      });
      const running = startRunning(database);
      const { result, outbox } = resultAndOutbox(running);
      const generation = database.getMeta().authorityGeneration;
      assert.throws(() => database.terminalizeSuccess({
        result,
        outbox,
        expectedVersion: running.version,
        claim: CLAIM,
        now: LATER,
      }), /injected/);
      assert.equal(database.authority.runResults.get(RUN_ID), undefined);
      assert.equal(database.authority.runTerminalOutbox.findByRun(RUN_ID), undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.equal(database.getMeta().authorityGeneration, generation);
    });
  }
});
