import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, realpathSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, it } from "vitest";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { runOfflineAuthorityRestoreRecovery } from "../../../../../src/backend/app/composition/storage-compose.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited;
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it("keeps the owned restoring journal after process death and absent staging until explicit exact stopped settlement", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-restore-crash-"))); roots.push(root);
  const url = (path: string) => pathToFileURL(join(process.cwd(), path)).href;
  const code = `
    import { readFileSync, renameSync, copyFileSync } from "node:fs";
    import { join } from "node:path";
    const { acquireEntrypointAdmission } = await import(${JSON.stringify(url("src/backend/storage/admission/bootstrap-admission.ts"))});
    const { AuthorityDatabase } = await import(${JSON.stringify(url("src/backend/storage/sqlite/authority-database.ts"))});
    const { AuthorityBackupService } = await import(${JSON.stringify(url("src/backend/storage/sqlite/backup-service.ts"))});
    const { OfflineAuthorityRestoreService } = await import(${JSON.stringify(url("src/backend/storage/sqlite/offline-restore.ts"))});
    const { observeRuntimeLockSnapshot } = await import(${JSON.stringify(url("src/backend/storage/sqlite/runtime-process-locks.ts"))});
    const { RecoveryStopProofStore } = await import(${JSON.stringify(url("src/backend/storage/sqlite/recovery-stop-proof.ts"))});
    const root = process.argv[1], admission = acquireEntrypointAdmission(root, "exclusive"), state = admission.stateRoot;
    const path = join(state, "state.db"), directory = join(state, "backups"), processLockRoot = join(state, "locks");
    const db = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "native-crash-test" });
    const report = await new AuthorityBackupService(admission, db, { directory }).request({ trigger: "operator", requiredGeneration: db.getMeta().authorityGeneration });
    db.close();
    const manifestPath = join(directory, report.manifests[0].backupFileName + ".manifest.json");
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path) });
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60000 }); proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({ observedBy: "local-operator", sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity });
    const service = new OfflineAuthorityRestoreService(admission, { authorityPath: path, suspectDirectory: join(state, "backups", "suspects"),
      processLockRoot, busyTimeoutMs: 250, stoppedProofMaxAgeMs: 60000 }, async () => {}, undefined,
      { copyFile: copyFileSync, atomicReplace(source, destination) {
        renameSync(source, destination); copyFileSync(destination, source);
        const journal = JSON.parse(readFileSync(join(root, ".tracker", "control", "journal.json"), "utf8"));
        process.send({ state: "barrier-held", operationId: journal.restore.operationId, stagedPath: source, manifestPath });
        const wait = new Int32Array(new SharedArrayBuffer(4)); for (;;) Atomics.wait(wait, 0, 0, 1000);
      } });
    await service.restore({ manifestPath, stoppedSystemProof });
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, root],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] }); children.push(child);
  const message = await new Promise<{ state: string; operationId: string; stagedPath: string; manifestPath: string }>((resolve, reject) => {
    let output = ""; child.stderr?.on("data", value => { output += String(value); });
    child.once("message", value => resolve(value as { state: string; operationId: string; stagedPath: string; manifestPath: string }));
    child.once("exit", code => reject(new Error(`restore child exited ${String(code)}: ${output}`)));
  });
  assert.equal(message.state, "barrier-held");
  const journalPath = join(root, ".tracker", "control", "journal.json"), before = readFileSync(journalPath);
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited;
  assert.throws(() => acquireEntrypointAdmission(root, "shared"), /unfinished restoring/u);
  assert.deepEqual(readFileSync(journalPath), before);
  rmSync(message.stagedPath);
  assert.throws(() => acquireEntrypointAdmission(root, "shared"), /unfinished restoring/u);
  const settled = await runOfflineAuthorityRestoreRecovery(root, ["--operation", message.operationId,
    "--from", message.manifestPath, "--outcome", "replaced", "--json"]);
  assert.deepEqual(settled.report, { state: "settled", operationId: message.operationId, outcome: "replaced" });
  assert.equal(existsSync(journalPath), false);
  const admission = acquireEntrypointAdmission(root, "shared");
  try { const db = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "native-crash-reopen" });
    try { assert.equal(db.getMeta().schemaVersion, 1); } finally { db.close(); }
  } finally { admission.release(); }
}, 30_000);
