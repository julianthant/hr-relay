import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { createRuntimeVersionChanges } from "../../src/core/archive-runtime-version-changes.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { QueueSurfaceWireSchema } from "../../src/domain/dashboard/projection.js";
import { RunIdSchema } from "../../src/domain/ids.js";
import { createRunLifecycleStorage } from "../../src/infra/sqlite/lifecycle-storage.js";
import { foundationFixture, id, NOW } from "../unit/database-foundation/fixtures.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";
import { ARCHIVED_RUN_WITH_SECTIONS } from "../fixtures/archive-fixtures.js";
import type { ArchiveRunSnapshot } from "../../src/backend/runs/archive/archive-service.js";
import { queryArchiveReports } from "../../src/backend/runs/dashboard/queries/archive-reports.js";
import { savedArchiveRuntimeVersions } from "../../src/backend/runs/dashboard/queries/archive.js";
import { archiveFixture } from "../unit/archive-transfer/fixtures.js";
import { CommandRequestSchema } from "../../src/domain/commands.js";

function fixture(afterTransferStep?: (runId: string, step: "captured" | "verified" | "cleaned" | "published") => void) {
  const f = foundationFixture({ registeredRuntimeVersion: true });
  const runId = id(9901);
  f.db.registerRuntimeVersionWorkflows(["person-lookup", "other-workflow"]);
  const queued = RunRecordSchema.parse({ ...QUEUED_RUN,
    envelope: { ...QUEUED_RUN.envelope, runId, workflow: "other-workflow", itemId: runId },
    runtimeVersion: { dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 0 } },
  });
  f.db.authority.runs.enqueue(queued);
  const terminal = f.db.authority.runs.transition({ runId, expectedVersion: queued.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
  assert.equal(terminal.state, "applied");
  const source = ARCHIVED_RUN_WITH_SECTIONS;
  assert.ok(source.sections);
  const snapshot = (selectedRunId: string): ArchiveRunSnapshot => ({
    row: QueueSurfaceWireSchema.parse({ ...source.row, session: { state: "absent", reason: "Synthetic" }, runId: RunIdSchema.parse(selectedRunId) }),
    detail: { ...source.detail, header: { ...source.detail.header, runId: RunIdSchema.parse(selectedRunId) } },
    failure: source.failure, sections: source.sections!,
  });
  const service = createRuntimeVersionChanges({ database: f.db, clock: f.clock,
    ids: { uuid: () => id(9902) },
    archiveSnapshots: { snapshot, snapshotBatch: runIds => new Map(runIds.map(id => [id, snapshot(id)])) },
    afterTransferStep,
  });
  return { f, runId, service };
}

function terminalizeRunning(f: ReturnType<typeof foundationFixture>) {
  if (f.run.lifecycle.state !== "running") throw new Error("expected running fixture");
  const result = f.db.authority.runs.transition({ runId: f.run.envelope.runId, expectedVersion: f.run.version,
    claim: { workerId: f.run.lifecycle.workerId, claimGeneration: f.run.claimGeneration },
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
  assert.equal(result.state, "applied");
}

function enqueueTerminal(f: ReturnType<typeof foundationFixture>, runId: string, workflow: string) {
  const queued = RunRecordSchema.parse({ ...QUEUED_RUN,
    envelope: { ...QUEUED_RUN.envelope, runId, workflow, itemId: runId },
    runtimeVersion: { dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 0 } },
  });
  f.db.authority.runs.enqueue(queued);
  const result = f.db.authority.runs.transition({ runId, expectedVersion: queued.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
  assert.equal(result.state, "applied");
}

function enqueueTerminalChild(f: ReturnType<typeof foundationFixture>, childId: string, workflow: string = f.run.envelope.workflow) {
  const parentId = f.run.envelope.runId;
  const child = RunRecordSchema.parse({ ...f.run,
    envelope: { ...f.run.envelope, runId: childId, itemId: childId, workflow,
      shape: "operation-member", parent: { runId: parentId, tracePrefix: f.run.envelope.traceId, edgeId: "archive-child" } },
    lifecycle: { state: "queued" }, version: 1, claimGeneration: 0,
  });
  f.db.authority.runs.enqueue(child);
  const result = f.db.authority.runs.transition({ runId: childId, expectedVersion: child.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
  assert.equal(result.state, "applied");
}

describe("runtime version change transfer", () => {
  it("uses the one command journal for review, apply and replay", () => {
    const f = archiveFixture({ registeredRuntimeVersion: true });
    try {
      f.terminal();
      const planRequest = CommandRequestSchema.parse({ commandId: id(9980), requestedAt: NOW,
        requestedBy: "local-operator", source: "archive", family: "version-archive", type: "plan-runtime-version",
        target: { scope: { kind: "dashboard" } } });
      assert.equal(f.kernel.execute(planRequest).state, "applied");
      const change = f.database.readRuntimeVersionChange(planRequest.commandId);
      assert.ok(change);
      const applyRequest = CommandRequestSchema.parse({ commandId: id(9981), requestedAt: NOW,
        requestedBy: "local-operator", source: "archive", family: "version-archive", type: "apply-runtime-version",
        target: { changeId: change.changeId, reviewFingerprint: change.reviewFingerprint } });
      assert.equal(f.kernel.execute(applyRequest).state, "applied");
      assert.equal(f.kernel.execute(applyRequest).state, "already-applied");
      assert.deepEqual(f.database.readRuntimeVersionAuthority().state.dashboard, { major: 2, minor: 0 });
      assert.equal(f.database.readRuntimeVersionChange(change.changeId)?.applicationCommandId, applyRequest.commandId);
      assert.equal(createRunLifecycleStorage(f.database).readReport(f.base.run.envelope.runId)?.content.runtimeVersion?.state, "stamped");
    } finally { f.dispose(); }
  });

  it("serves the exact retained apply request after an interrupted transfer and restart", () => {
    const f = archiveFixture({ registeredRuntimeVersion: true });
    try {
      f.terminal();
      const planRequest = CommandRequestSchema.parse({ commandId: id(9984), requestedAt: NOW,
        requestedBy: "local-operator", source: "archive", family: "version-archive", type: "plan-runtime-version",
        target: { scope: { kind: "dashboard" } } });
      assert.equal(f.kernel.execute(planRequest).state, "applied");
      const change = f.database.readRuntimeVersionChange(planRequest.commandId);
      assert.ok(change);
      const applyRequest = CommandRequestSchema.parse({ commandId: id(9985), requestedAt: NOW,
        requestedBy: "local-operator", source: "archive", family: "version-archive", type: "apply-runtime-version",
        target: { changeId: change.changeId, reviewFingerprint: change.reviewFingerprint } });
      f.failAfter("verified");
      assert.throws(() => f.kernel.execute(applyRequest), /injected-verified/u);
      const read = () => savedArchiveRuntimeVersions({ storage: createRunLifecycleStorage(f.database),
        descriptors: { list: () => [{ id: "person-lookup", label: "Person lookup", code: "PL", version: 1,
          contractFingerprint: "a".repeat(64) }] } });
      const applying = read().changes.find(row => row.changeId === change.changeId);
      assert.equal(applying?.state, "applying");
      assert.deepEqual(applying?.resumeRequest, applyRequest);
      f.reopen();
      assert.deepEqual(read().changes.find(row => row.changeId === change.changeId)?.resumeRequest, applyRequest);
      assert.equal(f.kernel.execute(applyRequest).state, "applied");
      assert.equal(read().changes.find(row => row.changeId === change.changeId)?.resumeRequest, undefined);
    } finally { f.dispose(); }
  });

  it("rejects a changed apply command after transfer finishes before audit", () => {
    const f = archiveFixture({ registeredRuntimeVersion: true });
    try {
      f.terminal();
      const planRequest = CommandRequestSchema.parse({ commandId: id(9982), requestedAt: NOW,
        requestedBy: "local-operator", source: "archive", family: "version-archive", type: "plan-runtime-version",
        target: { scope: { kind: "dashboard" } } });
      assert.equal(f.kernel.execute(planRequest).state, "applied");
      const change = f.database.readRuntimeVersionChange(planRequest.commandId);
      assert.ok(change);
      const applyRequest = CommandRequestSchema.parse({ commandId: id(9983), requestedAt: NOW,
        requestedBy: "local-operator", source: "archive", family: "version-archive", type: "apply-runtime-version",
        target: { changeId: change.changeId, reviewFingerprint: change.reviewFingerprint } });
      f.failAfter("audit");
      assert.throws(() => f.kernel.execute(applyRequest), /injected-audit/);
      assert.equal(f.database.readRuntimeVersionChange(change.changeId)?.state, "applied");
      f.reopen();
      const divergent = f.kernel.execute({ ...applyRequest, requestedAt: "2026-09-09T12:00:01.000Z" });
      assert.equal(divergent.state, "rejected");
      assert.equal(f.kernel.execute(applyRequest).state, "applied");
      assert.equal(f.kernel.execute(applyRequest).state, "already-applied");
    } finally { f.dispose(); }
  });

  it("archives only the selected workflow and publishes its next minor version", () => {
    const { f, runId, service } = fixture();
    try {
      const planned = service.plan({ kind: "workflows", workflowIds: ["other-workflow"] }, "local-operator");
      assert.equal(planned.state, "planned");
      const applied = service.apply(planned.changeId);
      assert.equal(applied.state, "applied");
      assert.deepEqual(applied.completedRunIds, [runId]);
      assert.equal(f.db.authority.runs.get(runId), undefined);
      assert.ok(f.db.authority.runs.get(f.run.envelope.runId));
      const report = createRunLifecycleStorage(f.db).readReport(runId);
      assert.equal(report?.content.schemaVersion, 2);
      assert.deepEqual(report?.content.runtimeVersion, {
        state: "stamped", dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 0 },
      });
      const authority = f.db.readRuntimeVersionAuthority();
      assert.deepEqual(authority.state.dashboard, { major: 1, minor: 0 });
      assert.deepEqual(authority.state.workflows.find(row => row.workflowId === "other-workflow")?.version, { major: 1, minor: 1 });
      assert.deepEqual(authority.state.workflows.find(row => row.workflowId === "person-lookup")?.version, { major: 1, minor: 0 });
      const storage = createRunLifecycleStorage(f.db);
      assert.deepEqual(queryArchiveReports(storage, { limit: 5, search: report.content.title.slice(0, 5) }).items.length, 1);
      for (const source of report.content.sources) {
        assert.deepEqual(queryArchiveReports(storage, { limit: 5, search: source.digest }).items, []);
      }
      assert.equal(queryArchiveReports(storage, { limit: 5, search: report.content.transferId }).items.length, 1);
      assert.deepEqual(queryArchiveReports(storage, { limit: 5, dashboardVersion: { major: 1, minor: 0 },
        workflowVersion: { major: 1, minor: 0 }, versionState: "stamped" }).items.map(item => item.state === "available" ? item.runId : "unavailable"), [runId]);
      assert.deepEqual(queryArchiveReports(storage, { limit: 5, workflowVersion: { major: 1, minor: 1 } }).items, []);
      assert.deepEqual(queryArchiveReports(storage, { limit: 5, versionState: "unrecorded" }).items, []);
      const index = savedArchiveRuntimeVersions({ storage, descriptors: { list: () => [
        { id: "person-lookup", label: "Person lookup", code: "PL", version: 1, contractFingerprint: "a".repeat(64) },
        { id: "other-workflow", label: "Other workflow", code: "OW", version: 1, contractFingerprint: "a".repeat(64) },
      ] } });
      assert.deepEqual(index.dashboard, { major: 1, minor: 0 });
      assert.deepEqual(index.workflows.find(row => row.workflowId === "other-workflow")?.version, { major: 1, minor: 1 });
      assert.equal(index.changes[0]?.state, "applied");
      assert.equal(index.changes[0]?.reviewFingerprint, planned.reviewFingerprint);
      assert.deepEqual(index.changes[0]?.completedRunIds, [runId]);
      assert.deepEqual(service.apply(planned.changeId), applied);
    } finally { f.dispose(); }
  });

  it("bumps several selected workflows while leaving an unselected workflow live", () => {
    const { f, runId, service } = fixture();
    try {
      f.db.registerRuntimeVersionWorkflows(["third-workflow"]);
      const thirdRunId = id(9903);
      enqueueTerminal(f, thirdRunId, "third-workflow");
      const planned = service.plan({ kind: "workflows", workflowIds: ["other-workflow", "third-workflow"] }, "local-operator");
      const applied = service.apply(planned.changeId);
      assert.equal(applied.state, "applied");
      assert.deepEqual(applied.completedRunIds, [runId, thirdRunId]);
      assert.ok(f.db.authority.runs.get(f.run.envelope.runId));
      const state = f.db.readRuntimeVersionAuthority().state;
      assert.deepEqual(state.dashboard, { major: 1, minor: 0 });
      assert.deepEqual(Object.fromEntries(state.workflows.map(({ workflowId, version }) => [workflowId, version.minor])),
        { "other-workflow": 1, "person-lookup": 0, "third-workflow": 1 });
    } finally { f.dispose(); }
  });

  it("refuses an all-workflow bump while any selected run is active", () => {
    const { f, runId, service } = fixture();
    try {
      const planned = service.plan({ kind: "dashboard" }, "local-operator");
      assert.ok(planned.members.some(member => member.runId === f.run.envelope.runId && member.state !== "terminal"));
      assert.throws(() => service.apply(planned.changeId), /runtime-version-active-blockers/);
      assert.ok(f.db.authority.runs.get(runId));
      assert.equal(f.db.readRuntimeVersionAuthority().claim, undefined);
      assert.deepEqual(f.db.readRuntimeVersionAuthority().state.dashboard, { major: 1, minor: 0 });
    } finally { f.dispose(); }
  });

  it("archives all workflows before publishing the dashboard major version", () => {
    const { f, runId, service } = fixture();
    try {
      terminalizeRunning(f);
      const planned = service.plan({ kind: "dashboard" }, "local-operator");
      const applied = service.apply(planned.changeId);
      assert.equal(applied.state, "applied");
      assert.deepEqual(applied.completedRunIds, [f.run.envelope.runId, runId].sort());
      const state = f.db.readRuntimeVersionAuthority().state;
      assert.deepEqual(state.dashboard, { major: 2, minor: 0 });
      assert.ok(state.workflows.every(row => row.version.major === 2 && row.version.minor === 0));
    } finally { f.dispose(); }
  });

  it("transfers terminal children before their parent", () => {
    const { f, service } = fixture();
    try {
      const childId = id(9904);
      enqueueTerminalChild(f, childId);
      terminalizeRunning(f);
      const planned = service.plan({ kind: "dashboard" }, "local-operator");
      const applied = service.apply(planned.changeId);
      assert.equal(applied.state, "applied");
      assert.equal(f.db.authority.runs.get(childId), undefined);
      assert.equal(f.db.authority.runs.get(f.run.envelope.runId), undefined);
      assert.ok(createRunLifecycleStorage(f.db).readReport(childId));
      assert.ok(createRunLifecycleStorage(f.db).readReport(f.run.envelope.runId));
    } finally { f.dispose(); }
  });

  it("refuses a selected parent when its child is outside the archive scope", () => {
    const { f, service } = fixture();
    try {
      const childId = id(9905);
      enqueueTerminalChild(f, childId, "other-workflow");
      terminalizeRunning(f);
      const planned = service.plan({ kind: "workflows", workflowIds: ["person-lookup"] }, "local-operator");
      assert.throws(() => service.apply(planned.changeId), /runtime-version-child-out-of-scope/);
      assert.equal(f.db.readRuntimeVersionAuthority().claim, undefined);
      assert.ok(f.db.authority.runs.get(childId));
      assert.ok(f.db.authority.runs.get(f.run.envelope.runId));
    } finally { f.dispose(); }
  });

  it("refuses a selected child when its live parent is outside the archive scope", () => {
    const { f, service } = fixture();
    try {
      const childId = id(9906);
      enqueueTerminalChild(f, childId, "other-workflow");
      const planned = service.plan({ kind: "workflows", workflowIds: ["other-workflow"] }, "local-operator");
      assert.throws(() => service.apply(planned.changeId), /runtime-version-parent-out-of-scope/);
      assert.equal(f.db.readRuntimeVersionAuthority().claim, undefined);
      assert.ok(f.db.authority.runs.get(childId));
      assert.ok(f.db.authority.runs.get(f.run.envelope.runId));
    } finally { f.dispose(); }
  });

  for (const interruption of ["captured", "verified", "cleaned", "published"] as const) {
    it(`resumes the exact frozen transfer after ${interruption}`, () => {
      let fail = true;
      const { f, runId, service } = fixture((_runId, step) => {
        if (step === interruption && fail) { fail = false; throw new Error("injected-interruption"); }
      });
      try {
        const planned = service.plan({ kind: "workflows", workflowIds: ["other-workflow"] }, "local-operator");
        assert.throws(() => service.apply(planned.changeId), /injected-interruption/);
        assert.equal(f.db.readRuntimeVersionChange(planned.changeId)?.state, "applying");
        assert.deepEqual(f.db.readRuntimeVersionAuthority().state.dashboard, { major: 1, minor: 0 });
        const applied = service.apply(planned.changeId);
        assert.equal(applied.state, "applied");
        assert.deepEqual(applied.completedRunIds, [runId]);
        assert.equal(f.db.authority.runs.get(runId), undefined);
      } finally { f.dispose(); }
    });
  }
});
