import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { createProfileSession } from "../../../src/backend/profiles/profile-session.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { LogoutOperationSchema } from "../../../src/models/profiles/profile.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { forceExactFileMetadata } from "../../support/helpers/exact-file-metadata.js";

const high = 21_110_623_253_370_482n;
for (const [inode, expected] of [[17n, 17], [high, "21110623253370482"]] as const) {
  it.skipIf(process.platform !== "linux")(`captures logout and revalidates its cold source for inode ${inode}`, async () => {
    const f = await createBoundProfileFixture();
    let substituted = false, database: AuthorityDatabase | undefined, databaseBytes: Buffer | undefined;
    const restore = forceExactFileMetadata(path => path === f.path, (_path, info) => {
      info.dev = 4n; info.ino = substituted ? inode - 1n : inode;
    });
    const session = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine,
      activity: { hasUnquiescedWork: () => true },
      prepareLogout(_profileId, owner) {
        const opened = AuthorityDatabase.open(owner, { path: f.path, busyTimeoutMs: 250, migrationOwner: "exact-logout-source" }, undefined,
          undefined, undefined, undefined, createCredentialStore({ admission: owner, stateRoot: owner.stateRoot }));
        database = opened;
        databaseBytes = readFileSync(f.path);
        const source = opened.capturePendingLogoutSource();
        assert.deepEqual(source, { database: { device: 4, inode: expected } });
        substituted = true;
        assert.throws(() => opened.capturePendingLogoutSource(), /profile-logout-native-source-changed/u);
        substituted = false;
        return { source, intentFailed(error): never { throw error; } };
      } });
    let lifetime: RuntimeLifetimeLock | undefined, cold: ReturnType<typeof acquireEntrypointAdmission> | undefined;
    try {
      if (inode === high) assert.equal(Number(inode), Number(inode - 1n));
      const active = session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: "2026-11-04T12:00:00.000Z" });
      assert.equal(active.state, "active"); assert.ok(active.state === "active");
      const paths = [join(f.stateRoot, "credentials", "protected.json"), join(f.stateRoot, "credentials", "chatgpt-account.json"),
        join(f.machine.stateRoot, "machine", "credential-keys", `${active.profileId}.json`), join(f.machine.stateRoot, "machine", "duo-credentials", `${active.profileId}.json`)];
      const credentials = paths.map(path => readFileSync(path));
      const result = session.logOut(active.token, { at: "2026-11-04T12:01:00.000Z" });
      assert.equal(result.state, "cancelling"); assert.ok(result.state === "cancelling" && result.operationId !== undefined);
      const path = join(f.machine.stateRoot, "machine", "operations", `${result.operationId}.json`), journal = readFileSync(path);
      const operation = LogoutOperationSchema.parse(JSON.parse(journal.toString("utf8")));
      assert.deepEqual(operation.source, { database: { device: 4, inode: expected } });
      assert.equal(operation.schemaVersion, 3);
      assert.ok(databaseBytes); assert.deepEqual(readFileSync(f.path), databaseBytes);
      database?.close(); database = undefined; session.close(); await f.closeController();
      lifetime = await RuntimeLifetimeLock.acquire(f.lifetime.port);
      const restarted = acquireEntrypointAdmission(f.workspace, "exclusive", lifetime); cold = restarted;
      restarted.assertColdPendingLogout(operation);
      substituted = true;
      assert.throws(() => restarted.assertColdPendingLogout(operation), /profile-logout-native-source-changed/u);
      substituted = false;
      restarted.assertColdPendingLogout(operation);
      assert.deepEqual(readFileSync(path), journal);
      for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), credentials[index]);
    } finally {
      substituted = false; cold?.release(); await lifetime?.close(); database?.close(); session.close(); restore(); await f.close();
    }
  });
}
