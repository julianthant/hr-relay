import { authoritySourceDatabaseIdentity } from "../sqlite/database-identity.js";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { acquireInstallation, inspectFlatOfflineRunMaintenance, type InstallationLease } from "../admission/installation.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { acquireRuntimeRestoreAdmission, assertWorkerProcessRecoveryRuntimeStopped, observeProcessIdentity,
  observeRuntimeLockSnapshot, readProcessCustodyFile, processCustodyDigest,
  WorkerProcessLockFileSchema, type RestoreAdmissionHandle } from "../sqlite/runtime-process-locks.js";
import { readPrivateFile } from "../configuration/credential-safe-file.js";
import { proveProfileRootsUnused } from "./process-closure.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";

export function parseQueuedRunCancellation(args: readonly string[]) {
  const fields = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === undefined || fields.has(key)) throw new Error("queued-run-cancellation-usage");
    if (["--plan", "--apply", "--json"].includes(key)) fields.set(key, "true");
    else if (key === "--capture") fields.set(key, z.string().regex(/^[0-9a-f]{64}$/u).parse(args[++index]));
    else throw new Error("queued-run-cancellation-usage");
  }
  if (fields.has("--plan") === fields.has("--apply") || fields.has("--capture") !== fields.has("--apply")) throw new Error("queued-run-cancellation-usage");
  return { apply: fields.has("--apply"), captureDigest: fields.get("--capture"), json: fields.has("--json") };
}

async function capture(workspace: string, clock: Clock) {
  const installation = inspectFlatOfflineRunMaintenance(workspace), root = installation.processLockRoot;
  const directory = join(root, "workers");
  const workers = lstatSync(directory, { throwIfNoEntry: false }) === undefined ? [] : readdirSync(directory).sort().map(name => {
    if (!/^[0-9a-f-]{36}\.lock\.json$/u.test(name)) throw new Error("queued-run-cancellation-worker-publication-uncertain");
    const file = readProcessCustodyFile(join(directory, name));
    const record = WorkerProcessLockFileSchema.parse(JSON.parse(file.bytes.toString("utf8")));
    if (name !== `${record.acquisitionId}.lock.json` || record.releasedAt === null && observeProcessIdentity(record.pid).state !== "gone") {
      throw new Error("queued-run-cancellation-worker-owner-unproved");
    }
    return { record, file: file.witness };
  });
  const singletonClaims = assertWorkerProcessRecoveryRuntimeStopped(root, workers.find(worker => worker.record.releasedAt === null)?.record.acquisitionId ?? "");
  const path = join(installation.roots[0]?.path ?? "", "state.db");
  const locks = observeRuntimeLockSnapshot({ processLockRoot: root, sourceDatabaseIdentity: authoritySourceDatabaseIdentity(path) }, clock).processLocks;
  if (Object.values(locks).some(lock => lock.state !== "stopped")) throw new Error("queued-run-cancellation-runtime-active");
  const files = ["", "-wal", "-shm", "-journal"].map(suffix => {
    const filePath = `${path}${suffix}`;
    const file = readPrivateFile(filePath, { label: "authority database", maxBytes: 512 * 1024 * 1024 });
    if (file === undefined) {
      if (suffix === "") throw new Error("queued-run-cancellation-source-missing");
      return { path: filePath, absent: true };
    }
    return { path: filePath, ...file.identity, digest: createHash("sha256").update(file.bytes).digest("hex") };
  });
  const inventory = await AuthorityDatabase.readFlatQueuedRunCancellation(path);
  const witnesses = [...installation.witnesses, ...workers.map(worker => worker.file), ...singletonClaims.map(claim => claim.file), ...files];
  const metadata = witnesses.map(file => {
    const stat = lstatSync(file.path, { throwIfNoEntry: false });
    return stat === undefined ? { path: file.path, absent: true } : { path: file.path, device: stat.dev, inode: stat.ino,
      mode: stat.mode, owner: stat.uid, links: stat.nlink, size: stat.size, modified: stat.mtimeMs, changed: stat.ctimeMs };
  });
  const body = { installation, workers, singletonClaims, locks, files, metadata, inventoryDigest: inventory.digest };
  return { installation, inventory, captureDigest: processCustodyDigest(body) };
}

export async function runOfflineQueuedRunCancellation(workspacePath: string, args: readonly string[], clock: Clock = systemClock) {
  const command = parseQueuedRunCancellation(args), workspace = realpathSync(workspacePath);
  if (workspace !== resolve(workspacePath)) throw new Error("queued-run-cancellation-workspace-unsafe");
  const planned = await capture(workspace, clock);
  const runIds = planned.inventory.candidates.map(run => run.envelope.runId);
  if (!command.apply) return { json: command.json, report: { state: "planned", captureDigest: planned.captureDigest, runIds } };
  if (planned.captureDigest !== command.captureDigest) throw new Error("queued-run-cancellation-capture-changed");
  let restore: RestoreAdmissionHandle | undefined, lease: InstallationLease | undefined;
  const release = () => {
    try { lease?.release(); }
    catch (error) { throw retainAuthoritySourceClosure([error], { admission: lease, restore }); }
    try { restore?.release(); }
    catch (error) { throw retainAuthoritySourceClosure([error], { restore }); }
  };
  try {
    restore = acquireRuntimeRestoreAdmission({ processLockRoot: planned.installation.processLockRoot, pid: process.pid }, clock);
    lease = acquireInstallation(workspace, "exclusive");
    proveProfileRootsUnused([...planned.installation.roots.slice(0, 2).map(root => root.path), join(workspace, "data")]);
    if ((await capture(workspace, clock)).captureDigest !== planned.captureDigest) throw new Error("queued-run-cancellation-capture-changed");
    await AuthorityDatabase.cancelQueuedRunsNative6(lease, restore, planned.inventory.digest, clock);
  } catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw retainAuthoritySourceClosure([error], { admission: lease, restore });
    try { release(); } catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: lease, restore }); }
    throw error;
  }
  release();
  return { json: command.json, report: { state: "cancelled", captureDigest: planned.captureDigest, runIds } };
}
