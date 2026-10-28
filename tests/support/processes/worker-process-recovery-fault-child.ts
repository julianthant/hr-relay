import assert from "node:assert/strict";
import fs, { type Dir } from "node:fs";
import { join, dirname } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { mock } from "node:test";
import { z } from "zod";
import { runOfflineWorkerProcessRecovery } from "../../../src/backend/storage/maintenance/worker-process-recovery.js";
import { profileProcessQuery } from "../../../src/backend/storage/maintenance/process-closure.js";
import { acquireRuntimeRestoreAdmission, inspectRuntimeProcessOrphans, observeProcessIdentity } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { acquireInstallation } from "../../../src/backend/storage/admission/installation.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { AuthoritySourceClosureUnprovedError } from "../../../src/backend/storage/source-closure.js";

const workspace = z.string().min(1).parse(process.argv[2]);
const acquisition = z.uuid().parse(process.argv[3]), digest = z.string().length(64).parse(process.argv[4]);
const phase = z.enum(["original-close", "witness-close", "receipt-close", "stage-sync-close", "database-close-1", "database-close-2",
  "snapshot-dispose-1", "snapshot-dispose-2", "iterator-close", "lease-release", "restore-release"]).parse(process.argv[5]);
const root = join(workspace, ".tracker/data/locks"), leases = join(workspace, ".tracker/control/leases");
const receipt = join(root, "worker-process-recovery", `${acquisition}.json`);
const stage = join(root, "worker-process-recovery", `.${acquisition}.tmp`);
const original = join(root, "workers", `${acquisition}.lock.json`), witness = join(workspace, ".tracker/control/locator.json");
const originalClose = fs.closeSync, originalSync = fs.fsyncSync, originalUnlink = fs.unlinkSync, originalRemove = fs.rmSync;
const originalRename = fs.renameSync;
const originalDatabaseClose = mock.method(DatabaseSync.prototype, "close"), originalIteratorClose = mock.method(fs.Dir.prototype, "closeSync");
const injected = new Error(`synthetic-${phase}`), primary = new Error("synthetic-stage-sync-primary");
let fired = false, descriptor: number | undefined, snapshot: string | undefined, passes = 0;
let stageSyncAttempted = false;
const databases: DatabaseSync[] = [], retainedDirectories: Dir[] = [];
const bothHeld = () => fs.existsSync(join(root, "restore-admission.lock.json")) && fs.readdirSync(leases).length === 1;
const matches = (fd: number, path: string) => {
  if (!fs.existsSync(path)) return false;
  const target = fs.lstatSync(path), opened = fs.fstatSync(fd);
  return target.dev === opened.dev && target.ino === opened.ino;
};
mock.method(profileProcessQuery, "spawnSync", (command: string) => ({ pid: 0, output: [], stderr: "", status: 0, signal: null,
  stdout: command === "/bin/ps" ? ` ${process.pid} synthetic-proof\n` : `p${process.pid}\nfcwd\ntDIR\nn/synthetic-other-root\n` }));
fs.closeSync = fd => {
  const target = phase === "original-close" ? original : phase === "witness-close" ? witness : phase === "receipt-close" ? receipt
    : phase === "stage-sync-close" ? stage : undefined;
  if (!fired && target !== undefined && (phase !== "stage-sync-close" || stageSyncAttempted) && bothHeld() && matches(fd, target)) {
    fired = true; descriptor = fd; throw injected;
  }
  originalClose(fd);
};
fs.fsyncSync = fd => {
  if (phase === "stage-sync-close" && matches(fd, stage)) { stageSyncAttempted = true; throw primary; }
  originalSync(fd);
};
DatabaseSync.prototype.close = function (this: DatabaseSync) {
  const path = z.string().parse(this.prepare("PRAGMA database_list").get()?.file);
  if (phase.startsWith("database-close") && path.includes("relay-readonly-authority-") && ++passes === Number(phase.slice(-1))) {
    fired = true; databases.push(this); snapshot = dirname(path); throw injected;
  }
  originalDatabaseClose.call(this);
};
fs.rmSync = (path, options) => {
  if (phase.startsWith("snapshot-dispose") && String(path).includes("relay-readonly-authority-") && ++passes === Number(phase.slice(-1))) {
    fired = true; snapshot = String(path); throw injected;
  }
  originalRemove(path, options);
};
fs.Dir.prototype.closeSync = function (this: Dir) {
  if (phase === "iterator-close" && bothHeld() && this.path === join(root, "workers")) {
    fired = true; retainedDirectories.push(this); throw injected;
  }
  originalIteratorClose.call(this);
};
fs.unlinkSync = path => {
  const target = String(path);
  if (fs.existsSync(receipt) && phase === "lease-release" && dirname(target) === leases) { fired = true; throw injected; }
  originalUnlink(path);
};
fs.renameSync = (source, destination) => {
  if (phase === "restore-release" && String(source) === join(root, "restore-admission.lock.json") && fs.existsSync(receipt)) {
    fired = true; throw injected;
  }
  originalRename(source, destination);
};
syncBuiltinESMExports();
let failure: unknown;
try { runOfflineWorkerProcessRecovery(workspace, ["--acquisition", acquisition, "--capture", digest, "--apply", "--json"]); }
catch (error) { failure = error; }
assert.equal(fired, true);
assert.ok(failure instanceof AuthoritySourceClosureUnprovedError);
function contains(error: unknown, expected: Error): boolean {
  return error === expected || error instanceof AggregateError && error.errors.some(child => contains(child, expected));
}
assert.equal(contains(failure, injected), true);
if (phase === "stage-sync-close") assert.equal(contains(failure, primary), true);
fs.closeSync = originalClose; fs.fsyncSync = originalSync; fs.unlinkSync = originalUnlink; fs.rmSync = originalRemove;
fs.renameSync = originalRename;
originalIteratorClose.mock.restore(); originalDatabaseClose.mock.restore();
syncBuiltinESMExports();
const [database] = databases, [retainedDirectory] = retainedDirectories;
if (descriptor !== undefined) assert.ok(fs.fstatSync(descriptor).isFile());
if (database !== undefined) assert.equal(database.prepare("SELECT 1 AS live").get()?.live, 1);
if (retainedDirectory !== undefined) assert.equal(retainedDirectory.path, join(root, "workers"));
if (snapshot !== undefined) assert.equal(fs.existsSync(join(snapshot, "authority.sqlite")), true);
const leaseNames = fs.readdirSync(leases);
assert.equal(leaseNames.length, phase === "restore-release" ? 0 : 1);
for (const name of leaseNames) assert.equal(z.object({ pid: z.number() }).parse(JSON.parse(fs.readFileSync(join(leases, name), "utf8"))).pid, process.pid);
assert.equal(z.object({ pid: z.number() }).parse(JSON.parse(fs.readFileSync(join(root, "restore-admission.lock.json"), "utf8"))).pid, process.pid);
assert.throws(() => acquireRuntimeRestoreAdmission({ processLockRoot: root, pid: process.pid }));
assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace), /held by live pid/u);
if (phase === "restore-release") {
  const lease = acquireInstallation(workspace, "exclusive");
  try { assert.equal(fs.readdirSync(leases).length, 1); }
  finally { lease.release(); }
  assert.equal(fs.readdirSync(leases).length, 0);
} else assert.throws(() => acquireInstallation(workspace, "exclusive"));
assert.equal(observeProcessIdentity(process.pid).state, "alive");
const published = ["receipt-close", "lease-release", "restore-release"].includes(phase);
assert.equal(fs.existsSync(receipt), published);
assert.equal(fs.existsSync(stage), phase === "stage-sync-close");
if (published) {
  assert.equal(fs.lstatSync(receipt).nlink, 1);
  assert.equal(inspectRuntimeProcessOrphans(root).staleWorkerRecords, 0);
}
process.stdout.write(`${JSON.stringify({ phase, pid: process.pid, snapshot, published, descriptorRetained: descriptor !== undefined,
  databaseRetained: database !== undefined, leaseCount: leaseNames.length, closure: "process-exit-required" })}\n`);
// The parent verifies this owned process exited before removing its synthetic source and snapshot.
process.exit(0);
