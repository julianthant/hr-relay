import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createCommandKernel } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { createStartPlanService } from "../../../../../../src/backend/runs/commands/start-plan-service.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../../../support/fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../../../../support/fixtures/archive-fixtures.js";
import { singleAppliedRunId } from "../../../../../support/fixtures/operator-command-fixtures.js";
import { settingsFixture } from "../../../../../support/helpers/backend/settings-activation-fixture.js";

it("refuses stale reviewed plans atomically, freshly confirms current settings and preserves accepted replay", () => {
  const f = settingsFixture();
  try {
    const descriptors = { resolve: (id: string) => id === personLookupDescriptor.id ? personLookupDescriptor : undefined };
    const kernel = createCommandKernel({ lifecycle: f.service, appVersion: "0.1.0", archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
      configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
      authority: f.database, clock: f.clock, ids: { uuid: randomUUID }, descriptors,
      explorerEdits: { apply: () => { throw new Error("unused explorer"); } },
      writeResolution: { resolvePresent: () => { throw new Error("unused write"); }, resolveAbsent: () => { throw new Error("unused write"); } },
      workerRuntime: { planWorkerCount: () => ({ state: "accepted", workerIds: ["settings-worker"] }),
        spawnWorker: () => ({ state: "accepted" }), refreshBrowser: () => ({ state: "accepted" }), reopenBrowser: () => ({ state: "accepted" }) },
    });
    const planner = createStartPlanService({ authority: f.database, authorityRead: f.database, descriptors,
      clock: f.clock, ids: { uuid: randomUUID }, planTtlMs: 600_000, configFingerprint: f.snapshot.fingerprint,
      configSnapshotId: f.snapshot.configSnapshotId, plannedBy: "local-operator" });
    const plan = () => planner.plan({ workflowId: personLookupDescriptor.id, submissions: [{ emplId: "10800000" }],
      dryRun: false, browserMode: "headless", captureBrowserScreenshots: false });
    const command = (planned: ReturnType<typeof plan>) => ({ commandId: randomUUID(), requestedAt: f.clock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
      target: { workflowId: planned.workflowId, startPlanId: planned.startPlanId, expectedVersion: planned.expectedVersion },
      payload: planned.fingerprints });
    const old = plan(); const stale = command(old);
    f.save({ "timeouts.taskMs": { set: 90_000 } });
    const generation = f.database.getMeta().authorityGeneration;
    const refusal = kernel.execute(stale); assert.ok(refusal.state === "rejected"); assert.equal(refusal.code, "replan-required");
    assert.equal(f.database.authority.startPlans.get(old.startPlanId)?.consumedBy, undefined);
    assert.deepEqual(f.database.authority.runs.listByWorkflow(personLookupDescriptor.id), []);
    assert.equal(f.database.authority.commands.get(stale.commandId), undefined);
    assert.equal(f.database.getMeta().authorityGeneration, generation); assert.deepEqual(f.published, []);
    const fresh = plan(); assert.equal(fresh.planned.length, 1, JSON.stringify(fresh.refused)); assert.equal(fresh.configSnapshotId, f.database.authority.runtimeConfig.get()?.configSnapshotId);
    assert.notEqual(fresh.configSnapshotId, old.configSnapshotId);
    const accepted = command(fresh); const first = kernel.execute(accepted); assert.equal(first.state, "applied");
    const runId = singleAppliedRunId(first); const original = f.database.authority.runs.get(runId); assert.ok(original);
    f.save({ "timeouts.taskMs": { set: 120_000 } });
    const beforeReplay = f.database.getMeta().authorityGeneration; const resolutions = f.resolutions();
    const replay = kernel.execute(accepted); assert.equal(replay.state, "already-applied");
    assert.equal(singleAppliedRunId(replay), runId); assert.deepEqual(f.database.authority.runs.get(runId), original);
    assert.equal(f.database.getMeta().authorityGeneration, beforeReplay); assert.equal(f.resolutions(), resolutions);
  } finally { f.close(); }
});
