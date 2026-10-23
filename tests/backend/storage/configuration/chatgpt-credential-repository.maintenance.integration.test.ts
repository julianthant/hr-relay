import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { createChatGptAccountService } from "../../../../src/backend/accounts/chatgpt-account-service.js";
import { createChatGptCredentialRepository, verifyChatGptCredentialStore, type ChatGptCredentialRecord } from "../../../../src/backend/storage/configuration/credential-store.js";
import { verifyRelocationLiveReferences } from "../../../../src/backend/storage/maintenance/relocation-inventory.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";

it("signed-out credential cleanup remains valid for custody and relocation", async () => {
  const profile = createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const service = createChatGptAccountService({ admission: profile.admission, stateRoot: profile.stateRoot, clock });
  const directories = [join(profile.stateRoot, "credentials"), join(profile.machine.stateRoot, "machine", "credential-keys"),
    join(profile.machine.stateRoot, "machine", "erasures")];
  const baseline = directories.map(directory => ({ directory, present: existsSync(directory),
    names: existsSync(directory) ? readdirSync(directory).sort() : [],
    files: existsSync(directory) ? readdirSync(directory).sort().map(name => ({ name, bytes: readFileSync(join(directory, name)) })) : [] }));
  try {
    assert.deepEqual(await service.signOut(), { state: "signed-out", remoteRevocation: "not-needed" });
    assert.equal(existsSync(join(profile.stateRoot, "credentials", "chatgpt-account.json")), false);
    for (const entry of baseline) {
      assert.equal(existsSync(entry.directory), entry.present);
      assert.deepEqual(existsSync(entry.directory) ? readdirSync(entry.directory).sort() : [], entry.names);
      for (const file of entry.files) assert.equal(readFileSync(join(entry.directory, file.name)).equals(file.bytes), true);
    }
    profile.machine.assertExclusive();
    verifyChatGptCredentialStore({ admission: profile.admission, stateRoot: profile.stateRoot });
    verifyRelocationLiveReferences({ admission: profile.admission, source: { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot },
      credentials: boundProfileCredentials(profile.admission) });
    assert.throws(() => profile.admission.assertStorageRelocationSupported(), { code: "PROFILE_STORAGE_RELOCATION_UNSUPPORTED" });
  } finally { await service.close(); profile.close(); }
});

it("SQLite backup, stopped upgrade and restore leave the current token authority untouched", async () => {
  const profile = createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
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
    const report = await upgradeStorage(profile.admission, { stateRoot, processLockRoot, plan: false }, clock);
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
        process.cwd(), detached, boundProfileCredentials(previous)), { message: "profile-restore-context-required" });
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
  } finally { profile.close(); }
});


for (const owner of ["missing", "foreign"] as const) it(`refuses ${owner} protected inventory owner before changing current profile bytes`, () => {
  const profile = createBoundProfileFixture(), foreign = createBoundProfileFixture();
  const paths = [profile.path, join(profile.stateRoot, "credentials"),
    join(profile.machine.stateRoot, "machine", "credential-keys"), join(profile.machine.stateRoot, "machine", "erasures")];
  const before = paths.map(path => path === profile.path ? { kind: "file" as const, path, bytes: readFileSync(path) }
    : { kind: "directory" as const, path, present: existsSync(path), names: existsSync(path) ? readdirSync(path).sort() : [],
      files: existsSync(path) ? readdirSync(path).sort().map(name => ({ name, bytes: readFileSync(join(path, name)) })) : [] });
  const failures: unknown[] = [];
  try {
    const input = { admission: profile.admission, source: { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot },
      ...(owner === "foreign" ? { credentials: boundProfileCredentials(foreign.admission) } : {}) };
    assert.throws(() => verifyRelocationLiveReferences(input), owner === "missing"
      ? { code: "CREDENTIAL_CONTEXT_REQUIRED" } : { message: "credential-store-owner-mismatch" });
    for (const entry of before) {
      if (entry.kind === "file") assert.equal(readFileSync(entry.path).equals(entry.bytes), true);
      else {
        assert.equal(existsSync(entry.path), entry.present);
        assert.deepEqual(existsSync(entry.path) ? readdirSync(entry.path).sort() : [], entry.names);
        for (const file of entry.files) assert.equal(readFileSync(join(entry.path, file.name)).equals(file.bytes), true);
      }
    }
    profile.admission.assertLive(); foreign.admission.assertLive();
  } catch (error) { failures.push(error); }
  try { profile.close(); } catch (error) { failures.push(error); }
  try { foreign.close(); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new AggregateError(failures, "inventory fixture failed", { cause: failures[0] });
});
