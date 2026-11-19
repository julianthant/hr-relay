import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { createProfileVerifiers } from "../../../../../src/backend/storage/configuration/verifier-store.js";
import { readLocalDebugLog } from "../../../../../src/backend/storage/events/local-debug-log.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { ApplicationLifecycleSchema } from "../../../../../src/models/dashboard/application-lifecycle.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";

it("Pause all and quit closes and backs up the resumed profile even when its custody read is slow", async () => {
  const f = await createBoundProfileFixture({ sharedMachine: true });
  const clock = manualClock(new Date("2026-11-14T12:00:00Z"));
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(file, join(f.workspace, file));
  const app = await composeDashboardApplication({ admission: f.machine, lifetimeLock: f.lifetime, repoRoot: f.workspace,
    isolation: rebuildRuntimeIsolation, clock, backendPortOverride: 0, frontendPortOverride: 0, env: {},
    preflightRunnerFactory: healthyRuntimePreflightRunners });
  try {
    const origin = `http://127.0.0.1:${String(app.port)}`;
    const registry = f.machine.readProfileRegistry();
    assert.ok(registry.activeProfileId);
    const proof = createProfileVerifiers(f.machine.stateRoot).issueResumeProof({ origin, installationId: registry.installationId,
      profileId: registry.activeProfileId, epoch: registry.sessionGeneration });
    const resumed = await fetch(`${origin}/api/v1/profile/resume`, { method: "POST", headers: { origin, "content-type": "application/json", "x-relay-resume": proof }, body: "{}" });
    assert.equal(PublicProfileStateSchema.parse(await resumed.json()).state, "active");
    const credential = resumed.headers.get("x-relay-session"); assert.ok(credential);
    const headers = { origin, "content-type": "application/json", "x-relay-session": credential };
    const activity = ApplicationLifecycleSchema.parse(await (await fetch(`${origin}/api/v1/application-lifecycle`, { headers })).json());
    const quit = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers, body: JSON.stringify({
      commandId: randomUUID(), family: "application", type: "pause-all-and-quit", requestedAt: clock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", target: { runtimeGeneration: activity.runtimeGeneration },
      payload: { confirmed: true, targets: activity.targets },
    }) });
    assert.equal(quit.status, 200);
    assert.equal(CommandResultSchema.parse(await quit.json()).state, "applied");
    await app.shutdownRequested;

    const read = AuthorityDatabase.prototype.readManagedArtifactReferences;
    const slow = vi.spyOn(AuthorityDatabase.prototype, "readManagedArtifactReferences").mockImplementation(function (this: AuthorityDatabase, candidate) {
      clock.advanceMonotonic(51);
      return read.call(this, candidate);
    });
    await app.stop();
    assert.ok(slow.mock.calls.length > 0);
    const log = readLocalDebugLog(f.stateRoot);
    assert.ok(log.state === "present" && log.records.some(record => record.payload.kind === "debug"
      && record.payload.event.code === "read-snapshot" && record.payload.event.durationMs === 51));
    assert.ok(readdirSync(join(f.stateRoot, "backups", "authority")).some(name => name.endsWith(".shutdown.sqlite.manifest.json")));
  } finally {
    vi.restoreAllMocks();
    try { await app.stop(); } finally { await f.close(); }
  }
});
