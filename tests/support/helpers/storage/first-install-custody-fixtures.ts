import { AuthorityDatabase } from '../../../../src/backend/storage/sqlite/authority-database.js';
import { createBoundProfileFixture } from '../admission-fixture.js';
import { join } from "node:path";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireRuntimeProcessLock, observeRuntimeLockSnapshot, type RuntimeProcessLockHandle } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";

export async function createFirstInstallCustodyFixture(roots: string[], sourceDatabaseIdentity: string) {
  const profile = await createBoundProfileFixture();
  roots.push(profile.workspace);
  const root = join(profile.workspace, rebuildRuntimeIsolation.processLockRoot);
  const authorityPath = profile.path;
  let custody: RuntimeProcessLockHandle | undefined;
  const snapshot = () => observeRuntimeLockSnapshot({ processLockRoot: root, sourceDatabaseIdentity });
  const acquire = () => {
    custody ??= acquireRuntimeProcessLock({ processLockRoot: root, name: "workers", pid: process.pid,
      admission: { kind: "unbound-worker", authorityPath } });
    AuthorityDatabase.open(profile.admission, { path: authorityPath, busyTimeoutMs: 250, migrationOwner: 'first-worker-admission-test' }).close();
    return profile.admission;
  };
  return { root, authorityPath, snapshot, acquire, close: async () => await profile.close(), custody: () => {
    if (custody === undefined) throw new Error("missing first-install custody"); return custody;
  } };
}
