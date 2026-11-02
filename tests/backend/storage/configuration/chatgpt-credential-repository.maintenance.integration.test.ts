import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { createChatGptAccountService } from "../../../../src/backend/accounts/chatgpt-account-service.js";
import { composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createChatGptCredentialRepository,verifyChatGptCredentialStore,type ChatGptCredentialRecord } from "../../../../src/backend/storage/configuration/chatgpt-credential-repository.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials,createBoundProfileFixture,withOfflineMaintenance } from "../../../support/helpers/admission-fixture.js";

it("signed-out credential cleanup preserves current custody", async () => {
  const profile = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const service = createChatGptAccountService({ admission: profile.admission, stateRoot: profile.stateRoot, clock });
  const directories = [join(profile.stateRoot, "credentials"), join(profile.machine.stateRoot, "machine", "credential-keys"),
    join(profile.machine.stateRoot, "machine", "erasures"), join(profile.machine.stateRoot, "machine", "credential-operations")];
  const baseline = directories.map(directory => ({ directory, present: existsSync(directory),
    names: existsSync(directory) ? readdirSync(directory).sort() : [],
    files: existsSync(directory) ? readdirSync(directory).sort().map(name => ({ name, bytes: readFileSync(join(directory, name)) })) : [] }));
  try {
    assert.deepEqual(await service.signOut(), { state: "signed-out", remoteRevocation: "not-needed" });
    assert.equal(createChatGptCredentialRepository({ admission: profile.admission, stateRoot: profile.stateRoot }).read(), undefined);
    for (const entry of baseline) {
      assert.equal(existsSync(entry.directory), entry.present);
      assert.deepEqual(existsSync(entry.directory) ? readdirSync(entry.directory).sort() : [], entry.names);
      for (const file of entry.files) assert.equal(readFileSync(join(entry.directory, file.name)).equals(file.bytes), true);
    }
    profile.machine.assertExclusive();
    verifyChatGptCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot });
  } finally { await service.close(); await profile.close(); }
});

it("SQLite backup, stopped upgrade and restore leave the current token authority untouched", async () => {
  const profile = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const stateRoot = profile.stateRoot, processLockRoot = join(profile.workspace, rebuildRuntimeIsolation.processLockRoot);
  const backupDirectory = join(stateRoot, "backups", "authority");
  try {
    const repository = createChatGptCredentialRepository({ admission: profile.admission, stateRoot });
    const original: ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`,
      clientId: "oaiapp_fixture", registration: { subject: "synthetic-subject", name: "Synthetic", email: "synthetic@example.com" },
      session: { accessToken: "synthetic-before-backup-access", refreshToken: "synthetic-before-backup-refresh", idToken: "synthetic-before-backup-id",
        expiresAt: IsoInstantSchema.parse("2026-10-12T12:00:00.000Z"), earliestRefreshAt: null, scopes: [], usePlan: false, usage: "available" } };
    await repository.withLock(async tx => { tx.replace(original, null); });
    const database = AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "account-maintenance" },
      clock, undefined, undefined, undefined, boundProfileCredentials(profile.admission));
    let manifest: string;
    try {
      const backup = await new AuthorityBackupService(profile.admission, database, { directory: backupDirectory }, clock).request({
        trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
      const latest = backup.manifests.at(-1); assert.ok(latest);
      manifest = join(backupDirectory, `${latest.backupFileName}.manifest.json`);
    } finally { database.close(); }
    assert.ok(readdirSync(backupDirectory).every(name => name.endsWith(".sqlite") || name.endsWith(".manifest.json")));
    for (const name of readdirSync(backupDirectory)) assert.equal(readFileSync(join(backupDirectory, name)).includes(Buffer.from("synthetic-before-backup")), false);
    const originalSession = original.session; assert.ok(originalSession);
    await repository.withLock(async tx => { tx.replace({ ...original, revision: 2, session: { ...originalSession, accessToken: "synthetic-current-access", refreshToken: "synthetic-current-refresh" } }, 1); });
    const credentialPath = join(stateRoot, "credentials", "chatgpt-account.json"), currentBytes = readFileSync(credentialPath);
    const report = await withOfflineMaintenance(profile.admission, operation => upgradeStorage(profileBrowserClosure, profile.admission, { stateRoot, processLockRoot, plan: false }, clock, operation));
    assert.equal(report.credentials, "unchanged"); assert.equal(readFileSync(credentialPath).equals(currentBytes), true);
    const damaged = readFileSync(profile.path);
    damaged.fill(0x5a, 4096, Math.min(damaged.length, 40_960)); writeFileSync(profile.path, damaged);
    const previous = profile.admission;
    const damagedBytes = readFileSync(profile.path);
    const detachedRoot = realpathSync(mkdtempSync(join(tmpdir(), "standalone-restore-context-")));
    const detachedArtifacts = join(detachedRoot, "artifacts"); mkdirSync(detachedArtifacts, { mode: 0o700 });
    const detached = RuntimeAdmission.syntheticRoots(detachedRoot, detachedArtifacts);
    try {
      await assert.rejects(composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", manifest], clock,
        process.cwd(), detached, boundProfileCredentials(previous)), { message: "runtime-admission: exclusive installation authority required" });
    } finally { detached.release(); rmSync(detachedRoot, { recursive: true, force: true }); }
    assert.equal(readFileSync(profile.path).equals(damagedBytes), true);
    assert.equal(readFileSync(credentialPath).equals(currentBytes), true);
    assert.equal(existsSync(join(profile.workspace, "foreign-locks")), false);
    assert.notEqual(profile.workspace, process.cwd());
    profile.admission.assertFixedProcessLockRoot(profile.workspace, processLockRoot);
    assert.throws(() => profile.admission.assertFixedProcessLockRoot(process.cwd(), processLockRoot));
    assert.throws(() => profile.admission.assertFixedProcessLockRoot(profile.workspace, join(profile.workspace, "foreign-locks")));
    const restored = await composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", manifest], clock, process.cwd(),
      previous, boundProfileCredentials(previous));
    assert.equal(restored.exitCode, 0, restored.output); assert.equal(readFileSync(credentialPath).equals(currentBytes), true);
    assert.throws(() => previous.assertProfileRuntime());
    assert.throws(() => repository.read(), { code: "CHATGPT_CREDENTIAL_UNAVAILABLE" });
    profile.renewAfterRestore();
    const renewed = createChatGptCredentialRepository({ admission: profile.admission, stateRoot });
    const current = renewed.read();
    assert.equal(current?.revision, 2);
    assert.equal(current?.session?.refreshToken, "synthetic-current-refresh");
    assert.equal(readFileSync(credentialPath).equals(currentBytes), true);
  } finally { await profile.close(); }
});
