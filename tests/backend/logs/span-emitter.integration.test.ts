import { registryWithCrmSearch, createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { taskSpanPath } from "../../../src/backend/logs/span-emitter.js";
import { executeClaimedRun } from "../../../src/backend/runtime/execution/run-executor.js";
import { crmDriver } from "../../../src/backend/systems/crm/driver-declaration.js";
import { crmSession } from "../../../src/backend/systems/crm/session-provider.js";
import { crmStore } from "../../../src/backend/systems/crm/task-registry.js";
import { CrmSearchOnboardingRecords } from "../../../src/models/systems/crm/search-onboarding-records.js";
import { NodeIdSchema, TraceIdSchema } from "../../../src/rules/identity/ids.js";
import { TaskError } from "../../../src/workflow-kit/errors.js";
import { defineBrowserStore, defineTaskStoreRegistry } from "../../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../../src/workflow-kit/task.js";
import { EXECUTABLE_SCENARIO_IDS } from "../../../src/workflow-kit/validation/scenario-execution.js";
import { RUN_ID, WORKFLOW_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { happySessionHarness, healthyCrmDriver, healthyUcpathDriver, personLookupQueuedRun, sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";

const {executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

describe("person-lookup full walk", () => {

  it("walks every declared node to sealed terminal success, skipping crm-results and crm-dates by condition", async () => {
    const harness = await executorHarness();
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
      [["search-identity", "resolved"], ["crm-identity", "resolved"], ["matching", "not-run"], ["crm-selected-record", "resolved"], ["crm-results", "not-run"], ["active-status", "resolved"], ["crm-dates", "not-run"]],
    );
    const crmResults = result.dependencies.find((dependency) => dependency.nodeId === "crm-results");
    assert.ok(crmResults?.state === "not-run" && crmResults.reason === "condition-false");
    const crmDates = result.dependencies.find((dependency) => dependency.nodeId === "crm-dates");
    assert.ok(crmDates?.state === "not-run" && crmDates.reason === "condition-false");
    assert.ok(database.authority.runs.get(RUN_ID)?.completion);
    assert.ok(database.authority.runs.get(RUN_ID)?.completion);

    // Checkpoints: three executed nodes have rows; the skipped node has none.
    const itemId = run.envelope.itemId;
    for (const nodeId of ["searching", "search-identity", "cross-verify", "crm-identity", "crm-selected-record", "active-status"]) {
      assert.ok(database.authority.runCheckpoints.latest(WORKFLOW_ID, itemId, nodeId), nodeId);
    }
    assert.equal(database.authority.runCheckpoints.latest(WORKFLOW_ID, itemId, "crm-results"), undefined);
    assert.equal(database.authority.runCheckpoints.latest(WORKFLOW_ID, itemId, "crm-dates"), undefined);

    // One warm session per browser system, one login each; nothing poisoned.
    assert.equal(harness.sessions.opens("ucpath"), 1);
    assert.equal(harness.sessions.opens("crm"), 1);
    assert.equal(harness.sessions.logins(), 2);
    assert.deepEqual(harness.sessions.closeReasons(), []);

    // Exact span sequence (ref workflow-model / ref dashboard-surfaces  identities).
    const trace = TraceIdSchema.parse(run.envelope.traceId);
    const node = (id: string) => NodeIdSchema.parse(id);
    const spans = harness.emitter.events().map((event) => [
      event.t,
      event.spanPath,
      "outcome" in event ? event.outcome : "",
    ]);

    assert.deepEqual(spans, [
      ["span.started", taskSpanPath(trace, node("searching"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("searching"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("searching"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("matching"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("matching"), 1, 1), "skipped"],
      ["span.started", taskSpanPath(trace, node("search-identity"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("search-identity"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("search-identity"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("cross-verify"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("cross-verify"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("crm-identity"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("crm-identity"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("crm-identity"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("crm-selected-record"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("crm-selected-record"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("crm-selected-record"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("crm-results"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("crm-results"), 1, 1), "skipped"],
      ["span.started", taskSpanPath(trace, node("crm-only-recovery"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("crm-only-recovery"), 1, 1), "skipped"],
      ["span.started", taskSpanPath(trace, node("active-status"), 1, 1), ""],
      ["data.observed", taskSpanPath(trace, node("active-status"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("active-status"), 1, 1), "done"],
      ["span.started", taskSpanPath(trace, node("crm-dates"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("crm-dates"), 1, 1), "skipped"],
      ["span.ended", trace, "done"],
    ]);


    const crmResultsSpan = harness.emitter.events().find((event) =>
      event.t === "span.ended" && event.spanPath === taskSpanPath(trace, node("crm-results"), 1, 1));
    assert.ok(crmResultsSpan?.t === "span.ended" && crmResultsSpan.kind === "task" && crmResultsSpan.outcome === "skipped");
    assert.equal(crmResultsSpan.notRunReason, crmResults.reason);

    const skipSpan = harness.emitter.events().find((event) =>
      event.t === "span.ended" && "outcome" in event && event.outcome === "skipped");
    assert.ok(skipSpan);
    assert.equal(
      skipSpan.t === "span.ended" && "notRunReason" in skipSpan ? skipSpan.notRunReason : undefined,
      crmDates.reason,
    );
  });
});

describe("failure, retry, and resume", () => {

  it("retries a transient task failure in-run with attempt-suffixed spans and a fresh session", async () => {
    let crmCalls = 0;
    const sessions = sessionFactoryHarness({
      ucpath: () => healthyUcpathDriver(),
      crm: (openIndex) => {
        if (openIndex === 1) {
          return Object.freeze({
            system: "crm" as const,
            searchOnboardingRecords: (): Promise<never> => {
              crmCalls += 1;
              return Promise.reject(new TaskError(
                CrmSearchOnboardingRecords.id,
                "PERSON_LOOKUP_CRM_CHECK_FAILED",
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
    const retryingSearch = defineTask(crmDriver, CrmSearchOnboardingRecords, {
      retry: { attempts: 2, backoffMs: 2000, retryOn: "transient" },
      sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
      async run({ input, ctx }) {
        const output = { state: "checked" as const, records: await ctx.driver.searchOnboardingRecords(input) };
        ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
        return output;
      },
    });
    const harness = await executorHarness({ sessions, stores: registryWithCrmSearch(retryingSearch), autoFireAtOrBelowMs: 2_500 });
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

    assert.deepEqual(crossVerifySpans, [
      ["span.started", taskSpanPath(trace, node("cross-verify"), 1, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 1, 1), "failed"],
      ["span.started", taskSpanPath(trace, node("cross-verify"), 2, 1), ""],
      ["data.observed", taskSpanPath(trace, node("cross-verify"), 2, 1), ""],
      ["span.ended", taskSpanPath(trace, node("cross-verify"), 2, 1), "done"],
    ]);
  });

  it("emits every recorded point on the task's own span with original values", async () => {
    const harness = await executorHarness({ sessions: happySessionHarness() });
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

    // Classification stays declared per leaf; the original is retained for the operator.
    const values = new Map(event.points.flatMap((point) => point.values.map((value) => [value.key, value])));
    assert.equal(values.get("results")?.transform, "allow");
    assert.equal(values.get("results")?.state, "allowed");
    assert.equal(values.get("selection.status")?.state, "allowed");
    const emplId = values.get("selection.selected.emplId");
    assert.equal(emplId?.transform, "allow");
    assert.equal(emplId?.state, "allowed");

    // A point covering a populated object contributes one value PER LEAF, in
    // the same path vocabulary a `FactProvenance` row is written under.
    const selection = event.points.find((point) => point.field === "selection");
    assert.ok((selection?.values.length ?? 0) > 1);
    assert.equal(selection?.values.every((value) => value.key.startsWith("selection.")), true);

    // The whole identifier is retained alongside the classified projection.
    const checkpoint = database.authority.runCheckpoints.latest(WORKFLOW_ID, run.envelope.itemId, "searching");
    const recorded = JSON.stringify(checkpoint?.output.value ?? {});
    const wholeEid = /"emplId":"(\d+)"/.exec(recorded)?.[1];
    assert.ok(wholeEid !== undefined && wholeEid.length > 4);
    assert.equal(emplId?.state === "allowed" ? emplId.value : undefined, wholeEid);
    assert.equal(JSON.stringify(event).includes(wholeEid), true);
  });

  it("fails the task by name on an UNDECLARED leaf, emitting nothing for that batch", async () => {

    const undeclaredCrossVerify = defineTask(crmDriver, CrmSearchOnboardingRecords, {
      sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
      async run({ input, ctx }) {
        const records = await ctx.driver.searchOnboardingRecords(input);
        ctx.recordData([{ direction: "read", field: "undeclaredLeaf", value: "x" }]);
        return { state: "checked" as const, records };
      },
    });
    const brokenCrmStore = defineBrowserStore("crm", crmDriver, crmSession, {
      ...crmStore.tasks,
      searchOnboardingRecords: undeclaredCrossVerify,
    });
    const stores: (typeof taskStoreRegistry.stores)[number][] = taskStoreRegistry.stores.map((store) =>
      store.namespace === "crm" ? brokenCrmStore : store);
    const registry = defineTaskStoreRegistry(stores, {
      scenarioIds: EXECUTABLE_SCENARIO_IDS,
      tasks: stores.flatMap((store) => Object.values(store.tasks))
        .map(({ contract }) => ({ id: contract.id, effect: contract.effect })),
    });

    const harness = await executorHarness({ stores: registry });
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
    assert.match(failure.summary, /crm\/search-onboarding-records/);
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
});
