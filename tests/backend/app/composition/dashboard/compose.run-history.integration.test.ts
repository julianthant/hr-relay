import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { TimelineAppendSchema } from "../../../../../src/models/events/timeline.js";
import { ClearRunHistoryRequestSchema } from "../../../../../src/models/dashboard/run-history.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { HASH_A, NOW } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import { createDashboardPortTestWorld } from "../../../../support/helpers/backend/dashboard-port-world.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";

const world = createDashboardPortTestWorld(() => {}, releaseAdmissionFixtures);
afterEach(world.cleanup);

it("serves history counts, refuses active deletion, then clears a finished run and its retained files over HTTP", async () => {
  const clock = manualClock(new Date(NOW));
  const profile = await world.createProfileFixture(clock);
  const runtime = await world.composeDashboardRuntime({ lifetimeLock: profile.lifetime, ...profile.dashboardInput,
    repoRoot: profile.workspace, isolation: rebuildRuntimeIsolation, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
  world.cleanups.push(() => runtime.stop());
  const { runtime: owner, token } = profile.dashboardInput.profile;
  const { database, admission } = owner.selectedContext(token);
  const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${runtime.port}` });
  assert.deepEqual(await client.runHistoryStatus(), { state: "available", finishedRuns: 0, activeRuns: 0 });
  const config = database.authority.runtimeConfig.get(); assert.ok(config);
  const runId = randomUUID();
  const run = RunRecordSchema.parse({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId, itemId: runId,
    descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
    configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId } });
  database.authority.runs.enqueue(run);
  const envelope = run.envelope;
  const eventId = randomUUID();
  database.authority.timelineEvents.append(TimelineAppendSchema.parse({ schemaVersion: 1, eventId,
    workflow: envelope.workflow, scope: { kind: "run", runId }, occurredAt: NOW, recordedAt: NOW,
    retentionDate: NOW.slice(0, 10), source: { kind: "native" }, payload: { kind: "span", event: {
      t: "run.queued", kind: "run", pid: 1, ts: NOW, workflow: envelope.workflow, runId, attempt: 1,
      traceId: envelope.traceId, spanPath: envelope.traceId, itemId: envelope.itemId, shape: envelope.shape,
      priority: envelope.priority, dryRun: envelope.dryRun, actorId: "local-operator", title: "Synthetic history run",
      descriptorVersion: envelope.descriptorVersion, contractFingerprint: envelope.contractFingerprint,
      resolvedInstance: envelope.resolvedInstance, configFingerprint: envelope.configFingerprint, configSnapshotId: envelope.configSnapshotId,
    } } }));
  const writer = createContentAddressedArtifactWriter({ admission }); await writer.ready;
  const image = await writer.put(Buffer.from("synthetic screenshot bytes"), { mediaType: "image/png" });
  const bundleId = randomUUID();
  database.authority.diagnosticBundles.insert({ bundleId, runId, origin: { kind: "operator-request", requestedBy: "local-operator" },
    createdAt: NOW, contentDigest: HASH_A, configFingerprint: envelope.configFingerprint, descriptorFingerprint: envelope.contractFingerprint,
    redaction: { fields: [], warnings: [] }, retention: { kind: "ordinary", purgeAfter: "2026-12-01T00:00:00.000Z" },
    attachments: [{ kind: "screenshot", artifactId: image.id, mediaType: image.mediaType, byteLength: image.bytes,
      digest: image.sha256, sensitivity: "redacted", width: 1, height: 1 }] });
  const path = join(admission.artifactRoot, `${image.sha256}.artifact`);
  assert.equal(existsSync(path), true);
  assert.deepEqual(await client.runHistoryStatus(), { state: "available", finishedRuns: 0, activeRuns: 1 });
  const refused = ClearRunHistoryRequestSchema.parse({ commandId: randomUUID() });
  assert.deepEqual(await client.clearRunHistory(refused), { state: "refused", commandId: refused.commandId, reason: "active-runs" });
  assert.ok(database.authority.runs.get(runId)); assert.equal(existsSync(path), true);
  const lifecycle = new RunRecordService({ database, clock, ids: sequentialIdFactory(), publishQueued() {} });
  assert.equal(lifecycle.transition({ commandId: randomUUID(), runId, expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome: "discarded", endedAt: NOW } }).state, "applied");
  assert.deepEqual(await client.runHistoryStatus(), { state: "available", finishedRuns: 1, activeRuns: 0 });
  const command = ClearRunHistoryRequestSchema.parse({ commandId: randomUUID() });
  assert.deepEqual(await client.clearRunHistory(command), { state: "cleared", commandId: command.commandId, deletedRuns: 1 });
  assert.equal(database.authority.runs.get(runId), undefined);
  assert.equal(database.authority.timelineEvents.get(eventId), undefined);
  assert.equal(database.authority.diagnosticBundles.get(bundleId), undefined);
  assert.equal(existsSync(path), false);
  assert.deepEqual(await client.runHistoryStatus(), { state: "available", finishedRuns: 0, activeRuns: 0 });
  assert.deepEqual(await client.checkClearRunHistoryResult(command), { state: "cleared", commandId: command.commandId, deletedRuns: 1 });
});
