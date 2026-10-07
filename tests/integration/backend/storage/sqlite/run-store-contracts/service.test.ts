import { historicalArchiveAuthority } from "../../../../../support/helpers/integration/historical-archive-authority.js";
import { CanonicalRelaunchRequestSchema } from "../../../../../../src/backend/storage/sqlite/run-store-contracts.js";
import { selectRunRuntime } from "../../../../../../src/backend/runs/settings/run-settings.js";
import { makeWorld } from "../../../../../support/helpers/backend/dashboard-harness.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../../../src/rules/identity/ids.js";
import { createTimelineEmitter } from "../../../../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../../../../src/backend/runs/commands/run-queued-span.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { on } from "node:events";
import { Worker } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { z } from "zod";
import { afterEach, describe, it } from "vitest";
import { CreateRunRequestSchema, RunRecordService, lifecycleCommandId, workerRunLifecyclePort, runContinuationPort, requireLifecycleApplied, type CreateRunRequest } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { planRuntimeVersionTransition } from "../../../../../../src/models/archive/runtime-version.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../../../../src/models/write-safety/protected-input.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import {
  RunLifecycleCommandAuditRecordSchema,
  RunLifecycleCommandOperationSchema,
  RunLifecycleCommandRecordSchema,
} from "../../../../../../src/rules/commands/commands.js";
import { RuntimeConfigClaimTokenSchema } from "../../../../../../src/models/config/runtime-generation.js";
import { FingerprintSchema } from "../../../../../../src/rules/identity/ids.js";
import { RunRecordSchema, type RunRecord } from "../../../../../../src/models/run/record.js";
import { deriveWriteBindingProofDigest } from "../../../../../../src/rules/write-safety/write-safety.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";
import {
  archivedRunContentDigest,
  archivedRunReferenceFingerprint,
  ArchivedRunContentSchema,
  ArchivedRunRecordSchema,
  VersionBumpApplicationSchema,
} from "../../../../../../src/models/archive/model.js";
import {
  AuthorityDatabase,
  type AuthorityLifecycleHooks,
  type AuthorityTerminalizationHooks,
} from "../../../../../support/helpers/synthetic-storage-admission.js";
import { createSpanJsonlWriter } from "../../../../../../src/backend/storage/events/span-jsonl-writer.js";
import { doctorAuthorityStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT, COMMAND_FIXTURES, CONFIG_SNAPSHOT, GATE_RESULT, HASH_A, HASH_C, LATER, NOW, UUID_1, UUID_5, UUID_6 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import { QUEUED_RUN, RUN_SESSION, RUN_SESSION_ID, WORKER_ID, WORKFLOW_ID } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import { ARCHIVED_RUN, VERSION_BUMP_APPLICATION, VERSION_PLAN_ROW } from "../../../../../support/fixtures/archive-fixtures.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture(
  terminalizationHooks?: AuthorityTerminalizationHooks,
  lifecycleHooks?: AuthorityLifecycleHooks,
  historical = false,
) {
  const root = mkdtempSync(join(tmpdir(), "run-record-service-"));
  cleanups.push(() => rmSync(root, { recursive: true }));
  const clock = manualClock(new Date(NOW));
  const database = historical ? historicalArchiveAuthority(join(root, "authority.sqlite"), clock) : AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), migrationOwner: "unit-test", busyTimeoutMs: 250 },
    clock,
    undefined,
    terminalizationHooks,
    lifecycleHooks,
  );
  cleanups.push(() => database.close());
  database.authority.configSnapshots.insert(CONFIG_SNAPSHOT);
  const active = database.authority.runtimeConfig.activate({
    settingsRevision: 1, settingsFingerprint: HASH_A,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
    configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    activatedAt: NOW,
  });
  const runtimeConfig = RuntimeConfigClaimTokenSchema.parse({
    generation: active.generation, settingsRevision: active.settingsRevision,
    settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint,
  });
  let next = 100;
  const published: RunRecord[] = [];
  const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
  const service = new RunRecordService({ database, clock,
    ids: { uuid: () => `10000000-0000-4000-8000-${String(next++).padStart(12, "0")}` },
    publishQueued: (run) => {
      assert.equal(database.authority.runs.get(run.envelope.runId)?.version, 1);
      emitter.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Synthetic run" }));
      database.afterAuthorityCommit(() => published.push(run));
    },
  });
  const request: CreateRunRequest = {
    commandId: UUID_1, code: "pl", matchKey: "synthetic-item", workflow: WORKFLOW_ID,
    descriptorVersion: QUEUED_RUN.envelope.descriptorVersion,
    contractFingerprint: QUEUED_RUN.envelope.contractFingerprint,
    configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
    resolvedInstance: RunRecordSchema.parse(QUEUED_RUN).envelope.resolvedInstance,
    priority: "bulk", shape: "single", dryRun: true,
    input: QUEUED_RUN.input, runtimeConfig,
  };
  return { database, service, clock, request, runtimeConfig, published, root };
}

function created(service: RunRecordService, request: CreateRunRequest) {
  const outcome = service.create(request);
  assert.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("create did not apply");
  return outcome.run;
}

/** Seed a released journal/lineage; never exercise retired creation as a fixture producer. */
function historicalRelaunch(service: RunRecordService, database: AuthorityDatabase, input: unknown) {
  const request = CanonicalRelaunchRequestSchema.parse(input);
  const run = created(service, { ...request.create, commandId: lifecycleCommandId("historical-fixture", request.commandId) });
  const safe = valueFreeProtectedData(request, retainedRunProtectedBindings({ envelope: { workflow: request.create.workflow }, input: request.create.input }));
  const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", commandId: request.commandId,
    operation: "relaunch", requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0relaunch\0${canonicalJsonStringify(safe)}`),
    fence: { kind: "none" }, recordedAt: NOW });
  database.withAuthorityTransaction(repositories => {
    repositories.lifecycleJournal.insertCommand(command);
    repositories.lifecycleJournal.insertAudit({ kind: "run-lifecycle", auditId: command.commandId, request: command,
      result: { kind: "run", runId: run.envelope.runId, appliedVersion: run.version }, completedAt: NOW });
  });
  return { state: "applied" as const, run };
}

describe("protected canonical command fingerprints", () => {
  it("retains safe historical archive identity for relaunch/delete replay after source deletion", () => {
    const exercise = (emplId: string) => {
      const f = fixture(undefined, undefined, true);
      const request = { ...f.request, descriptorVersion: personLookupDescriptor.version,
        contractFingerprint: personLookupDescriptor.contractFingerprint,
        input: { ...f.request.input, raw: { emplId }, parsed: { ...f.request.input.parsed,
          value: { emplId }, protectedBindings: [{ kind: "test-data-local" as const,
            inputPath: "emplId" as const, name: "personLookupCanaryEid" as const,
            sourceId: "10000000-0000-4000-8000-000000000001" }] } } };
      const source = created(f.service, request);
      const terminal = requireLifecycleApplied(f.service.transition({ commandId: UUID_5,
        runId: source.envelope.runId, expectedVersion: source.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
      const { contentDigest: _mismatchDigest, ...mismatchContent } = archivedRecord(terminal);
      mismatchContent.input = { ...mismatchContent.input, raw: { emplId, memo: "unbound extra fact" } };
      const mismatchArchive = { ...mismatchContent,
        contentDigest: FingerprintSchema.parse(sha256Hex(`hrauto:archived-run:v1\0${canonicalJsonStringify(mismatchContent)}`)) };
      const beforeRefusal = f.database.getMeta().authorityGeneration;
      assert.deepEqual(f.service.archive({ commandId: "83000000-0000-4000-8000-000000000003",
        expectedVersion: terminal.version, archive: mismatchArchive }),
      { state: "refused", refusal: { reason: "schema-mismatch", digest: archivedRunReferenceFingerprint(mismatchArchive) } });
      assert.equal(f.database.getMeta().authorityGeneration, beforeRefusal);
      const archived = archiveRun(f.service, f.database, terminal, UUID_6, true).archive;
      const { commandId: _commandId, ...create } = request;
      const relaunch = { commandId: "83000000-0000-4000-8000-000000000001",
        archivedRunId: source.envelope.runId, archiveFingerprint: archivedRunReferenceFingerprint(archived),
        relaunchedBy: "local-operator", create };
      assert.equal(historicalRelaunch(f.service, f.database, relaunch).state, "applied");
      const deletion = { commandId: "83000000-0000-4000-8000-000000000002",
        runId: source.envelope.runId, archiveFingerprint: archivedRunReferenceFingerprint(archived) };
      assert.equal(f.service.deleteArchived(deletion).state, "deleted");
      assert.equal(f.database.authority.archivedRuns.get(source.envelope.runId), undefined);
      const generation = f.database.getMeta().authorityGeneration;
      assert.equal(f.service.deleteArchived(deletion).state, "applied-already");
      assert.equal(f.service.relaunch(relaunch, personLookupDescriptor).state, "applied-already");
      assert.deepEqual(f.service.deleteArchived({ ...deletion, archiveFingerprint: HASH_A }),
        { state: "refused", refusal: { reason: "replay-divergent" } });
      assert.deepEqual(f.service.relaunch({ ...relaunch, archiveFingerprint: HASH_A }, personLookupDescriptor),
        { state: "refused", refusal: { reason: "replay-divergent" } });
      assert.deepEqual(f.service.relaunch({ ...relaunch, create: { ...create, priority: "interactive" } }, personLookupDescriptor),
        { state: "refused", refusal: { reason: "replay-divergent" } });
      assert.equal(f.database.getMeta().authorityGeneration, generation);
      const fingerprints = [relaunch.commandId, deletion.commandId].map((commandId) => {
        const journal = f.database.authority.lifecycleJournal.getCommand(commandId);
        assert.ok(journal && "requestFingerprint" in journal);
        assert.equal(JSON.stringify(journal).includes(archived.contentDigest), false);
        assert.equal(JSON.stringify(journal).includes(emplId), false);
        return journal.requestFingerprint;
      });
      return { fingerprints, privateDigest: archived.contentDigest };
    };
    const first = exercise("10812345");
    const rotated = exercise("10854321");
    assert.notEqual(first.privateDigest, rotated.privateDigest);
    assert.deepEqual(first.fingerprints, rotated.fingerprints);
  });

  it("binds protected input identity and safe facts across create and archive journals", () => {
    const journals = (emplId: string, memo = "ordinary fact", sourceId = "10000000-0000-4000-8000-000000000001") => {
      const f = fixture(undefined, undefined, true);
      const request = { ...f.request, input: { ...f.request.input, raw: { emplId, memo },
        parsed: { ...f.request.input.parsed, value: { emplId, memo }, protectedBindings: [{
          kind: "test-data-local" as const, inputPath: "emplId" as const, name: "personLookupCanaryEid" as const, sourceId }] } } };
      const run = created(f.service, request);
      assert.deepEqual(run.input.raw, { emplId, memo });
      const generation = f.database.getMeta().authorityGeneration;
      assert.equal(f.service.create(request).state, "applied-already");
      assert.equal(f.database.getMeta().authorityGeneration, generation);
      const terminal = requireLifecycleApplied(f.service.transition({ commandId: UUID_5,
        runId: run.envelope.runId, expectedVersion: run.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
      archiveRun(f.service, f.database, terminal, UUID_6);
      return [request.commandId, UUID_6].map((commandId) => {
        const journal = f.database.authority.lifecycleJournal.getCommand(commandId);
        assert.ok(journal && "requestFingerprint" in journal);
        return journal.requestFingerprint;
      });
    };
    assert.deepEqual(journals("10812345"), journals("10854321"));
    const original = journals("10812345");
    const changedFact = journals("10812345", "changed ordinary fact");
    const changedIdentity = journals("10812345", "ordinary fact", "10000000-0000-4000-8000-000000000002");
    original.forEach((fingerprint, index) => {
      assert.notEqual(fingerprint, changedFact[index]);
      assert.notEqual(fingerprint, changedIdentity[index]);
    });
  });
});

function archivedRecord(run: RunRecord) {
  if (run.lifecycle.state !== "terminal") throw new Error("archive fixture requires a terminal run");
  const { contentDigest: _digest, ...template } = ARCHIVED_RUN;
  const status = run.lifecycle.outcome === "interrupted" ? "blocked"
    : run.lifecycle.outcome === "failed" ? "failed"
      : run.lifecycle.outcome === "done" ? "done" : "cancelled";
  const detailOutcome = run.lifecycle.outcome === "interrupted"
    ? { state: "absent" as const, reason: "run interrupted; ref write-safety recovery will requeue or settle it" }
    : {
        state: "terminal" as const,
        result: run.lifecycle.outcome === "done" ? run.envelope.dryRun ? "partial" as const : "verified-done" as const
          : run.lifecycle.outcome === "failed" ? "failed" as const : "cancelled" as const,
        completedAt: run.lifecycle.endedAt,
        ...(run.lifecycle.outcome === "done" && run.envelope.dryRun ? { rehearsal: true as const } : {}),
      };
  const content = ArchivedRunContentSchema.parse({
    ...template,
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    traceId: run.envelope.traceId,
    archivedIdentity: {
      workflowId: run.envelope.workflow,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
    },
    input: run.input,
    row: {
      ...template.row,
      runId: run.envelope.runId,
      itemId: run.envelope.itemId,
      workflowId: run.envelope.workflow,
      traceId: run.envelope.traceId,
      attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion,
      descriptorHash: run.envelope.contractFingerprint,
      configFingerprint: run.envelope.configFingerprint,
      dryRun: run.envelope.dryRun,
      priority: run.envelope.priority,
      runNumber: run.runNumber === undefined
        ? { state: "absent", reason: "historical run had no ordinal" }
        : { state: "present", value: run.runNumber },
      rowRevision: run.version,
      status,
      endedAt: { state: "present", value: run.lifecycle.endedAt },
    },
    detail: {
      ...template.detail,
      runId: run.envelope.runId,
      rowRevision: run.version,
      header: {
        ...template.detail.header,
        runId: run.envelope.runId,
        traceId: run.envelope.traceId,
        workflowId: run.envelope.workflow,
        status,
        attempt: run.envelope.attempt,
      },
      outcome: detailOutcome,
    },
  });
  return ArchivedRunRecordSchema.parse({
    ...content,
    contentDigest: archivedRunContentDigest(content),
  });
}

function archiveRun(service: RunRecordService, database: AuthorityDatabase, run: RunRecord, commandId: string, historicalDigest = false) {
  database.authority.versionPlans.insert(VERSION_PLAN_ROW);
  database.authority.versionBumpApplications.insert(VersionBumpApplicationSchema.parse({
    ...VERSION_BUMP_APPLICATION,
    archivedRunIds: [run.envelope.runId],
  }));
  const archive = archivedRecord(run);
  if (historicalDigest) {
    const { contentDigest: _contentDigest, ...content } = archive;
    archive.contentDigest = FingerprintSchema.parse(sha256Hex(`hrauto:archived-run:v1\0${canonicalJsonStringify(content)}`));
  }
  const outcome = service.archive({ commandId, expectedVersion: run.version, archive });
  assert.equal(outcome.state, "applied");
  if (outcome.state !== "applied") throw new Error("archive refused");
  return { archive, run: outcome.run };
}

function runningRun(service: RunRecordService, request: CreateRunRequest, runtimeConfig: unknown) {
  const run = created(service, {
    ...request,
    descriptorVersion: personLookupDescriptor.version,
    contractFingerprint: personLookupDescriptor.contractFingerprint,
  });
  const claim = service.claimNext({
    commandId: "82000000-0000-4000-8000-000000000001",
    workflow: WORKFLOW_ID,
    workerId: WORKER_ID,
    runtimeConfig,
  });
  if (claim.state !== "applied") throw new Error("claim refused");
  const validating = service.workerTransition({
    commandId: "82000000-0000-4000-8000-000000000002",
    runId: run.envelope.runId,
    claim: { workerId: WORKER_ID, claimGeneration: 1 },
    lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
  });
  if (validating.state !== "applied") throw new Error("validating transition refused");
  const running = service.workerTransition({
    commandId: "82000000-0000-4000-8000-000000000003",
    runId: run.envelope.runId,
    claim: { workerId: WORKER_ID, claimGeneration: 1 },
    lifecycle: {
      state: "running",
      workerId: WORKER_ID,
      claimedAt: NOW,
      heartbeatAt: NOW,
      currentNodeId: "crm-dates",
    },
  });
  if (running.state !== "applied") throw new Error("running transition refused");
  return running.run;
}

function failureTerminalRequest(run: RunRecord, commandId: string) {
  return {
    kind: "failure" as const,
    commandId,
    terminal: {
      failure: {
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
      },
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
        failureId: UUID_6,
      },
    },
  };
}

function lifecycleCommand(
  request: unknown,
  operation: z.input<typeof RunLifecycleCommandOperationSchema>,
  fence: z.input<typeof RunLifecycleCommandRecordSchema>["fence"] = { kind: "none" },
) {
  const commandId = z.object({ commandId: z.string() }).parse(request).commandId;
  const create = CreateRunRequestSchema.parse(request);
  const fingerprintInput = valueFreeProtectedData(create, retainedRunProtectedBindings({
    envelope: { workflow: create.workflow }, input: create.input,
  }));
  return RunLifecycleCommandRecordSchema.parse({
    kind: "run-lifecycle",
    commandId,
    operation,
    requestFingerprint: sha256Hex(
      `hrauto:run-lifecycle-command:v1\0${operation}\0${canonicalJsonStringify(fingerprintInput)}`,
    ),
    fence,
    recordedAt: NOW,
  });
}

const RaceEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.enum(["ready", "reserved"]) }),
  z.strictObject({ type: z.literal("error"), message: z.string() }),
  z.strictObject({ type: z.literal("result"), outcome: z.discriminatedUnion("state", [
    z.strictObject({ state: z.enum(["applied", "applied-already"]), run: RunRecordSchema }),
    z.strictObject({ state: z.literal("refused"), refusal: z.strictObject({ reason: z.enum(["none-eligible", "lost"]) }) }),
  ]) }),
]);

function raceConnection(data: unknown) {
  const worker = new Worker(new URL("../../../../../../../../support/processes/run-record-race-worker.ts", import.meta.url), { workerData: data, execArgv: ["--import", "tsx"] });
  const events = on(worker, "message");
  return {
    worker,
    next: async () => {
      const event = await events.next();
      if (event.done) throw new Error("race worker ended before its expected event");
      return RaceEventSchema.parse(event.value[0]);
    },
  };
}

describe("canonical run-record service", () => {
  it("stamps the published workflow minor version on later runs while leaving other workflows at 1.0", () => {
    const { service, request, database } = fixture();
    const baseline = database.registerRuntimeVersionWorkflows([WORKFLOW_ID, "other-workflow"]);
    const scope = { kind: "workflows" as const, workflowIds: [WORKFLOW_ID] };
    const planned = planRuntimeVersionTransition(baseline.state, scope);
    const review = database.reviewRuntimeVersionTransition(scope);
    const changeId = "10000000-0000-4000-8000-000000000097";
    const claimed = database.claimRuntimeVersionTransition({ changeId, expectedRevision: baseline.revision,
      workflowIds: planned.affectedWorkflowIds, after: planned.after, expectedMembershipDigest: review.review.membershipDigest });
    database.publishRuntimeVersionTransition({ changeId, expectedRevision: claimed.revision, next: planned.after });
    const changed = created(service, request);
    assert.deepEqual(changed.runtimeVersion, {
      dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 1 },
    });
    const other = created(service, { ...request, commandId: UUID_6, workflow: "other-workflow" });
    assert.deepEqual(other.runtimeVersion, {
      dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 0 },
    });
  });

  it("stamps new runs and fences only workflows in a claimed version change", () => {
    const { service, request, database, published } = fixture();
    const baseline = database.registerRuntimeVersionWorkflows([WORKFLOW_ID, "other-workflow"]);
    const first = created(service, request);
    assert.deepEqual(first.runtimeVersion, {
      dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 0 },
    });
    const planned = planRuntimeVersionTransition(baseline.state, {
      kind: "workflows", workflowIds: [WORKFLOW_ID],
    });
    const blockedReview = database.reviewRuntimeVersionTransition({ kind: "workflows", workflowIds: [WORKFLOW_ID] });
    assert.deepEqual(blockedReview.review.blockers.map(row => row.runId), [first.envelope.runId]);
    assert.throws(() => database.claimRuntimeVersionTransition({
      changeId: "10000000-0000-4000-8000-000000000099",
      expectedRevision: baseline.revision,
      workflowIds: planned.affectedWorkflowIds,
      after: planned.after,
      expectedMembershipDigest: blockedReview.review.membershipDigest,
    }), /active-blockers/u);
    const terminal = service.transition({ commandId: UUID_5, runId: first.envelope.runId,
      expectedVersion: first.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    assert.equal(terminal.state, "applied");
    const review = database.reviewRuntimeVersionTransition({ kind: "workflows", workflowIds: [WORKFLOW_ID] });
    assert.deepEqual(review.review.candidates.map(row => row.runId), [first.envelope.runId]);
    assert.throws(() => database.claimRuntimeVersionTransition({
      changeId: "10000000-0000-4000-8000-000000000099",
      expectedRevision: baseline.revision,
      workflowIds: planned.affectedWorkflowIds,
      after: planned.after,
      expectedMembershipDigest: blockedReview.review.membershipDigest,
    }), /review-stale/u);
    database.claimRuntimeVersionTransition({
      changeId: "10000000-0000-4000-8000-000000000099",
      expectedRevision: baseline.revision,
      workflowIds: planned.affectedWorkflowIds,
      after: planned.after,
      expectedMembershipDigest: review.review.membershipDigest,
    });
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.create({ ...request, commandId: "10000000-0000-4000-8000-000000000098" }),
      { state: "refused", refusal: { reason: "policy-refused" } });
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.equal(published.length, 1);
    const other = created(service, { ...request, commandId: UUID_6, workflow: "other-workflow" });
    assert.deepEqual(other.runtimeVersion, first.runtimeVersion);
    assert.equal(published.length, 2);
    assert.equal(service.read(first.envelope.runId).state, "present");
  });

  it("#1 reserves distinct monotonically increasing item and workflow ordinals", () => {
    const { service, request, database, published } = fixture();
    const before = database.getMeta().authorityGeneration;
    const runs = Array.from({ length: 5 }, (_, index) => created(service, {
      ...request, commandId: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    assert.deepEqual(runs.map((run) => run.envelope.attempt), [1, 2, 3, 4, 5]);
    assert.deepEqual(runs.map((run) => run.runNumber), [1, 2, 3, 4, 5]);
    assert.equal(new Set(runs.map((run) => run.envelope.runId)).size, 5);
    assert.equal(database.getMeta().authorityGeneration, before + 5);
    assert.equal(published.length, 5);
  });

  it("#3 refuses a missing parent and retry source without reserving ordinals", () => {
    const { service, request, database } = fixture();
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.create({ ...request, parent: { runId: UUID_5, tracePrefix: "pl-170000-5555", edgeId: "member" } }),
      { state: "refused", refusal: { reason: "parent-missing" } });
    assert.deepEqual(service.create({ ...request, retryOf: UUID_5 }),
      { state: "refused", refusal: { reason: "retry-of-missing" } });
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.equal(created(service, request).envelope.attempt, 1);
  });

  it("P33 refuses an absent runtime token and preserves queued authority", () => {
    const { service, request, database } = fixture();
    const run = created(service, request);
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID, workerId: WORKER_ID }),
      { state: "refused", refusal: { reason: "runtime-stale" } });
    assert.deepEqual(service.read(run.envelope.runId), { state: "present", disposition: "live", run });
    assert.equal(database.getMeta().authorityGeneration, before);
  });

  it("#4 grants a queued row once and refuses a busy worker", () => {
    const { service, request, runtimeConfig } = fixture();
    const run = created(service, request);
    const first = service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig });
    assert.equal(first.state, "applied");
    if (first.state !== "applied") throw new Error("claim refused");
    assert.equal(first.run.envelope.runId, run.envelope.runId);
    assert.equal(first.run.claimGeneration, 1);
    assert.equal(first.run.version, 2);
    assert.deepEqual(service.claimNext({ commandId: "50000000-0000-4000-8000-000000000010", workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig }),
      { state: "refused", refusal: { reason: "worker-busy", runId: run.envelope.runId } });
  });

  it("#4 claims the first eligible row after dependency filtering and total ordering", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const blocked = created(service, {
      ...request,
      commandId: "51000000-0000-4000-8000-000000000001",
      matchKey: "claim-blocked-parent",
      priority: "interactive",
    });
    const child = created(service, {
      ...request,
      commandId: "51000000-0000-4000-8000-000000000002",
      matchKey: "claim-blocking-child",
    });
    const childTerminal = service.transition({
      commandId: "51000000-0000-4000-8000-000000000003",
      runId: child.envelope.runId,
      expectedVersion: child.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (childTerminal.state !== "applied") throw new Error("dependency child setup refused");
    const policy = {
      onChildFailed: "fail-parent" as const,
      cascadeCancel: "cascade" as const,
      afterChildRetry: "resume-parent" as const,
      visibility: "inline" as const,
    };
    const manifestId = "51000000-0000-4000-8000-000000000004";
    const dependencyId = "51000000-0000-4000-8000-000000000005";
    database.authority.delegationManifests.insert({
      manifestId,
      parentRunId: blocked.envelope.runId,
      edgeId: "claim-dependency",
      inputSchemaHash: HASH_A,
      resultSchemaHash: HASH_C,
      cardinality: "one",
      join: "one",
      policy,
      children: [{
        dependencyId,
        childRunId: child.envelope.runId,
        childItemId: child.envelope.itemId,
        canonicalInputFingerprint: HASH_A,
      }],
      createdAt: NOW,
      manifestFingerprint: HASH_C,
    });
    database.authority.dependencies.insert({
      dependencyId,
      manifestId,
      edgeId: "claim-dependency",
      parentRunId: blocked.envelope.runId,
      childRunId: child.envelope.runId,
      childItemId: child.envelope.itemId,
      policy,
      state: "active",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const olderBulk = created(service, {
      ...request,
      commandId: "51000000-0000-4000-8000-000000000006",
      matchKey: "claim-older-bulk",
      priority: "bulk",
    });
    const newerInteractive = created(service, {
      ...request,
      commandId: "51000000-0000-4000-8000-000000000007",
      matchKey: "claim-newer-interactive",
      priority: "interactive",
    });

    const claim = service.claimNext({
      commandId: "51000000-0000-4000-8000-000000000008",
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      runtimeConfig,
    });
    assert.equal(claim.state, "applied");
    if (claim.state !== "applied") throw new Error("eligible claim refused");
    assert.equal(claim.run.envelope.runId, newerInteractive.envelope.runId);
    assert.equal(service.read(blocked.envelope.runId).state, "present");
    assert.equal(service.read(olderBulk.envelope.runId).state, "present");
  });

  it("#25 preserves spent attempt and run number after deleting the highest row", () => {
    const { service, request, database, runtimeConfig } = fixture();
    const source = created(service, {
      ...request,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    const settledSource = service.transition({ commandId: UUID_5, runId: source.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    assert.equal(settledSource.state, "applied");
    const highest = created(service, {
      ...request,
      commandId: "30000000-0000-4000-8000-000000000001",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    assert.equal(highest.envelope.attempt, 2);
    assert.equal(highest.runNumber, 2);
    const settledHighest = service.transition({
      commandId: "30000000-0000-4000-8000-000000000002",
      runId: highest.envelope.runId,
      expectedVersion: highest.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(settledHighest.state, "applied");
    const deleted = service.delete({ commandId: "30000000-0000-4000-8000-000000000003",
      runId: highest.envelope.runId, expectedVersion: 2 });
    assert.equal(deleted.state, "deleted");
    const tombstone = database.authority.deletedRuns.get(highest.envelope.runId);
    assert.equal(tombstone?.attempt, 2);
    assert.equal(tombstone?.runNumber, 2);
    assert.equal(tombstone?.ordinalSource, "tombstone");
    const next = service.retry({
      commandId: "30000000-0000-4000-8000-000000000004",
      runId: source.envelope.runId,
      expectedVersion: 2,
      runtimeConfig,
    }, personLookupDescriptor);
    assert.equal(next.state, "applied");
    if (next.state !== "applied") throw new Error("retry after highest tombstone refused");
    assert.equal(next.run.envelope.attempt, 3);
    assert.equal(next.run.runNumber, 3);
    assert.equal(service.read(highest.envelope.runId).state, "deleted");
  });

  it("persists a cancellation request without changing the claimed lifecycle or fence", () => {
    const { service, request, runtimeConfig } = fixture();
    const run = created(service, request);
    const claim = service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig });
    if (claim.state !== "applied") throw new Error("claim refused");
    const cancelled = service.transition({ commandId: "40000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId, expectedVersion: claim.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    assert.equal(cancelled.state, "applied");
    if (cancelled.state !== "applied") throw new Error("cancel request refused");
    assert.deepEqual(cancelled.run, { ...claim.run, cancelRequested: true, version: claim.run.version + 1 });
    const renewed = service.renewClaim({ commandId: "40000000-0000-4000-8000-000000000002",
      runId: run.envelope.runId, claim: { workerId: WORKER_ID, claimGeneration: 1 } });
    assert.equal(renewed.state, "applied");
    if (renewed.state !== "applied") throw new Error("renew refused");
    assert.equal(renewed.run.cancelRequested, true);
    assert.equal(renewed.run.lifecycle.state, "claimed");
  });

  it("D330.9 floor permits source deletion while relaunch lineage remains", () => {
    const { root } = fixture();
    const raw = new DatabaseSync(join(root, "authority.sqlite"), { readOnly: true });
    try {
      const rows = z.array(z.strictObject({ id: z.number(), seq: z.number(), table: z.string(),
        from: z.string(), to: z.string(), on_update: z.string(), on_delete: z.string(), match: z.string(),
      })).parse(raw.prepare("PRAGMA foreign_key_list(archive_relaunches)").all());
      assert.deepEqual(rows.filter((row) => row.from === "archived_run_id"), [],
        "D330.9 requires archived source removal with descendant lineage retained; the source FK prevents it");
    } finally { raw.close(); }
  });

  it("#5 a generation advance refuses the next claim without invalidating the held claim", () => {
    const { service, request, runtimeConfig, database, clock } = fixture();
    const run = created(service, request);
    const queued = created(service, {
      ...request,
      commandId: "50000000-0000-4000-8000-000000000009",
      matchKey: "stale-runtime-queued",
    });
    const claim = service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig });
    if (claim.state !== "applied") throw new Error("claim refused");
    database.authority.runtimeConfig.activate({ settingsRevision: 2, settingsFingerprint: HASH_A,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
      activatedAt: NOW });
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.claimNext({ commandId: "50000000-0000-4000-8000-000000000001",
      workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig }),
    { state: "refused", refusal: { reason: "runtime-stale" } });
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.deepEqual(service.read(run.envelope.runId), { state: "present", disposition: "live", run: claim.run });
    assert.deepEqual(service.read(queued.envelope.runId), { state: "present", disposition: "live", run: queued });
    clock.advanceWall(1000);
    const renewed = service.renewClaim({ commandId: "50000000-0000-4000-8000-000000000002",
      runId: run.envelope.runId, claim: { workerId: WORKER_ID, claimGeneration: 1 } });
    assert.equal(renewed.state, "applied");
  });

  it("#6/#7 requeues only an expired claim, preserves its attempt/fence, and rejects the zombie", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const run = created(service, request);
    const claim = service.claimNext({
      commandId: "83000000-0000-4000-8000-000000000001",
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      runtimeConfig,
    });
    if (claim.state !== "applied") throw new Error("claim refused");
    const beforeLive = database.getMeta().authorityGeneration;
    assert.deepEqual(service.requeue({
      commandId: "83000000-0000-4000-8000-000000000002",
      runId: run.envelope.runId,
      expectedVersion: claim.run.version,
      cause: "recovery",
      staleBefore: NOW,
    }), { state: "refused", refusal: { reason: "heartbeat-live" } });
    assert.equal(database.getMeta().authorityGeneration, beforeLive);
    const requeued = service.requeue({
      commandId: "83000000-0000-4000-8000-000000000003",
      runId: run.envelope.runId,
      expectedVersion: claim.run.version,
      cause: "recovery",
      staleBefore: LATER,
    });
    assert.equal(requeued.state, "applied");
    if (requeued.state !== "applied") throw new Error("expired claim did not requeue");
    assert.equal(requeued.run.lifecycle.state, "queued");
    assert.equal(requeued.run.envelope.attempt, run.envelope.attempt);
    assert.equal(requeued.run.claimGeneration, claim.run.claimGeneration);
    assert.equal(requeued.run.version, claim.run.version + 1);
    const zombieClaim = { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration };
    assert.deepEqual(service.renewClaim({
      commandId: "83000000-0000-4000-8000-000000000004",
      runId: run.envelope.runId,
      claim: zombieClaim,
    }), { state: "refused", refusal: { reason: "lost" } });
    assert.deepEqual(service.workerTransition({
      commandId: "83000000-0000-4000-8000-000000000005",
      runId: run.envelope.runId,
      claim: zombieClaim,
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
    }), { state: "refused", refusal: { reason: "lost" } });
    assert.deepEqual(service.terminalize(
      failureTerminalRequest(claim.run, "83000000-0000-4000-8000-000000000006"),
      personLookupDescriptor,
    ), { state: "refused", refusal: { reason: "lost" } });
  });

  it("re-enqueues a resolved gate at its durable continuation node", () => {
    const { service, request, runtimeConfig } = fixture();
    const running = runningRun(service, request, runtimeConfig);
    const parked = service.workerTransition({
      commandId: "83000000-0000-4000-8000-000000000007",
      runId: running.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "parked-gate",
        gateId: GATE_RESULT.gateId,
        parkedAt: NOW,
        resumeAt: "crm-dates",
      },
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("gate park refused");

    const resumed = service.transition({
      commandId: "83000000-0000-4000-8000-000000000008",
      runId: running.envelope.runId,
      expectedVersion: parked.run.version,
      lifecycle: { state: "queued" },
    });

    assert.equal(resumed.state, "applied");
    if (resumed.state !== "applied") throw new Error("gate resume refused");
    assert.equal(resumed.run.envelope.startAt, "crm-dates");
  });

  it("refuses queued metadata that gate resolution cannot preserve", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const running = runningRun(service, request, runtimeConfig);
    const parked = service.workerTransition({
      commandId: "83000000-0000-4000-8000-000000000015",
      runId: running.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "parked-gate",
        gateId: GATE_RESULT.gateId,
        parkedAt: NOW,
        resumeAt: "crm-dates",
      },
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("gate park refused");
    const generation = database.getMeta().authorityGeneration;

    assert.deepEqual(service.transition({
      commandId: "83000000-0000-4000-8000-000000000016",
      runId: running.envelope.runId,
      expectedVersion: parked.run.version,
      lifecycle: { state: "queued", requeuedFrom: "recovery", notBefore: LATER },
    }), {
      state: "refused",
      refusal: {
        reason: "illegal-transition",
        from: "parked-gate",
        to: "queued",
        message: "gate resolution cannot add queued metadata",
      },
    });
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(service.read(running.envelope.runId), {
      state: "present",
      disposition: "live",
      run: parked.run,
    });
  });

  it("re-enqueues an operator-confirmed-absent write at its mandatory continuation node", () => {
    const { service, request, runtimeConfig } = fixture();
    const running = runningRun(service, request, runtimeConfig);
    const parked = service.workerTransition({
      commandId: "83000000-0000-4000-8000-000000000009",
      runId: running.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "parked-write",
        writeIntentId: "83000000-0000-4000-8000-000000000099",
        intentGeneration: 1,
        parkedAt: NOW,
        code: "operator-required",
        message: "check whether the external write landed",
      },
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("write park refused");

    const resumed = service.transition({
      commandId: "83000000-0000-4000-8000-000000000010",
      runId: running.envelope.runId,
      expectedVersion: parked.run.version,
      lifecycle: { state: "queued" },
      writeResolution: "resolve-write-absent",
      startAt: "commit-person",
    });

    assert.equal(resumed.state, "applied");
    if (resumed.state !== "applied") throw new Error("confirmed-absent resume refused");
    assert.equal(resumed.run.lifecycle.state, "queued");
    assert.equal(resumed.run.envelope.startAt, "commit-person");
    assert.equal(resumed.run.version, parked.run.version + 1);
  });

  it("re-enqueues an operator-confirmed-present write at its mandatory continuation node", () => {
    const { service, request, runtimeConfig } = fixture();
    const running = runningRun(service, request, runtimeConfig);
    const parked = service.workerTransition({
      commandId: "83000000-0000-4000-8000-000000000011",
      runId: running.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "parked-write",
        writeIntentId: "83000000-0000-4000-8000-000000000098",
        intentGeneration: 1,
        parkedAt: NOW,
        code: "operator-required",
        message: "check whether the external write landed",
      },
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("write park refused");
    const resolution = {
      commandId: "83000000-0000-4000-8000-000000000012",
      runId: running.envelope.runId,
      expectedVersion: parked.run.version,
      lifecycle: { state: "queued" as const },
      writeResolution: "resolve-write-present" as const,
      startAt: "verify-person",
    };

    const resumed = service.transition(resolution);

    assert.equal(resumed.state, "applied");
    if (resumed.state !== "applied") throw new Error("confirmed-present resume refused");
    assert.equal(resumed.run.lifecycle.state, "queued");
    assert.equal(resumed.run.envelope.startAt, "verify-person");
    assert.equal(resumed.run.version, parked.run.version + 1);
    const replay = service.transition(resolution);
    assert.equal(replay.state, "applied-already");
    if (replay.state !== "applied-already" || !("run" in replay)) throw new Error("write resolution did not replay");
    assert.equal(replay.run.version, resumed.run.version);
    assert.deepEqual(service.transition({ ...resolution, startAt: "commit-person" }), {
      state: "refused",
      refusal: { reason: "replay-divergent" },
    });
  });

  it("refuses to re-enqueue a parked write without a resolution continuation", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const running = runningRun(service, request, runtimeConfig);
    const parked = service.workerTransition({
      commandId: "83000000-0000-4000-8000-000000000013",
      runId: running.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "parked-write",
        writeIntentId: "83000000-0000-4000-8000-000000000097",
        intentGeneration: 1,
        parkedAt: NOW,
        code: "operator-required",
        message: "check whether the external write landed",
      },
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("write park refused");
    const generation = database.getMeta().authorityGeneration;

    assert.deepEqual(service.transition({
      commandId: "83000000-0000-4000-8000-000000000014",
      runId: running.envelope.runId,
      expectedVersion: parked.run.version,
      lifecycle: { state: "queued" },
    }), {
      state: "refused",
      refusal: {
        reason: "illegal-transition",
        from: "parked-write",
        to: "queued",
        message: "write resolution requires its continuation node",
      },
    });
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(service.read(running.envelope.runId), {
      state: "present",
      disposition: "live",
      run: parked.run,
    });
  });

  it("#9/#10 terminalize is atomic and command replay is exact or divergent", () => {
    const interrupted = fixture({
      afterFailureStorageStep: (step) => {
        if (step === "failure") throw new Error("injected terminal settlement failure");
      },
    });
    const interruptedRun = runningRun(interrupted.service, interrupted.request, interrupted.runtimeConfig);
    const interruptedRequest = failureTerminalRequest(
      interruptedRun,
      "84000000-0000-4000-8000-000000000001",
    );
    const before = interrupted.database.getMeta().authorityGeneration;
    assert.throws(
      () => interrupted.service.terminalize(interruptedRequest, personLookupDescriptor),
      /injected terminal settlement failure/,
    );
    assert.equal(interrupted.database.getMeta().authorityGeneration, before);
    assert.equal(interrupted.database.authority.failures.get(UUID_6), undefined);
    assert.equal(interrupted.database.authority.runResults.get(interruptedRun.envelope.runId), undefined);
    assert.equal(interrupted.database.authority.runs.get(interruptedRun.envelope.runId)?.completion, undefined);
    assert.deepEqual(interrupted.service.read(interruptedRun.envelope.runId), {
      state: "present",
      disposition: "live",
      run: interruptedRun,
    });

    const normal = fixture();
    const running = runningRun(normal.service, normal.request, normal.runtimeConfig);
    const request = failureTerminalRequest(running, "84000000-0000-4000-8000-000000000002");
    const applied = normal.service.terminalize(request, personLookupDescriptor);
    assert.equal(applied.state, "applied");
    if (applied.state !== "applied") throw new Error("terminalize refused");
    assert.equal(applied.run.version, running.version + 1);
    assert.equal(normal.database.authority.failures.listByRun(running.envelope.runId).length, 1);
    assert.equal(normal.database.authority.runResults.get(running.envelope.runId), undefined);
    assert.ok(normal.database.authority.runs.get(running.envelope.runId)?.completion);
    const replayGeneration = normal.database.getMeta().authorityGeneration;
    const replay = normal.service.terminalize(request, personLookupDescriptor);
    assert.equal(replay.state, "applied-already");
    if (replay.state !== "applied-already" || !("run" in replay)) throw new Error("terminalize did not replay");
    assert.equal(replay.run.version, applied.run.version);
    assert.equal(normal.database.getMeta().authorityGeneration, replayGeneration);
    assert.deepEqual(normal.service.terminalize({
      ...request,
      terminal: {
        ...request.terminal,
        failure: { ...request.terminal.failure, summary: "Different safe failure summary" },
      },
    }, personLookupDescriptor), {
      state: "refused",
      refusal: { reason: "replay-divergent" },
    });
    assert.equal(normal.database.getMeta().authorityGeneration, replayGeneration);
    assert.equal(normal.service.delete({
      commandId: "84000000-0000-4000-8000-000000000003",
      runId: running.envelope.runId,
      expectedVersion: applied.run.version,
    }).state, "deleted");
    const replayAfterDelete = normal.service.terminalize(request, personLookupDescriptor);
    assert.equal(replayAfterDelete.state, "applied-already");
    assert.ok("tombstone" in replayAfterDelete);
    if (!("tombstone" in replayAfterDelete)) throw new Error("deleted terminal replay lost its tombstone");
    assert.equal(replayAfterDelete.tombstone.runId, running.envelope.runId);
    assert.equal(replayAfterDelete.appliedVersion, applied.run.version);
  });

  it("refuses failure terminalization while a direct tree member is non-terminal", () => {
    const { service, request, runtimeConfig } = fixture();
    const anchor = runningRun(service, { ...request, shape: "operation" }, runtimeConfig);
    const member = created(service, {
      ...request,
      commandId: "84000000-0000-4000-8000-000000000007",
      matchKey: "terminalize-active-member",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      shape: "operation-member",
      parent: {
        runId: anchor.envelope.runId,
        tracePrefix: anchor.envelope.traceId,
        edgeId: "active-member",
      },
    });

    assert.deepEqual(service.terminalize(
      failureTerminalRequest(anchor, "84000000-0000-4000-8000-000000000008"),
      personLookupDescriptor,
    ), { state: "refused", refusal: { reason: "tree-non-terminal", runId: member.envelope.runId } });
  });

  it("refuses failure terminalization while a nested tree member is non-terminal", () => {
    const { service, request, runtimeConfig } = fixture();
    const anchor = runningRun(service, { ...request, shape: "operation" }, runtimeConfig);
    const member = created(service, {
      ...request,
      commandId: "84000000-0000-4000-8000-000000000009",
      matchKey: "terminalize-terminal-member",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      shape: "operation-member",
      parent: {
        runId: anchor.envelope.runId,
        tracePrefix: anchor.envelope.traceId,
        edgeId: "terminal-member",
      },
    });
    const terminalMember = service.transition({
      commandId: "84000000-0000-4000-8000-000000000010",
      runId: member.envelope.runId,
      expectedVersion: member.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(terminalMember.state, "applied");
    const grandchild = created(service, {
      ...request,
      commandId: "84000000-0000-4000-8000-000000000011",
      matchKey: "terminalize-active-grandchild",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      shape: "operation-member",
      parent: {
        runId: member.envelope.runId,
        tracePrefix: member.envelope.traceId,
        edgeId: "active-grandchild",
      },
    });

    assert.deepEqual(service.terminalize(
      failureTerminalRequest(anchor, "84000000-0000-4000-8000-000000000012"),
      personLookupDescriptor,
    ), { state: "refused", refusal: { reason: "tree-non-terminal", runId: grandchild.envelope.runId } });
  });

  it("refuses a distinct terminal lifecycle self-edge", () => {
    const { service, request } = fixture();
    const run = created(service, request);
    const lifecycle = { state: "terminal" as const, outcome: "cancelled" as const, endedAt: NOW };
    const settled = service.transition({
      commandId: "84000000-0000-4000-8000-000000000013",
      runId: run.envelope.runId,
      expectedVersion: run.version,
      lifecycle,
    });
    assert.equal(settled.state, "applied");
    if (settled.state !== "applied") throw new Error("settlement refused");

    assert.deepEqual(service.transition({
      commandId: "84000000-0000-4000-8000-000000000014",
      runId: run.envelope.runId,
      expectedVersion: settled.run.version,
      lifecycle,
    }), {
      state: "refused",
      refusal: {
        reason: "illegal-transition",
        from: "terminal",
        to: "terminal",
        message: "terminal has no self-edge; a settled outcome is settled",
      },
    });
  });

  it("refuses a display-name self-edge on a terminal run", () => {
    const { service, request } = fixture();
    const run = created(service, request);
    const settled = service.transition({
      commandId: "84000000-0000-4000-8000-000000000015",
      runId: run.envelope.runId,
      expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(settled.state, "applied");
    if (settled.state !== "applied") throw new Error("settlement refused");

    assert.deepEqual(service.transition({
      commandId: "84000000-0000-4000-8000-000000000016",
      runId: run.envelope.runId,
      expectedVersion: settled.run.version,
      displayName: "Late rename",
    }), {
      state: "refused",
      refusal: {
        reason: "illegal-transition",
        from: "terminal",
        to: "terminal",
        message: "terminal has no self-edge; a settled outcome is settled",
      },
    });
  });

  it("#10 journals only request commitments and returns the current version on exact replay", () => {
    const { service, request, database } = fixture();
    const run = created(service, request);
    const first = service.transition({
      commandId: "85000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId,
      expectedVersion: run.version,
      displayName: "Reviewed name",
    });
    if (first.state !== "applied") throw new Error("rename refused");
    const second = service.transition({
      commandId: "85000000-0000-4000-8000-000000000002",
      runId: run.envelope.runId,
      expectedVersion: first.run.version,
      priority: "interactive",
    });
    if (second.state !== "applied") throw new Error("bump refused");
    const generation = database.getMeta().authorityGeneration;
    const replay = service.transition({
      commandId: "85000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId,
      expectedVersion: run.version,
      displayName: "Reviewed name",
    });
    assert.equal(replay.state, "applied-already");
    if (replay.state !== "applied-already" || !("run" in replay)) throw new Error("rename did not replay");
    assert.equal(replay.run.version, second.run.version);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(service.transition({
      commandId: "85000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId,
      expectedVersion: run.version,
      displayName: "Divergent name",
    }), { state: "refused", refusal: { reason: "replay-divergent" } });
    const journal = database.authority.lifecycleJournal.getCommand(request.commandId);
    assert.ok(journal !== undefined && "kind" in journal);
    if (!("kind" in journal)) throw new Error("create journal used the product command arm");
    assert.equal(journal.kind, "run-lifecycle");
    assert.equal(JSON.stringify(journal).includes("10873698"), false);
  });

  it("D333 refuses cross-kind ids and fails loud for every partial or mismatched journal pair", () => {
    const crossKind = fixture();
    crossKind.database.withAuthorityTransaction(({ commands }) => {
      commands.insert(COMMAND_FIXTURES[0]);
    });
    const crossKindGeneration = crossKind.database.getMeta().authorityGeneration;
    assert.deepEqual(crossKind.service.create(crossKind.request), {
      state: "refused",
      refusal: { reason: "replay-divergent" },
    });
    assert.equal(crossKind.database.getMeta().authorityGeneration, crossKindGeneration);

    const commandOnly = fixture();
    const commandOnlyRecord = lifecycleCommand(commandOnly.request, "create");
    commandOnly.database.withAuthorityTransaction(({ lifecycleJournal }) => {
      lifecycleJournal.insertCommand(commandOnlyRecord);
    });
    const commandOnlyGeneration = commandOnly.database.getMeta().authorityGeneration;
    assert.throws(() => commandOnly.service.create(commandOnly.request), /has no audit/u);
    assert.equal(commandOnly.database.getMeta().authorityGeneration, commandOnlyGeneration);

    const auditOnly = fixture();
    const auditOnlyRecord = lifecycleCommand(auditOnly.request, "create");
    const audit = RunLifecycleCommandAuditRecordSchema.parse({
      kind: "run-lifecycle",
      auditId: auditOnlyRecord.commandId,
      request: auditOnlyRecord,
      result: { kind: "run", runId: UUID_5, appliedVersion: 1 },
      completedAt: NOW,
    });
    const auditOnlySqlite = new DatabaseSync(join(auditOnly.root, "authority.sqlite"));
    try {
      auditOnlySqlite.exec("PRAGMA foreign_keys = OFF");
      auditOnlySqlite.prepare(`
        INSERT INTO command_audits (record_key, command_id, record_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(audit.auditId, audit.request.commandId, canonicalJsonStringify(audit), audit.completedAt);
    } finally {
      auditOnlySqlite.close();
    }
    const auditOnlyGeneration = auditOnly.database.getMeta().authorityGeneration;
    assert.throws(() => auditOnly.service.create(auditOnly.request), /has an audit without its command/u);
    assert.equal(auditOnly.database.getMeta().authorityGeneration, auditOnlyGeneration);

    const mismatched = fixture();
    const matchedCommand = lifecycleCommand(mismatched.request, "create");
    const mismatchedRequest = RunLifecycleCommandRecordSchema.parse({
      ...matchedCommand,
      operation: "claim-next",
      requestFingerprint: HASH_A,
    });
    mismatched.database.withAuthorityTransaction(({ lifecycleJournal }) => {
      lifecycleJournal.insertCommand(matchedCommand);
      lifecycleJournal.insertAudit({
        kind: "run-lifecycle",
        auditId: matchedCommand.commandId,
        request: mismatchedRequest,
        result: { kind: "run", runId: UUID_5, appliedVersion: 1 },
        completedAt: NOW,
      });
    });
    const mismatchedGeneration = mismatched.database.getMeta().authorityGeneration;
    assert.throws(() => mismatched.service.create(mismatched.request), /has a mismatched audit/u);
    assert.equal(mismatched.database.getMeta().authorityGeneration, mismatchedGeneration);
  });

  it("#8 stale CAS reports the current version and writes nothing", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const run = created(service, request);
    service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig });
    const before = database.getMeta().authorityGeneration;
    const bytes = service.read(run.envelope.runId);
    assert.deepEqual(service.transition({ commandId: "60000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }),
    { state: "refused", refusal: { reason: "conflict", currentVersion: 2 } });
    assert.deepEqual(service.read(run.envelope.runId), bytes);
    assert.equal(database.getMeta().authorityGeneration, before);
  });

  it("list uses priority, enqueue time and run id, and refuses a stale cursor", () => {
    const { service, request } = fixture();
    const bulk = created(service, request);
    const interactive = created(service, { ...request, commandId: UUID_5, priority: "interactive" });
    const page = service.list({ disposition: "live", limit: 1 });
    if (page.state !== "listed") throw new Error("list refused");
    assert.deepEqual(page.rows.map((run) => run.envelope.runId), [interactive.envelope.runId]);
    assert.ok(page.cursor);
    const second = service.list({ disposition: "live", limit: 1, cursor: page.cursor });
    if (second.state !== "listed") throw new Error("second page refused");
    assert.deepEqual(second.rows.map((run) => run.envelope.runId), [bulk.envelope.runId]);
    created(service, { ...request, commandId: "70000000-0000-4000-8000-000000000001" });
    assert.deepEqual(service.list({ disposition: "live", limit: 1, cursor: page.cursor }),
      { state: "refused", refusal: { reason: "cursor-stale" } });
  });

  for (const operation of ["enqueue", "claim", "terminal"] as const) {
    it(`rolls back ${operation} state and journal when required timeline persistence fails`, () => {
      const f = fixture();
      const run = operation === "enqueue" ? undefined : created(f.service, f.request);
      const raw = new DatabaseSync(join(f.root, "authority.sqlite"));
      try {
        raw.exec("CREATE TRIGGER injected_timeline_failure BEFORE INSERT ON timeline_events BEGIN SELECT RAISE(ABORT, 'injected timeline failure'); END");
        const before = f.database.getMeta();
        const events = f.database.authority.timelineEvents.page({});
        const state = run === undefined ? undefined : f.service.read(run.envelope.runId);
        const commandId = operation === "enqueue" ? f.request.commandId : UUID_5;
        assert.throws(() => {
          if (operation === "enqueue") f.service.create(f.request);
          else if (operation === "claim") f.service.claimNext({ commandId, workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig: f.runtimeConfig });
          else {
            assert.ok(run);
            f.service.transition({ commandId, runId: run.envelope.runId, expectedVersion: run.version,
              lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
          }
        }, /injected timeline failure/);
        assert.deepEqual(f.database.getMeta(), before);
        assert.deepEqual(f.database.authority.timelineEvents.page({}), events);
        assert.equal(f.database.authority.lifecycleJournal.getCommand(commandId), undefined);
        if (run !== undefined) assert.deepEqual(f.service.read(run.envelope.runId), state);
        else assert.equal(f.database.authority.runs.listByWorkflow(WORKFLOW_ID).length, 0);
      } finally { raw.close(); }
    });
  }

  it("keeps one gate opening when a parked run is renamed and the rename is replayed", () => {
    const f = fixture();
    const running = runningRun(f.service, f.request, f.runtimeConfig);
    const parked = f.service.workerTransition({ commandId: "83000000-0000-4000-8000-000000000077",
      runId: running.envelope.runId, claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: { state: "parked-gate", gateId: GATE_RESULT.gateId, parkedAt: NOW, resumeAt: "crm-dates" } });
    if (parked.state !== "applied") throw new Error("park refused");
    const before = f.database.authority.timelineEvents.page({});
    const request = { commandId: "83000000-0000-4000-8000-000000000078",
      runId: running.envelope.runId, expectedVersion: parked.run.version, displayName: "Reviewed parked run" };
    const renamed = f.service.transition(request);
    if (renamed.state !== "applied") throw new Error("rename refused");
    assert.equal(renamed.run.displayName, request.displayName);
    assert.equal(f.service.transition(request).state, "applied-already");
    assert.deepEqual(f.database.authority.timelineEvents.page({}), before);
    const world = makeWorld();
    try {
      world.authority.records.set(running.envelope.runId, renamed.run);
      for (const record of f.database.authority.timelineEvents.page({})) {
        if (record.payload.kind === "span") world.writer.emit(record.payload.event);
      }
      assert.equal(world.projection.runFold(running.envelope.runId)?.openGates.length, 1);
    } finally { world.dispose(); }
  });

  it("rolls back gate parking when its required opened event fails", () => {
    const f = fixture();
    const running = runningRun(f.service, f.request, f.runtimeConfig);
    const raw = new DatabaseSync(join(f.root, "authority.sqlite"));
    try {
      raw.exec("CREATE TRIGGER injected_gate_event BEFORE INSERT ON timeline_events WHEN json_extract(NEW.record_json, '$.payload.event.t') = 'gate.opened' BEGIN SELECT RAISE(ABORT, 'injected gate event'); END");
      const before = f.database.getMeta();
      const events = f.database.authority.timelineEvents.page({});
      const commandId = "83000000-0000-4000-8000-000000000007";
      assert.throws(() => f.service.workerTransition({ commandId, runId: running.envelope.runId,
        claim: { workerId: WORKER_ID, claimGeneration: 1 },
        lifecycle: { state: "parked-gate", gateId: GATE_RESULT.gateId, parkedAt: NOW, resumeAt: "crm-dates" },
      }), /injected gate event/u);
      assert.deepEqual(f.database.authority.runs.get(running.envelope.runId), running);
      assert.deepEqual(f.database.getMeta(), before);
      assert.deepEqual(f.database.authority.timelineEvents.page({}), events);
      assert.equal(f.database.authority.lifecycleJournal.getCommand(commandId), undefined);
    } finally { raw.close(); }
  });

  it("queue-root publication waits for the outer transaction and disappears on rollback", () => {
    const { service, request, database, published } = fixture();
    let rolledBack: RunRecord | undefined;
    assert.throws(() => database.withAuthorityTransaction(() => {
      rolledBack = created(service, request);
      assert.equal(database.authority.timelineEvents.page({}).length, 1);
      assert.equal(published.length, 0);
      throw new Error("outer command refused");
    }), /outer command refused/);
    assert.equal(published.length, 0);
    assert.ok(rolledBack);
    assert.equal(service.read(rolledBack.envelope.runId).state, "absent");
    assert.deepEqual(database.authority.timelineEvents.page({}), []);
    database.withAuthorityTransaction(() => {
      created(service, { ...request, commandId: UUID_5 });
      assert.equal(published.length, 0);
    });
    assert.equal(published.length, 1);
  });

  it("#11 retry and restart create new attempts and preserve source identity", () => {
    const { service, request, runtimeConfig, database } = fixture();
    database.authority.runSessions.insert(RUN_SESSION);
    const run = created(service, { ...request, sessionId: RUN_SESSION_ID, descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint });
    service.transition({ commandId: UUID_5, runId: run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const source = service.read(run.envelope.runId);
    const retry = service.retry({ commandId: "80000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId, expectedVersion: 2, runtimeConfig }, personLookupDescriptor);
    assert.equal(retry.state, "applied");
    if (retry.state !== "applied") throw new Error("retry refused");
    assert.equal(retry.run.envelope.itemId, run.envelope.itemId);
    assert.equal(retry.run.envelope.attempt, 2);
    assert.equal(retry.run.envelope.retryOf, run.envelope.runId);
    assert.equal(retry.run.envelope.recovery, undefined);
    assert.equal(retry.run.sessionId, RUN_SESSION_ID);
    assert.deepEqual(retry.run.input, run.input);
    service.transition({ commandId: "80000000-0000-4000-8000-000000000002",
      runId: retry.run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const restart = service.restart({ commandId: "80000000-0000-4000-8000-000000000003",
      runId: run.envelope.runId, expectedVersion: 2, runtimeConfig }, personLookupDescriptor);
    assert.equal(restart.state, "applied");
    if (restart.state !== "applied") throw new Error("restart refused");
    assert.equal(restart.run.envelope.attempt, 3);
    assert.equal(restart.run.sessionId, RUN_SESSION_ID);
    assert.equal(restart.run.envelope.recovery, "restart-from-start");
    assert.equal(restart.run.envelope.retryOf, run.envelope.runId);
    assert.deepEqual(service.read(run.envelope.runId), source);
  });

  it("#12 refuses retry from deleted and unresolved-write sources without minting a run", () => {
    const deletedWorld = fixture();
    const deleted = created(deletedWorld.service, {
      ...deletedWorld.request,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    deletedWorld.service.transition({
      commandId: "86000000-0000-4000-8000-000000000001",
      runId: deleted.envelope.runId,
      expectedVersion: deleted.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    deletedWorld.service.delete({
      commandId: "86000000-0000-4000-8000-000000000002",
      runId: deleted.envelope.runId,
      expectedVersion: 2,
    });
    const deletedGeneration = deletedWorld.database.getMeta().authorityGeneration;
    assert.deepEqual(deletedWorld.service.retry({
      commandId: "86000000-0000-4000-8000-000000000003",
      runId: deleted.envelope.runId,
      expectedVersion: 2,
      runtimeConfig: deletedWorld.runtimeConfig,
    }, personLookupDescriptor), { state: "refused", refusal: { reason: "source-deleted" } });
    assert.equal(deletedWorld.database.getMeta().authorityGeneration, deletedGeneration);

    const parkedWorld = fixture();
    const running = runningRun(parkedWorld.service, parkedWorld.request, parkedWorld.runtimeConfig);
    const parked = parkedWorld.service.workerTransition({
      commandId: "86000000-0000-4000-8000-000000000004",
      runId: running.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: 1 },
      lifecycle: {
        state: "parked-write",
        writeIntentId: "86000000-0000-4000-8000-000000000099",
        intentGeneration: 1,
        parkedAt: NOW,
        code: "unknown",
        message: "external outcome is unknown",
      },
    });
    assert.equal(parked.state, "applied");
    if (parked.state !== "applied") throw new Error("parked transition refused");
    const parkedGeneration = parkedWorld.database.getMeta().authorityGeneration;
    assert.deepEqual(parkedWorld.service.retry({
      commandId: "86000000-0000-4000-8000-000000000005",
      runId: running.envelope.runId,
      expectedVersion: parked.run.version,
      runtimeConfig: parkedWorld.runtimeConfig,
    }, personLookupDescriptor), { state: "refused", refusal: { reason: "invalid-state" } });
    assert.equal(parkedWorld.database.getMeta().authorityGeneration, parkedGeneration);
    assert.equal(parkedWorld.database.authority.runs.listByItem({
      workflow: running.envelope.workflow,
      itemId: running.envelope.itemId,
    }).length, 1);
  });

  it("#13/#14/#18/#19/#20 preserves historical relaunch replay and lineage when the archived source is deleted", () => {
    const { service, request, database, runtimeConfig } = fixture(undefined, undefined, true);
    const source = created(service, {
      ...request,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    const terminal = service.transition({
      commandId: "81000000-0000-4000-8000-000000000001",
      runId: source.envelope.runId,
      expectedVersion: source.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(terminal.state, "applied");
    if (terminal.state !== "applied") throw new Error("terminal transition refused");
    const archived = archiveRun(
      service,
      database,
      terminal.run,
      "81000000-0000-4000-8000-000000000002",
    );
    const archivedBytes = database.authority.archivedRuns.get(source.envelope.runId);
    assert.ok(archivedBytes !== undefined);
    const generation = database.getMeta().authorityGeneration;
    assert.equal(service.archive({
      commandId: "81000000-0000-4000-8000-000000000003",
      expectedVersion: terminal.run.version,
      archive: archived.archive,
    }).state, "applied-already");
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(database.authority.archivedRuns.get(source.envelope.runId), archivedBytes);
    const { contentDigest: _originalDigest, ...originalArchiveContent } = archived.archive;
    const changedArchiveContent = ArchivedRunContentSchema.parse({
      ...originalArchiveContent, archivedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.deepEqual(service.archive({
      commandId: "81000000-0000-4000-8000-000000000004",
      expectedVersion: terminal.run.version,
      archive: { ...changedArchiveContent, contentDigest: archivedRunContentDigest(changedArchiveContent) },
    }), { state: "refused", refusal: { reason: "already-archived" } });
    assert.deepEqual(database.authority.archivedRuns.get(source.envelope.runId), archivedBytes);

    const { commandId: _createCommandId, ...relaunchCreate } = {
      ...request,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
      runtimeConfig,
    };
    const mismatchGeneration = database.getMeta().authorityGeneration;
    assert.deepEqual(service.relaunch({
      commandId: "81000000-0000-4000-8000-000000000005",
      archivedRunId: source.envelope.runId,
      archiveFingerprint: HASH_A,
      relaunchedBy: "local-operator",
      create: relaunchCreate,
    }, personLookupDescriptor), {
      state: "refused",
      refusal: { reason: "invalid-state" },
    });
    assert.equal(database.getMeta().authorityGeneration, mismatchGeneration);

    const relaunched = historicalRelaunch(service, database, {
      commandId: "81000000-0000-4000-8000-000000000006",
      archivedRunId: source.envelope.runId,
      archiveFingerprint: archivedRunReferenceFingerprint(archived.archive),
      relaunchedBy: "local-operator",
      create: relaunchCreate,
    });
    assert.equal(relaunched.state, "applied");
    if (relaunched.state !== "applied") throw new Error("relaunch refused");
    assert.equal(relaunched.run.envelope.retryOf, undefined);
    assert.equal(relaunched.run.envelope.itemId, source.envelope.itemId);
    assert.equal("archiveRelaunches" in database.authority, false);
    assert.ok(database.authority.runs.get(relaunched.run.envelope.runId));

    const wrongDeleteGeneration = database.getMeta().authorityGeneration;
    assert.deepEqual(service.deleteArchived({
      commandId: "81000000-0000-4000-8000-000000000007",
      runId: source.envelope.runId,
      archiveFingerprint: HASH_A,
    }), { state: "refused", refusal: { reason: "schema-mismatch", digest: HASH_A } });
    assert.equal(database.getMeta().authorityGeneration, wrongDeleteGeneration);
    const deleteRequest = {
      commandId: "81000000-0000-4000-8000-000000000008",
      runId: source.envelope.runId,
      archiveFingerprint: archivedRunReferenceFingerprint(archived.archive),
    };
    assert.equal(service.deleteArchived(deleteRequest).state, "deleted");
    assert.equal(service.read(source.envelope.runId).state, "deleted");
    assert.equal(service.deleteArchived(deleteRequest).state, "applied-already");
    assert.deepEqual(service.deleteArchived({
      ...deleteRequest,
      commandId: "81000000-0000-4000-8000-000000000011",
    }), { state: "refused", refusal: { reason: "tombstoned" } });
    assert.ok(database.authority.runs.get(relaunched.run.envelope.runId));

    const relaunchedTerminal = service.transition({
      commandId: "81000000-0000-4000-8000-000000000009",
      runId: relaunched.run.envelope.runId,
      expectedVersion: relaunched.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(relaunchedTerminal.state, "applied");
    if (relaunchedTerminal.state !== "applied") throw new Error("relaunch settle refused");
    assert.equal(service.delete({
      commandId: "81000000-0000-4000-8000-000000000010",
      runId: relaunched.run.envelope.runId,
      expectedVersion: relaunchedTerminal.run.version,
    }).state, "deleted");
    const replayedRelaunch = service.relaunch({
      commandId: "81000000-0000-4000-8000-000000000006",
      archivedRunId: source.envelope.runId,
      archiveFingerprint: archivedRunReferenceFingerprint(archived.archive),
      relaunchedBy: "local-operator",
      create: relaunchCreate,
    }, personLookupDescriptor);
    assert.equal(replayedRelaunch.state, "applied-already");
    assert.ok("tombstone" in replayedRelaunch);
    if (!("tombstone" in replayedRelaunch)) throw new Error("relaunch replay lost the deleted target tombstone");
    assert.equal(replayedRelaunch.tombstone.runId, relaunched.run.envelope.runId);
    assert.equal(replayedRelaunch.appliedVersion, relaunched.run.version);
    assert.equal("archiveRelaunches" in database.authority, false);
    assert.deepEqual(service.read("81000000-0000-4000-8000-000000000099"), {
      state: "absent",
      runId: "81000000-0000-4000-8000-000000000099",
    });
  });

  it("#20 returns every closed existence arm", () => {
    const { service, request, database } = fixture(undefined, undefined, true);
    const live = created(service, request);
    const archiveSource = created(service, {
      ...request,
      commandId: "88000000-0000-4000-8000-000000000001",
      matchKey: "existence-archived",
    });
    const archiveTerminal = service.transition({
      commandId: "88000000-0000-4000-8000-000000000002",
      runId: archiveSource.envelope.runId,
      expectedVersion: archiveSource.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (archiveTerminal.state !== "applied") throw new Error("existence archive setup refused");
    const archived = archiveRun(
      service,
      database,
      archiveTerminal.run,
      "88000000-0000-4000-8000-000000000003",
    );
    const deletedSource = created(service, {
      ...request,
      commandId: "88000000-0000-4000-8000-000000000004",
      matchKey: "existence-deleted",
    });
    const deleteTerminal = service.transition({
      commandId: "88000000-0000-4000-8000-000000000005",
      runId: deletedSource.envelope.runId,
      expectedVersion: deletedSource.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (deleteTerminal.state !== "applied") throw new Error("existence delete setup refused");
    const deleted = service.delete({
      commandId: "88000000-0000-4000-8000-000000000006",
      runId: deletedSource.envelope.runId,
      expectedVersion: deleteTerminal.run.version,
    });
    if (deleted.state !== "deleted" || !("tombstones" in deleted)) throw new Error("existence delete refused");
    const tombstone = deleted.tombstones[0];
    assert.ok(tombstone !== undefined);

    assert.deepEqual(service.read("88000000-0000-4000-8000-000000000099"), {
      state: "absent",
      runId: "88000000-0000-4000-8000-000000000099",
    });
    assert.deepEqual(service.read(live.envelope.runId), { state: "present", disposition: "live", run: live });
    assert.deepEqual(service.read(archiveSource.envelope.runId), {
      state: "present",
      disposition: "archived",
      run: archived.run,
    });
    assert.deepEqual(service.read(deletedSource.envelope.runId), { state: "deleted", tombstone });
  });

  it("#17 refuses a non-terminal root without writing a tombstone", () => {
    const { service, request, database } = fixture();
    const run = created(service, request);
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.delete({
      commandId: "89000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId,
      expectedVersion: run.version,
    }), { state: "refused", refusal: { reason: "not-terminal" } });
    assert.equal(database.authority.deletedRuns.get(run.envelope.runId), undefined);
    assert.deepEqual(service.read(run.envelope.runId), { state: "present", disposition: "live", run });
    assert.equal(database.getMeta().authorityGeneration, before);
  });

  it("#15/#17/#26 delete writes each tombstone first, removes leaves first, and settles each tally once", () => {
    const deleteSteps: { runId: string; step: string }[] = [];
    const { service, request, database } = fixture(undefined, {
      afterDeleteStep: (event) => deleteSteps.push(event),
    });
    const anchor = created(service, { ...request, shape: "operation" });
    const terminalAnchor = service.transition({
      commandId: "90000000-0000-4000-8000-000000000003",
      runId: anchor.envelope.runId,
      expectedVersion: anchor.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(terminalAnchor.state, "applied");
    if (terminalAnchor.state !== "applied") throw new Error("anchor settle refused");
    const members = [1, 2].map((n) => created(service, { ...request,
      commandId: `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      matchKey: `synthetic-member-${String(n)}`, shape: "operation-member",
      parent: { runId: anchor.envelope.runId, tracePrefix: anchor.envelope.traceId, edgeId: "members" },
    }));
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(service.delete({ commandId: "90000000-0000-4000-8000-000000000004",
      runId: anchor.envelope.runId, expectedVersion: terminalAnchor.run.version }),
    { state: "refused", refusal: { reason: "tree-non-terminal", runId: members[0].envelope.runId } });
    assert.equal(database.getMeta().authorityGeneration, before);
    for (const [index, member] of members.entries()) {
      service.transition({ commandId: `a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        runId: member.envelope.runId, expectedVersion: 1,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
      assert.deepEqual(service.delete({ commandId: `b0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        runId: member.envelope.runId, expectedVersion: 2 }),
      { state: "refused", refusal: { reason: "is-member" } });
    }
    const beforeDelete = database.getMeta().authorityGeneration;
    const outcome = service.delete({ commandId: "90000000-0000-4000-8000-000000000005",
      runId: anchor.envelope.runId, expectedVersion: terminalAnchor.run.version });
    assert.equal(outcome.state, "deleted");
    if (outcome.state !== "deleted" || !("tombstones" in outcome)) throw new Error("tree delete refused");
    assert.deepEqual(outcome.tombstones.map((entry) => entry.runId),
      [...members.map((member) => member.envelope.runId), anchor.envelope.runId]);
    assert.deepEqual(deleteSteps, [...members, anchor].flatMap((run) => [
      { runId: run.envelope.runId, step: "tombstone" },
      { runId: run.envelope.runId, step: "cascade-complete" },
      { runId: run.envelope.runId, step: "tally-settled" },
    ]));
    for (const tombstone of outcome.tombstones) {
      assert.deepEqual(database.authority.deletedRuns.get(tombstone.runId), tombstone);
      assert.deepEqual(tombstone.removed, [{ table: "timeline_events", rows: 2 }, { table: "workflow_runs", rows: 1 }]);
      assert.equal(tombstone.tallyVersion, 3);
    }
    assert.equal(database.getMeta().authorityGeneration, beforeDelete + 1);
    for (const run of [...members, anchor]) assert.equal(service.read(run.envelope.runId).state, "deleted");
  });

  it("requests cancellation on both a claimed anchor and claimed member without settling either", () => {
    const { service, request, runtimeConfig, database } = fixture();
    const anchor = runningRun(service, { ...request, shape: "operation" }, runtimeConfig);
    const member = created(service, { ...request, commandId: "99000000-0000-4000-8000-000000000001", matchKey: "claimed-member",
      shape: "operation-member", parent: { runId: anchor.envelope.runId, tracePrefix: anchor.envelope.traceId, edgeId: "member" } });
    const claimed = service.claimNext({ commandId: "99000000-0000-4000-8000-000000000002", workflow: WORKFLOW_ID,
      workerId: "member-worker", runtimeConfig });
    assert.equal(claimed.state, "applied");
    const cancelled = service.transition({ commandId: "99000000-0000-4000-8000-000000000003", runId: anchor.envelope.runId,
      expectedVersion: anchor.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    assert.equal(cancelled.state, "applied");
    for (const run of [anchor, member]) {
      const current = database.authority.runs.get(run.envelope.runId); assert.ok(current);
      assert.equal(current.cancelRequested, true);
      assert.notEqual(current.lifecycle.state, "terminal");
    }
  });

  it("#23 runs a multi-member group through cancel-tree and leaves-first deletion", () => {
    const writes: RunRecord[] = [];
    const { service, request } = fixture(undefined, {
      afterRunWrite: (run) => writes.push(run),
    });
    const anchor = created(service, { ...request, shape: "operation" });
    const members = [1, 2].map((index) => created(service, {
      ...request,
      commandId: `87000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      matchKey: `group-member-${String(index)}`,
      shape: "operation-member",
      parent: {
        runId: anchor.envelope.runId,
        tracePrefix: anchor.envelope.traceId,
        edgeId: `member-${String(index)}`,
      },
    }));
    writes.length = 0;
    const cancelled = service.transition({
      commandId: "87000000-0000-4000-8000-000000000003",
      runId: anchor.envelope.runId,
      expectedVersion: anchor.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    assert.equal(cancelled.state, "applied");
    if (cancelled.state !== "applied") throw new Error("group cancel refused");
    assert.deepEqual(writes.map(({ envelope }) => envelope.runId), [
      ...members.map(({ envelope }) => envelope.runId),
      anchor.envelope.runId,
    ]);
    assert.equal(cancelled.run.lifecycle.state, "terminal");
    for (const member of members) {
      const existence = service.read(member.envelope.runId);
      assert.equal(existence.state, "present");
      if (existence.state !== "present") throw new Error("group member disappeared");
      assert.equal(existence.run.lifecycle.state, "terminal");
      assert.deepEqual(service.delete({
        commandId: `87000000-0000-4000-8000-${String(member.envelope.attempt + 20).padStart(12, "0")}`,
        runId: member.envelope.runId,
        expectedVersion: existence.run.version,
      }), { state: "refused", refusal: { reason: "is-member" } });
    }
    const deleted = service.delete({
      commandId: "87000000-0000-4000-8000-000000000099",
      runId: anchor.envelope.runId,
      expectedVersion: cancelled.run.version,
    });
    assert.equal(deleted.state, "deleted");
    if (deleted.state !== "deleted" || !("tombstones" in deleted)) throw new Error("group delete refused");
    assert.deepEqual(deleted.tombstones.map(({ runId }) => runId), [
      ...members.map(({ envelope }) => envelope.runId),
      anchor.envelope.runId,
    ]);
  });

  for (const kind of ["create", "claim"] as const) {
    it(`${kind === "create" ? "#1" : "#4"} ${kind} serializes independent connections across a held reservation`, async () => {
      const { root, request, service, runtimeConfig } = fixture();
      if (kind === "claim") created(service, request);
      const releases = [new SharedArrayBuffer(4), new SharedArrayBuffer(4)];
      const connections = releases.map((release, index) => raceConnection({
        path: join(root, "authority.sqlite"), now: NOW, release,
        runId: `c0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        operation: kind === "create" ? { kind, request: { ...request,
          commandId: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        } } : { kind, request: { runtimeConfig, workflow: WORKFLOW_ID,
          workerId: `race-worker-${String(index)}`,
          commandId: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        } },
      }));
      try {
        const [first, second] = connections;
        assert.deepEqual(await first.next(), { type: "ready" });
        assert.deepEqual(await second.next(), { type: "ready" });
        first.worker.postMessage("run");
        assert.deepEqual(await first.next(), { type: "reserved" });
        second.worker.postMessage("run");
        const blocked = await second.next();
        assert.equal(blocked.type, "error", "second connection crossed the reservation before first commit");
        if (blocked.type !== "error") throw new Error("second connection did not block");
        assert.match(blocked.message, /database is locked/);
        Atomics.store(new Int32Array(releases[0]), 0, 1);
        Atomics.notify(new Int32Array(releases[0]), 0);
        const firstResult = await first.next();
        assert.equal(firstResult.type, "result");
        if (firstResult.type !== "result") throw new Error("first connection did not finish");
        assert.equal(firstResult.outcome.state, "applied");
        Atomics.store(new Int32Array(releases[1]), 0, 1);
        second.worker.postMessage("run");
        if (kind === "create") assert.deepEqual(await second.next(), { type: "reserved" });
        const secondResult = await second.next();
        assert.equal(secondResult.type, "result");
        if (secondResult.type !== "result") throw new Error("second connection did not finish");
        if (kind === "claim") {
          assert.deepEqual(secondResult.outcome, { state: "refused", refusal: { reason: "none-eligible" } });
        } else {
          assert.equal(secondResult.outcome.state, "applied");
          assert.deepEqual([firstResult.outcome.run.envelope.attempt, secondResult.outcome.run.envelope.attempt], [1, 2]);
          assert.deepEqual([firstResult.outcome.run.runNumber, secondResult.outcome.run.runNumber], [1, 2]);
        }
      } finally {
        await Promise.all(connections.map(({ worker }) => worker.terminate()));
      }
    });
  }

  it("#22 removes only the deleted run's gate records and tallies them", () => {
    const { service, request, database } = fixture();
    const source = created(service, request);
    const peer = created(service, { ...request, commandId: UUID_5, matchKey: "synthetic-peer" });
    const sourceGate = { ...GATE_RESULT, runId: source.envelope.runId };
    const peerGate = { ...GATE_RESULT, runId: peer.envelope.runId };
    database.authority.gateResults.insert(sourceGate);
    database.authority.gateResults.insert(peerGate);
    service.transition({ commandId: "e0000000-0000-4000-8000-000000000001",
      runId: source.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const deleted = service.delete({ commandId: "e0000000-0000-4000-8000-000000000002",
      runId: source.envelope.runId, expectedVersion: 2 });
    assert.equal(deleted.state, "deleted");
    assert.deepEqual(database.authority.gateResults.listByRun(source.envelope.runId), []);
    assert.deepEqual(database.authority.gateResults.listByRun(peer.envelope.runId), [peerGate]);
    assert.deepEqual(database.authority.deletedRuns.get(source.envelope.runId)?.removed
      .filter((entry) => entry.table === "checkpoint_payloads"), [{ table: "checkpoint_payloads", rows: 1 }]);
    assert.equal(service.transition({
      commandId: "e0000000-0000-4000-8000-000000000003",
      runId: source.envelope.runId,
      expectedVersion: 2,
      lifecycle: { state: "queued" },
    }).state, "deleted", "a tombstoned gate target cannot re-enter the lifecycle");
    assert.deepEqual(database.authority.gateResults.listByRun(source.envelope.runId), []);
  });

  it("#2 refuses a minted id already held by a tombstone without touching authority", () => {
    const { service, request, database, clock } = fixture();
    const run = created(service, request);
    service.transition({ commandId: UUID_5, runId: run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    service.delete({ commandId: "f0000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId, expectedVersion: 2 });
    const collision = new RunRecordService({ database, clock, ids: { uuid: () => run.envelope.runId },
      publishQueued: () => assert.fail("tombstoned id must never publish a new queue root") });
    const before = database.getMeta().authorityGeneration;
    assert.deepEqual(collision.create({ ...request, commandId: "f0000000-0000-4000-8000-000000000002" }),
      { state: "refused", refusal: { reason: "tombstoned" } });
    assert.equal(database.getMeta().authorityGeneration, before);
    assert.equal(service.read(run.envelope.runId).state, "deleted");
  });

  it("#25 reads historical NULL ordinals without inventing a spent value", () => {
    const { service, request, database, root } = fixture();
    // Reproduce the old cascade's retained shape, with no recovered span-root
    // ordinals. The run originates in the service; all protective triggers stay.
    const run = created(service, request);
    service.transition({ commandId: UUID_5, runId: run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const historical = {
      runId: run.envelope.runId, workflow: WORKFLOW_ID, traceId: run.envelope.traceId,
      origin: "queue", commandId: UUID_1, deletedAt: NOW, removed: [{ table: "workflow_runs", rows: 1 }],
    };
    const raw = new DatabaseSync(join(root, "authority.sqlite"));
    try {
      raw.prepare(`INSERT INTO deleted_runs
        (record_key, workflow, trace_id, origin, command_id, deleted_at, record_json, created_at,
         item_id, attempt, run_number, ordinal_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'unknown')`)
        .run(historical.runId, WORKFLOW_ID, historical.traceId, "queue", UUID_1, NOW, JSON.stringify(historical), NOW);
      raw.prepare("DELETE FROM timeline_events WHERE run_id = ?").run(historical.runId);
      raw.prepare("DELETE FROM workflow_runs WHERE record_key = ?").run(historical.runId);
    } finally { raw.close(); }
    const before = database.getMeta().authorityGeneration;
    const answer = service.read(historical.runId);
    assert.equal(answer.state, "deleted");
    if (answer.state !== "deleted") throw new Error("historical tombstone did not read forward");
    assert.equal(answer.tombstone.attempt, null);
    assert.equal(answer.tombstone.runNumber, null);
    assert.equal(answer.tombstone.itemId, null);
    assert.equal(answer.tombstone.ordinalSource, "unknown");
    assert.equal(database.getMeta().authorityGeneration, before);
    const next = created(service, { ...request, commandId: "f0000000-0000-4000-8000-000000000003" });
    assert.equal(next.envelope.attempt, 1);
    assert.equal(next.runNumber, 1);
    assert.deepEqual(service.read(historical.runId), answer);
  });

  it("#17 session membership alone permits deletion and preserves the session", () => {
    const { service, request, database } = fixture();
    database.authority.runSessions.insert(RUN_SESSION);
    const run = created(service, { ...request, sessionId: RUN_SESSION_ID });
    service.transition({ commandId: UUID_5, runId: run.envelope.runId, expectedVersion: 1,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const session = database.authority.runSessions.get(RUN_SESSION_ID);
    const deleted = service.delete({ commandId: "90000000-0000-4000-8000-000000000001",
      runId: run.envelope.runId, expectedVersion: 2 });
    assert.equal(deleted.state, "deleted");
    assert.equal(service.read(run.envelope.runId).state, "deleted");
    assert.deepEqual(database.authority.runSessions.get(RUN_SESSION_ID), session);
  });

  it("#21 ignores a retired file root in canonical reads and current storage health", async () => {
    const { service, request, root, clock } = fixture();
    const runId = UUID_5;
    const traceId = "pl-120021-0000";
    const authorityPath = join(root, "authority.sqlite");
    const countTasks = () => {
      const sqlite = new DatabaseSync(authorityPath, { readOnly: true });
      try {
        return (sqlite.prepare("SELECT count(*) AS count FROM workflow_runs").get() as { count: number }).count;
      } finally {
        sqlite.close();
      }
    };
    assert.equal(countTasks(), 0);
    assert.deepEqual(service.read(runId), { state: "absent", runId });
    createSpanJsonlWriter({ stateRoot: root, clock, pid: 4242 }).emit({
      t: "run.queued", kind: "run", ts: NOW,
      workflow: request.workflow, runId, attempt: 1, traceId, spanPath: traceId,
      itemId: UUID_6, shape: request.shape, priority: request.priority, dryRun: request.dryRun,
      actorId: "local-operator", title: "Redacted span-only run",
      descriptorVersion: request.descriptorVersion,
      contractFingerprint: request.contractFingerprint,
      resolvedInstance: request.resolvedInstance,
      configFingerprint: request.configFingerprint,
      configSnapshotId: request.configSnapshotId,
    });
    const doctor = await doctorAuthorityStorage({
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: join(root, "backups"),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 250,
    }, clock);
    assert.deepEqual(doctor.spanAuthority, { state: "reconciled", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [] });
    assert.deepEqual(service.read(runId), { state: "absent", runId });
    assert.equal(countTasks(), 0);
  });

  it("D330.10 table-class coverage drives every public service method and its generation class", () => {
    const { service, request, runtimeConfig, database } = fixture(undefined, undefined, true);
    const covered = new Set<string>();
    let commandSequence = 100;
    const commandId = () => `99000000-0000-4000-8000-${String(commandSequence++).padStart(12, "0")}`;
    const measure = <T,>(method: string, delta: 0 | 1, call: () => T): T => {
      const before = database.getMeta().authorityGeneration;
      const result = call();
      assert.equal(database.getMeta().authorityGeneration, before + delta, method);
      covered.add(method);
      return result;
    };

    const sourceResult = measure("create", 1, () => service.create({
      ...request,
      commandId: commandId(),
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    }));
    if (sourceResult.state !== "applied") throw new Error("coverage create refused");
    const source = sourceResult.run;
    assert.deepEqual(measure("withRunTreeSnapshot", 0, () => service.withRunTreeSnapshot([source.envelope.runId], runs => runs.map(run => run.envelope.runId))), [source.envelope.runId]);
    measure("read", 0, () => service.read(source.envelope.runId));
    assert.ok(measure("lifecycleStorage", 0, () => service.lifecycleStorage()));
    measure("list", 0, () => service.list({ disposition: "live", limit: 10 }));
    const terminal = measure("transition", 1, () => service.transition({
      commandId: commandId(), runId: source.envelope.runId, expectedVersion: source.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    }));
    if (terminal.state !== "applied") throw new Error("coverage transition refused");
    const retry = measure("retry", 1, () => service.retry({
      commandId: commandId(), runId: source.envelope.runId,
      expectedVersion: terminal.run.version, runtimeConfig,
    }, personLookupDescriptor));
    if (retry.state !== "applied") throw new Error("coverage retry refused");
    const settledRetry = service.transition({
      commandId: commandId(), runId: retry.run.envelope.runId, expectedVersion: retry.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (settledRetry.state !== "applied") throw new Error("coverage retry setup refused");
    const restart = measure("restart", 1, () => service.restart({
      commandId: commandId(), runId: source.envelope.runId,
      expectedVersion: terminal.run.version, runtimeConfig,
    }, personLookupDescriptor));
    if (restart.state !== "applied") throw new Error("coverage restart refused");
    const settledRestart = service.transition({
      commandId: commandId(), runId: restart.run.envelope.runId, expectedVersion: restart.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (settledRestart.state !== "applied") throw new Error("coverage restart setup refused");

    database.authority.versionPlans.insert(VERSION_PLAN_ROW);
    database.authority.versionBumpApplications.insert(VersionBumpApplicationSchema.parse({
      ...VERSION_BUMP_APPLICATION,
      archivedRunIds: [source.envelope.runId],
    }));
    const archive = archivedRecord(terminal.run);
    const archived = measure("archive", 1, () => service.archive({
      commandId: commandId(), expectedVersion: terminal.run.version, archive,
    }));
    if (archived.state !== "applied") throw new Error("coverage archive refused");
    const { commandId: _ignored, ...relaunchCreate } = {
      ...request,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    };
    const historicalRequest = { commandId: commandId(), archivedRunId: source.envelope.runId,
      archiveFingerprint: archivedRunReferenceFingerprint(archive), relaunchedBy: "local-operator", create: relaunchCreate };
    const relaunched = historicalRelaunch(service, database, historicalRequest);
    assert.equal(measure("relaunch", 0, () => service.relaunch(historicalRequest, personLookupDescriptor)).state, "applied-already");
    if (relaunched.state !== "applied") throw new Error("coverage relaunch refused");
    const settledRelaunch = service.transition({
      commandId: commandId(), runId: relaunched.run.envelope.runId,
      expectedVersion: relaunched.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
    });
    if (settledRelaunch.state !== "applied") throw new Error("coverage delete setup refused");
    const deletedArchive = measure("deleteArchived", 1, () => service.deleteArchived({
      commandId: commandId(), runId: source.envelope.runId, archiveFingerprint: archivedRunReferenceFingerprint(archive),
    }));
    assert.equal(deletedArchive.state, "deleted");

    const workerRun = created(service, {
      ...request,
      commandId: commandId(),
      matchKey: "coverage-worker",
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    });
    const claim = measure("claimNext", 1, () => service.claimNext({
      commandId: commandId(), workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig,
    }));
    if (claim.state !== "applied" || claim.run.envelope.runId !== workerRun.envelope.runId) {
      throw new Error("coverage claim refused or selected the wrong run");
    }
    const renewed = measure("renewClaim", 1, () => service.renewClaim({
      commandId: commandId(), runId: workerRun.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration },
    }));
    if (renewed.state !== "applied") throw new Error("coverage renew refused");
    const validating = measure("workerTransition", 1, () => service.workerTransition({
      commandId: commandId(), runId: workerRun.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration },
      lifecycle: { state: "validating", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW },
    }));
    if (validating.state !== "applied") throw new Error("coverage worker transition refused");
    const running = service.workerTransition({
      commandId: commandId(), runId: workerRun.envelope.runId,
      claim: { workerId: WORKER_ID, claimGeneration: claim.run.claimGeneration },
      lifecycle: {
        state: "running", workerId: WORKER_ID, claimedAt: NOW, heartbeatAt: NOW,
        currentNodeId: "crm-dates",
      },
    });
    if (running.state !== "applied") throw new Error("coverage running transition refused");
    const terminalized = measure("terminalize", 1, () => service.terminalize(
      failureTerminalRequest(running.run, commandId()),
      personLookupDescriptor,
    ));
    if (terminalized.state !== "applied") throw new Error("coverage terminalize refused");

    const recoverable = created(service, { ...request, commandId: commandId(), matchKey: "coverage-requeue" });
    const recoveryClaim = service.claimNext({
      commandId: commandId(), workflow: WORKFLOW_ID, workerId: WORKER_ID, runtimeConfig,
    });
    if (recoveryClaim.state !== "applied" || recoveryClaim.run.envelope.runId !== recoverable.envelope.runId) {
      throw new Error("coverage recovery claim refused or selected the wrong run");
    }
    const requeued = measure("requeue", 1, () => service.requeue({
      commandId: commandId(), runId: recoverable.envelope.runId,
      expectedVersion: recoveryClaim.run.version,
      claim: { workerId: WORKER_ID, claimGeneration: recoveryClaim.run.claimGeneration },
      cause: "recovery",
    }));
    if (requeued.state !== "applied") throw new Error("coverage requeue refused");

    const deleted = measure("delete", 1, () => service.delete({
      commandId: commandId(), runId: relaunched.run.envelope.runId,
      expectedVersion: settledRelaunch.run.version,
    }));
    assert.equal(deleted.state, "deleted");
    const purged = measure("purge", 1, () => service.purge({
      commandId: commandId(), evidenceClass: "diagnostic-bundle", bundleId: UUID_6,
    }));
    assert.deepEqual(purged, { state: "purged", evidenceClass: "diagnostic-bundle", purged: 0 });

    const sourceText = readFileSync(join(process.cwd(), "src/backend/runs/lifecycle/run-record-service.ts"), "utf8");
    const sourceFile = ts.createSourceFile("run-record-service.ts", sourceText, ts.ScriptTarget.Latest, true);
    const serviceClass = sourceFile.statements.find((statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === "RunRecordService");
    assert.ok(serviceClass !== undefined);
    const publicMethods = serviceClass.members
      .filter((member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
        && !member.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.PrivateKeyword))
      .map((method) => {
        assert.ok(ts.isIdentifier(method.name), "service public method names remain static identifiers");
        return method.name.text;
      })
      .sort();
    assert.deepEqual([...covered].sort(), publicMethods);
  });

});


describe("worker lifecycle service capability", () => {
  it("separates command authority and stable nested identities", () => {
    const { service } = fixture();
    assert.deepEqual(Object.keys(workerRunLifecyclePort(service)).sort(),
      ["claimNext", "renewClaim", "requeue", "terminalize", "workerTransition"].sort());
    assert.deepEqual(Object.keys(runContinuationPort(service)), ["transition"]);
    assert.equal(lifecycleCommandId("worker", UUID_1), lifecycleCommandId("worker", UUID_1));
    assert.notEqual(lifecycleCommandId("worker", UUID_1), lifecycleCommandId("continuation", UUID_1));
    assert.notEqual(lifecycleCommandId("continuation", UUID_1), UUID_1);
  });

  it("settles admitted cancellation under both fences; outer rollback removes journal and lifecycle", () => {
    const { database, service, request, runtimeConfig } = fixture();
    const run = created(service, request);
    const claimed = requireLifecycleApplied(service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID,
      workerId: WORKER_ID, runtimeConfig }));
    const requested = requireLifecycleApplied(service.transition({ commandId: UUID_6,
      runId: run.envelope.runId, expectedVersion: claimed.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
    const terminal = { kind: "cancelled", commandId: lifecycleCommandId("cancel", run.envelope.runId),
      runId: run.envelope.runId, expectedVersion: requested.version,
      claim: { workerId: WORKER_ID, claimGeneration: claimed.claimGeneration }, endedAt: NOW };
    const generation = database.getMeta().authorityGeneration;
    assert.throws(() => database.withAuthorityTransaction(() => {
      assert.equal(service.terminalize(terminal, personLookupDescriptor).state, "applied");
      throw new Error("outer cancellation rollback");
    }), /outer cancellation rollback/);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(database.authority.runs.get(run.envelope.runId), requested);
    const settled = requireLifecycleApplied(service.terminalize(terminal, personLookupDescriptor));
    assert.deepEqual(settled.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: NOW });
    const after = database.getMeta().authorityGeneration;
    assert.equal(service.terminalize(terminal, personLookupDescriptor).state, "applied-already");
    assert.deepEqual(service.terminalize({ ...terminal, endedAt: LATER }, personLookupDescriptor),
      { state: "refused", refusal: { reason: "replay-divergent" } });
    assert.equal(database.getMeta().authorityGeneration, after);
  });

  it("D118 finds attempting evidence from an absent run before releasing or cancelling the same item", () => {
    const { database, service, request, runtimeConfig } = fixture();
    const run = created(service, request);
    const claimed = requireLifecycleApplied(service.claimNext({ commandId: UUID_5, workflow: WORKFLOW_ID,
      workerId: WORKER_ID, runtimeConfig }));
    const requested = requireLifecycleApplied(service.transition({ commandId: UUID_6,
      runId: run.envelope.runId, expectedVersion: claimed.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
    const absentRunId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const bindingProof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: absentRunId };
    const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
    database.authority.writeIntents.fenceAttempt({
      intent: { ...WRITE_INTENT_ATTEMPTING, workflowId: run.envelope.workflow, itemId: run.envelope.itemId,
        runId: absentRunId, bindingProof, bindingProofDigest },
      attempt: { ...WRITE_ATTEMPT, runId: absentRunId, bindingProof, bindingProofDigest },
    });
    assert.equal(database.authority.writeIntents.listByRun(run.envelope.runId).length, 0);
    const generation = database.getMeta().authorityGeneration;
    assert.equal(database.authority.writeIntents.listAttemptingByItem({
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId }).length, 1);
    assert.equal(database.authority.writeIntents.listAttemptingByItem({
      workflowId: run.envelope.workflow, itemId: UUID_1 }).length, 0);
    assert.throws(() => database.authority.writeIntents.listAttemptingByItem({
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId, extra: true }));
    const result = service.requeue({ commandId: lifecycleCommandId("recovery", run.envelope.runId),
      runId: run.envelope.runId, expectedVersion: requested.version, cause: "recovery", staleBefore: LATER });
    assert.equal(result.state, "recovery-required");
    if (result.state !== "recovery-required") throw new Error("D118 did not refuse release");
    assert.equal(result.parked, false);
    assert.deepEqual(result.run, requested);
    assert.equal(database.getMeta().authorityGeneration, generation);
  });
});


for (const finishingGeneration of [2, 3]) {
  it(`C P1/P4 rejects A generation1 after reassignment; generation${finishingGeneration} finishes and Retry preserves completion`, () => {
    const f = fixture(); let next = 20;
    const id = () => `99000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
    let running = runningRun(f.service, f.request, f.runtimeConfig);
    const stale = failureTerminalRequest(running, id());
    for (let generation = 2; generation <= finishingGeneration; generation++) {
      assert.equal(f.service.requeue({ commandId: id(), runId: running.envelope.runId,
        expectedVersion: running.version, cause: "recovery", staleBefore: LATER }).state, "applied");
      const workerId = generation === 2 ? "worker-b" : WORKER_ID;
      const claimed = requireLifecycleApplied(f.service.claimNext({ commandId: id(), workflow: WORKFLOW_ID, workerId, runtimeConfig: f.runtimeConfig }));
      assert.equal(claimed.claimGeneration, generation);
      const claim = { workerId, claimGeneration: generation };
      requireLifecycleApplied(f.service.workerTransition({ commandId: id(), runId: claimed.envelope.runId,
        claim, lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW } }));
      running = requireLifecycleApplied(f.service.workerTransition({ commandId: id(), runId: claimed.envelope.runId,
        claim, lifecycle: { state: "running", workerId, claimedAt: NOW, heartbeatAt: NOW, currentNodeId: "crm-dates" } }));
      const before = f.database.getMeta();
      assert.deepEqual(f.service.terminalize(stale, personLookupDescriptor), { state: "refused", refusal: { reason: "lost" } });
      assert.deepEqual(f.database.getMeta(), before);
      assert.equal(f.database.authority.runs.get(running.envelope.runId)?.completion, undefined);
    }
    const current = failureTerminalRequest(running, id());
    current.terminal.authorization.claim = { workerId: finishingGeneration === 2 ? "worker-b" : WORKER_ID, claimGeneration: finishingGeneration };
    const terminal = requireLifecycleApplied(f.service.terminalize(current, personLookupDescriptor));
    assert.equal(terminal.completion?.claim.claimGeneration, finishingGeneration);
    const retry = requireLifecycleApplied(f.service.retry({ commandId: id(), runId: terminal.envelope.runId,
      expectedVersion: terminal.version, runtimeConfig: f.runtimeConfig }, personLookupDescriptor));
    assert.notEqual(retry.envelope.runId, terminal.envelope.runId);
    assert.equal(retry.envelope.retryOf, terminal.envelope.runId);
    assert.equal(retry.completion, undefined);
    assert.deepEqual(f.database.authority.runs.get(terminal.envelope.runId), terminal);
    assert.equal(f.service.terminalize(current, personLookupDescriptor).state, "applied-already");
    const claims = f.database.authority.timelineEvents.page({}).filter((record) => record.payload.kind === "span" && record.payload.event.t === "run.claimed");
    assert.equal(claims.length, finishingGeneration);
    claims.forEach((record, index) => {
      assert.ok(record.payload.kind === "span" && record.payload.event.t === "run.claimed");
      assert.equal(record.payload.event.claimGeneration, index + 1);
    });
  });
}

it("C P1 competing connections cannot accept conflicting failure settlements", async () => {
  const f = fixture(); const running = runningRun(f.service, f.request, f.runtimeConfig);
  const firstRequest = failureTerminalRequest(running, "99000000-0000-4000-8000-000000000051");
  const secondRequest = failureTerminalRequest(running, "99000000-0000-4000-8000-000000000052");
  secondRequest.terminal.failure.failureId = UUID_5;
  secondRequest.terminal.authorization.failureId = UUID_5;
  const releases = [new SharedArrayBuffer(4), new SharedArrayBuffer(4)];
  const connections = [firstRequest, secondRequest].map((request, index) => raceConnection({
    path: join(f.root, "authority.sqlite"), now: NOW, release: releases[index], runId: running.envelope.runId,
    operation: { kind: "terminal-failure", request: { commandId: request.commandId, terminal: request.terminal } },
  }));
  const [first, second] = connections; assert.ok(first && second && releases[0] && releases[1]);
  try {
    assert.deepEqual(await first.next(), { type: "ready" }); assert.deepEqual(await second.next(), { type: "ready" });
    first.worker.postMessage("run"); assert.deepEqual(await first.next(), { type: "reserved" });
    second.worker.postMessage("run"); const busy = await second.next(); assert.equal(busy.type, "error");
    if (busy.type !== "error") throw new Error("competing settlement did not encounter held transaction");
    assert.match(busy.message, /locked|busy/);
    assert.deepEqual(f.database.authority.runs.get(running.envelope.runId), running);
    Atomics.store(new Int32Array(releases[0]), 0, 1); Atomics.notify(new Int32Array(releases[0]), 0);
    const accepted = await first.next(); assert.equal(accepted.type, "result");
    if (accepted.type !== "result") throw new Error("winning settlement missing");
    assert.equal(accepted.outcome.state, "applied");
    Atomics.store(new Int32Array(releases[1]), 0, 1); second.worker.postMessage("run");
    assert.deepEqual(await second.next(), { type: "result", outcome: { state: "refused", refusal: { reason: "lost" } } });
    assert.equal(f.database.authority.failures.listByRun(running.envelope.runId).length, 1);
    assert.equal(f.database.authority.failures.get(UUID_5), undefined);
    assert.equal(f.database.authority.lifecycleJournal.getCommand(secondRequest.commandId), undefined);
  } finally { await Promise.all(connections.map(({ worker }) => worker.terminate())); }
});


describe("F repaired settings selection", () => {
  for (const operation of ["retry", "restart"] as const) {
    it(`${operation} selects active settings and preserves source and journal replay`, () => {
      const f = fixture();
      const source = created(f.service, { ...f.request,
        contractFingerprint: personLookupDescriptor.contractFingerprint });
      const terminal = requireLifecycleApplied(f.service.transition({ commandId: UUID_5,
        runId: source.envelope.runId, expectedVersion: source.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
      f.database.authority.configSnapshots.insert({ ...CONFIG_SNAPSHOT,
        configSnapshotId: UUID_6, fingerprint: HASH_C });
      f.database.authority.runtimeConfig.activate({ settingsRevision: 1, settingsFingerprint: HASH_A,
        configSnapshotId: UUID_6, configFingerprint: HASH_C, activatedAt: NOW });
      const request = { commandId: "83000000-0000-4000-8000-000000000091",
        runId: terminal.envelope.runId, expectedVersion: terminal.version,
        runtimeConfig: selectRunRuntime(f.database.authority) };
      const next = requireLifecycleApplied(f.service[operation](request, personLookupDescriptor));
      assert.equal(next.envelope.configSnapshotId, UUID_6);
      assert.equal(next.envelope.configFingerprint, HASH_C);
      assert.deepEqual(next.input, terminal.input);
      assert.deepEqual(f.database.authority.runs.get(terminal.envelope.runId), terminal);
      f.database.authority.runtimeConfig.activate({ settingsRevision: 1, settingsFingerprint: HASH_A,
        configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint, activatedAt: NOW });
      assert.deepEqual(requireLifecycleApplied(f.service[operation](request, personLookupDescriptor)), next);
    });
  }
});


it("F direct creation selects current settings while exact replay retains the original snapshot", () => {
 const f = fixture();
 f.database.authority.configSnapshots.insert({ ...CONFIG_SNAPSHOT, configSnapshotId: UUID_6, fingerprint: HASH_C });
 f.database.authority.runtimeConfig.activate({ settingsRevision: 1, settingsFingerprint: HASH_A,
  configSnapshotId: UUID_6, configFingerprint: HASH_C, activatedAt: NOW });
 const request = { ...f.request, runtimeConfig: selectRunRuntime(f.database.authority) };
 const next = created(f.service, request);
 assert.equal(next.envelope.configSnapshotId, UUID_6);
 assert.equal(next.envelope.configFingerprint, HASH_C);
 f.database.authority.runtimeConfig.activate({ settingsRevision: 1, settingsFingerprint: HASH_A,
  configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint, activatedAt: NOW });
 assert.deepEqual(requireLifecycleApplied(f.service.create(request)), next);
});
