import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { manualClock } from "../../../src/domain/clock.js";
import { StorageRelocationCommandRequestSchema, storageRelocationDesiredDigest,
  storageRelocationRequestFingerprint } from "../../../src/domain/commands.js";
import { RuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import { acquireEntrypointAdmission } from "../../../src/infra/runtime-control/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { composeDashboardRuntime } from "../../../src/server/dashboard/compose.js";

it("plans, reads, retries, conflicts, and cancels through a real admitted dashboard", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-bff-")));
  const stateRoot = join(workspace, rebuildRuntimeIsolation.stateRoot);
  const artifactRoot = join(workspace, rebuildRuntimeIsolation.artifactRoot);
  const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
  try {
    copyFileSync(join(process.cwd(), "package.json"), join(workspace, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(workspace, "package-lock.json"));
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
    const fixtureAdmission = RuntimeAdmission.syntheticFixture(join(stateRoot, "state.db"), "authority");
    try {
      const database = AuthorityDatabase.open(fixtureAdmission, { path: join(stateRoot, "state.db"), busyTimeoutMs: 250,
        migrationOwner: "unit-test" }, clock);
      database.close();
    } finally { fixtureAdmission.release(); }
    const admission = acquireEntrypointAdmission(workspace, "shared");
    try {
      const runtime = await composeDashboardRuntime({ admission, isolation: rebuildRuntimeIsolation, repoRoot: workspace,
        env: {}, clock, backendPortOverride: 0, frontendPortOverride: 0 });
      try {
        const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
        const view = await client.storageRelocationPlans();
        assert.equal(view.revision, 0);
        assert.equal(view.sourceGeneration, 0);
        assert.deepEqual(view.sourcePair, { stateRoot, artifactRoot });
        assert.equal(view.pending, null);
        const target = { installationId: view.installationId, sourceGeneration: view.sourceGeneration,
          sourcePair: view.sourcePair, expectedRevision: view.revision };
        const desiredPair = { stateRoot: join(workspace, "moved-state"), artifactRoot: join(workspace, "moved-state", "artifacts") };
        const basis = StorageRelocationCommandRequestSchema.parse({ family: "storage-relocation", type: "plan-storage-relocation",
          commandId: randomUUID(), requestedAt: "2026-09-26T11:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
          target, payload: { writeId: randomUUID(), desiredPair, desiredDigest: storageRelocationDesiredDigest(target, desiredPair),
            requestFingerprint: "0".repeat(64) } });
        const plan = StorageRelocationCommandRequestSchema.parse({ ...basis, payload: { ...basis.payload,
          requestFingerprint: storageRelocationRequestFingerprint(basis) } });
        if (plan.type !== "plan-storage-relocation") throw new Error("expected plan request");
        const applied = await client.applyStorageRelocation(plan);
        assert.equal(applied.state, "applied");
        clock.advanceWall(1_000);
        assert.deepEqual(await client.applyStorageRelocation(plan), applied);
        const planned = await client.storageRelocationPlans();
        assert.equal(planned.revision, 1);
        assert.deepEqual(planned.pending, { commandId: plan.commandId, writeId: plan.payload.writeId,
          desiredPair, desiredDigest: plan.payload.desiredDigest, requestFingerprint: plan.payload.requestFingerprint });
        const staleBasis = StorageRelocationCommandRequestSchema.parse({ ...basis, commandId: randomUUID(),
          payload: { ...basis.payload, writeId: randomUUID() } });
        const stale = StorageRelocationCommandRequestSchema.parse({ ...staleBasis, payload: { ...staleBasis.payload,
          requestFingerprint: storageRelocationRequestFingerprint(staleBasis) } });
        assert.deepEqual(await client.applyStorageRelocation(stale), {
          state: "conflict", commandId: stale.commandId, currentVersion: 1,
          message: "storage relocation plan revision changed; reread before saving",
        });
        const cancelBasis = StorageRelocationCommandRequestSchema.parse({ family: "storage-relocation",
          type: "cancel-storage-relocation", commandId: randomUUID(), requestedAt: clock.now().toISOString(),
          requestedBy: "local-operator", source: "settings-surface",
          target: { ...target, expectedRevision: 1 }, payload: { writeId: randomUUID(),
            cancelledPlanCommandId: plan.commandId, cancelledPlanDigest: plan.payload.desiredDigest,
            requestFingerprint: "0".repeat(64) } });
        const cancel = StorageRelocationCommandRequestSchema.parse({ ...cancelBasis, payload: { ...cancelBasis.payload,
          requestFingerprint: storageRelocationRequestFingerprint(cancelBasis) } });
        const cancelled = await client.applyStorageRelocation(cancel);
        assert.equal(cancelled.state, "applied");
        clock.advanceWall(1_000);
        assert.deepEqual(await client.applyStorageRelocation(cancel), cancelled);
        const final = await client.storageRelocationPlans();
        assert.equal(final.revision, 2);
        assert.equal(final.pending, null);
        assert.deepEqual(final.sourcePair, { stateRoot, artifactRoot });
        assert.equal(final.sourceGeneration, 0);
      } finally { await runtime.stop(); }
    } finally { admission.release(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}, 20_000);

it("initializes fresh authority before admission and refuses a later missing database", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-fresh-bff-")));
  const authorityPath = join(workspace, rebuildRuntimeIsolation.stateRoot, "state.db");
  const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
  try {
    copyFileSync(join(process.cwd(), "package.json"), join(workspace, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(workspace, "package-lock.json"));
    const first = acquireEntrypointAdmission(workspace, "shared");
    try {
      assert.equal(existsSync(authorityPath), true);
      const runtime = await composeDashboardRuntime({ admission: first, isolation: rebuildRuntimeIsolation, repoRoot: workspace,
        env: {}, clock, backendPortOverride: 0, frontendPortOverride: 0 });
      try {
        const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
        assert.equal((await client.storageRelocationPlans()).revision, 0);
      } finally { await runtime.stop(); }
    } finally { first.release(); }

    rmSync(authorityPath);
    const later = acquireEntrypointAdmission(workspace, "shared");
    try {
      await assert.rejects(composeDashboardRuntime({ admission: later, isolation: rebuildRuntimeIsolation,
        repoRoot: workspace, env: {}, clock, backendPortOverride: 0, frontendPortOverride: 0 }),
      /dashboard state root is established but its authority database is missing/u);
      assert.equal(existsSync(authorityPath), false);
    } finally { later.release(); }
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}, 20_000);
