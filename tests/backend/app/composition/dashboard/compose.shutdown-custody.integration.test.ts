import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { startRebuildRuntime } from "../../../../../src/backend/app/composition/runtime-composition.js";
import { createProfileVerifiers } from "../../../../../src/backend/storage/configuration/verifier-store.js";
import * as fileIdentity from "../../../../../src/backend/storage/file-identity.js";
import { appendLocalDebug, readLocalDebugLog } from "../../../../../src/backend/storage/events/local-debug-log.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { ApplicationLifecycleSchema } from "../../../../../src/models/dashboard/application-lifecycle.js";
import { ProfileRegistryDocumentSchema } from "../../../../../src/models/profiles/profile.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";

it.each(["Pause all and quit", "SIGINT during logout"] as const)("%s closes and backs up the resumed profile even when its custody read is slow", async entry => {
  const f = await createBoundProfileFixture({ sharedMachine: true });
  const clock = manualClock(new Date("2026-11-14T12:00:00Z"));
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(file, join(f.workspace, file));
  const app = await composeDashboardApplication({ admission: f.machine, lifetimeLock: f.lifetime, repoRoot: f.workspace,
    isolation: rebuildRuntimeIsolation, clock, backendPortOverride: 0, frontendPortOverride: 0, env: {},
    preflightRunnerFactory: healthyRuntimePreflightRunners });
  const releaseDrain = Promise.withResolvers<void>();
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
    const slowReads = () => {
      const started = clock.monotonicMs();
      const reads = vi.spyOn(AuthorityDatabase.prototype, "readManagedArtifactReferences");
      vi.spyOn(clock, "monotonicMs").mockImplementation(() => started + 51 * reads.mock.calls.length);
      return reads;
    };
    if (entry === "Pause all and quit") {
      const activity = ApplicationLifecycleSchema.parse(await (await fetch(`${origin}/api/v1/application-lifecycle`, { headers })).json());
      const quit = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers, body: JSON.stringify({
        commandId: randomUUID(), family: "application", type: "pause-all-and-quit", requestedAt: clock.now().toISOString(),
        requestedBy: "local-operator", source: "dashboard", target: { runtimeGeneration: activity.runtimeGeneration },
        payload: { confirmed: true, targets: activity.targets },
      }) });
      assert.equal(quit.status, 200);
      assert.equal(CommandResultSchema.parse(await quit.json()).state, "applied");
      await app.shutdownRequested;
      const slow = slowReads();
      await app.stop();
      assert.ok(slow.mock.calls.length > 0);
    } else {
      const enteredDrain = Promise.withResolvers<void>(), signal = Promise.withResolvers<(signal: "SIGINT") => void>();
      const waitForChildren = f.lifetime.awaitOwnedChildrenClosed.bind(f.lifetime);
      vi.spyOn(f.lifetime, "awaitOwnedChildrenClosed").mockImplementationOnce(async () => {
        enteredDrain.resolve();
        await releaseDrain.promise;
        await waitForChildren();
      });
      const stopped = startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"],
        signals: { subscribe(handler) { signal.resolve(handler); return () => undefined; } },
        dashboard: async () => ({ port: app.port, stop() {
          const closing = app.stop();
          releaseDrain.resolve();
          return closing;
        } }) });
      const interrupt = await signal.promise;
      const registryPath = join(f.machine.stateRoot, "machine", "profiles.json");
      const activeEpoch = f.machine.readProfileRegistry().sessionGeneration;
      const logout = fetch(`${origin}/api/v1/profile/logout`, { method: "POST", headers, body: "{}" });
      await Promise.race([enteredDrain.promise, logout.then(response => { throw new Error(`logout returned before drain: ${response.status}`); })]);
      const slow = slowReads();
      interrupt("SIGINT");
      const [response] = await Promise.all([logout.catch((error: unknown) => {
        // The listener may close this connection while the admitted logout finishes.
        if (!(error instanceof TypeError && error.cause instanceof Error && "code" in error.cause && error.cause.code === "UND_ERR_SOCKET")) throw error;
      }), stopped]);
      if (response) assert.equal(PublicProfileStateSchema.parse(await response.json()).state, "signed-out");
      const closed = ProfileRegistryDocumentSchema.parse(JSON.parse(readFileSync(registryPath, "utf8")));
      assert.equal(closed.activeProfileId, null);
      assert.equal(closed.sessionGeneration, activeEpoch + 1);
      assert.ok(slow.mock.calls.length > 0);
    }
    const log = readLocalDebugLog(f.stateRoot);
    assert.ok(log.state === "present" && log.records.some(record => record.payload.kind === "debug"
      && record.payload.event.code === "read-snapshot" && record.payload.event.durationMs === 51));
    assert.ok(readdirSync(join(f.stateRoot, "backups", "authority")).some(name => name.endsWith(".shutdown.sqlite.manifest.json")));
  } finally {
    releaseDrain.resolve();
    vi.restoreAllMocks();
    try { await app.stop(); } finally { await f.close(); }
  }
});

it("preserves boot log bytes when the open descriptor fails custody", () => {
  const root = mkdtempSync(join(tmpdir(), "shutdown-timing-"));
  const path = join(root, "logs", "boot.jsonl");
  const append = () => appendLocalDebug({ stateRoot: root, build: "test", now: new Date("2026-11-14T12:00:00Z"),
    event: { category: "boot", phase: "settled", area: "storage", reason: "slow-operation", code: "read-snapshot", durationMs: 51, pinned: false } });
  try {
    append();
    const original = readFileSync(path);
    const status = fileIdentity.descriptorStatus;
    const changed = vi.spyOn(fileIdentity, "descriptorStatus").mockImplementationOnce(fd => {
      const file = status(fd);
      file.nlink = typeof file.nlink === "bigint" ? 2n : 2;
      return file;
    });
    assert.throws(append, /boot-log-path-unsafe/u);
    assert.equal(changed.mock.calls.length, 1);
    assert.deepEqual(readFileSync(path), original);
    if (process.platform !== "win32") {
      chmodSync(path, 0o644);
      assert.throws(append, /boot-log-path-unsafe/u);
      assert.deepEqual(readFileSync(path), original);
    }
  } finally { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); }
});
