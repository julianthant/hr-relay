import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { buildRunResult } from "../../src/core/run-result.js";
import { manualClock } from "../../src/domain/clock.js";
import { ReadActiveStatus } from "../../src/domain/contracts/person-lookup/read-active-status.js";
import { ReadOnboardingDatesOutputSchema } from "../../src/domain/contracts/crm/read-onboarding-dates.js";
import { RunRecordSchema, type RunRecord } from "../../src/domain/run/record.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import {
  deriveRunResultDigest,
  deriveTerminalDependencyDigest,
} from "../../src/domain/run/result.js";
import {
  RunTerminalOutboxRecordSchema,
} from "../../src/domain/run/terminal-outbox.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import type {
  AuthorityTerminalizationHooks,
} from "../../src/infra/sqlite/index.js";
import {
  PersonLookupCanonicalInput,
  personLookupDescriptor,
} from "../../src/workflows/person-lookup/descriptor.js";
import {
  HASH_B,
  HASH_A,
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
const AFTER_LATER = "2026-07-31T17:02:00.000Z";
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

function corruptRunConsequence(
  mutate: (run: RunRecord) => unknown,
): void {
  const path = join(roots.at(-1) ?? "", "authority.sqlite");
  const raw = new DatabaseSync(path);
  try {
    // These fixtures model offline corruption after write-time guards have run.
    // Removing only the monotonic trigger lets each strict record mismatch stay
    // independent instead of forcing an unrelated version increment.
    raw.exec("DROP TRIGGER tasks_monotonic_counters_update");
    const row = raw.prepare("SELECT record_json FROM tasks WHERE record_key = ?")
      .get(RUN_ID) as { record_json: string } | undefined;
    if (row === undefined) throw new Error(`run ${RUN_ID} is absent from corruption fixture`);
    const current = RunRecordSchema.parse(JSON.parse(row.record_json));
    const corrupted = RunRecordSchema.parse(mutate(current));
    const ownerWorkerId = "workerId" in corrupted.lifecycle ? corrupted.lifecycle.workerId : null;
    const heartbeatAt = "heartbeatAt" in corrupted.lifecycle ? corrupted.lifecycle.heartbeatAt : null;
    raw.prepare("UPDATE tasks SET record_json = ? WHERE record_key = ?")
      .run(JSON.stringify(corrupted), RUN_ID);
    if (corrupted.version !== current.version) {
      raw.prepare("UPDATE tasks SET version = ? WHERE record_key = ?").run(corrupted.version, RUN_ID);
    }
    if (corrupted.claimGeneration !== current.claimGeneration) {
      raw.prepare("UPDATE tasks SET claim_generation = ? WHERE record_key = ?")
        .run(corrupted.claimGeneration, RUN_ID);
    }
    if (corrupted.lifecycle.state !== current.lifecycle.state) {
      raw.prepare(`
        UPDATE tasks SET state = ?, owner_worker_id = ?, heartbeat_at = ? WHERE record_key = ?
      `).run(corrupted.lifecycle.state, ownerWorkerId, heartbeatAt, RUN_ID);
    }
  } finally {
    raw.close();
  }
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

function resultAndOutbox(database: AuthorityDatabase, run: ReturnType<typeof startRunning>) {
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
    outboxId: outbox.outboxId,
  };
  return { result, outbox, authorization, factoryAuthorization: built.authorization };
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
    assert.deepEqual(database.authority.terminalAuthorizations.get(RUN_ID), request.authorization);
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

  it("rejects identity, execution, version, claim, and generic failed bypasses", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const record = failure(running);
    assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
      failure: { ...record, traceId: "pl-170001-1111" },
      authorization: failureAuthorization(running),
    }), /identity does not match/);
    assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
      failure: { ...record, taskId: "ucpath/search-person-org" },
      authorization: failureAuthorization(running),
    }), /does not match descriptor node/);
    assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
      failure: record,
      authorization: { ...failureAuthorization(running), expectedVersion: running.version - 1 },
    }), /not/);
    assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
      failure: record,
      authorization: {
        ...failureAuthorization(running),
        claim: { workerId: "worker-2", claimGeneration: 1 },
      },
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

  it("refuses replay for every schema-valid mismatch from failure authorization to consequence", () => {
    const cases: ReadonlyArray<readonly [string, (run: RunRecord) => unknown]> = [
      ["version", (run: RunRecord) => ({ ...run, version: run.version + 1 })],
      ["claim generation", (run: RunRecord) => ({ ...run, claimGeneration: run.claimGeneration + 1 })],
      ["lifecycle state", (run: RunRecord) => ({ ...run, lifecycle: { state: "queued" as const } })],
      ["outcome", (run: RunRecord) => ({
        ...run,
        lifecycle: { state: "terminal" as const, outcome: "cancelled" as const, endedAt: LATER },
      })],
      ["failure id", (run: RunRecord) => ({
        ...run,
        lifecycle: run.lifecycle.state === "terminal"
          ? { ...run.lifecycle, failureId: UUID_7 }
          : run.lifecycle,
      })],
      ["endedAt", (run: RunRecord) => ({
        ...run,
        lifecycle: run.lifecycle.state === "terminal"
          ? { ...run.lifecycle, endedAt: AFTER_LATER }
          : run.lifecycle,
      })],
      ["updatedAt", (run: RunRecord) => ({ ...run, updatedAt: AFTER_LATER })],
    ];
    for (const [name, mutate] of cases) {
      const database = openDatabase();
      const running = startRunning(database);
      const record = failure(running);
      const request = { failure: record, authorization: failureAuthorization(running) } as const;
      database.terminalizeFailure(personLookupDescriptor, request);
      corruptRunConsequence(mutate);
      assert.throws(
        () => database.terminalizeFailure(personLookupDescriptor, request),
        /does not match its exact failed terminal authorization consequence/,
        name,
      );
    }
  });

  for (const injectedStep of ["authorization", "failure", "run"] as const) {
    it(`rolls back every failure terminal write when ${injectedStep} persistence fails`, () => {
      const database = openDatabase({
        afterFailureStorageStep: (step) => {
          if (step === injectedStep) throw new Error(`injected ${step} failure`);
        },
      });
      const running = startRunning(database);
      const record = failure(running);
      const generation = database.getMeta().authorityGeneration;
      assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
        failure: record,
        authorization: failureAuthorization(running),
      }), /injected/);
      assert.equal(database.authority.failures.get(UUID_6), undefined);
      assert.equal(database.authority.terminalAuthorizations.get(RUN_ID), undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.equal(database.getMeta().authorityGeneration, generation);
    });
  }
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
    const outbox = {
      outboxId: UUID_7,
      payload: {
        kind: "run-terminal-result" as const,
        runId: fabricated.runId,
        workflowId: fabricated.workflowId,
        attempt: fabricated.attempt,
        resultDigest: fabricated.resultDigest,
      },
      projection: { state: "pending" as const },
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
      outboxId: outbox.outboxId,
    };
    assert.throws(
      () => database.terminalizeSuccess({ result: fabricated, outbox, authorization }, {}),
      /lacks factory-authenticated/,
    );
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(database.authority.terminalAuthorizations.get(RUN_ID), undefined);
  });

  it("inserts result and pending outbox, transitions done, and replays byte-exactly", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, outbox, authorization, factoryAuthorization } = resultAndOutbox(database, running);
    const request = { result, outbox, authorization };
    const applied = database.terminalizeSuccess(request, factoryAuthorization);
    assert.equal(applied.state, "applied");
    assert.deepEqual(applied.run.lifecycle, { state: "terminal", outcome: "done", endedAt: LATER });
    assert.deepEqual(database.authority.runResults.get(RUN_ID), result);
    assert.deepEqual(database.authority.runTerminalOutbox.get(UUID_7), outbox);
    assert.deepEqual(database.authority.runTerminalOutbox.findByRun(RUN_ID), outbox);
    assert.deepEqual(database.authority.terminalAuthorizations.get(RUN_ID), authorization);
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
    const changedOutbox = {
      ...outbox,
      payload: { ...outbox.payload, resultDigest: changedResult.resultDigest },
    };
    assert.throws(
      () => database.terminalizeSuccess({
        ...request,
        result: changedResult,
        outbox: changedOutbox,
        authorization: { ...authorization, resultDigest: changedResult.resultDigest },
      }),
      /original pre-terminal claim/,
    );
    assert.throws(
      () => database.terminalizeSuccess({
        ...request,
        outbox: { ...outbox, outboxId: UUID_6 },
        authorization: { ...authorization, outboxId: UUID_6 },
      }),
      /original pre-terminal claim/,
    );
  });

  it("rejects an authenticated result whose exact checkpoint was never stored", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, outbox, authorization, factoryAuthorization } = resultAndOutbox(database, running);
    // Remove only the test fixture's checkpoint through a second connection;
    // the public authority surface intentionally has no delete operation.
    database.close();
    const path = join(roots.at(-1) ?? "", "authority.sqlite");
    const raw = new DatabaseSync(path);
    raw.prepare("DELETE FROM run_checkpoints").run();
    raw.close();
    databases.splice(databases.indexOf(database), 1);
    const reopened = AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
      CLOCK,
    );
    databases.push(reopened);
    assert.throws(
      () => reopened.terminalizeSuccess({ result, outbox, authorization }, factoryAuthorization),
      /has no exact stored checkpoint/,
    );
  });

  it("rejects not-run evidence contradicted by a stored checkpoint for the terminal attempt", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, outbox, authorization, factoryAuthorization } = resultAndOutbox(database, running);
    const crmDates = ReadOnboardingDatesOutputSchema.parse({
      emplId: "10873698",
      invitedOn: { state: "present", value: "2026-06-01" },
      startsOn: { state: "present", value: "2026-07-15" },
      completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
    });
    database.authority.runCheckpoints.insert({
      workflowId: running.envelope.workflow,
      itemId: running.envelope.itemId,
      nodeId: "crm-dates",
      attempt: running.envelope.attempt,
      claimGeneration: 1,
      runId: running.envelope.runId,
      output: {
        schemaHash: deriveSchemaHash(ReadOnboardingDatesOutputSchema, "output"),
        value: crmDates,
      },
      descriptorVersion: running.envelope.descriptorVersion,
      contractFingerprint: running.envelope.contractFingerprint,
      implFingerprint: HASH_B,
      provenance: [{ path: "emplId", source: "live", observedAt: NOW, originalObservedAt: NOW }],
      writtenAt: NOW,
    });
    assert.throws(
      () => database.terminalizeSuccess({ result, outbox, authorization }, factoryAuthorization),
      /marked condition-false but has a stored checkpoint/,
    );
  });

  it("rejects run/outbox identity, stale claim/version, generic done, and non-running success", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, outbox, authorization, factoryAuthorization } = resultAndOutbox(database, running);
    assert.throws(() => database.terminalizeSuccess({
      result,
      outbox: { ...outbox, payload: { ...outbox.payload, resultDigest: HASH_C } },
      authorization,
    }), /does not bind the exact result/);
    assert.throws(() => database.terminalizeSuccess({
      result,
      outbox,
      authorization: { ...authorization, expectedVersion: running.version - 1 },
    }, factoryAuthorization), /not/);
    assert.throws(() => database.terminalizeSuccess({
      result,
      outbox,
      authorization: {
        ...authorization,
        claim: { workerId: "worker-2", claimGeneration: 1 },
      },
    }, factoryAuthorization), /no longer claimed/);
    assert.throws(
      () => database.terminalizeSuccess({ result, outbox, authorization }),
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
        outbox,
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
      outbox,
      authorization,
    }), /already terminal without a result/);
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(database.authority.runTerminalOutbox.findByRun(RUN_ID), undefined);
  });

  it("refuses replay for every schema-valid mismatch from success authorization to consequence", () => {
    const cases: ReadonlyArray<readonly [string, (run: RunRecord) => unknown]> = [
      ["version", (run: RunRecord) => ({ ...run, version: run.version + 1 })],
      ["claim generation", (run: RunRecord) => ({ ...run, claimGeneration: run.claimGeneration + 1 })],
      ["lifecycle state", (run: RunRecord) => ({ ...run, lifecycle: { state: "queued" as const } })],
      ["outcome", (run: RunRecord) => ({
        ...run,
        lifecycle: { state: "terminal" as const, outcome: "cancelled" as const, endedAt: LATER },
      })],
      ["endedAt", (run: RunRecord) => ({
        ...run,
        lifecycle: run.lifecycle.state === "terminal"
          ? { ...run.lifecycle, endedAt: AFTER_LATER }
          : run.lifecycle,
      })],
      ["updatedAt", (run: RunRecord) => ({ ...run, updatedAt: AFTER_LATER })],
    ];
    for (const [name, mutate] of cases) {
      const database = openDatabase();
      const running = startRunning(database);
      const terminal = resultAndOutbox(database, running);
      const request = {
        result: terminal.result,
        outbox: terminal.outbox,
        authorization: terminal.authorization,
      };
      database.terminalizeSuccess(request, terminal.factoryAuthorization);
      corruptRunConsequence(mutate);
      assert.throws(
        () => database.terminalizeSuccess(request),
        /does not match its exact done terminal authorization consequence/,
        name,
      );
    }
  });

  for (const injectedStep of ["authorization", "result", "outbox", "run"] as const) {
    it(`rolls back every success terminal write when ${injectedStep} persistence fails`, () => {
      const database = openDatabase({
        afterSuccessStorageStep: (step) => {
          if (step === injectedStep) throw new Error(`injected ${step} failure`);
        },
      });
      const running = startRunning(database);
      const { result, outbox, authorization, factoryAuthorization } = resultAndOutbox(database, running);
      const generation = database.getMeta().authorityGeneration;
      assert.throws(() => database.terminalizeSuccess({
        result,
        outbox,
        authorization,
      }, factoryAuthorization), /injected/);
      assert.equal(database.authority.runResults.get(RUN_ID), undefined);
      assert.equal(database.authority.runTerminalOutbox.findByRun(RUN_ID), undefined);
      assert.equal(database.authority.terminalAuthorizations.get(RUN_ID), undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.equal(database.getMeta().authorityGeneration, generation);
    });
  }
});
