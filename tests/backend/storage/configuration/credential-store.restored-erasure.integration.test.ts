import assert from "node:assert/strict";
import { Entry } from "@napi-rs/keyring";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { composeSelectedProfileStorage } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { hasUnprovedSourceClosure, retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { DuoCredentialRecordSchema } from "../../../../src/models/config/duo-credential-store.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";

const retainedRestoreOwners = new Set<object>();
const snapshot = (paths: readonly string[]) => paths.map(path => ({ path, bytes: existsSync(path) ? readFileSync(path) : undefined }));
const unchanged = (before: ReturnType<typeof snapshot>) => assert.deepEqual(snapshot(before.map(source => source.path)), before);

for (const copy of ["none", "encrypted-stage", "missing-owner", "membership-mutation", "never-initialized", "missing-with-history", "retained-active-engine"] as const)
  it(`preserves canonical history and external counters at the real SQL restore boundary with ${copy}`, async () => {
    const actualEntry: unknown = Entry; assert.equal(actualEntry, FakeKeyringEntry);
    const f = await createBoundProfileFixture(), held = { fixture: f };
    retainedRestoreOwners.add(held);
    let primary: { error: unknown } | undefined;
    try {
      await (async () => {
      const clock = manualClock(new Date("2026-11-01T12:00:00.000Z"));
      const store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot });
      assert.equal(AuthorityDatabase.readProfileMaintenanceInventory(f.admission).settingsAuthority.state, "never-initialized");
      if (copy !== "never-initialized") {
        const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials: store,
          clock, hostFacts: { primaryDisplay: null } });
        await context.account.close(); context.database.close();
        assert.equal(AuthorityDatabase.readProfileMaintenanceInventory(f.admission).settingsAuthority.state, "initialized");
      }
      const backupDirectory = join(f.stateRoot, "backups", "authority");
      const originalPassword = store.read().entries.ucpathPassword?.value; assert.ok(originalPassword);
      const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "canonical-restore-test" }, clock,
        undefined, undefined, undefined, store);
      let backup: Awaited<ReturnType<AuthorityBackupService["request"]>>;
      try {
        backup = await new AuthorityBackupService(f.admission, database, { directory: backupDirectory }, clock)
          .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
      } finally { database.close(); }
      const manifest = backup.manifests[0]; assert.ok(manifest);
      const manifestPath = join(backupDirectory, `${manifest.backupFileName}.manifest.json`);
      const owner = createCanonicalCredentials(f.admission), duo = owner.readRecord("duo"); assert.ok(duo);
      const credential = DuoCredentialRecordSchema.parse(duo.value).credentials.find(row => row.state === "ready"); assert.ok(credential);
      const reservationId = randomUUID(), reserved = owner.reserveDuoCounter(credential.credentialId, reservationId);
      const request = ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(), commandFingerprint: "d".repeat(64),
        expectedRevision: store.read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: clock.now().toISOString(),
        entries: { ucpathPassword: { set: "synthetic-post-backup-protected-value" } } });
      const applied = store.apply(request); assert.equal(applied.state, "applied");
      const profileId = f.admission.profileBinding.profileId;
      const paths = [join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`),
        join(f.stateRoot, "credentials", "protected.json"), join(f.machine.stateRoot, "machine", "duo-credentials", `${profileId}.json`),
        join(f.stateRoot, "credentials", "chatgpt-account.json")];
      const entry = new FakeKeyringEntry("Relay", `${f.admission.profileBinding.installationId}:${profileId}`), key = entry.getPassword(); assert.ok(key);
      const backupBytes = readFileSync(join(backupDirectory, manifest.backupFileName));
      assert.equal(backupBytes.includes(key), false); assert.equal(backupBytes.includes(Buffer.from(key, "base64")), false);
      assert.equal(backupBytes.includes(originalPassword), false);
      assert.equal(backupBytes.includes("synthetic-post-backup-protected-value"), false);
      const canonicalBefore = snapshot(paths);
      const options = { authorityPath: f.path, suspectDirectory: join(f.stateRoot, "backups", "suspects"), busyTimeoutMs: 250,
        processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot) };
      const projection = async (path: string, operation: Parameters<OfflineAuthorityRestoreService["restore"]>[1]) => {
        const admission = f.admission.stoppedRestoreProjection(path, operation);
        try { const staged = AuthorityDatabase.openStoppedRestoreProjection(admission, { path, busyTimeoutMs: 250, migrationOwner: "canonical-restore-projection" }, clock); staged.close(); }
        finally { admission.release(); }
      };
      if (copy === "missing-owner") {
        const before = snapshot([f.path, ...paths]);
        assert.throws(() => new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission, options, projection, clock), /profile-restore-credential-owner-required/u);
        unchanged(before); assert.equal(entry.getPassword() === key, true); return;
      }
      if (copy === "missing-with-history") {
        const source = new DatabaseSync(f.path);
        try { source.prepare("DELETE FROM settings WHERE id='current'").run(); } finally { source.close(); }
        const before = snapshot([f.path, ...paths]);
        assert.throws(() => AuthorityDatabase.readProfileMaintenanceInventory(f.admission), /settings-current-missing-with-history/u);
        unchanged(before); assert.equal(entry.getPassword() === key, true); return;
      }
      let companion: string | undefined;
      if (copy === "encrypted-stage") {
        companion = join(f.stateRoot, "credentials", `.${profileId}.${randomUUID()}.canonical.tmp`);
        copyFileSync(join(f.stateRoot, "credentials", "protected.json"), companion);
      } else if (copy === "membership-mutation") {
        companion = join(f.stateRoot, "credentials", "unowned.json"); writeFileSync(companion, "{}", { mode: 0o600, flag: "wx" });
      } else if (copy === "retained-active-engine") {
        companion = join(f.stateRoot, "credentials", "duo-webauthn.json");
        writeFileSync(companion, JSON.stringify({ rpId: credential.scope.rpId, credentialId: credential.credentialId,
          privateKey: credential.privateKeyPkcs8, signCount: reserved.count, transport: "usb" }), { mode: 0o600, flag: "wx" });
      }
      const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, f.admission, options, projection, clock, undefined, store);
      if (companion !== undefined) {
        const before = snapshot([f.path, ...paths, companion]);
        await assert.rejects(restore.restore({ manifestPath }, f.admission.acquireOfflineMaintenance()), { code: "CREDENTIAL_OPERATION_PENDING" });
        unchanged(before); assert.equal(entry.getPassword() === key, true); return;
      }
      const report = await restore.restore({ manifestPath }, f.admission.acquireOfflineMaintenance());
      assert.equal(report.state, "restored"); unchanged(canonicalBefore); assert.equal(entry.getPassword() === key, true);
      assert.throws(() => f.admission.assertProfileRuntime(), /profile-restore-context-expired/u);
      assert.throws(() => store.read(), { code: "CREDENTIAL_UNAVAILABLE" });
      f.renewAfterRestore();
      const fresh = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot });
      assert.equal(fresh.read().revision, request.expectedRevision + 1);
      assert.equal(fresh.read().entries.ucpathPassword?.value, "synthetic-post-backup-protected-value");
      assert.equal(fresh.ownsCommandId(request.commandId), true); assert.equal(fresh.acceptedAt(request.commandId), request.updatedAt);
      assert.deepEqual(fresh.verifyReplay(request), applied); assert.deepEqual(fresh.apply(request), applied); unchanged(canonicalBefore);
      const current = createCanonicalCredentials(f.admission);
      assert.throws(() => current.reserveDuoCounter(credential.credentialId, reservationId), { code: "CREDENTIAL_CONFLICT" }); unchanged(canonicalBefore);
      const next = current.reserveDuoCounter(credential.credentialId, randomUUID());
      assert.equal(next.count, reserved.count + 1); assert.equal(next.revision, reserved.revision + 2);
      for (const source of canonicalBefore.slice(1)) assert.deepEqual(readFileSync(source.path), source.bytes);
      assert.equal(entry.getPassword() === key, true);
      })();
    } catch (error) { primary = { error }; }
    if (primary !== undefined && hasUnprovedSourceClosure(primary.error)) {
      throw retainAuthoritySourceClosure([primary.error], { admission: held });
    }
    try { await f.close(); retainedRestoreOwners.delete(held); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { admission: held }); }
    if (primary !== undefined) {
      const error = primary.error;
      throw error instanceof Error ? error : new AggregateError([error], "canonical-restore-test-failed", { cause: error });
    }
  });
