/**
 * Phase-1f interpreter behavior over the REAL person-lookup descriptor,
 * stores, claim authority, and worker session manager — only the process
 * edges (browser factory, clock, ids, timers, span sink) are recording fakes.
 */
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { afterEach, describe, it } from "vitest";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../src/base/store.js";
import { defineTask } from "../../src/base/task.js";
import { TaskError } from "../../src/base/errors.js";
import {
  executeClaimedRun,
  type RunExecutorDependencies,
} from "../../src/core/run-executor.js";
import { taskSpanPath } from "../../src/core/span-emitter.js";
import type { WorkerSessionManager } from "../../src/core/worker-sessions.js";
import { CrmReadOnboardingRecord } from "../../src/domain/contracts/crm/read-onboarding-record.js";
import { EXECUTABLE_SCENARIO_IDS } from "../../src/domain/workflow/scenario-execution.js";
import { NodeIdSchema, TraceIdSchema } from "../../src/domain/ids.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { crmSession } from "../../src/stores/crm/session-provider.js";
import { crmDriver } from "../../src/stores/crm/declaration.js";
import { readOnboardingDatesTask } from "../../src/stores/crm/tasks/read-onboarding-dates.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import {
  personLookupDescriptor,
  PersonLookupResultSchema,
} from "../../src/workflows/person-lookup/descriptor.js";
import { sequentialIdFactory, RUN_ID, WORKER_ID, WORKFLOW_ID } from "./fixtures/phase1f-run-fixtures.js";
import { UUID_5, UUID_6 } from "./fixtures/phase1c-contract-fixtures.js";
import {
  happySessionHarness,
  healthyCrmDriver,
  healthyUcpathDriver,
  ManualScheduler,
  openAuthorityHarness,
  personLookupQueuedRun,
  recordingEmitter,
  recordingLogger,
  sessionFactoryHarness,
  sessionManagerFor,
  type AuthorityHarness,
  type SessionFactoryHarness,
} from "./fixtures/phase1f-executor-harness.js";

const disposers: (() => void)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
});

interface ExecutorHarness {
  readonly authority: AuthorityHarness;
  readonly sessions: SessionFactoryHarness;
  readonly manager: WorkerSessionManager;
  readonly scheduler: ManualScheduler;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly deps: RunExecutorDependencies;
}

function executorHarness(options: Readonly<{
  sessions?: SessionFactoryHarness;
  autoFireAtOrBelowMs?: number;
  taskDeadlineMs?: number;
  stores?: RunExecutorDependencies["stores"];
}> = {}): ExecutorHarness {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  const sessions = options.sessions ?? happySessionHarness();
  const manager = sessionManagerFor(sessions, authority.clock);
  const scheduler = new ManualScheduler(authority.clock, options.autoFireAtOrBelowMs ?? 0);
  const emitter = recordingEmitter();
  const deps: RunExecutorDependencies = {
    descriptor: personLookupDescriptor,
    stores: options.stores ?? taskStoreRegistry,
    authority: authority.database,
    sessions: manager,
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("b"),
    scheduler,
    taskDeadlineMs: options.taskDeadlineMs ?? 60_000,
    log: recordingLogger().log,
  };
  return { authority, sessions, manager, scheduler, emitter, deps };
}

function enqueueAndClaim(
  database: AuthorityDatabase,
  run: Record<string, unknown>,
  now: string,
): { run: RunRecord; claim: { workerId: string; claimGeneration: number } } {
  database.authority.runs.enqueue(run);
  const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId: WORKER_ID, now });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return {
    run: claimed.run,
    claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
  };
}

const SIGNAL = new AbortController().signal;

describe("person-lookup full walk", () => {
  it("walks all four nodes to sealed terminal success, skipping crm-dates by condition", async () => {
    const harness = executorHarness();
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.deepEqual(outcome, { state: "done", runId: RUN_ID });

    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    assert.equal(run.lifecycle.state, "terminal");
    assert.equal(run.lifecycle.state === "terminal" && run.lifecycle.outcome, "done");

    // Durable terminal authority: result + authorization + pending outbox.
    const result = database.authority.runResults.get(RUN_ID);
    assert.ok(result);
    assert.deepEqual(
      result.dependencies.map((dependency) => [dependency.nodeId, dependency.state]),
      [["active-status", "resolved"], ["crm-dates", "not-run"]],
    );
    const crmDates = result.dependencies.find((dependency) => dependency.nodeId === "crm-dates");
    assert.ok(crmDates?.state === "not-run" && crmDates.reason === "condition-false");
    assert.ok(database.authority.terminalAuthorizations.get(RUN_ID));
    assert.ok(database.authority.runTerminalOutbox.findByRun(RUN_ID));

    // Checkpoints: three executed nodes have rows; the skipped node has none.
    const itemId = run.envelope.itemId;
    for (const nodeId of ["searching", "cross-verify", "active-status"]) {
      assert.ok(database.authority.runCheckpoints.latest(WORKFLOW_ID, itemId, nodeId), nodeId);
    }
    assert.equal(database.authority.runCheckpoints.latest(WORKFLOW_ID, itemId, "crm-dates"), undefined);

    // One warm session per browser system, one login each; nothing poisoned.
    assert.equal(harness.sessions.opens("ucpath"), 1);
    assert.equal(harness.sessions.opens("crm"), 1);
    assert.equal(harness.sessions.logins(), 2);
    assert.deepEqual(harness.sessions.closeReasons(), []);

    // Exact span sequence (ref workflow-model §6 / ref dashboard-surfaces §1.1 identities).
    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const node = (id: string) => NodeIdSchema.parse(id);
    const spans = harness.emitter.events().map((event) => [
      event.t,
      event.spanPath,
      "outcome" in event ? event.outcome : "",
    ]);
    // D270 — every executed task publishes its recorded observations on its own
    // span, BETWEEN the open and the close. The skipped node has none, because
    // a node that did not run observed nothing.
    assert.deepEqual(spans, [
      ["span.started", taskSpanPath(trace, node("searching"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("searching"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("searching"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("cross-verify"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("cross-verify"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("active-status"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("active-status"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("active-status"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("crm-dates"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("crm-dates"), 1, 1), "skipped"],
      ["span.ended", trace, "done"],
    ]);

    // D123: the skip span carries the SAME closed reason the durable result
    // records, so the timeline can say why the node did not run instead of
    // presenting it as an act somebody took.
    const skipSpan = harness.emitter.events().find((event) =>
      event.t === "span.ended" && "outcome" in event && event.outcome === "skipped");
    assert.ok(skipSpan);
    assert.equal(
      skipSpan.t === "span.ended" && "notRunReason" in skipSpan ? skipSpan.notRunReason : undefined,
      crmDates.reason,
    );
  });

  it("includes crm-dates when the operator asked for it", async () => {
    const harness = executorHarness();
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(
      database,
      personLookupQueuedRun({ includeCrmDates: true }),
      clock.now().toISOString(),
    );

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");

    const result = database.authority.runResults.get(RUN_ID);
    assert.ok(result);
    const crmDates = result.dependencies.find((dependency) => dependency.nodeId === "crm-dates");
    assert.ok(crmDates?.state === "resolved");
    const value = PersonLookupResultSchema.parse(result.result.value);
    assert.equal(value.crmDates.state, "included");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    assert.ok(database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "crm-dates"));
  });
});

describe("failure, retry, and resume", () => {
  it("terminalizes a node failure with the exact structured record and authorization consequence", async () => {
    // CRM is down: a non-transient task error must land the run failed,
    // naming the exact node and task.
    const mismatched = sessionFactoryHarness({
      ucpath: () => healthyUcpathDriver(),
      crm: () => Object.freeze({
        system: "crm" as const,
        readOnboardingRecord: () => Promise.reject(new TaskError(
          CrmReadOnboardingRecord.id,
          "crm-unavailable",
          "CRM returned an unexpected page",
        )),
        readOnboardingDates: () => Promise.reject(new Error("unused")),
      }),
    });
    const harness = executorHarness({ sessions: mismatched });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "failed");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.equal(failure.nodeId, "cross-verify");
    assert.equal(failure.taskId, "crm/read-onboarding-record");
    assert.equal(failure.code, "CRM_UNAVAILABLE");
    // The authorization retained the pre-terminal CAS and claim.
    const authorization = database.authority.terminalAuthorizations.get(RUN_ID);
    assert.ok(authorization && authorization.kind === "failed");
    assert.equal(run.version, authorization.expectedVersion + 1);
    assert.equal(run.claimGeneration, authorization.claim.claimGeneration);
    // The failing CRM session poison-closed; UCPath's stayed healthy.
    assert.deepEqual(harness.sessions.closeReasons(), ["poisoned"]);
  });

  it("retries a transient task failure in-run with attempt-suffixed spans and a fresh session", async () => {
    let crmCalls = 0;
    const sessions = sessionFactoryHarness({
      ucpath: () => healthyUcpathDriver(),
      crm: (openIndex) => {
        if (openIndex === 1) {
          return Object.freeze({
            system: "crm" as const,
            readOnboardingRecord: (): Promise<never> => {
              crmCalls += 1;
              return Promise.reject(new TaskError(
                CrmReadOnboardingRecord.id,
                "crm-unavailable",
                "CRM 502",
                { transient: true },
              ));
            },
            readOnboardingDates: (): Promise<never> => Promise.reject(new Error("unused")),
          });
        }
        return healthyCrmDriver();
      },
    });
    // Auto-fire the 2s retry backoff; the 60s task deadline stays pending.
    const harness = executorHarness({ sessions, autoFireAtOrBelowMs: 2_500 });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());

    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");
    assert.equal(crmCalls, 1);
    // First CRM session poison-closed after the failure; a fresh one served #2.
    assert.equal(harness.sessions.opens("crm"), 2);
    assert.deepEqual(harness.sessions.closeReasons(), ["poisoned"]);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const node = (id: string) => NodeIdSchema.parse(id);
    const crossVerifySpans = harness.emitter.events()
      .filter((event) => event.spanPath.includes("/cross-verify#"))
      .map((event) => [event.t, event.spanPath, "outcome" in event ? event.outcome : ""]);
    // The failed attempt read nothing before it threw, so it publishes no
    // observation; the successful one does, on ITS OWN span path (D123/D214).
    assert.deepEqual(crossVerifySpans, [
      ["span.started", taskSpanPath(trace, node("cross-verify"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 1, 1), "failed"],
      ["span.started", taskSpanPath(trace, node("cross-verify"), 2, 1), ""],
      ["data.observed", taskSpanPath(trace, node("cross-verify"), 2, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 2, 1), "done"],
    ]);
  });

  it("replays compatible checkpoints on a cross-run retry and re-executes always-rerun nodes", async () => {
    let ucpathSearches = 0;
    const failingCrm = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return {
          ...driver,
          searchPersonOrg: (...args: Parameters<typeof driver.searchPersonOrg>) => {
            ucpathSearches += 1;
            return driver.searchPersonOrg(...args);
          },
        };
      },
      crm: () => Object.freeze({
        system: "crm" as const,
        readOnboardingRecord: (): Promise<never> => Promise.reject(new Error("CRM exploded")),
        readOnboardingDates: (): Promise<never> => Promise.reject(new Error("unused")),
      }),
    });
    const first = executorHarness({ sessions: failingCrm });
    const { database, clock } = first.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const failed = await executeClaimedRun(first.deps, { ...claimed, signal: SIGNAL });
    assert.equal(failed.state, "failed");
    assert.equal(ucpathSearches, 1);

    // Cross-run retry: a NEW run on the same logical item (ref workflow-model §6).
    // D221 — a retry is the ITEM's next attempt, not a second attempt 1.
    const retryRun = personLookupQueuedRun({ runId: UUID_5, attempt: 2 });
    const retryEnvelope = retryRun.envelope as Record<string, unknown>;
    retryEnvelope.runId = UUID_5;
    retryEnvelope.retryOf = RUN_ID;
    database.authority.runs.enqueue(retryRun);
    const reclaimed = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      now: clock.now().toISOString(),
    });
    assert.equal(reclaimed.state, "claimed");
    if (reclaimed.state !== "claimed") return;

    let ucpathSearchesRetry = 0;
    const healthySessions = sessionFactoryHarness({
      ucpath: () => {
        const driver = healthyUcpathDriver();
        return {
          ...driver,
          searchPersonOrg: (...args: Parameters<typeof driver.searchPersonOrg>) => {
            ucpathSearchesRetry += 1;
            return driver.searchPersonOrg(...args);
          },
        };
      },
      crm: () => healthyCrmDriver(),
    });
    const second = executorHarness({ sessions: healthySessions });
    // Reuse the FIRST authority database — the checkpoints live there.
    const secondDeps: RunExecutorDependencies = {
      ...second.deps,
      authority: database,
      clock,
    };
    const outcome = await executeClaimedRun(secondDeps, {
      run: reclaimed.run,
      claim: { workerId: WORKER_ID, claimGeneration: reclaimed.run.claimGeneration },
      signal: SIGNAL,
    });
    assert.equal(outcome.state, "done");
    // `searching` replayed from its checkpoint — zero new UCPath searches —
    // while `active-status` (always-rerun) executed fresh.
    assert.equal(ucpathSearchesRetry, 0);
    assert.equal(healthySessions.opens("ucpath"), 0);
    assert.equal(healthySessions.opens("crm"), 1);

    const result = database.authority.runResults.get(UUID_5);
    assert.ok(result);
    const active = result.dependencies.find((dependency) => dependency.nodeId === "active-status");
    assert.ok(active?.state === "resolved");
    // The always-rerun dependency was produced by THIS run, not replayed from
    // the failed one: the interpreter never consults loadCheckpoint for it.
    assert.equal(active.checkpoint.runId, UUID_5);
    const spans = second.emitter.events().map((event) => event.spanPath);
    assert.ok(spans.every((path) => !path.includes("/searching#")), "replayed searching must not re-span");
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
    // §5.4: before any browser launches — zero sessions were opened.
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

  it("emits every recorded point on the task's own span, redacted by declaration (D270)", async () => {
    const harness = executorHarness({ sessions: happySessionHarness() });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const searching = taskSpanPath(trace, NodeIdSchema.parse("searching"), 1, 1);

    const observed = harness.emitter.events()
      .filter((event) => event.t === "data.observed" && event.spanPath === searching);
    // ONE event per `ctx.recordData` CALL: `searchPersonOrgTask` records both
    // of its points in one batch, and a batch is one observation of the page.
    assert.equal(observed.length, 1);
    const event = observed[0];
    assert.ok(event !== undefined && event.t === "data.observed");
    assert.equal(event.nodeId, "searching");
    assert.equal(event.taskId, "ucpath/search-person-org");
    assert.equal(event.observedAt, event.ts);
    assert.deepEqual(event.points.map((point) => point.field), ["results", "selection"]);
    assert.deepEqual([...new Set(event.points.map((point) => point.direction))], ["read"]);

    // Redaction is the DECLARED one, per leaf — a population is a count, a
    // person identifier is a last4, and a status is allowed through whole.
    const values = new Map(event.points.flatMap((point) => point.values.map((value) => [value.key, value])));
    assert.equal(values.get("results")?.transform, "count");
    assert.equal(values.get("selection.status")?.state, "allowed");
    const emplId = values.get("selection.selected.emplId");
    assert.equal(emplId?.transform, "last4");
    assert.equal(emplId?.state === "transformed" ? String(emplId.value).length : -1, 4);

    // A point covering a populated object contributes one value PER LEAF, in
    // the same path vocabulary a `FactProvenance` row is written under.
    const selection = event.points.find((point) => point.field === "selection");
    assert.ok((selection?.values.length ?? 0) > 1);
    assert.equal(selection?.values.every((value) => value.key.startsWith("selection.")), true);

    // The whole identifier never reached the stream.
    const checkpoint = database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "searching");
    const recorded = JSON.stringify(checkpoint?.output.value ?? {});
    const wholeEid = /"emplId":"(\d+)"/.exec(recorded)?.[1];
    assert.ok(wholeEid !== undefined && wholeEid.length > 4);
    assert.equal(JSON.stringify(event).includes(wholeEid), false);
  });

  it("fails the task by name on an UNDECLARED leaf, emitting nothing for that batch (D270)", async () => {
    // The point is honest about the page and the classification table has no
    // line for it. Dropping it would make the log look complete while hiding
    // what the run read, so the recording task fails instead.
    const undeclaredCrossVerify = defineTask(crmDriver, CrmReadOnboardingRecord, {
      sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
      async run({ input, ctx }) {
        const read = await ctx.driver.readOnboardingRecord(input);
        ctx.recordData([{ direction: "read", field: "undeclaredLeaf", value: "x" }]);
        return read.output;
      },
    });
    const brokenCrmStore = defineBrowserStore("crm", crmDriver, crmSession, {
      readOnboardingRecord: undeclaredCrossVerify,
      readOnboardingDates: readOnboardingDatesTask,
    });
    const stores: (typeof taskStoreRegistry.stores)[number][] = taskStoreRegistry.stores.map((store) =>
      store.namespace === "crm" ? brokenCrmStore : store);
    const registry = defineTaskStoreRegistry(stores, {
      scenarioIds: EXECUTABLE_SCENARIO_IDS,
      tasks: stores.flatMap((store) => Object.values(store.tasks))
        .map(({ contract }) => ({ id: contract.id, effect: contract.effect })),
    });

    const harness = executorHarness({ stores: registry });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    // The refusal names the task AND the field — the two things an author needs.
    assert.match(failure.summary, /crm\/read-onboarding-record/);
    assert.match(failure.summary, /undeclaredLeaf/);
    assert.match(failure.summary, /no declared evidence classification/);

    // Nothing from that batch reached the stream, and no checkpoint landed.
    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const crossVerify = taskSpanPath(trace, NodeIdSchema.parse("cross-verify"), 1, 1);
    assert.equal(
      harness.emitter.events().filter((event) =>
        event.t === "data.observed" && event.spanPath === crossVerify).length,
      0,
    );
    assert.equal(
      database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "cross-verify"),
      undefined,
    );
  });

  it("fails a task whose provenance does not cover its output, before any checkpoint", async () => {
    // A store task that returns a valid output but records NO data points.
    const brokenCrossVerify = defineTask(crmDriver, CrmReadOnboardingRecord, {
      sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
      async run({ input, ctx }) {
        const read = await ctx.driver.readOnboardingRecord(input);
        return read.output;
      },
    });
    const crmTasks = {
      readOnboardingRecord: brokenCrossVerify,
      readOnboardingDates: readOnboardingDatesTask,
    };
    const brokenCrmStore = defineBrowserStore("crm", crmDriver, crmSession, crmTasks);
    const stores: (typeof taskStoreRegistry.stores)[number][] = taskStoreRegistry.stores.map((store) =>
      store.namespace === "crm" ? brokenCrmStore : store);
    const corpus = {
      scenarioIds: EXECUTABLE_SCENARIO_IDS,
      tasks: stores.flatMap((store) => Object.values(store.tasks))
        .map(({ contract }) => ({ id: contract.id, effect: contract.effect })),
    };
    const registry = defineTaskStoreRegistry(stores, corpus);

    const harness = executorHarness({ stores: registry });
    const { database, clock } = harness.authority;
    const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
    const outcome = await executeClaimedRun(harness.deps, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "failed");
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    const failureId = run.lifecycle.state === "terminal" ? run.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = database.authority.failures.get(failureId);
    assert.ok(failure);
    assert.match(failure.summary, /recorded no provenance points/);
    // The unproven output never became durable authority.
    assert.equal(
      database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "cross-verify"),
      undefined,
    );
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
    // The wedged session was poison-closed, not reused.
    assert.deepEqual(harness.sessions.closeReasons(), ["poisoned"]);
  });

  // D166: injected patches now APPLY to replayed checkpoints; a patch naming
  // a node with no checkpoint to replay is refused loudly — a fresh read
  // supersedes any correction, so the patch must never be silently ignored.
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
    // No terminal settlement was attempted; the run is still claimed/running.
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run);
    assert.equal(run.lifecycle.state, "running");
    assert.deepEqual(harness.sessions.closeReasons(), ["poisoned"]);
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
  });
});

describe("terminal identity binding", () => {
  it("refuses to execute a run bound to a different descriptor identity", async () => {
    const harness = executorHarness();
    const { database, clock } = harness.authority;
    const run = personLookupQueuedRun();
    const envelope = run.envelope as Record<string, unknown>;
    envelope.contractFingerprint = UUID_6.replaceAll("-", "").padEnd(64, "0");
    database.authority.runs.enqueue(run);
    const claimed = database.authority.runs.claimNext({
      workflow: WORKFLOW_ID,
      workerId: WORKER_ID,
      now: clock.now().toISOString(),
    });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") return;
    await assert.rejects(
      executeClaimedRun(harness.deps, {
        run: claimed.run,
        claim: { workerId: WORKER_ID, claimGeneration: claimed.run.claimGeneration },
        signal: SIGNAL,
      }),
      /the worker is miswired/,
    );
  });
});
