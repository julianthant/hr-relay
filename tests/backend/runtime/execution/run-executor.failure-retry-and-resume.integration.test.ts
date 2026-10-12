import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { RUN_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { happySessionHarness, healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const {executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

describe("failure, retry, and resume", () => {
  it("keeps arbitrary task failure detail unstamped in authority and out of the admitted task span", async () => {
    const rawDiagnostic = "ucpath:termination|10812345|2026-08-29";
    const sessions = sessionFactoryHarness({
      ucpath: () => healthyUcpathDriver(),
      crm: () => Object.freeze({
        system: "crm" as const,
        readOnboardingRecord: (): Promise<never> => Promise.reject(new Error(rawDiagnostic)),
        readOnboardingDates: (): Promise<never> => Promise.reject(new Error("unused")),
      }),
    });
    const harness = executorHarness({ sessions });
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
      "task crm/read-onboarding-record failed; inspect its structured failure record",
    );
    assert.equal(JSON.stringify(failedTaskSpan).includes(rawDiagnostic), false);
  });

  it("rolls back an ordinary checkpoint when its required timeline event cannot persist", async () => {
    const h = executorHarness();
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
    const harness = executorHarness();
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
    const harness = executorHarness({ sessions: happySessionHarness() });
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
    const harness = executorHarness({ sessions, taskDeadlineMs: 5_000 });
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
    const harness = executorHarness();
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
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          releaseDriver?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const harness = executorHarness({ sessions });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const executing = executeClaimedRun(harness.deps, { ...claimed, signal: controller.signal });
    await started;
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
  });
});
