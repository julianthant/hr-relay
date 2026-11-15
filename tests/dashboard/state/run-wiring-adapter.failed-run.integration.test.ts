import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { descriptorSetHash } from "../../../src/backend/app/registries/workflow-registry.js";
import { createOperatorProjection } from "../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/run-detail.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { readRunDetail } from "../../../src/backend/runs/queries/run-detail.js";
import { readRunSection } from "../../../src/backend/runs/queries/run-sections.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { executeClaimedRun } from "../../../src/backend/runtime/execution/run-executor.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { runQueuedSpanEvent } from "../../../src/backend/runs/commands/run-queued-span.js";
import { ucpathDriver } from "../../../src/backend/systems/ucpath/driver-declaration.js";
import { projectRunLogs, readRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { SearchPersonOrg } from "../../../src/models/systems/ucpath/search-person-org.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/rules/identity/ids.js";
import { defineTask } from "../../../src/workflow-kit/task.js";
import { createRunExecutorTestWorld, registryWithUcpathSearch } from "../../support/helpers/backend/run-executor-world.js";
import { happySessionHarness, personLookupQueuedRun } from "../../support/helpers/phase1f-executor-harness.js";
import { personLookupModule } from "../../support/helpers/registered-workflows.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

// The first browser step throws and its page cannot be captured: the run stops before any step finishes.
const throwing = defineTask(ucpathDriver, SearchPersonOrg, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run() { throw Object.assign(new Error("Timeout 30000ms exceeded."), { name: "TimeoutError" }); },
});

it("serves a run that failed in its first step with its planned steps and the failure card", async () => {
  const base = happySessionHarness();
  const h = await world.executorHarness({ stores: registryWithUcpathSearch(throwing), sessions: { ...base, factory: { ...base.factory, async open(input) {
    const resource = await base.factory.open(input);
    return { ...resource, screenshot: async () => ({ pageVersion: 1, sessionId: resource.sessionId, observedAt: "2026-08-29T08:00:00.000Z", state: "unavailable" as const, reason: "page-closed" as const }) };
  } } } });
  const { database, clock, stateRoot } = h.authority;
  const claimed = world.enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
  createTimelineEmitter({ repository: database.authority.timelineEvents, clock }).emit(runQueuedSpanEvent({ run: claimed.run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: personLookupModule.descriptor.label }));
  const outcome = await executeClaimedRun({ ...h.deps, taskNotes: createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock }) }, { ...claimed, signal: world.SIGNAL });
  assert.equal(outcome.state, "failed");

  const runReader = new RunRecordService({ database, clock, ids: { uuid: () => "eeeeeeee-0001-4000-8000-000000000001" }, publishQueued: () => {} });
  const descriptors = { resolve: (workflow: string) => workflow === personLookupModule.descriptor.id ? personLookupModule.descriptor : undefined };
  const projection = createOperatorProjection({ database, stateRoot, clock, reader: runReader, appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([personLookupModule.descriptor.contractFingerprint]), ledger: createTransactionHistory(database.authority), descriptors });
  projection.ingestFromTimeline();
  const deps = createOperatorRunDetail({ database, stateRoot, projection, runReader,
    trust: createReceiptService({ database, runReader, descriptors: [personLookupModule.descriptor] }), canonical: { database, reader: runReader, descriptors } });
  const runId = claimed.run.envelope.runId;
  const queued = projection.runFold(runId)?.queued?.ts;
  assert.ok(queued !== undefined, "the run was queued");
  // The queue day is the server-local day, which can sit either side of the UTC date.
  const row = [-1, 0, 1].map(offset => new Date(Date.parse(queued) + offset * 86_400_000).toISOString().slice(0, 10))
    .flatMap(day => projection.buildDashboardDayWire(day).queueSurfaces).find(candidate => candidate.runId === runId);
  assert.ok(row, "the failed run is on its day's queue");
  const client = { runDetail: (id: string, signal?: AbortSignal) => readRunDetail(deps, id, signal),
    runSection: (id: string, section: string, cursor?: string, signal?: AbortSignal) => readRunSection(deps, id, section, cursor, signal) } as unknown as DashboardClient;

  const snapshot = await readRunLogs(client, { row, workflowLabel: "Person Lookup" }, new AbortController().signal);
  const logs = projectRunLogs(snapshot, { artifactUrl: id => `/artifacts/${id}` });

  assert.deepEqual(logs.timeline.map(stage => stage.state), ["failed", ...logs.timeline.slice(1).map(() => "pending")]);
  assert.ok(logs.timeline.length > 1, "every planned step is listed");
  const failure = logs.steps.flatMap(step => step.entries).find(entry => entry.kind === "decision" && entry.decision.state === "failed");
  assert.ok(failure?.kind === "decision", "the failed step carries the failure card");
  assert.equal(failure.decision.footer, "No changes were made.");
  assert.doesNotMatch(failure.decision.title, /^[A-Z_]+$/u, "the card is titled in words, not a code");
  // No capture service is wired here, so the browser refuses the screenshot with an Error.
  assert.equal(failure.decision.unavailableCapture, "No screenshot: the browser could not take it.");
  assert.equal(logs.timeline[0]?.stepId !== undefined, true, "the failed stage jumps to its failure card");
});
