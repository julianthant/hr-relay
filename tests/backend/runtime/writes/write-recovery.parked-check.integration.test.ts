import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet, openBoundDatabaseFixture } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { recordBrowserAction, withBrowserActionSession } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { RecoveryActivityError } from "../../../../src/backend/runtime/writes/recovery-activity.js";
import { retainedUcpathFindings } from "../../../../src/backend/runs/queries/run-detail/ucpath-findings.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail-types.js";
import { BrowserSessionClosureUnprovedError } from "../../../../src/workflow-kit/session.js";
import { WorkerControlRefusal } from "../../../../src/models/run/worker-control.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { checkParkedWrite, requireParkedWriteCheckTarget } from "../../../../src/backend/runtime/writes/write-recovery.js";
import { WorkerSessionClosureUnprovedError, WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWorkerChildControls } from "../../../../src/backend/runtime/workers/worker-browser-control.js";
import { createWorkerChildChannel } from "../../../../src/backend/runtime/workers/worker-child-channel.js";
import type { WorkerReplyOutcome } from "../../../../src/backend/runtime/workers/worker-messages.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { UcpathTerminationTargetSchema, UcpathTransactionScanSchema } from "../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { UcpathTransactionFindingsReadSchema } from "../../../../src/models/ui/ucpath-transaction-findings.js";
import { UcpathReadTransactionFindings } from "../../../../src/models/systems/ucpath/read-transaction-findings.js";
import { UcpathCreateTermination, UcpathCreateTerminationOutputSchema, ucpathTerminationIdempotencyKey } from "../../../../src/models/systems/ucpath/create-termination.js";
import { UcpathStageTermination } from "../../../../src/models/systems/ucpath/stage-termination.js";
import { CommandRequestSchema, ParkedWriteCheckAcknowledgementSchema, ParkedWriteCheckTargetSchema } from "../../../../src/rules/commands/commands.js";
import { BrowserSessionIdSchema, PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { deriveIdempotencyKeyDigest, deriveWriteAuthorityReason, deriveWriteBindingProofDigest, WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { ManualScheduler, recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { testRunService, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { runClaim } from "../../../../src/models/run/record.js";
import type { RunBrowserScreenshotCapture } from "../../../../src/workflow-kit/diagnostics.js";
import type { BrowserSessionId } from "../../../../src/rules/identity/ids.js";
import type { Clock } from "../../../../src/rules/time/clock.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { UUID_1, UUID_2, UUID_5, UUID_6, UUID_7, UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { WRITE_FIXTURE_NOW, WRITE_FIXTURE_FINGERPRINT, WRITE_FIXTURE_OBSERVATION, WRITE_FIXTURE_STAGED_STATE, writeFixtureQueuedRun } from "../../../support/fixtures/write-sequencer-fixtures.js";

const profileFixtures = createProfileFixtureSet();
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
function screenshotFor(clock: Clock, sessionId: BrowserSessionId) {
  return async () => ({ state: "available" as const, sessionId, pageVersion: 1, observedAt: clock.now().toISOString(),
    bytes: new Uint8Array([137, 80, 78, 71]), width: 1280, height: 720 });
}

async function fixture(rows: number, workflowId: string = descriptor.id) {
  const active = workflowId === descriptor.id ? descriptor : heldDescriptor(workflowId);
  const clock = manualClock(new Date(NOW));
  const opened = await openBoundDatabaseFixture("parked-read-check", clock, undefined, undefined, undefined, undefined, profileFixtures.create);
  disposers.push(() => opened.close());
  const template = RunRecordSchema.parse(writeFixtureQueuedRun());
  const queued = RunRecordSchema.parse({ ...template, envelope: { ...template.envelope, workflow: active.id, descriptorVersion: active.version,
    contractFingerprint: active.contractFingerprint, resolvedInstance: { ucpath: "prod" }, dryRun: false },
    input: { raw: TARGET, parsed: { schemaHash: deriveSchemaHash(canonical, "output"), value: TARGET, protectedBindings: [] },
      ingressSchemaHash: deriveSchemaHash(UcpathTerminationTargetSchema, "input") },
    lifecycle: { state: "queued" }, version: 1 });
  const authority = opened.database.authority;
  testWorkerPorts(opened.database, clock, { path: opened.path, descriptor: active, poolIndex: 1 });
  assert.equal(authority.runs.enqueue(queued).state, "inserted");
  const proof = { kind: "subject-match", version: 1, proofId: UUID_7, runId: queued.envelope.runId, attempt: queued.envelope.attempt, leaseId: UUID_6,
    taskId: UcpathCreateTermination.id, observationId: WRITE_FIXTURE_OBSERVATION, pageStateId: WRITE_FIXTURE_STAGED_STATE,
    expected: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "0000" },
    observed: { kind: "person", identifierKind: "eid", bindingDigest: "a".repeat(64), displaySuffix: "0000" }, match: "match", observedAt: NOW,
    afterPrepareSpanPath: `${queued.envelope.traceId}/submit-write/prepare` };
  const key = ucpathTerminationIdempotencyKey(TARGET);
  const pending = WriteIntentRecordSchema.parse({ writeIntentId: UUID_8, workflowId: active.id, itemId: queued.envelope.itemId, taskId: UcpathCreateTermination.id,
    system: "ucpath", idempotencyKey: key, idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key), currentAttemptId: UUID_5,
    generation: 1, runId: queued.envelope.runId, runAttempt: queued.envelope.attempt, bindingProof: proof, bindingProofDigest: deriveWriteBindingProofDigest(proof),
    fencedAt: NOW, version: 1, createdAt: NOW, updatedAt: NOW, status: "attempting" });
  assert.ok(pending.status === "attempting");
  const pendingAttempt = WriteAttemptRecordSchema.parse({ writeAttemptId: UUID_5, writeIntentId: UUID_8, generation: 1, runId: queued.envelope.runId,
    runAttempt: queued.envelope.attempt, leaseId: UUID_6, bindingProof: proof, bindingProofDigest: pending.bindingProofDigest, fencedAt: NOW,
    outcome: { state: "attempting" }, recordedAt: NOW });
  assert.equal(fenceWriteFixture(opened.database, { intent: pending, attempt: pendingAttempt }).state, "fenced");
  const owner = authority.runs.get(queued.envelope.runId); assert.ok(owner);
  const claim = runClaim(owner); assert.ok(claim);
  const intent = authority.writeIntents.parkAttempt({ writeIntentId: UUID_8, generation: 1, expectedVersion: pending.version,
    code: "unknown", message: "Synthetic unknown write", now: NOW,
    authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic") });
  assert.ok(intent.status === "parked");
  const parked = authority.runs.transition({ runId: owner.envelope.runId, expectedVersion: owner.version,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, now: NOW,
    lifecycle: { state: "parked-write", writeIntentId: UUID_8, intentGeneration: 1, parkedAt: NOW, code: "unknown", message: "Synthetic unknown write" } });
  assert.equal(parked.state, "applied");
  const run = authority.runs.get(owner.envelope.runId); assert.ok(run);
  const attempt = authority.writeAttempts.get(UUID_5); assert.ok(attempt?.outcome.state === "parked");
  const timeline = authority.timelineEvents;
  const repositories = authority;
  const identity = opened.database.getMeta(); assert.ok(identity.installationId && identity.profileId);
  const target = ParkedWriteCheckTargetSchema.parse({ workerId: claim.workerId, lifetimeId: UUID_1, expectedVersion: 1,
    installationId: identity.installationId, profileId: identity.profileId,
    workflowId: active.id, itemId: run.envelope.itemId, runId: run.envelope.runId, runVersion: run.version,
    runAttempt: run.envelope.attempt, traceId: run.envelope.traceId, nodeId: "submit-write", writeIntentId: UUID_8, intentVersion: intent.version,
    intentGeneration: 1, writeAttemptId: UUID_5, bindingProofDigest: intent.bindingProofDigest, occurrenceKeyDigest: intent.idempotencyKeyDigest });
  const events: string[] = [];
  let failClose = false;
  let failRead = false;
  let failCapture = false;
  let readHold: Promise<void> | undefined;
  let afterRead = () => {};
  const driver = { system: "ucpath" as const, scanTerminationTransactions: async () => { recordBrowserAction("opened", "ucpath.smart-hr.transaction-search"); await readHold; return UcpathTransactionScanSchema.parse({ state: "read", emplId: TARGET.emplId,
    rows: Array.from({ length: rows }, (_, index) => ({ transactionId: `T00220963${index + 1}`, emplId: TARGET.emplId, action: "Terminatn", approvalStatus: "Pending",
      startDate: TARGET.effectiveDate, displayedName: TARGET.expectedName })), scannedRowCount: rows, observedAt: NOW }); },
    readTransactionFindings: async () => { recordBrowserAction("opened", "ucpath.smart-hr.transaction-search"); await readHold;
      return UcpathTransactionFindingsReadSchema.parse({ state: "read", emplId: TARGET.emplId,
        rows: Array.from({ length: rows }, (_, index) => ({ transactionId: `T00220963${index + 1}`, emplId: TARGET.emplId,
          action: "Terminatn", approvalStatus: "Pending", startDate: TARGET.effectiveDate, displayedName: TARGET.expectedName,
          submittedAt: "06/11/26 1:02:03.123456PM", detailVerified: true })), scannedRowCount: rows,
        completeness: rows === 300 ? { state: "incomplete", reason: "search-cap", reportedRowCount: 300 }
          : { state: "complete", reportedRowCount: rows }, observedAt: NOW, source: "ss-smart-hr-list-and-detail" }); },
  };
  const sessions: Parameters<typeof checkParkedWrite>[0]["sessions"] = {
    withDriver: async (_need, _instance, _signal, operation) => { events.push("read"); if (failRead) throw new Error("synthetic-read-unavailable"); const result = await withBrowserActionSession(UUID_6, () => operation(driver, async () => {
      if (failCapture) throw new RecoveryActivityError(new Error("synthetic-capture-failure"));
      recordBrowserAction("screenshot", "ucpath.smart-hr.transaction-search", `${UUID_5}:${UUID_8}`);
    })); afterRead(); return result; },
    bindRunConfigFingerprint: () => { events.push("bind"); }, releaseRunConfigFingerprint: () => { events.push("release"); },
    closeAll: async () => { events.push("close"); if (failClose && events.includes("read")) throw new WorkerSessionClosureUnprovedError("separations-worker-1"); },
  };
  const input: Parameters<typeof checkParkedWrite>[0] = { repositories, descriptor: active, target, commandId: UUID_7, requestedBy: "local-operator", signal: new AbortController().signal,
    probe: { stores: taskStoreRegistry, clock, scheduler: new ManualScheduler(clock), taskDeadlineMs: 1000, log: recordingLogger().log }, sessions,
    configureRun: () => ({ taskDeadlineMs: 1000 }) };
  const captures: Parameters<RunBrowserScreenshotCapture["capture"]>[0][] = [];
  const browserScreenshotCapture: RunBrowserScreenshotCapture = { capture: async captured => {
    assert.equal(captured.runId, run.envelope.runId);
    assert.equal(captured.screenshot.state, "available");
    captures.push(captured);
  } };
  return { input, events, driver, clock, timeline, browserScreenshotCapture, captures,
    get run() { const current = authority.runs.get(run.envelope.runId); assert.ok(current); return current; },
    get intent() { const current = authority.writeIntents.get(intent.writeIntentId); assert.ok(current); return current; },
    get attempt() { const current = authority.writeAttempts.get(attempt.writeAttemptId); assert.ok(current); return current; },
    failCapture: () => { failCapture = true; }, database: opened.database, path: opened.path, holdRead: (hold: Promise<void>) => { readHold = hold; },
    failClosure: () => { failClose = true; }, failRead: () => { failRead = true; }, afterRead: (fn: () => void) => { afterRead = fn; } };
}

describe("held-only parked write checks", () => {
  it("records real action and capture times on a retained run without changing write authority", async () => {
    const h = await fixture(1);
    h.clock.advanceWall(3 * 24 * 60 * 60 * 1000);
    const at = h.clock.now().toISOString();
    const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
    const result = await checkParkedWrite(h.input);
    assert.equal(result.result.code, "PARKED_CHECK_UNKNOWN");
    const events = h.timeline.page({ runId: h.run.envelope.runId });
    assert.deepEqual(events.map(event => event.payload.kind),
      ["recovery-activity-started", "note", "note", "recovery-activity-ended"]);
    assert.ok(events.every(event => event.occurredAt === at && event.recordedAt === at));
    const notes = events.flatMap(event => event.payload.kind === "note" ? [event.payload.note] : []);
    assert.equal(notes.filter(note => note.action?.kind === "screenshot").length, 1);
    assert.ok(notes.every(note => "recoveryActivityId" in note && note.recoveryActivityId === events[0].eventId));
    assert.equal(canonicalJsonStringify([h.run, h.intent, h.attempt]), before);
  });
  it("refuses failed activity opening before sessions or captures", async () => {
    const h = await fixture(1);
    await assert.rejects(checkParkedWrite({ ...h.input, repositories: { ...h.input.repositories,
      timelineEvents: { ...h.timeline, append: () => { throw new Error("synthetic-open-failed"); } } } }), RecoveryActivityError);
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.timeline.page({}), []);
  });
  it("refuses a required capture failure without settling the held occurrence", async () => {
    const h = await fixture(1); h.failCapture();
    const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
    await assert.rejects(checkParkedWrite(h.input), RecoveryActivityError);
    assert.equal(canonicalJsonStringify([h.run, h.intent, h.attempt]), before);
    assert.equal(h.timeline.page({}).at(-1)?.payload.kind, "recovery-activity-ended");
    assert.equal(h.input.repositories.runCheckpoints.latest(h.run.envelope.workflow, h.run.envelope.itemId, "submit-write"), undefined);
  });

  for (const failure of ["missing", "outage"] as const) it(`refuses nested required capture errors from real sessions with ${failure} persistence`, async () => {
    const h = await fixture(1), sessionId = BrowserSessionIdSchema.parse(UUID_6);
    let closed = 0;
    const sessions = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(h.input.target.workerId), workflowId: descriptor.id,
      stores: taskStoreRegistry, clock: h.clock, scheduler: h.input.probe.scheduler, acquireDeadlineMs: 10_000,
      duoCeremony: await fixtureDuoCeremonyGates(h.clock),
      ...(failure === "missing" ? {} : { browserScreenshotCapture: { capture: async () => { throw new Error("synthetic-persistence-outage"); } } }),
      factory: { probeProfile: async () => undefined, open: async request => ({ ...request, sessionId,
        signInFingerprint: request.configFingerprint, profileRevision: 1, profileDirectory: "/synthetic/capture-probe", driver: h.driver,
        authentication: { authenticate: async () => "already-authenticated" }, reset: async () => undefined,
        screenshot: screenshotFor(h.clock, sessionId),
        close: async () => { closed++; return { sessionId, system: "ucpath", pagesClosed: true, contextClosed: true }; },
      }) } });
    try {
      await assert.rejects(checkParkedWrite({ ...h.input, sessions }), error => {
        assert.ok(error instanceof RecoveryActivityError);
        assert.ok(error.cause instanceof AggregateError);
        assert.ok(error.cause.errors.some(cause => cause instanceof TaskError && cause.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED"));
        assert.ok(error.cause.errors.length > 1);
        return true;
      });
      assert.equal(closed, 1);
      assert.equal(h.run.lifecycle.state, "parked-write"); assert.equal(h.intent.status, "parked");
      assert.equal(h.attempt.outcome.state, "parked");
      assert.equal(h.input.repositories.runCheckpoints.latest(h.run.envelope.workflow, h.run.envelope.itemId, "submit-write"), undefined);
      assert.equal(h.timeline.page({}).at(-1)?.payload.kind, "recovery-activity-ended");
    } finally { await sessions.closeAll("worker-stop"); }
  });

  for (const scenario of ["deadline", "late-rejection", "stop", "closure"] as const) it(`holds the control turn on the actual registered read through ${scenario} until callback settlement`, async () => {
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
      browserScreenshotCapture: h.browserScreenshotCapture,
      factory: { probeProfile: async () => undefined, open: async request => ({ ...request, sessionId, signInFingerprint: request.configFingerprint, profileRevision: 1,
        profileDirectory: "/synthetic/parked-probe", driver: { ...h.driver, readTransactionFindings: async () => {
          readCount++; started(); return h.driver.readTransactionFindings();
        } }, authentication: { authenticate: async () => "already-authenticated" }, reset: async () => undefined,
        screenshot: screenshotFor(h.clock, sessionId),
        close: async () => { closeCount++; closed(); if (closeFails) throw new Error("synthetic-close-unproved");
          closedCount++;
          return { sessionId, system: "ucpath", pagesClosed: true, contextClosed: true }; },
      }) } });
    const request = CommandRequestSchema.parse({ commandId: UUID_7, family: "worker-browser", type: "check-parked-write", source: "run-detail", requestedAt: NOW,
      requestedBy: "local-operator", target: h.input.target });
    const replies: WorkerReplyOutcome[] = [];
    let replied!: () => void;
    const reply = new Promise<void>(resolve => { replied = resolve; });
    const channel = createWorkerChildChannel({ clock: h.clock, onStop: () => undefined,
      send: message => { if (message.kind === "worker-reply") { replies.push(message.outcome); replied(); } },
      handlers: createWorkerChildControls({ sessions: () => sessions, signal: controller.signal, pause: () => null, resume: () => null,
        checkParkedWrite: async (_sessions, admitted) => checkParkedWrite({ ...h.input, target: admitted.target, signal: controller.signal, sessions,
          probe: { ...h.input.probe, scheduler } }) }) });
    const message = { kind: "worker-request", requestId: UUID_2, sentAt: NOW, deadlineMs: 180_000,
      request: { type: "check-parked-write", command: JsonValueSchema.parse(request) } };
    channel.receive(message);
    try {
      await readStarted;
      if (scenario === "stop") controller.abort(new Error("synthetic-stop"));
      else {
        h.clock.advanceWall(1000); h.clock.advanceMonotonic(1000);
        const taskDeadline = scheduler.pending().find(entry => entry.deadlineMonotonicMs === 1000); assert.ok(taskDeadline); taskDeadline.fire();
      }
      await closeAttempted;
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.ok(closeCount > 0, "resource close was attempted while the registered callback remained pending");
      assert.equal(closedCount, scenario === "closure" ? 0 : 1);
      assert.equal(replies.length, 0);
      assert.equal(channel.beginRun(), false, "no run is claimed while the registered read is pending");
      assert.throws(() => sessions.bindRunConfigFingerprint(WRITE_FIXTURE_FINGERPRINT), /already has a bound run/);
      if (scenario === "late-rejection") rejectRead(new Error("synthetic-late-read-rejection")); else resolveRead();
      await reply;
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(readCount, 1);
      const outcome = replies[0];
      if (scenario === "deadline" || scenario === "late-rejection") {
        assert.ok(outcome?.state === "done");
        const result = ParkedWriteCheckAcknowledgementSchema.parse(outcome.result).result;
        assert.equal(result.state, "unknown"); assert.equal(result.held, true); assert.equal(result.provenance, "not-observed");
      } else assert.equal(outcome?.state, "refused");
      assert.equal(h.run.lifecycle.state, "parked-write"); assert.equal(h.intent.status, "parked"); assert.equal(h.attempt.outcome.state, "parked");
      channel.receive(message);
      assert.deepEqual(replies.at(-1), { state: "refused", code: "WORKER_IPC_PROTOCOL_INVALID", message: "WORKER_IPC_PROTOCOL_INVALID" });
      assert.equal(readCount, 1, "a repeated request cannot repeat the read");
      assert.equal(channel.beginRun(), true);
    } finally {
      resolveRead(); closeFails = false; await sessions.closeAll("worker-stop");
    }
  });
  it("admits the exact held read through the kernel and replays without another read", async () => {
    const h = await fixture(1), scheduler = new ManualScheduler(h.clock), workerId = h.input.target.workerId;
    const identity = h.database.getMeta(), active = h.database.authority.runtimeConfig.get();
    assert.ok(active); assert.ok(identity.installationId); assert.ok(identity.profileId);
    const target = h.input.target;
    const request = CommandRequestSchema.parse({ commandId: UUID_7, requestedAt: NOW, requestedBy: "local-operator", source: "run-detail",
      family: "worker-browser", type: "check-parked-write", target });
    const sessionId = BrowserSessionIdSchema.parse(UUID_6);
    const sessions = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(workerId), workflowId: descriptor.id, stores: taskStoreRegistry,
      clock: h.clock, scheduler, acquireDeadlineMs: 10_000, duoCeremony: await fixtureDuoCeremonyGates(h.clock),
      browserScreenshotCapture: h.browserScreenshotCapture,
      factory: { probeProfile: async () => undefined, open: async input => ({ ...input, sessionId, signInFingerprint: input.configFingerprint, profileRevision: 1,
        profileDirectory: "/synthetic/parked-kernel", driver: h.driver, authentication: { authenticate: async () => "already-authenticated" },
        reset: async () => undefined, screenshot: screenshotFor(h.clock, sessionId),
        close: async () => ({ sessionId, system: "ucpath", pagesClosed: true, contextClosed: true }) }) } });
    disposers.push(() => sessions.closeAll("worker-stop"));
    const controls = createWorkerChildControls({ sessions: () => sessions, signal: h.input.signal, pause: () => null, resume: () => null,
      checkParkedWrite: async (_sessions, admitted) => { h.events.push("read"); return checkParkedWrite({ ...h.input, sessions, target: admitted.target }); } });
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
      workerRuntime: { pool: { admit: async () => undefined,
        assertMember: member => { assert.deepEqual(member, { workerId, lifetimeId: UUID_1, expectedVersion: 1 }); return "running"; },
        checkParkedWrite: async (_target, command) => { deliveries++; return controls.checkParkedWrite(JsonValueSchema.parse(command)); },
        start: unused, ensure: unused, stop: unused, remove: unused, direct: unused, browser: unused } },
    });
    const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
    const applied = await kernel.executeWorkerPool(request);
    assert.equal(applied.state, "applied");
    const audit = h.database.authority.commandAudits.findByCommand(request.commandId);
    assert.ok(audit?.parkedWriteCheck);
    const replay = await kernel.executeWorkerPool(request);
    assert.equal(replay.state, "already-applied"); assert.equal(deliveries, 1);
    assert.equal(h.events.filter(event => event === "read").length, 1);
    assert.equal(canonicalJsonStringify([h.run, h.intent, h.attempt]), before);
    const check = audit.parkedWriteCheck;
    assert.equal(check.result.code, "PARKED_CHECK_UNKNOWN");
    const findings = retainedUcpathFindings({ authorityIdentity: { installationId: target.installationId, profileId: target.profileId },
      canonical: { database: h.database, descriptors: { resolve: () => descriptor } },
    } as unknown as RunDetailQueryDeps, h.run, h.intent, audit);
    assert.ok(findings.state === "found"); assert.equal(findings.authoritative, false);
    assert.equal(findings.findings.rows[0].submittedAt, "06/11/26 1:02:03.123456PM");
    assert.deepEqual(check.result.target, target);
    const taskCaptures = h.captures.filter(captured => captured.trigger.kind === "task-point");
    assert.equal(taskCaptures.length, 1);
    assert.deepEqual(taskCaptures[0].trigger, { kind: "task-point", nodeId: "submit-write", attempt: h.run.envelope.attempt, boundary: "step" });
  });
  for (const rows of [0, 1, 2, 300]) it(`retains ${rows} findings without changing write or run authority`, async () => {
    const h = await fixture(rows);
    const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
    const result = await checkParkedWrite(h.input);
    assert.equal(result.result.held, true);
    assert.equal(result.result.state, "unknown");
    assert.equal(result.result.code, "PARKED_CHECK_UNKNOWN");
    assert.equal(result.result.provenance, "system-probe");
    assert.ok(result.evidence);
    assert.ok(result.findingsIdentity);
    assert.equal(result.result.probeTaskId, UcpathReadTransactionFindings.id);
    const findings = UcpathTransactionFindingsReadSchema.parse(result.evidence.value);
    assert.equal(findings.rows.length, rows); assert.equal(findings.completeness.state, rows === 300 ? "incomplete" : "complete");
    if (rows > 0) assert.equal(findings.rows[0].submittedAt, "06/11/26 1:02:03.123456PM");
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
    assert.equal(result.result.code, "PARKED_CHECK_UNKNOWN");
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
    for (const patch of [{ runVersion: h.run.version + 1 }, { workflowId: "person-lookup" }, { intentGeneration: 2 }, { writeAttemptId: UUID_6 }, { bindingProofDigest: "b".repeat(64) }, { occurrenceKeyDigest: "b".repeat(64) }]) {
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
  it("refuses a missing registered findings task instead of substituting the operational probe", async () => {
    const h = await fixture(1);
    const stores = taskStoreRegistry.stores.map(store => ({ ...store, tasks: Object.fromEntries(Object.entries(store.tasks)
      .filter(([, task]) => task.contract.id !== UcpathReadTransactionFindings.id)) }));
    const result = await checkParkedWrite({ ...h.input, probe: { ...h.input.probe, stores: { ...taskStoreRegistry, stores } } });
    assert.equal(result.result.state, "unavailable"); assert.equal(result.evidence, undefined); assert.equal(result.findingsIdentity, undefined);
    assert.deepEqual(h.events, []); assert.equal(h.intent.status, "parked");
  });
  for (const foreign of ["employee", "name"] as const) it(`does not retain findings for a foreign ${foreign}`, async () => {
    const h = await fixture(1), originalRead = h.driver.readTransactionFindings;
    h.driver.readTransactionFindings = async () => {
      const scan = await originalRead();
      return UcpathTransactionFindingsReadSchema.parse({ ...scan, ...(foreign === "employee" ? { emplId: "10800001" } : {}),
        rows: scan.rows.map(row => ({ ...row, ...(foreign === "employee" ? { emplId: "10800001" } : { displayedName: "Foreign Person" }) })) });
    };
    const before = canonicalJsonStringify([h.run, h.intent, h.attempt]);
    const result = await checkParkedWrite(h.input);
    assert.equal(result.result.state, "unknown"); assert.equal(result.result.provenance, "not-observed");
    assert.equal(result.evidence, undefined); assert.equal(result.findingsIdentity, undefined);
    assert.equal(canonicalJsonStringify([h.run, h.intent, h.attempt]), before);
    assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
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
      let observedRun = h.run;
      const repositories = { ...h.input.repositories, runs: { ...h.input.repositories.runs,
        get: (id: string) => id === h.run.envelope.runId ? observedRun : h.input.repositories.runs.get(id) } };
      h.afterRead(() => { if (scenario === "revision") observedRun = { ...h.run, version: PositiveIntSchema.parse(h.run.version + 1) };
        else controller.abort(new Error("synthetic-late-stop")); });
      await assert.rejects(checkParkedWrite({ ...h.input, repositories, signal: controller.signal }), error => {
        if (scenario === "revision") {
          assert.ok(error instanceof RecoveryActivityError);
          assert.ok(error.cause instanceof Error); assert.match(error.cause.message, /recovery-activity-not-open/);
        } else { assert.ok(error instanceof Error); assert.match(error.message, /synthetic-late-stop/); }
        return true;
      });
      if (scenario === "revision") assert.throws(() => requireParkedWriteCheckTarget(repositories, h.input.target, h.input.descriptor), /parked-check-authority-changed/);
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

  for (const companion of ["read", "note", "release", "end", "all"] as const) it(`keeps closure uncertainty fatal alongside ${companion} failure`, async () => {
    const h = await fixture(1); h.failClosure();
    if (companion === "read" || companion === "all") h.failRead();
    const timeline = h.input.repositories.timelineEvents;
    const repositories = { ...h.input.repositories, timelineEvents: { ...timeline, append: (input: unknown) => {
      const kind = (input as { payload: { kind: string } }).payload.kind;
      if ((companion === "note" || companion === "all") && kind === "note") throw new Error("synthetic-note-failure");
      if ((companion === "end" || companion === "all") && kind === "recovery-activity-ended") throw new Error("synthetic-end-failure");
      return timeline.append(input);
    } } };
    const sessions = { ...h.input.sessions, releaseRunConfigFingerprint: () => {
      h.input.sessions.releaseRunConfigFingerprint();
      if (companion === "release" || companion === "all") throw new Error("synthetic-release-failure");
    } };
    await assert.rejects(checkParkedWrite({ ...h.input, repositories, sessions }), error => {
      assert.ok(error instanceof BrowserSessionClosureUnprovedError || error instanceof WorkerSessionClosureUnprovedError);
      assert.equal(error instanceof WorkerControlRefusal, false);
      return true;
    });
    assert.deepEqual(h.events, ["close", "bind", "read", "close", "release"]);
    assert.equal(h.run.lifecycle.state, "parked-write"); assert.equal(h.intent.status, "parked");
    assert.equal(h.attempt.outcome.state, "parked");
    assert.equal(h.input.repositories.runCheckpoints.latest(h.run.envelope.workflow, h.run.envelope.itemId, "submit-write"), undefined);
  });
});
