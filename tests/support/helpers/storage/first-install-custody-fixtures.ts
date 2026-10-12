import { realpathSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireRuntimeProcessLock, observeRuntimeLockSnapshot, type RuntimeProcessLockHandle } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";

export function createFirstInstallCustodyFixture(roots: string[], sourceDatabaseIdentity: string) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-first-worker-")));
  roots.push(workspace);
  const root = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  const authorityPath = join(workspace, rebuildRuntimeIsolation.stateRoot, "state.db");
  let custody: RuntimeProcessLockHandle | undefined;
  const snapshot = () => observeRuntimeLockSnapshot({ processLockRoot: root, sourceDatabaseIdentity });
  const acquire = () => acquireEntrypointAdmission(workspace, "shared", pair => {
    expect(join(pair.stateRoot, "state.db")).toBe(authorityPath);
    custody ??= acquireRuntimeProcessLock({ processLockRoot: root, name: "workers", pid: process.pid,
      admission: { kind: "unbound-worker", authorityPath } });
  });
  return { root, authorityPath, snapshot, acquire, custody: () => {
    if (custody === undefined) throw new Error("missing first-install custody"); return custody;
  } };
}
