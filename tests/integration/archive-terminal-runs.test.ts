import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { archiveFixture } from "../unit/archive-transfer/fixtures.js";
import { id, NOW } from "../unit/database-foundation/fixtures.js";
import { CommandRequestSchema } from "../../src/domain/commands.js";
import { createRunLifecycleStorage } from "../../src/infra/sqlite/lifecycle-storage.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../fixtures/phase1c-contract-fixtures.js";
import { queryArchiveReports } from "../../src/server/dashboard/queries/archive-reports.js";

function request(f: ReturnType<typeof archiveFixture>, over: Record<string, unknown> = {}) {
  const run = f.database.authority.runs.get(f.base.run.envelope.runId);
  const command = CommandRequestSchema.parse({ commandId: id(98900), requestedAt: NOW, requestedBy: "local-operator", source: "queue",
    family: "run", type: "archive", target: { runId: f.base.run.envelope.runId, expectedVersion: run?.version ?? 2 }, ...over });
  if (command.type !== "archive") throw new Error("expected archive request");
  return command;
}

describe("manual terminal archive", () => {
  it("transfers a saved report, preserves versions and identity, and replays exactly", () => {
    const f = archiveFixture({ registeredRuntimeVersion: true });
    try {
      f.terminal(); const command = request(f);
      const version = f.database.readRuntimeVersionAuthority();
      assert.equal(f.kernel.execute(command).state, "applied");
      assert.equal(f.database.authority.runs.get(command.target.runId), undefined);
      assert.equal(f.database.authority.deletedRuns.get(command.target.runId), undefined);
      assert.deepEqual(f.database.readRuntimeVersionAuthority(), version);
      const report = createRunLifecycleStorage(f.database).readReport(command.target.runId);
      assert.ok(report); assert.equal(report.content.manualArchive?.commandId, command.commandId);
      assert.equal(queryArchiveReports(createRunLifecycleStorage(f.database), { limit: 20 }).items.some(item => "runId" in item && item.runId === command.target.runId), true);
      f.reopen(); assert.equal(f.kernel.execute(command).state, "already-applied");
      assert.deepEqual(createRunLifecycleStorage(f.database).readReport(command.target.runId), report);
      assert.equal(f.kernel.execute({ ...command, commandId: id(98901) }).state, "rejected");
    } finally { f.dispose(); }
  });
  it("refuses an active descendant, then transfers the complete terminal group atomically", () => {
    const f = archiveFixture();
    try {
      f.terminal(); const command = request(f), root = f.database.authority.runs.get(command.target.runId); assert.ok(root);
      const child = RunRecordSchema.parse({ ...root, envelope: { ...root.envelope, runId: id(98910), itemId: id(98911),
        parent: { runId: root.envelope.runId, tracePrefix: root.envelope.traceId, edgeId: "manual-archive" }, shape: "operation-member" },
        lifecycle: { state: "queued" }, version: 1, claimGeneration: 0 });
      f.database.authority.runs.enqueue(child);
      f.database.authority.delegationManifests.insert({ manifestId: id(98912), parentRunId: root.envelope.runId, edgeId: "manual-archive",
        inputSchemaHash: root.input.ingressSchemaHash, resultSchemaHash: root.input.ingressSchemaHash, cardinality: "one", join: "one",
        policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
        children: [{ dependencyId: id(98913), childRunId: child.envelope.runId, childItemId: child.envelope.itemId, canonicalInputFingerprint: "a".repeat(64) }], createdAt: NOW, manifestFingerprint: "a".repeat(64) });
      f.database.authority.dependencies.insert({ dependencyId: id(98913), manifestId: id(98912), edgeId: "manual-archive",
        parentRunId: root.envelope.runId, childRunId: child.envelope.runId, childItemId: child.envelope.itemId,
        policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" }, state: "active", version: 1, createdAt: NOW, updatedAt: NOW });
      assert.equal(f.kernel.execute(command).state, "rejected");
      assert.equal(f.database.lifecycleArchive().read(root.envelope.runId), undefined);
      f.database.authority.runs.transition({ runId: child.envelope.runId, expectedVersion: 1,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
      assert.equal(f.kernel.execute({ ...command, target: { runId: child.envelope.runId, expectedVersion: 2 } }).state, "rejected");
      f.failAfter("saveReport"); assert.throws(() => f.kernel.execute(command), /injected-saveReport/);
      assert.ok(f.database.authority.runs.get(root.envelope.runId)); assert.ok(f.database.authority.runs.get(child.envelope.runId));
      f.reopen(); const adopted = { ...command, commandId: id(98914) };
      f.failAfter("publishReport"); assert.throws(() => f.kernel.execute(adopted), /injected-publishReport/);
      f.reopen(); assert.equal(queryArchiveReports(createRunLifecycleStorage(f.database), { limit: 20 }).items.length, 2);
      assert.equal(f.kernel.execute(adopted).state, "already-applied");
    } finally { f.dispose(); }
  });
  it("retains the permanent write fence after manual transfer", () => {
    const f = archiveFixture();
    try {
      const owner = f.database.authority.runs.get(f.base.run.envelope.runId); assert.ok(owner);
      const intent = { ...WRITE_INTENT_ATTEMPTING, runId: owner.envelope.runId, workflowId: owner.envelope.workflow, itemId: owner.envelope.itemId };
      f.database.authority.writeIntents.fenceAttempt({ intent, attempt: { ...WRITE_ATTEMPT, runId: owner.envelope.runId } });
      f.database.authority.runs.transition({ runId: owner.envelope.runId, expectedVersion: owner.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
      const result = f.kernel.execute({ ...request(f), target: { runId: owner.envelope.runId, expectedVersion: owner.version + 1 } });
      assert.equal(result.state, "applied");
      assert.deepEqual(f.database.authority.writeIntents.findByPermanentKey(WRITE_INTENT_ATTEMPTING.system, WRITE_INTENT_ATTEMPTING.idempotencyKey), intent);
      assert.ok(createRunLifecycleStorage(f.database).readReport(owner.envelope.runId));
    } finally { f.dispose(); }
  });
  it("refuses active roots and stale revisions before capture", () => {
    const f = archiveFixture();
    try {
      assert.equal(f.kernel.execute(request(f)).state, "rejected");
      f.terminal(); const command = request(f);
      assert.equal(f.kernel.execute({ ...command, target: { ...command.target, expectedVersion: command.target.expectedVersion - 1 } }).state, "conflict");
      assert.equal(createRunLifecycleStorage(f.database).readReport(command.target.runId), undefined);
      assert.ok(f.database.authority.runs.get(command.target.runId));
    } finally { f.dispose(); }
  });
  for (const step of ["saveReport", "verifyReport", "transfer", "audit", "publishReport"]) {
    it(`recovers exact replay after ${step} failure`, () => {
      const f = archiveFixture();
      try {
        f.terminal(); const command = request(f); f.failAfter(step);
        assert.throws(() => f.kernel.execute(command), new RegExp(`injected-${step}`));
        assert.equal(f.database.authority.runs.get(command.target.runId) !== undefined, step !== "publishReport");
        f.reopen();
        if (step === "publishReport") {
          assert.equal(queryArchiveReports(createRunLifecycleStorage(f.database), { limit: 20 }).items.length, 1);
        }
        assert.ok(["applied", "already-applied"].includes(f.kernel.execute(command).state));
        assert.ok(createRunLifecycleStorage(f.database).readReport(command.target.runId));
      } finally { f.dispose(); }
    });
  }
  it("fences an interrupted capture against source edits and divergent commands", () => {
    const f = archiveFixture();
    try {
      f.terminal(); const command = request(f); f.failAfter("verifyReport");
      assert.throws(() => f.kernel.execute(command), /injected-verifyReport/);
      const run = f.database.authority.runs.get(command.target.runId); assert.ok(run);
      assert.throws(() => f.database.authority.runs.updatePresentation({ runId: command.target.runId, expectedVersion: run.version,
        displayName: "Changed", now: NOW }), /manual-archive-source-applying/);
      assert.throws(() => f.kernel.execute({ ...command, requestedBy: "another-operator" }), /manual-archive-replay-conflict/);
      f.reopen();
      const replacement = { ...command, commandId: id(98904), requestedAt: "2026-09-29T20:00:00.000Z" };
      assert.equal(f.kernel.execute(replacement).state, "applied");
      assert.equal(f.kernel.execute(replacement).state, "already-applied");
      assert.ok(createRunLifecycleStorage(f.database).readReport(command.target.runId));
    } finally { f.dispose(); }
  });
});
