import { afterAll, afterEach, describe, it } from "vitest";
import { createClonedProfileFixtures, openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { checkParkedWrite } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { WorkerSessionClosureUnprovedError, WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWorkerBrowserControl } from "../../../../src/backend/runtime/workers/worker-browser-control.js";
import { createWorkerBrowserChannel } from "../../../../src/backend/runtime/workers/worker-browser-channel.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { UcpathTerminationTargetSchema, UcpathTransactionScanSchema } from "../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { UcpathCreateTermination, UcpathCreateTerminationOutputSchema, ucpathTerminationIdempotencyKey } from "../../../../src/models/systems/ucpath/create-termination.js";
import { UcpathStageTermination } from "../../../../src/models/systems/ucpath/stage-termination.js";
import { CommandRequestSchema, ParkedWriteCheckTargetSchema } from "../../../../src/rules/commands/commands.js";
import { BrowserSessionIdSchema, PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { deriveIdempotencyKeyDigest, deriveWriteAuthorityReason, deriveWriteBindingProofDigest, WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { ManualScheduler, recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { testRunService, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { UUID_5, UUID_6, UUID_7, UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { WRITE_FIXTURE_NOW, WRITE_FIXTURE_FINGERPRINT, WRITE_FIXTURE_OBSERVATION, WRITE_FIXTURE_STAGED_STATE, writeFixtureQueuedRun } from "../../../support/fixtures/write-sequencer-fixtures.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());

const NOW = WRITE_FIXTURE_NOW;
const TARGET = UcpathTerminationTargetSchema.parse({ emplId: "10800000", expectedName: "Synthetic Person", emplRecord: "0", effectiveDate: "06/11/2026",
  template: "UC_VOL_TERM", reasonCode: "Resign - Attend School", lastDateWorked: "06/10/2026", initiatorComments: "Synthetic read-only check" });
const canonical = defineCanonicalInput(UcpathTerminationTargetSchema, UcpathTerminationTargetSchema, [TARGET]);
const graph = flow(UcpathTerminationTargetSchema).transaction("submit-write", { dependsOn: [],
  prepare: { uses: UcpathStageTermination, bind: ({ input }) => input },
  commit: { uses: UcpathCreateTermination, bind: ({ input }) => input },
  dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000,
}).build({ schema: UcpathCreateTerminationOutputSchema, dependsOn: ["submit-write"], derive: ({ outputs }) => outputs["submit-write"].output });
function heldDescriptor(id: string) {
  return defineWorkflowDescriptor({ id: WorkflowIdSchema.parse(id), version: 1, contractFingerprint: WRITE_FIXTURE_FINGERPRINT,
    code: "sep", label: "Synthetic held probe", icon: "ShieldCheck", category: "operations", canonicalInput: canonical, inputSubject: "eid",
    surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
    identity: { matchKey: input => `eid:${input.emplId}` }, presentation: { title: () => "Synthetic held probe" }, scenarios: ["parked-check/read"], flow: graph });
}
const descriptor = heldDescriptor("separations");

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose(); });
async function fixture(rows: number, workflowId: string = descriptor.id) {
  const active = workflowId === descriptor.id ? descriptor : heldDescriptor(workflowId);
  const clock = manualClock(new Date(NOW));
  const opened = await openBoundDatabaseFixture("parked-read-check", clock, undefined, undefined, undefined, undefined, profileFixtures.create);
  disposers.push(() => opened.close());
  const template = RunRecordSchema.parse(writeFixtureQueuedRun());
  const run = RunRecordSchema.parse({ ...template, envelope: { ...template.envelope, workflow: active.id, descriptorVersion: active.version,
    contractFingerprint: active.contractFingerprint, resolvedInstance: { ucpath: "prod" }, dryRun: false },
    input: { raw: TARGET, parsed: { schemaHash: deriveSchemaHash(canonical, "output"), value: TARGET, protectedBindings: [] },
      ingressSchemaHash: deriveSchemaHash(UcpathTerminationTargetSchema, "input") },
    lifecycle: { state: "parked-write", writeIntentId: UUID_8, intentGeneration: 1, parkedAt: NOW, code: "unknown", message: "Synthetic unknown write" }, version: 4 });
  const proof = { kind: "subject-match", version: 1, proofId: UUID_7, runId: run.envelope.runId, attempt: run.envelope.attempt, leaseId: UUID_6,
    taskId: UcpathCreateTermination.id, observationId: WRITE_FIXTURE_OBSERVATION, pageStateId: WRITE_FIXTURE_STAGED_STATE,
    expected: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "0000" },
    observed: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "0000" }, match: "match", observedAt: NOW,
    afterPrepareSpanPath: `${run.envelope.traceId}/submit-write/prepare` };
  const key = ucpathTerminationIdempotencyKey(TARGET);
  const intent = WriteIntentRecordSchema.parse({ writeIntentId: UUID_8, workflowId: active.id, itemId: run.envelope.itemId, taskId: UcpathCreateTermination.id,
    system: "ucpath", idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key), currentAttemptId: UUID_5,
    generation: 1, runId: run.envelope.runId, runAttempt: run.envelope.attempt, bindingProof: proof, bindingProofDigest: deriveWriteBindingProofDigest(proof),
    fencedAt: NOW, version: 1, createdAt: NOW, updatedAt: NOW, status: "parked", parkedCode: "unknown", message: "Synthetic unknown write",
    authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic") });
  assert.ok(intent.status === "parked");
  const attempt = WriteAttemptRecordSchema.parse({ writeAttemptId: UUID_5, writeIntentId: UUID_8, generation: 1, runId: run.envelope.runId,
    runAttempt: run.envelope.attempt, leaseId: UUID_6, bindingProof: proof, bindingProofDigest: intent.bindingProofDigest, fencedAt: NOW,
    outcome: { state: "parked", code: "unknown", message: "Synthetic unknown write", authorityReason: intent.authorityReason }, recordedAt: NOW });
  const repositories = { ...opened.database.authority, runs: { ...opened.database.authority.runs, get: () => run },
    writeIntents: { ...opened.database.authority.writeIntents, get: () => intent }, writeAttempts: { ...opened.database.authority.writeAttempts, get: () => attempt } };
  const target = ParkedWriteCheckTargetSchema.parse({ workerId: "separations-worker-1", expectedVersion: 1, controlBasis: { leaseGeneration: 1, controlRevision: 1 },
    membershipRevision: 1, processId: 42, startedAt: NOW, installationId: UUID_6, profileId: UUID_7,
    workflowId: active.id, itemId: run.envelope.itemId, runId: run.envelope.runId, runVersion: run.version,
    runAttempt: run.envelope.attempt, traceId: run.envelope.traceId, nodeId: "submit-write", writeIntentId: UUID_8, intentVersion: 1,
    intentGeneration: 1, writeAttemptId: UUID_5, bindingProofDigest: intent.bindingProofDigest, occurrenceKeyDigest: intent.idempotencyKeyDigest });
  const events: string[] = [];
  let failClose = false;
  let failRead = false;
  let readHold: Promise<void> | undefined;
  let afterRead = () => {};
  const driver = { system: "ucpath" as const, scanTerminationTransactions: async () => { await readHold; return UcpathTransactionScanSchema.parse({ state: "read", emplId: TARGET.emplId,
    rows: Array.from({ length: rows }, (_, index) => ({ transactionId: `T00220963${index + 1}`, emplId: TARGET.emplId, action: "Terminatn", approvalStatus: "Pending",
      startDate: TARGET.effectiveDate, displayedName: TARGET.expectedName })), scannedRowCount: rows, observedAt: NOW }); } };
  const sessions: Parameters<typeof checkParkedWrite>[0]["sessions"] = {
    withDriver: async (_need, _instance, _signal, operation) => { events.push("read"); if (failRead) throw new Error("synthetic-read-unavailable"); const result = await operation(driver, async () => { throw new Error("recheck does not request capture"); }); afterRead(); return result; },
    bindRunConfigFingerprint: () => { events.push("bind"); }, releaseRunConfigFingerprint: () => { events.push("release"); },
    closeAll: async () => { events.push("close"); if (failClose && events.includes("read")) throw new WorkerSessionClosureUnprovedError("separations-worker-1"); },
  };
  const input: Parameters<typeof checkParkedWrite>[0] = { repositories, descriptor: active, target, commandId: UUID_7, requestedBy: "local-operator", signal: new AbortController().signal,
    probe: { stores: taskStoreRegistry, clock, scheduler: new ManualScheduler(clock), taskDeadlineMs: 1000, log: recordingLogger().log }, sessions,
    configureRun: () => ({ taskDeadlineMs: 1000 }) };
  return { input, events, run, intent, attempt, driver, clock, database: opened.database, path: opened.path, holdRead: (hold: Promise<void>) => { readHold = hold; },
    failClosure: () => { failClose = true; }, failRead: () => { failRead = true; }, afterRead: (fn: () => void) => { afterRead = fn; } };
}

describe("held-only parked write checks", () => {
  it("preserves channel Error identity and non-Error causes without changing held authority", async () => {
    const failures: readonly unknown[] = [new Error("synthetic-channel-scheduler-failure"), { code: "synthetic-non-error" }];
    for (const failure of failures) {
      const h = await fixture(1);
      testWorkerPorts(h.database, h.clock, { path: h.path, descriptor, poolIndex: 1 });
      const lease = h.database.authority.workerLeases.get(h.input.target.workerId), slot = h.database.authority.workerSlots.get(h.input.target.workerId);
      assert.ok(lease); assert.ok(slot);
      const request = CommandRequestSchema.parse({ commandId: UUID_7, requestedAt: NOW, requestedBy: "local-operator", source: "run-detail",
        family: "worker-browser", type: "check-parked-write", target: { ...h.input.target, expectedVersion: lease.version, processId: lease.processId,
          startedAt: lease.lifecycle.startedAt, membershipRevision: slot.membershipRevision,
          controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } } });
      assert.equal(request.type, "check-parked-write");
      if (request.type !== "check-parked-write") throw new Error("fixture-check-request");
      h.database.withAuthorityTransaction(r => {
        r.commands.insert(request);
        r.workerLeases.reserveControl(request.target.workerId, request.target.controlBasis, request.commandId, NOW);
        r.workerControls.admit({ commandId: request.commandId, request, scope: "worker-pool:separations", executorId: UUID_6,
          admittedAt: NOW, expiresAt: new Date(h.clock.nowMs() + 180_000).toISOString(), basisVersion: request.target.expectedVersion, phase: { state: "admitted" } });
      });
      const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
      const channel = createWorkerBrowserChannel({ database: h.database, clock: h.clock, scheduler: { schedule: () => { throw failure; } } });
      await assert.rejects(channel.check(request.commandId), error => {
        assert.ok(error instanceof Error);
        if (failure instanceof Error) assert.equal(error, failure);
        else { assert.equal(error.message, "parked-check-channel-failed"); assert.equal(error.cause, failure); }
        return true;
      });
      assert.equal(canonicalJsonStringify([h.run, h.intent, h.attempt]), before);
      assert.deepEqual(h.events, []);
    }
  });
  for (const scenario of ["deadline", "late-rejection", "expiry", "stop", "closure"] as const) it(`retains the actual registered read through ${scenario} until callback settlement`, async () => {
    const h = await fixture(1), scheduler = new ManualScheduler(h.clock), controller = new AbortController();
    let resolveRead!: () => void, rejectRead!: (error: Error) => void;
    h.holdRead(new Promise<void>((resolve, reject) => { resolveRead = resolve; rejectRead = reject; }));
    let started!: () => void, closed!: () => void;
    const readStarted = new Promise<void>(resolve => { started = resolve; });
    const closeAttempted = new Promise<void>(resolve => { closed = resolve; });
    const sessionId = BrowserSessionIdSchema.parse(UUID_6);
    let closeFails = scenario === "closure", closeCount = 0, closedCount = 0, readCount = 0;
    const sessions = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(h.input.target.workerId), workflowId: descriptor.id,
      stores: taskStoreRegistry, clock: h.clock, scheduler, acquireDeadlineMs: 10_000, duoCeremony: await fixtureDuoCeremonyGates(h.clock),
      factory: { probeProfile: async () => undefined, open: async request => ({ ...request, sessionId, signInFingerprint: request.configFingerprint, profileRevision: 1,
        profileDirectory: "/synthetic/parked-probe", driver: { ...h.driver, scanTerminationTransactions: async () => {
          readCount++; started(); return h.driver.scanTerminationTransactions();
        } }, authentication: { authenticate: async () => "already-authenticated" }, reset: async () => undefined,
        close: async () => { closeCount++; closed(); if (closeFails) throw new Error("synthetic-close-unproved");
          closedCount++;
          return { sessionId, system: "ucpath", pagesClosed: true, contextClosed: true }; },
      }) } });
    const repositories = h.database.authority, workerId = h.input.target.workerId;
    testWorkerPorts(h.database, h.clock, { path: h.path, descriptor, poolIndex: 1 });
    repositories.workerLeases.reportLifecycle({ workerId, leaseGeneration: 1, lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW }, now: NOW });
    const slot = repositories.workerSlots.get(workerId), lease = repositories.workerLeases.get(workerId);
    assert.ok(slot);
    assert.ok(lease);
    const request = CommandRequestSchema.parse({ commandId: UUID_7, family: "worker-browser", type: "check-parked-write", source: "run-detail", requestedAt: NOW,
      requestedBy: "local-operator", target: { ...h.input.target, expectedVersion: lease.version, processId: lease.processId,
        controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision }, membershipRevision: slot.membershipRevision } });
    assert.equal(request.type, "check-parked-write");
    if (request.type !== "check-parked-write") throw new Error("fixture-check-request");
    h.database.withAuthorityTransaction(r => {
      r.commands.insert(request); r.workerLeases.reserveControl(workerId, request.target.controlBasis, request.commandId, NOW);
      r.workerControls.admit({ commandId: request.commandId, request, scope: "worker-pool:separations", executorId: UUID_6,
        admittedAt: NOW, expiresAt: new Date(h.clock.nowMs() + 180_000).toISOString(), basisVersion: request.target.expectedVersion, phase: { state: "admitted" } });
    });
    const channel = createWorkerBrowserChannel({ database: h.database, clock: h.clock, scheduler });
    const channelOutcome = channel.check(request.commandId).then(result => ({ result }), (error: unknown) => ({ error }));
    const consume = createWorkerBrowserControl({ database: h.database, workerId, leaseGeneration: 1, clock: h.clock, signal: controller.signal,
      checkParkedWrite: async (_sessions, admitted) => checkParkedWrite({ ...h.input, target: admitted.target, signal: controller.signal, sessions,
        probe: { ...h.input.probe, scheduler } }) });
    let finished = false, nextOperation = false;
    const delivery = consume(sessions).then(() => {
      finished = true;
      sessions.bindRunConfigFingerprint(WRITE_FIXTURE_FINGERPRINT);
      nextOperation = true;
      sessions.releaseRunConfigFingerprint();
    }, (error: unknown) => { finished = true; return error; });
    try {
      await readStarted;
      if (scenario === "stop") controller.abort(new Error("synthetic-stop"));
      else if (scenario === "expiry") {
        h.clock.advanceWall(180_000); h.clock.advanceMonotonic(180_000);
        controller.abort(new Error("synthetic-expiry"));
        const poll = scheduler.pending().find(entry => entry.deadlineMonotonicMs === 50); assert.ok(poll); poll.fire();
      } else {
        h.clock.advanceWall(1000); h.clock.advanceMonotonic(1000);
        const taskDeadline = scheduler.pending().find(entry => entry.deadlineMonotonicMs === 1000); assert.ok(taskDeadline); taskDeadline.fire();
      }
      await closeAttempted;
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.ok(closeCount > 0, "resource close was attempted while the registered callback remained pending");
      assert.equal(closedCount, scenario === "closure" ? 0 : 1);
      assert.equal(finished, false); assert.equal(nextOperation, false);
      assert.equal(repositories.workerControls.get(request.commandId)?.phase.state, scenario === "expiry" ? "uncertain" : "executing");
      assert.throws(() => sessions.bindRunConfigFingerprint(WRITE_FIXTURE_FINGERPRINT), /already has a bound run/);
      if (scenario === "late-rejection") rejectRead(new Error("synthetic-late-read-rejection")); else resolveRead();
      const failure = await delivery;
      assert.equal(finished, true); assert.equal(readCount, 1);
      const expected = scenario === "deadline" || scenario === "late-rejection" ? "succeeded" : "uncertain";
      const record = repositories.workerControls.get(request.commandId); assert.equal(record?.phase.state, expected);
      if (expected === "succeeded") {
        assert.equal(failure, undefined);
        assert.ok(record?.phase.state === "succeeded" && record.phase.acknowledgement.kind === "parked-write-check");
        if (record?.phase.state !== "succeeded" || record.phase.acknowledgement.kind !== "parked-write-check") throw new Error("missing-held-result");
        assert.equal(record.phase.acknowledgement.result.state, "unknown");
        assert.equal(record.phase.acknowledgement.result.held, true);
        assert.equal(record.phase.acknowledgement.result.provenance, "not-observed");
      } else { assert.ok(failure instanceof Error); assert.equal(nextOperation, false); }
      scheduler.pending()[0]?.fire();
      const channelResult = await channelOutcome;
      assert.equal("result" in channelResult, expected === "succeeded");
      assert.equal(h.run.lifecycle.state, "parked-write"); assert.equal(h.intent.status, "parked"); assert.equal(h.attempt.outcome.state, "parked");
      await consume(sessions); assert.equal(readCount, 1, "late delivery cannot repeat the read");
    } finally {
      resolveRead(); await delivery; closeFails = false; await sessions.closeAll("worker-stop");
    }
  });
  it("admits the exact held read through the kernel and channel and replays without another read", async () => {
    const h = await fixture(1), scheduler = new ManualScheduler(h.clock), workerId = h.input.target.workerId;
    testWorkerPorts(h.database, h.clock, { path: h.path, descriptor, poolIndex: 1 });
    h.database.authority.workerLeases.reportLifecycle({ workerId, leaseGeneration: 1, lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW }, now: NOW });
    const lease = h.database.authority.workerLeases.get(workerId), slot = h.database.authority.workerSlots.get(workerId);
    assert.ok(lease); assert.ok(slot);
    const identity = h.database.getMeta(), active = h.database.authority.runtimeConfig.get();
    assert.ok(active); assert.ok(identity.installationId); assert.ok(identity.profileId);
    const target = ParkedWriteCheckTargetSchema.parse({ ...h.input.target, installationId: identity.installationId, profileId: identity.profileId,
      membershipRevision: slot.membershipRevision, processId: lease.processId, expectedVersion: lease.version,
      controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision } });
    const request = CommandRequestSchema.parse({ commandId: UUID_7, requestedAt: NOW, requestedBy: "local-operator", source: "run-detail",
      family: "worker-browser", type: "check-parked-write", target });
    const channel = createWorkerBrowserChannel({ database: h.database, clock: h.clock, scheduler });
    const sessionId = BrowserSessionIdSchema.parse(UUID_6);
    const sessions = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(workerId), workflowId: descriptor.id, stores: taskStoreRegistry,
      clock: h.clock, scheduler, acquireDeadlineMs: 10_000, duoCeremony: await fixtureDuoCeremonyGates(h.clock),
      factory: { probeProfile: async () => undefined, open: async input => ({ ...input, sessionId, signInFingerprint: input.configFingerprint, profileRevision: 1,
        profileDirectory: "/synthetic/parked-kernel", driver: h.driver, authentication: { authenticate: async () => "already-authenticated" },
        reset: async () => undefined, close: async () => ({ sessionId, system: "ucpath", pagesClosed: true, contextClosed: true }) }) } });
    disposers.push(() => sessions.closeAll("worker-stop"));
    let deliveries = 0;
    const unused = (): never => { throw new Error("unexpected-non-read-effect"); };
    const kernel = createCommandKernel({
      authority: { withAuthorityTransaction: work => h.database.withAuthorityTransaction(r => work({ ...r,
        runs: h.input.repositories.runs, writeIntents: h.input.repositories.writeIntents, writeAttempts: h.input.repositories.writeAttempts })) },
      lifecycle: testRunService(h.database, h.clock), clock: h.clock, ids: sequentialIdFactory("d"), appVersion: "0.1.0",
      authorityInstallationId: identity.installationId, authorityProfileId: identity.profileId, workflowSources: { separations: "served" },
      configIdentity: { configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId },
      descriptors: { resolve: id => id === descriptor.id ? descriptor : undefined },
      intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
      writeResolution: { recheck: unused, resolveAbsent: unused },
      workerRuntime: { pool: { assertResetOwner: (id, revision, lifetime) => {
        assert.equal(id, workerId); assert.equal(revision, slot.membershipRevision); assert.equal(lifetime.processId, lease.processId);
      }, checkParkedWrite: context => { deliveries++; return channel.check(context.command.commandId); },
      planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused,
      stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } },
    });
    const consume = createWorkerBrowserControl({ database: h.database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.clock, signal: h.input.signal,
      checkParkedWrite: async (_sessions, admitted) => { h.events.push("read"); return checkParkedWrite({ ...h.input, sessions, target: admitted.target }); } });
    const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
    const applying = kernel.executeWorkerPool(request);
    assert.equal(h.database.authority.workerControls.get(request.commandId)?.phase.state, "ready");
    await consume(sessions);
    const poll = scheduler.pending()[0]; assert.ok(poll); poll.fire();
    const applied = await applying;
    assert.equal(applied.state, "applied");
    assert.equal(h.database.authority.workerControls.get(request.commandId)?.phase.state, "succeeded");
    assert.ok(h.database.authority.commandAudits.findByCommand(request.commandId));
    const replay = await kernel.executeWorkerPool(request);
    assert.equal(replay.state, "already-applied"); assert.equal(deliveries, 1);
    assert.equal(h.events.filter(event => event === "read").length, 1);
    assert.equal(canonicalJsonStringify([h.run, h.intent, h.attempt]), before);
    const record = h.database.authority.workerControls.get(request.commandId);
    assert.ok(record?.phase.state === "succeeded" && record.phase.acknowledgement.kind === "parked-write-check");
    if (record?.phase.state !== "succeeded" || record.phase.acknowledgement.kind !== "parked-write-check") throw new Error("missing-held-journal");
    assert.equal(record.phase.acknowledgement.result.code, "PARKED_CHECK_OCCURRENCE_UNPROVED");
    assert.deepEqual(record.phase.acknowledgement.result.target, target);
  });
  for (const rows of [0, 1, 2]) it(`reads ${rows} synthetic matches without changing write or run authority`, async () => {
    const h = await fixture(rows);
    const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
    const result = await checkParkedWrite(h.input);
    assert.equal(result.result.held, true);
    assert.equal(result.result.state, rows === 0 ? "absent" : "ambiguous");
    assert.equal(result.result.code, rows === 1 ? "PARKED_CHECK_OCCURRENCE_UNPROVED" : rows === 0 ? "PARKED_CHECK_ABSENT" : "PARKED_CHECK_AMBIGUOUS");
    assert.equal(result.result.provenance, "system-probe");
    assert.ok(result.evidence);
    assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
    assert.equal(canonicalJsonStringify([h.run, h.intent, h.attempt]), before);
  });
  it("admits a non-separations workflow that reuses the held termination probe", async () => {
    const h = await fixture(0, "person-lookup");
    const result = await checkParkedWrite(h.input);
    const descriptor = h.input.descriptor;
    assert.ok(descriptor);
    assert.equal(descriptor.id, "person-lookup");
    assert.equal(result.result.provenance, "system-probe");
    assert.equal(result.result.code, "PARKED_CHECK_ABSENT");
    assert.equal(result.result.held, true);
    assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
  });
  it("refuses a held probe whose system is not the registered read", async () => {
    const h = await fixture(1);
    const idempotencyKeyDigest = deriveIdempotencyKeyDigest("kuali", h.intent.idempotencyKey);
    const intent = WriteIntentRecordSchema.parse({ ...h.intent, system: "kuali", idempotencyKeyDigest });
    const target = ParkedWriteCheckTargetSchema.parse({ ...h.input.target, occurrenceKeyDigest: idempotencyKeyDigest });
    const run = RunRecordSchema.parse({ ...h.run, envelope: { ...h.run.envelope, resolvedInstance: { ...h.run.envelope.resolvedInstance, kuali: "prod" } } });
    const result = await checkParkedWrite({ ...h.input, target, repositories: { ...h.input.repositories, runs: { ...h.input.repositories.runs, get: () => run }, writeIntents: { ...h.input.repositories.writeIntents, get: () => intent } } });
    assert.equal(result.result.state, "unavailable");
    assert.equal(result.result.provenance, "not-observed");
    assert.equal(result.evidence, undefined);
    assert.deepEqual(h.events, []);
  });
  it("refuses stale occurrence identities before session or provider access", async () => {
    const h = await fixture(1);
    for (const patch of [{ runVersion: 5 }, { workflowId: "person-lookup" }, { intentGeneration: 2 }, { writeAttemptId: UUID_6 }, { bindingProofDigest: "b".repeat(64) }, { occurrenceKeyDigest: "b".repeat(64) }]) {
      await assert.rejects(checkParkedWrite({ ...h.input, target: ParkedWriteCheckTargetSchema.parse({ ...h.input.target, ...patch }) }), /parked-check-authority-changed/);
    }
    assert.deepEqual(h.events, []);
  });
  it("keeps missing read capability unavailable before session access", async () => {
    const h = await fixture(1);
    const result = await checkParkedWrite({ ...h.input, probe: { ...h.input.probe, stores: { ...taskStoreRegistry, stores: [] } } });
    assert.equal(result.result.state, "unavailable"); assert.equal(result.result.provenance, "not-observed");
    assert.equal(result.evidence, undefined); assert.deepEqual(h.events, []);
  });
  it("refuses a foreign actor or cancelled request before provider access", async () => {
    const h = await fixture(1);
    await assert.rejects(checkParkedWrite({ ...h.input, requestedBy: "assistant" }), /PARKED_CHECK_UNAVAILABLE/);
    const controller = new AbortController(); controller.abort(new Error("synthetic-stop"));
    await assert.rejects(checkParkedWrite({ ...h.input, signal: controller.signal }), /synthetic-stop/);
    assert.deepEqual(h.events, []);
  });
  it("keeps a failed read UNKNOWN without granting retry or settlement", async () => {
    const h = await fixture(1); h.failRead();
    const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
    const result = await checkParkedWrite(h.input);
    assert.equal(result.result.state, "unknown"); assert.equal(result.result.provenance, "not-observed");
    assert.equal(result.evidence, undefined); assert.equal(result.result.held, true);
    assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
    assert.equal(canonicalJsonStringify([h.run, h.intent, h.attempt]), before);
  });
  it("refuses a successful but stale or cancelled observation after closing its sessions", async () => {
    for (const scenario of ["revision", "abort"] as const) {
      const h = await fixture(1), controller = new AbortController();
      h.afterRead(() => { if (scenario === "revision") h.run.version = PositiveIntSchema.parse(h.run.version + 1); else controller.abort(new Error("synthetic-late-stop")); });
      await assert.rejects(checkParkedWrite({ ...h.input, signal: controller.signal }), scenario === "revision" ? /parked-check-authority-changed/ : /synthetic-late-stop/);
      assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
      assert.equal(h.intent.status, "parked"); assert.equal(h.attempt.outcome.state, "parked");
    }
  });
  it("propagates unproved closure and releases the retained config binding", async () => {
    const h = await fixture(1); h.failClosure();
    await assert.rejects(checkParkedWrite(h.input), WorkerSessionClosureUnprovedError);
    assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
    assert.equal(h.run.lifecycle.state, "parked-write"); assert.equal(h.intent.status, "parked");
  });
});
