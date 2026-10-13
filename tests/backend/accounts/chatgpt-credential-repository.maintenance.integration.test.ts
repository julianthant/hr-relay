import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { createChatGptCredentialRepository, type ChatGptCredentialRecord } from "../../../src/backend/accounts/chatgpt-credential-repository.js";
import { createStorageRestoreTestWorld } from "../../support/helpers/backend/storage-restore-world.js";
import { upgradeStorage } from "../../../src/backend/storage/maintenance/upgrade.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";

it("SQLite backup, stopped upgrade and restore leave the current token authority untouched", async () => {
  const world = createStorageRestoreTestWorld(), paths = world.drillPaths();
  try {
    const repository = createChatGptCredentialRepository({ admission: paths.admission, stateRoot: paths.stateRoot });
    const original: ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`,
      clientId: "oaiapp_fixture", registration: { subject: "synthetic-subject", name: "Synthetic", email: "synthetic@example.com" },
      session: { accessToken: "synthetic-before-backup-access", refreshToken: "synthetic-before-backup-refresh", idToken: "synthetic-before-backup-id",
        expiresAt: "2026-10-12T12:00:00.000Z", earliestRefreshAt: null, scopes: [], usePlan: false, usage: "available" } };
    await repository.withLock(async tx => { tx.replace(original, null); });
    const database = world.open(paths), manifest = await world.takeBackup(database, paths); database.close();
    assert.ok(readdirSync(paths.backupDirectory).every(name => name.endsWith(".sqlite") || name.endsWith(".manifest.json")));
    for (const name of readdirSync(paths.backupDirectory)) assert.equal(readFileSync(join(paths.backupDirectory, name)).includes(Buffer.from("synthetic-before-backup")), false);
    const originalSession = original.session; assert.ok(originalSession);
    await repository.withLock(async tx => { tx.replace({ ...original, revision: 2, session: { ...originalSession, accessToken: "synthetic-current-access", refreshToken: "synthetic-current-refresh" } }, 1); });
    const credentialPath = join(paths.stateRoot, "chatgpt-credentials", "account.json"), currentBytes = readFileSync(credentialPath);
    const report = await upgradeStorage(paths.admission, { stateRoot: paths.stateRoot, processLockRoot: paths.processLockRoot, plan: false }, world.CLOCK);
    assert.equal(report.credentials, "unchanged"); assert.deepEqual(readFileSync(credentialPath), currentBytes);
    world.corrupt(paths);
    const restored = await world.composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", manifest], world.CLOCK, paths.repoRoot);
    assert.equal(restored.exitCode, 0, restored.output); assert.deepEqual(readFileSync(credentialPath), currentBytes);
    assert.equal(repository.read()?.session?.refreshToken, "synthetic-current-refresh");
  } finally { world.cleanup(); }
});
