import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import assert from "node:assert/strict";
import fs, { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { acquireRecoveryRuntimeRestore } from "../../../../src/backend/storage/admission/admission.js";
import type { OfflineMaintenanceOperation } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService, OfflineRestoreFailure, settleInterruptedAuthorityRestore } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { ProfileRegistryDocumentSchema } from "../../../../src/models/profiles/profile.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

for (const boundary of ["before", "after"] as const) for (const mutation of ["revision", "epoch", "selection", "content"] as const) {
  it(`refuses altered restore invalidation ${mutation} ${boundary} registry rename and settles the original successor once`, async () => {
    const f = await createBoundProfileFixture();
    let operation: OfflineMaintenanceOperation | undefined, recovery: ReturnType<typeof acquireRecoveryRuntimeRestore> | undefined;
    const processLockRoot = join(f.workspace, rebuildRuntimeIsolation.processLockRoot);
    const registryPath = join(f.machine.stateRoot, "machine", "profiles.json"), journalPath = join(f.workspace, ".tracker", "control", "journal.json");
    try {
      const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "invalidation-replay" });
      let manifestPath: string;
      try {
        const directory = join(f.stateRoot, "backups", "authority");
        const report = await new AuthorityBackupService(f.admission, database, { directory }).request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
        const manifest = report.manifests[0]; assert.ok(manifest); manifestPath = join(directory, manifest.backupFileName + ".manifest.json");
      } finally { database.close(); }
      const before = f.machine.readProfileRegistry();
      const store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot,
        });
      const rename = fs.renameSync; let interrupted = false, replacements = 0;
      vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
        if (!interrupted && String(target) === registryPath && existsSync(journalPath)) {
          const saved = z.looseObject({ invalidation: z.unknown().optional() }).parse(JSON.parse(readFileSync(journalPath, "utf8")));
          if (saved.invalidation !== undefined) {
            interrupted = true; if (boundary === "after") rename(source, target);
            throw new Error("fixture invalidation registry boundary");
          }
        }
        rename(source, target);
      });
      syncBuiltinESMExports();
      try {
        const service = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission,
          { authorityPath: f.path, suspectDirectory: join(f.stateRoot, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot },
          async () => {}, systemClock, { copyFile: copyFileSync, atomicReplace(source, target) { replacements++; rename(source, target); } }, store);
        await assert.rejects(service.restore({ manifestPath }, f.admission.acquireOfflineMaintenance()),
          error => error instanceof OfflineRestoreFailure && error.authorityState === "replaced");
      } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
      assert.equal(interrupted, true); assert.equal(replacements, 1);
      const originalJournal = readFileSync(journalPath);
      const pending = z.looseObject({ restore: z.looseObject({ operationId: z.uuid() }),
        invalidation: z.looseObject({ priorDocument: ProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema }) })
        .parse(JSON.parse(originalJournal.toString("utf8")));
      assert.deepEqual(pending.invalidation.priorDocument, before);
      assert.notEqual(before.activeProfileId, null);
      const next = pending.invalidation.document;
      const document = mutation === "revision" ? { ...next, revision: next.revision + 1 }
        : mutation === "epoch" ? { ...next, sessionGeneration: next.sessionGeneration + 1 }
        : mutation === "selection" ? { ...next, activeProfileId: before.activeProfileId }
        : { ...next, profiles: next.profiles.map(row => ({ ...row, firstName: "Tampered" })) };
      writeFileSync(journalPath, JSON.stringify({ ...pending, invalidation: { ...pending.invalidation, document } }));
      f.machine.release(); operation = f.lifetime.beginOfflineMaintenance(f.workspace);
      recovery = acquireRecoveryRuntimeRestore(f.workspace, f.lifetime, pending.restore.operationId, operation);
      const tampered = storageTree(f.workspace);
      await assert.rejects(settleInterruptedAuthorityRestore({ admission: recovery.admission, operationId: pending.restore.operationId,
        manifestPath, outcome: "replaced", processLockRoot, restoreAdmission: operation }), /profile-restore-invalidation-uncertain/u);
      assert.deepEqual(storageTree(f.workspace), tampered);
      operation.release(); recovery.admission.release(); operation = undefined; recovery = undefined;
      writeFileSync(journalPath, originalJournal);
      operation = f.lifetime.beginOfflineMaintenance(f.workspace);
      recovery = acquireRecoveryRuntimeRestore(f.workspace, f.lifetime, pending.restore.operationId, operation);
      assert.equal((await settleInterruptedAuthorityRestore({ admission: recovery.admission, operationId: pending.restore.operationId,
        manifestPath, outcome: "replaced", processLockRoot, restoreAdmission: operation })).state, "settled");
      assert.equal(replacements, 1); assert.equal(existsSync(journalPath), false);
      const settled = ProfileRegistryDocumentSchema.parse(JSON.parse(readFileSync(registryPath, "utf8")));
      assert.equal(settled.revision, before.revision + 1); assert.equal(settled.sessionGeneration, before.sessionGeneration + 1); assert.equal(settled.activeProfileId, null);
    } finally {
      vi.restoreAllMocks(); syncBuiltinESMExports(); operation?.release(); recovery?.admission.release(); await f.close();
    }
  });
}
