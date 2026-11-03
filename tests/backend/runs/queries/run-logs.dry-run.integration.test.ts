import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { workflowModuleOf, childWorkflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { dataOriginViewsOf } from "../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { buildRunLogsSection } from "../../../../src/backend/runs/queries/run-logs.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("retains cancelled preview unavailability while a cancelled read-only child stays an ordinary read", async () => {
  const f = await world.fixture({ coordinator: true, dryRun: true, record: true });
  const parent = f.database.authority.runs.get(f.parentRun.envelope.runId); assert.ok(parent);
  const cancelled = f.canonical.kernel.execute({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard",
    requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(),
    target: { runId: parent.envelope.runId, expectedVersion: parent.version } });
  assert.equal(cancelled.state, "applied");
  const descriptors = { resolve: f.resolve };
  const projection = createOperatorProjection({ database: f.database, reader: f.canonical.lifecycle, descriptors,
    stateRoot: f.harness.authority.stateRoot, clock: f.clock, appVersion: "0.1.0", descriptorSetHash: parent.envelope.contractFingerprint,
    ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } } });
  projection.rebuildFromTimeline();
  const detail = createOperatorRunDetail({ database: f.database, runReader: f.canonical.lifecycle, projection,
    stateRoot: f.harness.authority.stateRoot, canonical: { database: f.database, reader: f.canonical.lifecycle, descriptors } });
  const modules = [workflowModuleOf("emergency-contact"), childWorkflowModuleOf("emergency-contact", "ocr")];
  const deps = { ...detail, descriptors: { resolve: (id: string) => {
    const module = modules.find(module => module.descriptor.id === id);
    return module === undefined ? undefined : { ...module.descriptor, dataOrigins: dataOriginViewsOf(module) };
  } } };
  for (const runId of [parent.envelope.runId, f.run.envelope.runId]) {
    const run = f.database.authority.runs.get(runId); assert.ok(run?.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "cancelled");
    assert.equal(run.envelope.dryRun, true);
    assert.ok(f.database.authority.runResults.get(runId));
    const logs = buildRunLogsSection(deps, runId, projection.runFold(runId), run);
    assert.ok(logs.section === "logs");
    assert.deepEqual(logs.payload.dryRunPreview, runId === parent.envelope.runId
      ? { state: "unavailable", reason: "preview-not-completed" } : undefined);
    assert.deepEqual(f.database.authority.writeIntents.countDryRunEvidenceByRun(runId),
      { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  }
});
