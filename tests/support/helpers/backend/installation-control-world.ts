import assert from "node:assert/strict";
import { mkdirSync,mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireInstallation,type ExclusiveInstallationLease,type RuntimePair } from "../../../../src/backend/storage/admission/installation.js";
import { type OfflineMaintenanceOperation,type RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { runtimeLifetimeLock } from "./runtime-lifetime.js";





export function createInstallationControlTestWorld() {
  const workspaces: string[] = [];

  async function fixture(): Promise<{ workspace: string; pair: RuntimePair; lifetime: RuntimeLifetimeLock }> {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "runtime-control-")));
    workspaces.push(root);
    const lifetime = await runtimeLifetimeLock();
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { mode: 0o700 });
    mkdirSync(join(workspace, ".tracker"), { mode: 0o700 });
    return { workspace, lifetime, pair: { stateRoot: join(workspace, ".tracker/data"), artifactRoot: join(workspace, ".tracker/data", "artifacts") } };
  }

  function restore(workspace: string, lifetime: RuntimeLifetimeLock): OfflineMaintenanceOperation {
    return lifetime.beginOfflineMaintenance(workspace);
  }

  function adoptSynthetic(workspace: string, pair: RuntimePair, lifetime: RuntimeLifetimeLock): ExclusiveInstallationLease {
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
    assert.equal(machine.stateRoot, pair.stateRoot);
    assert.equal(machine.artifactRoot, pair.artifactRoot);
    machine.release();
    return acquireInstallation(workspace, "exclusive", lifetime);
  }

  const cleanup = () => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }); };
  return { workspaces, fixture, restore, adoptSynthetic, cleanup };
}
