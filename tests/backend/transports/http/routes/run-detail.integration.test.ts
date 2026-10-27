import { createRunExecutorTestWorld } from "../../../../support/helpers/backend/run-executor-world.js";
import { Hono } from "hono";
import { DatabaseSync } from "node:sqlite";
import { resolveOperationSource } from "../../../../../src/backend/runs/queries/operation-source.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerRunDetailRoutes } from "../../../../../src/backend/transports/http/routes/run-detail.js";
import { RunResultRecordSchema } from "../../../../../src/models/run/result.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../src/rules/validation/sha256.js";
import { testRunService } from "../../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import type { RunDetailQueryDeps } from "../../../../../src/backend/runs/queries/run-detail-types.js";
import { executeClaimedRun } from "../../../../../src/backend/runtime/execution/run-executor.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import { ObservedOperationStructureWireSchema } from "../../../../../src/models/dashboard/operation-structure.js";
import { NoteWireSchema } from "../../../../../src/models/events/types.js";
import { UUID_5, UUID_6 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { AuthorityDatabase as SyntheticAuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";

const {executorHarness, enqueueAndClaim, SIGNAL, ACTION_BINDING_WORKFLOW_ID, actionBindingCompiled, readPersistedNotes, actionBindingQueuedRun, actionBindingSessions, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

describe("complete operation display action binding", () => {

  it("serves explicit executor lifecycle and safely classified values through the exact bounded source route", async () => {
    const harness = await executorHarness({ sessions: actionBindingSessions({ lifecycle: true }), descriptor: actionBindingCompiled.descriptor });
    const { database, clock, stateRoot: _stateRoot } = harness.authority;
    const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const claimed = enqueueAndClaim(database, actionBindingQueuedRun(clock.now().toISOString(), { protectedValue: false }), clock.now().toISOString(), ACTION_BINDING_WORKFLOW_ID);
    for (let index = 0; index < 205; index += 1) writer.emitRunLog({ workflow: ACTION_BINDING_WORKFLOW_ID,
      address: { runId: UUID_5, attempt: 1, traceId: "fa-170000-5555", spanPath: "fixture" },
      level: "step", message: "Before the action" }, claimed.run);
    const outcome = await executeClaimedRun({ ...harness.deps, taskNotes: writer }, { ...claimed, signal: SIGNAL });
    assert.equal(outcome.state, "done");
    const notes = readPersistedNotes(database).map((note) => NoteWireSchema.parse(note));
    const actions = notes.flatMap((note) => note.action === undefined ? [] : [note.action]);
    assert.deepEqual(actions.map((action) => action.operation?.state), ["started", "completed", "started", "completed", "started", "completed"]);
    assert.deepEqual(actions.map((action) => action.operation?.occurrence), [1, 1, 1, 1, 1, 1]);
    const checkpoint = database.authority.runCheckpoints.latest(ACTION_BINDING_WORKFLOW_ID, UUID_6, "search");
    assert.ok(checkpoint);
    assert.equal(checkpoint.operationSources?.[0]?.identity.logicalActionId, "read-selection");
    const result = database.authority.runResults.get(UUID_5);
    assert.ok(result);
    assert.equal(result.operationSources?.[0]?.path, "selection.status");
    assert.equal(result.operationSources?.[0]?.identity.logicalActionId, "read-selection");
    const sourceDependency = result.dependencies.find((dependency) => dependency.state === "resolved" && dependency.nodeId === "search");
    assert.ok(sourceDependency?.state === "resolved");
    assert.deepEqual(sourceDependency.operationSources, checkpoint.operationSources);
    const forgedSources = result.operationSources?.map((source) => ({ ...source, identity: { ...source.identity, logicalActionId: "forged-read" } }));
    assert.equal(RunResultRecordSchema.safeParse({ ...result, operationSources: forgedSources,
      operationSourceDigest: sha256Hex(`hrauto:result-operation-sources:v1\0${canonicalJsonStringify(forgedSources)}`) }).success, false, "rehashing a foreign occurrence cannot bypass retained dependency binding");
    assert.deepEqual(result.operationLineage?.[0]?.inputs.map((input) => [input.inputId, input.state]), [["selection", "retained"], ["query", "unavailable"]]);
    assert.equal(result.operationLineage?.[0]?.inputs[0]?.identity?.logicalActionId, "read-selection");
    const forgedLineage = result.operationLineage?.map((lineage) => ({ ...lineage, inputs: lineage.inputs.map((input) => input.identity === undefined ? input : { ...input, identity: { ...input.identity, logicalActionId: "equal-value-other-read" } }) }));
    assert.equal(RunResultRecordSchema.safeParse({ ...result, operationLineage: forgedLineage,
      operationLineageDigest: sha256Hex(`hrauto:result-operation-lineage:v1\0${canonicalJsonStringify(forgedLineage)}`) }).success, false, "equal values cannot substitute another input occurrence");
    const completed = actions[1]?.operation;
    assert.ok(completed);
    const { value: _value, ...identity } = completed;
    const deps = { timeline: database.authority.timelineEvents, stateRoot: _stateRoot, runReader: testRunService(database, clock), descriptors: { resolve: () => undefined },
      projection: { runLogSnapshot: () => ({ entries: [] }) } } as unknown as RunDetailQueryDeps;
    const app: DashboardApp = new Hono();
    registerRunDetailRoutes(app, { runDetail: deps });
    const request = { identity };
    const url = (input: unknown) => `/api/v1/runs/${UUID_5}/operation-source?request=${encodeURIComponent(JSON.stringify(input))}`;
    const first = await app.request(url(request));
    assert.equal(first.status, 200);
    const continuation = await first.json() as { state: string; cursor: string };
    assert.equal(continuation.state, "continue");
    const second = await app.request(url({ ...request, cursor: continuation.cursor }));
    assert.equal(second.status, 200);
    const source = await second.json() as { state: string; structure: z.infer<typeof ObservedOperationStructureWireSchema> };
    assert.equal(source.state, "found");
    assert.equal(source.structure.observations.length, 1);
    assert.deepEqual(source.structure.observations[0]?.occurrence.value, {
      slot: "empl-id", fieldPath: "emplId", producer: { kind: "run-input", path: "emplId" },
      state: "observed", classification: "local-operator", value: "10873698",
    });
    assert.throws(() => resolveOperationSource(deps, UUID_5, { identity: { ...identity, occurrence: 2 }, cursor: continuation.cursor }), /cursor-unavailable-or-identity-mismatch/u);
    assert.throws(() => resolveOperationSource(deps, UUID_5, { identity: { ...identity, definitionFingerprint: "0".repeat(64) } }), /run-identity-mismatch/u);
    assert.throws(() => resolveOperationSource(deps, UUID_5, { identity: { ...identity, logicalActionId: "unknown-action" } }), /unknown-frozen-action/u);
    assert.throws(() => resolveOperationSource(deps, UUID_5, { identity: { ...identity, invocationId: "unknown-invocation" } }), /unknown-frozen-invocation/u);
    for (let index = 0; index < 129; index += 1) resolveOperationSource(deps, UUID_5, request);
    assert.throws(() => resolveOperationSource(deps, UUID_5, { ...request, cursor: continuation.cursor }), /cursor-unavailable-or-identity-mismatch/u);
    const abort = new AbortController(); abort.abort(new Error("cancelled lookup"));
    assert.throws(() => resolveOperationSource(deps, UUID_5, request, abort.signal), /cancelled lookup/u);
  });

  it("retains and reopens the exact frozen complete snapshot from authority storage", async () => {
    const harness = await executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const { database, clock, path } = harness.authority;
    const queued = actionBindingQueuedRun(clock.now().toISOString());
    const snapshot = queued.envelope.operationDisplaySnapshot;
    assert.ok(snapshot);
    database.authority.runs.enqueue(queued);
    const authorityGeneration = database.getMeta().authorityGeneration;
    database.close();

    const reopened = SyntheticAuthorityDatabase.open(
      { path, busyTimeoutMs: 250, migrationOwner: "operation-display-snapshot-reopen-test" },
      clock,
    );
    try {
      const stored = reopened.authority.runs.get(UUID_5);
      assert.ok(stored);
      assert.deepEqual(stored.envelope.operationDisplaySnapshot, snapshot);
      assert.equal(reopened.getMeta().authorityGeneration, authorityGeneration);
    } finally {
      reopened.close();
    }
  });

  it("refuses a corrupt stored complete snapshot after close and reopen", async () => {
    const harness = await executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const { database, clock, path } = harness.authority;
    database.authority.runs.enqueue(actionBindingQueuedRun(clock.now().toISOString()));
    database.close();

    const raw = new DatabaseSync(path);
    try {
      const stored = z.object({ envelope_json: z.string() }).parse(
        raw.prepare("SELECT envelope_json FROM runs WHERE id = ?").get(UUID_5),
      );
      const record = JSON.parse(stored.envelope_json) as { operationDisplaySnapshot: { contentDigest: string } };
      record.operationDisplaySnapshot.contentDigest = "0".repeat(64);
      raw.prepare("UPDATE runs SET envelope_json = ? WHERE id = ?").run(JSON.stringify(record), UUID_5);
    } finally {
      raw.close();
    }

    assert.throws(
      () => SyntheticAuthorityDatabase.open(
        { path, busyTimeoutMs: 250, migrationOwner: "operation-display-snapshot-corrupt-test" },
        clock,
      ),
      /corrupt frozen operation display snapshot digest/u,
    );
  });
});
