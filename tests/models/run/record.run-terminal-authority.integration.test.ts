import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { buildRunResult } from "../../../src/backend/runs/lifecycle/run-result.js";
import { runRecordFromRow } from "../../../src/backend/storage/sqlite/run-record-row.js";
import { RunLifecycleSchema,type RunRecord } from "../../../src/models/run/record.js";
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
UUID_6,
UUID_7
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
  testWorkerPorts(database, CLOCK, { path: join(root, "authority.sqlite"), descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
  return database;
}

function corruptRunConsequence(
  mutate: (run: RunRecord) => unknown,
): void {
  const path = join(roots.at(-1) ?? "", "authority.sqlite");
  const raw = new DatabaseSync(path);
  try {
    const guards = ["runs_completion_update", "runs_completion_immutable"].map(name => {
      const row = raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name);
      if (row === undefined || typeof row.sql !== "string") throw new Error("missing corruption fixture guard");
      return { name, sql: row.sql };
    });
    raw.exec("BEGIN");
    try {
      for (const guard of guards) raw.exec("DROP TRIGGER " + guard.name);
      const row = raw.prepare("SELECT * FROM runs WHERE id=?").get(RUN_ID);
      if (row === undefined) throw new Error("run is absent from corruption fixture");
      const corrupted = z.looseObject({ lifecycle: RunLifecycleSchema, claimGeneration: z.number().int(),
        version: z.number().int(), updatedAt: z.string() }).parse(mutate(runRecordFromRow(row)));
      const { envelope, ...lifecycle } = corrupted;
      void envelope;
      const owner = "workerId" in corrupted.lifecycle ? corrupted.lifecycle.workerId : null;
      const heartbeat = "heartbeatAt" in corrupted.lifecycle ? corrupted.lifecycle.heartbeatAt : null;
      const outcome = corrupted.lifecycle.state === "terminal" ? corrupted.lifecycle.outcome : null;
      raw.prepare("UPDATE runs SET lifecycle_json=?,state=?,outcome=?,owner_worker_id=?,heartbeat_at=?,version=?,claim_generation=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(lifecycle), corrupted.lifecycle.state, outcome, owner, heartbeat,
          corrupted.version, corrupted.claimGeneration, corrupted.updatedAt, RUN_ID);
      for (const guard of guards) raw.exec(guard.sql);
      raw.exec("COMMIT");
    } catch (error) { raw.exec("ROLLBACK"); throw error; }
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
        /completion|terminal consequence|run-search-index-corrupt/,
        name,
      );
    }
  });
});

describe("atomic success terminal authority", () => {

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
      const terminal = resultRequest(database, running);
      const request = {
        result: terminal.result,
        authorization: terminal.authorization,
      };
      database.terminalizeSuccess(request, terminal.factoryAuthorization);
      corruptRunConsequence(mutate);
      assert.throws(
        () => database.terminalizeSuccess(request),
        /completion|terminal consequence|run-search-index-corrupt/,
        name,
      );
    }
  });
});
