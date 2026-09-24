import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { createRuntimeVersionChanges } from "../../src/core/archive-runtime-version-changes.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { QueueSurfaceWireSchema } from "../../src/domain/dashboard/projection.js";
import { RunIdSchema } from "../../src/domain/ids.js";
import { createRunLifecycleStorage } from "../../src/infra/sqlite/lifecycle-storage.js";
import { foundationFixture, id, NOW } from "./database-foundation/fixtures.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";
import { ARCHIVED_RUN_WITH_SECTIONS } from "../fixtures/archive-fixtures.js";
import type { ArchiveRunSnapshot } from "../../src/services/archive/archive-service.js";

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

describe("runtime version change transfer", () => {
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
