import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { buildRunResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { ReadActiveStatus } from "../../../../src/models/workflows/person-lookup/read-active-status.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { PersonLookupCanonicalInput } from "../../../../src/workflows/person-lookup/workflow.js";
import {
HASH_B,
HASH_C,
LATER,
NOW,
UUID_6,
UUID_7
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
QUEUED_RUN,
RUN_ID,
WORKFLOW_ID,
} from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import type {
AuthorityTerminalizationHooks,
} from "../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

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

  it("copies a failure's diagnostic admission stamp exactly when terminalizing", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const record = { ...failure(running), diagnosticSafetyVersion: 1 as const };
    const applied = database.terminalizeFailure(personLookupDescriptor, {
      failure: record,
      authorization: failureAuthorization(running),
    });

    assert.equal(applied.run.lifecycle.state, "terminal");
    assert.equal(
      applied.run.lifecycle.state === "terminal"
        ? applied.run.lifecycle.diagnosticSafetyVersion
        : undefined,
      record.diagnosticSafetyVersion,
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
      assert.throws(() => database.terminalizeFailure(personLookupDescriptor, {
        failure: record,
        authorization: failureAuthorization(running),
      }), /injected/);
      assert.equal(database.authority.failures.get(UUID_6), undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.equal(database.getMeta().authorityGeneration, generation);
    });
  }
});

describe("atomic success terminal authority", () => {

  it("rejects an authenticated result whose exact checkpoint was never stored", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, authorization, factoryAuthorization } = resultRequest(database, running);
    // A second connection corrupts the exact checkpoint while this authority
    // remains open: terminal settlement must independently reject the absence.
    const path = join(roots.at(-1) ?? "", "authority.sqlite");
    const raw = new DatabaseSync(path);
    try {
      const guard = raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='run_checkpoints_owner_delete'").get();
      if (guard === undefined || typeof guard.sql !== "string") throw new Error("missing checkpoint ownership guard");
      raw.exec("BEGIN; DROP TRIGGER run_checkpoints_owner_delete; DELETE FROM run_checkpoints");
      raw.exec(guard.sql); raw.exec("COMMIT");
    } finally { raw.close(); }
    assert.throws(
      () => database.terminalizeSuccess({ result, authorization }, factoryAuthorization),
      /has no exact stored checkpoint|timeline-checkpoint-reference-mismatch/,
    );
    // Reopening also refuses the now-dangling durable checkpoint event.
    assert.throws(() => AuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, CLOCK,
    ), /timeline-checkpoint-reference-mismatch/);

  });

  for (const injectedStep of ["result", "run"] as const) {
    it(`rolls back every success terminal write when ${injectedStep} persistence fails`, () => {
      const database = openDatabase({
        afterSuccessStorageStep: (step) => {
          if (step === injectedStep) throw new Error(`injected ${step} failure`);
        },
      });
      const running = startRunning(database);
      const { result, authorization, factoryAuthorization } = resultRequest(database, running);
      const generation = database.getMeta().authorityGeneration;
      assert.throws(() => database.terminalizeSuccess({
        result,
          authorization,
      }, factoryAuthorization), /injected/);
      assert.equal(database.authority.runResults.get(RUN_ID), undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
      assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
      assert.equal(database.getMeta().authorityGeneration, generation);
    });
  }
});


describe("public settlement write boundaries", () => {
  for (const kind of ["success", "failure"] as const) {
    for (const table of [kind === "success" ? "run_results" : "run_failures", "runs", "timeline_events", "commands", "command_audits"]) {
      it(`${kind} rolls back completion, consequence, timeline and journal after ${table} write`, () => {
        const database = openDatabase(); const running = startRunning(database);
        const built = kind === "success" ? resultRequest(database, running) : undefined;
        const request = { kind, commandId: "99000000-0000-4000-8000-000000000011",
          terminal: built === undefined ? { failure: failure(running), authorization: failureAuthorization(running) }
            : { result: built.result, authorization: built.authorization } };
        const service = new RunRecordService({ database, clock: CLOCK, publishQueued: () => { throw new Error("unexpected queue publication"); }, ids: { uuid: () => UUID_7 } });
        const raw = new DatabaseSync(join(roots.at(-1) ?? "", "authority.sqlite"));
        try {
          const before = database.getMeta(); const events = database.authority.timelineEvents.page({});
          raw.exec(`CREATE TRIGGER injected_completion AFTER ${table === "runs" ? "UPDATE" : "INSERT"} ON ${table} BEGIN SELECT RAISE(ABORT, 'C-write-fault'); END`);
          assert.throws(() => service.terminalize(request, personLookupDescriptor, built?.factoryAuthorization), /C-write-fault/);
          assert.deepEqual(database.authority.runs.get(RUN_ID), running);
          assert.deepEqual(database.authority.failures.listByRun(RUN_ID), []);
          assert.equal(database.authority.runResults.get(RUN_ID), undefined);
          assert.equal(database.authority.lifecycleJournal.getCommand(request.commandId), undefined);
          assert.equal(database.authority.lifecycleJournal.findAuditByCommand(request.commandId), undefined);
          assert.deepEqual(database.authority.timelineEvents.page({}), events);
          assert.deepEqual(database.getMeta(), before);
          raw.exec("DROP TRIGGER injected_completion");
          assert.equal(service.terminalize(request, personLookupDescriptor, built?.factoryAuthorization).state, "applied");
          const settled = database.authority.runs.get(RUN_ID); assert.ok(settled?.completion);
          // Discard the acknowledgement and replay through an independently opened connection.
          const reopened = AuthorityDatabase.open({ path: join(roots.at(-1) ?? "", "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "c-replay" }, CLOCK);
          try {
            const replay = new RunRecordService({ database: reopened, clock: CLOCK, publishQueued: () => { throw new Error("unexpected queue publication"); }, ids: { uuid: () => UUID_7 } });
            const generation = reopened.getMeta().authorityGeneration;
            assert.equal(replay.terminalize(request, personLookupDescriptor).state, "applied-already");
            assert.deepEqual(reopened.authority.runs.get(RUN_ID), settled);
            assert.equal(reopened.getMeta().authorityGeneration, generation);
            const ended = reopened.authority.timelineEvents.page({}).filter((record) => record.payload.kind === "span" && record.payload.event.t === "span.ended");
            assert.equal(ended.length, 1);
            const event = ended[0]?.payload;
            assert.ok(event?.kind === "span" && event.event.t === "span.ended" && event.event.kind === "run");
            assert.equal(event.event.workerId, WORKER_ID); assert.equal(event.event.claimGeneration, 1);
          } finally { reopened.close(); }
        } finally { raw.close(); }
      });
    }
  }
});
