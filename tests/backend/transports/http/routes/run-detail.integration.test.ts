import { createRunExecutorTestWorld } from "../../../../support/helpers/backend/run-executor-world.js";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import * as writeSafety from "../../../../../src/backend/app/composition/dashboard/write-safety.js";
import { readRunDetail, readRunSection, type RunDetailQueryDeps } from "../../../../../src/backend/runs/queries/run-detail.js";
import * as captures from "../../../../../src/backend/runs/queries/run-captures.js";
import * as streams from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { createNoteTimelineWriter } from "../../../../../src/backend/storage/events/note-timeline-writer.js";
import { ItemAttemptHistoryResponseSchema } from "../../../../../src/models/dashboard/item-attempt-history.js";
import { RunDetailSectionResponseSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { searchPartitionDay } from "../../../../../src/models/dashboard/search-calendar.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT, NOW, UUID_5 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { admitFixtureSlot, testRunService } from "../../../../support/fixtures/run-lifecycle-fixtures.js";
import { releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import { createDashboardPortTestWorld } from "../../../../support/helpers/backend/dashboard-port-world.js";
import { failureRecordOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase as SyntheticAuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";
import { measureRunDetailReads } from "../../../../../scripts/bench/run-detail-lane.js";

const {executorHarness, actionBindingCompiled, actionBindingQueuedRun, cleanup } = createRunExecutorTestWorld();

afterEach(cleanup);

const dashboard = createDashboardPortTestWorld(() => vi.restoreAllMocks(), releaseAdmissionFixtures);
afterEach(dashboard.cleanup);

it("serves run routes and the stream panel through the composed navigation lane", async () => {
  const composed: RunDetailQueryDeps[] = [];
  const compose = writeSafety.composeWriteSafety;
  vi.spyOn(writeSafety, "composeWriteSafety").mockImplementation(input => {
    const deps = compose(input);
    composed.push(deps.runDetailDeps);
    return deps;
  });
  const inPanel = new AsyncLocalStorage<boolean>();
  const createHub = streams.createDashboardStreamHub;
  vi.spyOn(streams, "createDashboardStreamHub").mockImplementation(deps => {
    const panels = deps.runPanels;
    assert.ok(panels);
    return createHub({ ...deps, runPanels: { read: (id, signal) => inPanel.run(true, () => panels.read(id, signal)) } });
  });
  const clock = manualClock(new Date(NOW));
  const profile = await dashboard.createProfileFixture(clock);
  const runtime = await dashboard.composeDashboardRuntime({
    ...profile.dashboardInput, lifetimeLock: profile.lifetime, repoRoot: profile.workspace,
    isolation: rebuildRuntimeIsolation, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
  });
  dashboard.cleanups.push(() => runtime.stop());
  const { runtime: owner, token } = profile.dashboardInput.profile;
  const { database } = owner.selectedContext(token);
  assert.equal(composed.length, 1);
  const [detailDeps] = composed;
  database.authority.configSnapshots.insert(CONFIG_SNAPSHOT);
  const run = RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: { ...QUEUED_RUN.envelope, descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint },
    input: { ...QUEUED_RUN.input, workbookReferences: [] },
  });
  database.authority.runs.enqueue(run);
  const { runId, workflow, traceId, attempt } = run.envelope;
  const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
  for (let index = 0; index < 201; index++) {
    notes.emitRunLog({ workflow, address: { runId, traceId, attempt, spanPath: traceId },
      level: "step", message: `Recorded note ${String(index)}` }, run);
  }
  const ended = testRunService(database, clock).transition({ commandId: randomUUID(), runId, expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome: "discarded", endedAt: NOW } });
  assert.equal(ended.state, "applied");

  const config = database.authority.runtimeConfig.get();
  assert.ok(config);
  const failedId = randomUUID();
  const queued = RunRecordSchema.parse({ ...run, envelope: { ...run.envelope, runId: failedId, itemId: failedId,
    configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId, traceId: "pl-170000-2223" } });
  database.authority.runs.enqueue(queued);
  const { workerId } = database.withAuthorityTransaction(repositories => admitFixtureSlot(repositories, workflow, 1, NOW));
  const claimed = database.authority.runs.claimNext({ workflow, workerId, now: NOW });
  assert.ok(claimed.state === "claimed" && claimed.run.envelope.runId === failedId);
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const clockFacts = { workerId, claimedAt: NOW, heartbeatAt: NOW };
  const validating = database.authority.runs.transition({ runId: failedId, expectedVersion: claimed.run.version, claim,
    lifecycle: { ...clockFacts, state: "validating" }, now: NOW });
  assert.equal(validating.state, "applied");
  const running = database.authority.runs.transition({ runId: failedId, expectedVersion: validating.run.version, claim,
    lifecycle: { ...clockFacts, state: "running", currentNodeId: "crm-dates" }, now: NOW });
  assert.equal(running.state, "applied");
  const failure = { ...failureRecordOf({ seed: 41, code: "CRM_UNAVAILABLE" }), runId: failedId, traceId: queued.envelope.traceId,
    nodeId: "crm-dates", taskId: "crm/read-onboarding-dates", occurredAt: NOW };
  database.terminalizeFailure(personLookupDescriptor, { failure, authorization: {
    kind: "failed", runId: failedId, workflowId: workflow, attempt, claim, authorizedAt: NOW,
    descriptorVersion: queued.envelope.descriptorVersion, contractFingerprint: queued.envelope.contractFingerprint,
    expectedVersion: running.run.version, failureId: failure.failureId,
  } });
  const origin = `http://127.0.0.1:${String(runtime.port)}`;
  const path = `${origin}/api/v1/runs/${runId}`;
  const get = async (suffix: string, runPath = path) => {
    const response = await fetch(runPath + suffix);
    const body = await response.text();
    assert.equal(response.status, 200, `${suffix}: ${body}`);
    return body;
  };
  assert.equal(database.authority.evidenceReceipts.findByRun(runId), undefined);
  const derive = vi.spyOn(database, "withAuthorityTransaction");
  const receipt = await get("/receipt");
  assert.equal(derive.mock.calls.length, 1);
  derive.mockRestore();
  const storedReceipt = database.authority.evidenceReceipts.findByRun(runId);
  assert.ok(storedReceipt);
  const itemHistory = detailDeps.itemAttemptHistory;
  assert.ok(itemHistory);
  const firstLogs = await readRunSection(detailDeps, runId, "logs");
  assert.ok(firstLogs.section === "logs" && firstLogs.payload.nextCursor.state === "present");
  const cursor = firstLogs.payload.nextCursor.value;
  const history = ItemAttemptHistoryResponseSchema.parse(itemHistory.read(runId, { limit: 1 }));
  assert.equal(history.state, "available");
  const failed = await readRunSection(detailDeps, failedId, "failure");
  assert.ok(failed.section === "failure" && failed.payload.state === "available");
  const expected = [
    ["", JSON.stringify(await readRunDetail(detailDeps, runId))],
    ["/logs", JSON.stringify(firstLogs)],
    [`/logs?cursor=${encodeURIComponent(cursor)}`, JSON.stringify(await readRunSection(detailDeps, runId, "logs", cursor))],
    ["/workbook-writes", JSON.stringify(await readRunSection(detailDeps, runId, "workbook-writes"))],
    ["/failure", JSON.stringify(await readRunSection(detailDeps, runId, "failure"))],
    ["/receipt", receipt],
    ["/attempt-history?limit=1", JSON.stringify(history)],
  ] as const;

  const inCapture = new AsyncLocalStorage<boolean>();
  const readCaptures = captures.readRunCaptureAvailability;
  vi.spyOn(captures, "readRunCaptureAvailability").mockImplementation((...args) =>
    inCapture.run(true, () => readCaptures(...args)));
  let guardHttp = true;
  const refuse = () => { throw new Error("request-thread run read touched authority"); };
  const readSnapshot = database.withAuthorityReadSnapshot.bind(database);
  vi.spyOn(database, "withAuthorityReadSnapshot").mockImplementation(read => {
    if ((guardHttp || inPanel.getStore() === true) && inCapture.getStore() !== true) refuse();
    return readSnapshot(read);
  });
  vi.spyOn(database, "withAuthorityTransaction").mockImplementation(refuse);
  vi.spyOn(database, "listItemAttemptHistorySources").mockImplementation(refuse);
  vi.spyOn(detailDeps.projection, "runFold").mockImplementation(refuse);
  vi.spyOn(detailDeps.projection, "runLogSnapshot").mockImplementation(refuse);
  await assert.rejects(readRunDetail(detailDeps, runId), /request-thread run read touched authority/u);
  for (const [suffix, body] of expected) assert.equal(await get(suffix), body, suffix);
  assert.equal(await get("/failure", `${origin}/api/v1/runs/${failedId}`), JSON.stringify(failed));

  const logs = RunDetailSectionResponseSchema.parse(JSON.parse(await get("/logs")));
  assert.ok(logs.section === "logs" && logs.payload.nextCursor.state === "present");
  assert.equal(logs.payload.nextCursor.value, cursor);
  guardHttp = false;
  const measured = await measureRunDetailReads(origin, runId, searchPartitionDay(new Date(run.envelope.enqueuedAt)));
  assert.equal(measured.panel.value.detail.runId, runId);
  assert.equal(measured.panel.value.logs.rows?.length, 201);
  assert.deepEqual(measured.panel.value.sections.map(section => section.section), ["workbook-writes"]);
});

describe("recorded operation display data", () => {


  it("keeps a recorded operation display snapshot as plain data across close and reopen", async () => {
    const harness = await executorHarness({ descriptor: actionBindingCompiled.descriptor });
    const { database, clock, path } = harness.authority;
    const plain = actionBindingQueuedRun(clock.now().toISOString());
    const snapshot = { contentDigest: "0".repeat(64), invocations: [] };
    const queued = { ...plain, envelope: { ...plain.envelope, operationDisplayCapability: "complete" as const, operationDisplaySnapshot: snapshot } };
    database.authority.runs.enqueue(queued);
    const authorityGeneration = database.getMeta().authorityGeneration;
    harness.authority.closeDatabase();

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

});
