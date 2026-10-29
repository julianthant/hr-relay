import assert from "node:assert/strict";
import { copyFileSync, renameSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { z } from "zod";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService, OfflineRestoreFailure } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

for (const malformed of ["browser", "config", "control"] as const) it(`refuses malformed current ${malformed} custody before restore or native browser effects`, async () => {
  const fixture = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const processLockRoot = join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot);
  const directory = join(fixture.stateRoot, "backups", "authority"), now = clock.now().toISOString();
  let primary: { error: unknown } | undefined;
  const native = vi.spyOn(profileBrowserClosure, "probeClosed");
  const inventory = vi.spyOn(AuthorityDatabase, "readProfileRestoreBrowserInventory");
  try {
    const database = AuthorityDatabase.open(fixture.admission, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "restore-browser-custody" }, clock,
      undefined, undefined, undefined, boundProfileCredentials(fixture.admission));
    let manifestPath: string;
    try {
      const report = await new AuthorityBackupService(fixture.admission, database, { directory }, clock)
        .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
      const manifest = report.manifests[0]; assert.ok(manifest);
      manifestPath = join(directory, manifest.backupFileName + ".manifest.json");
    } finally { database.close(); }
    const raw = new DatabaseSync(fixture.path, { enableForeignKeyConstraints: false });
    try {
      if (malformed === "browser") raw.prepare(`INSERT INTO browser_sessions
        (id,worker_id,lease_generation,system,state,auth_fingerprint,presentation,profile_revision,payload_json,opened_at,observed_at)
        VALUES(?,?,1,'ucpath','unknown',?,'headless',1,'{}',?,?)`).run("malformed-browser", "missing-worker", "a".repeat(64), now, now);
      if (malformed === "config") raw.prepare(`INSERT INTO settings_snapshots
        (id,revision,fingerprint,payload_json,captured_at) VALUES(?,1,?,'{}',?)`).run("malformed-config", "a".repeat(64), now);
      if (malformed === "control") raw.prepare(`INSERT INTO worker_controls
        (command_id,scope,worker_id,phase,audited_at,payload_json,created_at)
        VALUES(?,'worker',NULL,'admitted',NULL,'{}',?)`).run("malformed-control", now);
    } finally { raw.close(); }
    const identity = AuthorityDatabase.sourceDatabaseIdentity(fixture.path);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, clock);
    proofs.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: identity }, clock));
    const stoppedSystemProof = proofs.issue({ observedBy: "local-operator", sourceDatabaseIdentity: identity });
    const before = storageTree(fixture.workspace), entries = readdirSync(fixture.workspace, { recursive: true }).sort();
    const stat = lstatSync(fixture.path);
    let copies = 0, replacements = 0, projections = 0;
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, fixture.admission,
      { authorityPath: fixture.path, suspectDirectory: join(fixture.stateRoot, "backups", "suspects"), busyTimeoutMs: 250,
        processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async () => { projections++; }, clock,
      { copyFile: (from, to) => { copies++; copyFileSync(from, to); }, atomicReplace: (from, to) => { replacements++; renameSync(from, to); } },
      undefined, boundProfileCredentials(fixture.admission));
    await assert.rejects(restore.restore({ manifestPath, stoppedSystemProof }), error => error instanceof OfflineRestoreFailure
      && error.authorityState === "unchanged" && error.cause instanceof z.ZodError);
    assert.equal(inventory.mock.calls.length, 1); assert.equal(native.mock.calls.length, 0);
    assert.deepEqual([copies, replacements, projections], [0, 0, 0]);
    assert.deepEqual(storageTree(fixture.workspace), before);
    assert.deepEqual(readdirSync(fixture.workspace, { recursive: true }).sort(), entries);
    const after = lstatSync(fixture.path);
    assert.deepEqual([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs], [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
  } catch (error) { primary = { error }; }
  native.mockRestore(); inventory.mockRestore();
  try { await fixture.close(); }
  catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary.error, error], "restore-browser-custody-close-failed", { cause: error }); }
  if (primary !== undefined) throw primary.error;
});
