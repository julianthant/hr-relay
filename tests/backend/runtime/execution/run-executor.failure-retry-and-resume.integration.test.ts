import { afterAll } from "vitest";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { DiagnosticBundleSchema } from "../../../../src/models/trust/diagnostic.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { lifecycleCommandId, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { directUcpathSearchFixtureTask, registryWithUcpathSearch, createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { RUN_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { happySessionHarness, healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const {executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld(profiles.create);

afterEach(cleanup);

const RAW_DIAGNOSTIC = "ucpath:termination|10812345|2026-08-29";
const failingUcpath = () => sessionFactoryHarness({
  ucpath: () => ({ ...healthyUcpathDriver(), searchPersonOrg: (): Promise<never> => Promise.reject(new Error(RAW_DIAGNOSTIC)) }),
  crm: () => healthyCrmDriver(),
});
const runDebugRecords = (database: { authority: { timelineEvents: { page(query: object): readonly { scope: { kind: string }; workflow?: string; payload: { kind: string } }[] } } }) =>
  database.authority.timelineEvents.page({}).filter((record) => record.payload.kind === "debug" && record.scope.kind === "run");

describe("failure, retry, and resume", () => {
  it("keeps arbitrary task failure detail unstamped in authority and out of the admitted task span", async () => {
    const rawDiagnostic = "ucpath:termination|10812345|2026-08-29";
    const sessions = sessionFactoryHarness({
      ucpath: () => ({ ...healthyUcpathDriver(), searchPersonOrg: (): Promise<never> => Promise.reject(new Error(rawDiagnostic)) }),
      crm: () => healthyCrmDriver(),
    });
    const harness = await executorHarness({ sessions, stores: registryWithUcpathSearch(directUcpathSearchFixtureTask) });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run?.lifecycle.state === "terminal");
    const failureId = run.lifecycle.failureId;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);

    assert.equal(failure.summary.includes(rawDiagnostic), true, "authority must retain the opaque source detail");
    assert.equal(failure.diagnosticSafetyVersion, undefined);
    assert.equal(run.lifecycle.errorSummary, failure.summary);
    assert.equal(run.lifecycle.diagnosticSafetyVersion, undefined);

    const failedTaskSpan = harness.emitter.events().find((event) =>
      event.t === "span.ended" && event.kind === "task" && event.outcome === "failed");
    assert.ok(failedTaskSpan?.t === "span.ended" && failedTaskSpan.kind === "task");
    assert.equal(failedTaskSpan.diagnosticSafetyVersion, 1);
    assert.equal(
      failedTaskSpan.errorSummary,
      "task ucpath/search-person-org failed; inspect its structured failure record",
    );
    assert.equal(JSON.stringify(failedTaskSpan).includes(rawDiagnostic), false);
  });

  it("records one run-scoped failure debug event for an admitted task failure, free of diagnostic text", async () => {
    const harness = await executorHarness({ sessions: failingUcpath(), stores: registryWithUcpathSearch(directUcpathSearchFixtureTask) });
    const { database, clock } = harness.authority;
    const debugEvents = createDebugEventWriter({ repository: database.authority.timelineEvents, clock, build: "test" });
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());

    const outcome = await executeClaimedRun({ ...harness.deps, debugEvents }, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run?.lifecycle.state === "terminal");
    const failure = run.lifecycle.failureId === undefined ? undefined : database.authority.failures.get(run.lifecycle.failureId);
    assert.ok(failure);

    const records = runDebugRecords(database);
    assert.equal(records.length, 1);
    const [record] = records;
    assert.deepEqual(record?.scope, { kind: "run", runId: RUN_ID });
    assert.equal(record?.workflow, claimed.run.envelope.workflow);
    assert.ok(record?.payload.kind === "debug");
    const { event } = record.payload as unknown as { event: Record<string, unknown> };
    assert.equal(event.category, "worker");
    assert.equal(event.phase, "failed");
    assert.equal(event.area, "run-execution");
    assert.equal(event.reason, "run-failed");
    assert.equal(event.code, failure.code);
    assert.equal(event.correlationId, failure.failureId);
    assert.equal(event.message, undefined);
    assert.equal(event.stack, undefined);
    assert.equal(JSON.stringify(records).includes(RAW_DIAGNOSTIC), false);
  });

  it("records no failure debug event when the failure admission is lost", async () => {
    const harness = await executorHarness({ sessions: failingUcpath(), stores: registryWithUcpathSearch(directUcpathSearchFixtureTask) });
    const { database, clock } = harness.authority;
    const debugEvents = createDebugEventWriter({ repository: database.authority.timelineEvents, clock, build: "test" });
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const lifecycle = { ...harness.deps.lifecycle, terminalize: (): ReturnType<typeof harness.deps.lifecycle.terminalize> => ({ state: "refused", refusal: { reason: "lost" } }) };

    const outcome = await executeClaimedRun({ ...harness.deps, lifecycle, debugEvents }, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "abandoned");
    assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "running");
    assert.deepEqual(runDebugRecords(database), []);
  });

  it.each(["append", "mirror"] as const)("keeps the committed failure and its bundle when the failure event %s faults, then raises the fault", async (fault) => {
    const harness = await executorHarness({ sessions: failingUcpath(), stores: registryWithUcpathSearch(directUcpathSearchFixtureTask) });
    const { database, clock } = harness.authority;
    const timeline = database.authority.timelineEvents;
    const debugEvents = fault === "append"
      ? createDebugEventWriter({ repository: { ...timeline, append: (input: unknown) => {
        if ((input as { payload: { kind: string } }).payload.kind === "debug") throw new Error("debug-append-fault");
        return timeline.append(input);
      } }, clock, build: "test" })
      : createDebugEventWriter({ repository: timeline, clock, build: "test", development: true,
        writeStderr: () => { throw new Error("debug-mirror-fault"); } });
    const bundles = { persisted: 0, discarded: 0 };
    const bundleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const diagnostics: NonNullable<Parameters<typeof executeClaimedRun>[0]["diagnostics"]> = {
      captureForFailure: async (context) => DiagnosticBundleSchema.parse({ bundleId, runId: RUN_ID,
        origin: { kind: "failure", failureId: context.failure.failureId }, createdAt: clock.now().toISOString(), contentDigest: "a".repeat(64),
        configFingerprint: context.configFingerprint, descriptorFingerprint: context.descriptorFingerprint,
        redaction: { fields: [], warnings: [] }, attachments: [], retention: { kind: "pinned", reason: "write-recovery" } }),
      persist: (bundle) => { bundles.persisted += 1; return bundle; },
      discard: () => { bundles.discarded += 1; },
    };
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());

    await assert.rejects(executeClaimedRun({ ...harness.deps, debugEvents, diagnostics }, { ...claimed, signal: SIGNAL }), new RegExp(`debug-${fault}-fault`, "u"));
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed" && run.lifecycle.failureId !== undefined);
    assert.equal(database.authority.failures.get(run.lifecycle.failureId)?.diagnosticBundleId, bundleId);
    assert.ok(database.authority.runResults.get(RUN_ID));
    assert.deepEqual(bundles, { persisted: 1, discarded: 0 });
    assert.equal(runDebugRecords(database).length, fault === "append" ? 0 : 1);
  });

  it("rolls back an ordinary checkpoint when its required timeline event cannot persist", async () => {
    const h = await executorHarness();
    const { database, clock, path } = h.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const raw = new DatabaseSync(path);
    try {
      raw.exec("CREATE TRIGGER injected_checkpoint_event BEFORE INSERT ON timeline_events WHEN json_extract(NEW.payload_json, '$.payload.kind') = 'checkpoint-recorded' BEGIN SELECT RAISE(ABORT, 'injected checkpoint event'); END");
      const outcome = await executeClaimedRun(h.deps, { ...claimed, signal: SIGNAL });
      assert.equal(outcome.state, "failed");
      assert.equal(database.authority.runCheckpoints.latest(WORKFLOW_ID, claimed.run.envelope.itemId, "searching"), undefined);
      assert.equal(database.authority.timelineEvents.page({ runId: RUN_ID }).some((row) => row.payload.kind === "checkpoint-recorded"), false);
      assert.equal(h.emitter.events().some((event) => event.t === "span.ended" && event.kind === "task"
        && event.spanPath.includes("/searching#") && event.outcome === "done"), false);
      assert.equal(h.emitter.events().filter((event) => event.t === "span.ended" && event.kind === "run"
        && event.outcome === "failed").length, 1);
    } finally { raw.close(); }
  });

  it("refuses an explicit startAt resume whose ancestors have no checkpoints, before any browser", async () => {
    const harness = await executorHarness();
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(
      database,
      personLookupQueuedRun({ startAt: "active-status" }),
      clock.now().toISOString(),
    );

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");

    assert.equal(harness.sessions.opens(), 0);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    // Entry validation names EVERY missing ancestor in ONE failure, no node id.
    assert.equal(failure.nodeId, undefined);
    assert.equal(failure.code, "RESUME_VALIDATION_FAILED");
    assert.match(failure.summary, /start at "active-status"/);
    assert.match(failure.summary, /missing context "searching"/);
    assert.match(failure.summary, /ucpath\/search-person-org/);
    assert.match(failure.summary, /missing context "cross-verify"/);
  });

  it("retains a protected canary EID in real executor observed-data emission", async () => {
    const harness = await executorHarness({ sessions: happySessionHarness() });
    const { database, clock } = harness.authority;
    const binding = { kind: "test-data-local" as const, inputPath: "emplId" as const,
      name: "personLookupCanaryEid" as const, sourceId: "00000000-0000-4000-8000-000000000088" };
    const claimed = enqueueAndClaim(database, personLookupQueuedRun({ protectedBindings: [binding] }), clock.now().toISOString());
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");
    const points = harness.emitter.events().flatMap((event) => event.t === "data.observed" ? event.points : []);
    const identifiers = points.flatMap((point) => point.values).filter(({ key }) => key.endsWith("emplId"));
    assert.ok(identifiers.length > 0);
    assert.ok(identifiers.every((value) => value.state === "allowed" && value.value !== undefined));
    assert.ok(identifiers.some((value) => value.state === "allowed" && value.value === "10873698"));
    assert.deepEqual(database.authority.runs.get(RUN_ID)?.input.parsed.protectedBindings, [binding]);
  });

  it("bounds a non-cooperative task by its immutable deadline and fails loud", async () => {
    let wedged: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      wedged = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        // Ignores its signal and never settles: only the deadline race bounds it.
        searchPersonOrg: (): Promise<never> => {
          wedged?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const harness = await executorHarness({ sessions, taskDeadlineMs: 5_000 });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const executing = executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    await started;
    const deadline = harness.scheduler.pending()
      .find((entry) => entry.deadlineMonotonicMs === clock.monotonicMs() + 5_000);
    assert.ok(deadline, "the task deadline must be scheduled while the task runs");
    deadline.fire();
    const outcome = await executing;
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.match(failure.summary, /exceeded its immutable 5000ms task deadline/);

    assert.deepEqual(harness.sessions.closeReasons(), ["poisoned"]);
  });


  it("rejects injected patches naming a node this run does not replay", async () => {
    const harness = await executorHarness();
    const { database, clock } = harness.authority;
    const run = personLookupQueuedRun({ startAt: "cross-verify" });
    const envelope = run.envelope as Record<string, unknown>;
    envelope.injected = [{
      nodeId: "searching",
      fieldPath: "selection.status",
      value: "resolved",
      correctedAt: clock.now().toISOString(),
      reason: "operator correction",
    }];
    const claimed = enqueueAndClaim(database, run, clock.now().toISOString());
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const stored = database.authority.runs.get(RUN_ID);
    assert.ok(stored && stored.lifecycle.state === "terminal");
    const failureId = stored.lifecycle.state === "terminal" ? stored.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.match(failure.summary, /does not replay from a checkpoint/);
    assert.equal(harness.sessions.opens(), 0);
  });

  it("returns abandoned when the run signal aborts mid-task and poison-closes the lease", async () => {
    let releaseDriver: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      releaseDriver = resolve;
    });
    const controller = new AbortController();
    let rejectDriver: (reason: unknown) => void = () => { throw new Error("driver gate not entered"); };
    const driverOperation = new Promise<never>((_resolve, reject) => { rejectDriver = reject; });
    let driverSettled = false;
    const driverSettlement = driverOperation.then(() => { throw new Error("driver gate unexpectedly resolved"); }, reason => {
      assert.equal(reason, controller.signal.reason); driverSettled = true;
    });
    const retained: Promise<unknown>[] = [];
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          releaseDriver?.();
          return driverOperation;
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const harness = await executorHarness({ sessions });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const executing = executeClaimedRun({ ...harness.deps, retainCallback(identity, operation) {
      assert.equal(identity.runId, claimed.run.envelope.runId);
      assert.equal(identity.claimGeneration, claimed.claim.claimGeneration);
      assert.equal(identity.attempt, claimed.run.envelope.attempt);
      retained.push(operation);
    } }, { ...claimed, signal: controller.signal });
    await started;
    const retainedBeforeAbort = retained.length; assert.equal(retainedBeforeAbort, 2);
    controller.abort(new Error("operator cancelled the run"));
    const outcome = await executing;
    assert.equal(outcome.state, "abandoned");
    if (outcome.state === "abandoned") assert.match(outcome.reason, /operator cancelled the run/);
    await new Promise((resolve) => setImmediate(resolve));

    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    assert.equal(run.lifecycle.state, "running");
    assert.deepEqual(harness.sessions.closeReasons(), ["poisoned"]);
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(driverSettled, false);
    assert.equal(retained.length, retainedBeforeAbort);
    rejectDriver(controller.signal.reason);
    await driverSettlement;
    const settled = await Promise.allSettled(retained);
    assert.equal(driverSettled, true);
    assert.equal(settled.length, 2);
    const [sessionOperation, taskOperation] = settled; assert.ok(sessionOperation && taskOperation);
    assert.equal(sessionOperation.status, "rejected");
    if (sessionOperation.status === "rejected") {
      assert.ok(sessionOperation.reason instanceof Error);
      assert.equal(sessionOperation.reason.constructor, Error);
      assert.equal(sessionOperation.reason.message, "ucpath driver lease was aborted during use");
      assert.equal(sessionOperation.reason.cause, undefined);
    }
    assert.equal(taskOperation.status, "rejected");
    if (taskOperation.status === "rejected") assert.equal(taskOperation.reason, controller.signal.reason);
    const lifecycle = testRunService(database, clock);
    const claim = runClaim(run); assert.ok(claim);
    const now = clock.now().toISOString();
    const requested = requireLifecycleApplied(lifecycle.transition({ commandId: lifecycleCommandId("fixture-cancel-request", RUN_ID),
      runId: RUN_ID, expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now } }));
    assert.equal(requested.cancelRequested, true);
    const terminal = requireLifecycleApplied(lifecycle.terminalize({ kind: "cancelled", commandId: lifecycleCommandId("fixture-cancel-terminal", RUN_ID),
      runId: RUN_ID, expectedVersion: requested.version, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, endedAt: now }, harness.deps.descriptor));
    assert.deepEqual(terminal.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: now });
    assert.equal(database.authority.runs.listByWorker(claim.workerId).some(owned => runClaim(owned) !== undefined), false);
  });
});
