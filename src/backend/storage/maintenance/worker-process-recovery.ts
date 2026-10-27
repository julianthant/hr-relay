import { linkSync, lstatSync, mkdirSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { acquireInstallation, assertFlatWorkerProcessRecoveryHeld, inspectFlatWorkerProcessRecovery, type InstallationLease } from "../admission/installation.js";
import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { acquireRuntimeRestoreAdmission, authoritySourceDatabaseIdentity, assertWorkerProcessRecoveryCapture, observeProcessIdentity, observeRuntimeLockSnapshot,
  assertWorkerProcessRecoveryRuntimeStopped, readProcessCustodyFile, validateWorkerProcessRecoveryReceipt, workerProcessRecoveryProved,
  processCustodyDigest, WORKER_PROCESS_RECOVERY_DIRECTORY, type WorkerProcessRecoveryCapture, type RestoreAdmissionHandle } from "../sqlite/runtime-process-locks.js";
import { assertCredentialCopyResourcesClosed } from "./profile-inventory.js";
import { assertFlatBackupFacts } from "./existing-data-backup.js";
import { proveProfileRootsUnused } from "./process-closure.js";
import { fsyncPath, readPrivateFile, statDirectory, writePrivateStage } from "../configuration/credential-safe-file.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import { createHash } from "node:crypto";

function refuse(reason: string): never { throw new Error(`worker-process-recovery-${reason}`); }
const same = (left: unknown, right: unknown) => canonicalJsonStringify(left) === canonicalJsonStringify(right);

export function parseWorkerProcessRecoveryCommand(args: readonly string[]) {
  const fields = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === undefined || fields.has(key)) refuse("usage");
    if (["--plan", "--apply", "--json"].includes(key)) fields.set(key, "true");
    else if (["--acquisition", "--capture"].includes(key)) {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) refuse("usage");
      fields.set(key, value);
    } else refuse("usage");
  }
  if (fields.has("--plan") === fields.has("--apply") || fields.has("--plan") && fields.has("--capture")) refuse("usage");
  const acquisitionId = z.uuid().parse(fields.get("--acquisition"));
  return fields.has("--apply")
    ? { mode: "apply" as const, acquisitionId, captureDigest: z.string().regex(/^[0-9a-f]{64}$/u).parse(fields.get("--capture")), json: fields.has("--json") }
    : { mode: "plan" as const, acquisitionId, json: fields.has("--json") };
}

function runtimeCustody(capture: WorkerProcessRecoveryCapture, clock: Clock) {
  assertWorkerProcessRecoveryCapture(capture);
  if (observeProcessIdentity(capture.original.pid).state !== "gone") refuse("owner-not-gone");
  const root = capture.processLockRoot;
  const snapshot = observeRuntimeLockSnapshot({ processLockRoot: root, sourceDatabaseIdentity: authoritySourceDatabaseIdentity(join(capture.roots[0].path, "state.db")) }, clock);
  if (Object.values(snapshot.processLocks).some(lock => lock.state !== "stopped")) refuse("runtime-active");
  assertWorkerProcessRecoveryRuntimeStopped(root, capture.original.acquisitionId);
  const membership: unknown[] = [];
  for (const name of ["server-claims", "live-smoke-claims", "geocode-claims", "workers"]) {
    const directory = join(root, name), info = lstatSync(directory, { throwIfNoEntry: false });
    if (info === undefined) continue;
    statDirectory(directory, "process custody", 0o700);
    for (const child of readdirSync(directory).sort()) {
      if (child.startsWith(".") || child.endsWith(".tmp") || child.endsWith(".channel.json")) refuse("runtime-publication-uncertain");
      const file = readProcessCustodyFile(join(directory, child));
      membership.push(file.witness);
    }
  }
  return { snapshot: snapshot.processLocks, membership };
}

function sourceMembership(root: string, excluded: ReadonlySet<string> = new Set()) {
  const result: unknown[] = [];
  const walk = (path: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || process.getuid !== undefined && stat.uid !== process.getuid()
      || (stat.mode & 0o022) !== 0 || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) refuse("source-unsafe");
    result.push({ path, device: stat.dev, inode: stat.ino, mode: stat.mode, size: stat.size, modified: stat.mtimeMs, changed: stat.ctimeMs });
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      if (!excluded.has(child)) walk(child);
    }
  };
  walk(root);
  return result;
}

function nativeClosure(capture: WorkerProcessRecoveryCapture, restore: RestoreAdmissionHandle) {
  const state = capture.roots[0].path, artifacts = capture.roots[1].path;
  const files = ["", "-wal", "-shm", "-journal"].map(suffix => {
    const path = join(state, `state.db${suffix}`), file = readPrivateFile(path, { label: "authority database", maxBytes: 512 * 1024 * 1024 });
    if (file === undefined) {
      if (suffix === "") refuse("source-missing");
      return { path, state: "absent" };
    }
    return { path, ...file.identity, digest: createHash("sha256").update(file.bytes).digest("hex") };
  });
  const { inspection, facts } = AuthorityDatabase.readFlatBackupRecoveryInventory(join(state, "state.db"), restore);
  assertCredentialCopyResourcesClosed(facts);
  assertFlatBackupFacts(capture.workspace, state, artifacts, facts);
  for (const browser of facts.browsers) if (browser.profileDirectory === undefined
    || !browser.profileDirectory.startsWith(`${join(state, "browsers")}/`) || resolve(browser.profileDirectory) !== browser.profileDirectory) refuse("browser-path-unproved");
  const control = join(capture.workspace, ".tracker/control");
  const { installationId: _installationId, profileId: _profileId, ...nativeInspection } = inspection;
  return { nativeDigest: processCustodyDigest({ inspection: nativeInspection, facts }), sourceDigest: processCustodyDigest({ files,
    state: sourceMembership(state, new Set([capture.processLockRoot])),
    control: sourceMembership(control, new Set([join(control, "leases"), join(control, "admission-mutex")])) }) };
}

export function runOfflineWorkerProcessRecovery(workspacePath: string, args: readonly string[], clock: Clock = systemClock) {
  const command = parseWorkerProcessRecoveryCommand(args), workspace = realpathSync(workspacePath);
  if (workspace !== resolve(workspacePath)) refuse("workspace-unsafe");
  const capture = inspectFlatWorkerProcessRecovery(workspace, command.acquisitionId), captureDigest = processCustodyDigest(capture);
  runtimeCustody(capture, clock);
  if (command.mode === "plan") return { json: command.json, report: { state: "planned", authorized: false, acquisitionId: command.acquisitionId,
    captureDigest, original: capture.original, file: capture.file, nativeClosure: "apply-proof-required" } };
  if (captureDigest !== command.captureDigest) refuse("capture-changed");
  let restore: RestoreAdmissionHandle | undefined, lease: InstallationLease | undefined;
  const release = () => {
    try { lease?.release(); }
    catch (error) { throw retainAuthoritySourceClosure([error], { admission: lease, restore }); }
    try { restore?.release(); }
    catch (error) { throw retainAuthoritySourceClosure([error], { restore }); }
  };
  let report: { state: string; acquisitionId: string; captureDigest: string; receiptPath: string };
  try {
    restore = acquireRuntimeRestoreAdmission({ processLockRoot: capture.processLockRoot, pid: process.pid }, clock);
    lease = acquireInstallation(workspace, "exclusive");
    const assertHeld = () => {
      if (lease === undefined || restore === undefined || !same(assertFlatWorkerProcessRecoveryHeld(lease, restore, command.acquisitionId), capture)) refuse("capture-changed");
    };
    assertHeld();
    const roots = [...capture.roots.slice(0, 2).map(root => root.path), join(workspace, "data")];
    proveProfileRootsUnused(roots);
    const runtime = runtimeCustody(capture, clock), native = nativeClosure(capture, restore);
    const directory = join(capture.processLockRoot, WORKER_PROCESS_RECOVERY_DIRECTORY), receiptPath = join(directory, `${command.acquisitionId}.json`);
    if (lstatSync(directory, { throwIfNoEntry: false }) === undefined) { mkdirSync(directory, { mode: 0o700 }); fsyncPath(capture.processLockRoot); }
    statDirectory(directory, "worker process recovery", 0o700);
    const receiptExists = lstatSync(receiptPath, { throwIfNoEntry: false }) !== undefined;
    if (receiptExists && !workerProcessRecoveryProved(capture.processLockRoot, capture.original)) refuse("receipt-unproved");
    if (readdirSync(directory).some(name => name.startsWith(".") || !/^[0-9a-f-]{36}\.json$/u.test(name))) refuse("publication-uncertain");
    const recovering = observeProcessIdentity(process.pid);
    if (recovering.state !== "alive") refuse("recovering-owner-unproved");
    const body = { schemaVersion: 1 as const, kind: "offline-worker-process-recovery" as const, capture, captureDigest,
      proof: { ...native, runtimeDigest: processCustodyDigest(runtime), originalOwner: "gone" as const, processes: "absent" as const,
        openFiles: "absent" as const, workingDirectories: "absent" as const, nativeResources: "closed" as const,
        checkedAt: clock.now().toISOString(), recoveringPid: process.pid, recoveringIdentity: recovering.identity, restoreAdmissionId: restore.admissionId } };
    const receipt = validateWorkerProcessRecoveryReceipt({ ...body, digest: processCustodyDigest(body) });
    assertHeld();
    proveProfileRootsUnused(roots);
    assertHeld();
    if (!same(nativeClosure(capture, restore), native) || !same(runtimeCustody(capture, clock), runtime)) refuse("source-changed");
    if (!receiptExists) {
      const stage = join(directory, `.${command.acquisitionId}.tmp`);
      writePrivateStage(stage, Buffer.from(canonicalJsonStringify(receipt)));
      // A linked or staged publication is uncertain until the sole final name is durable.
      linkSync(stage, receiptPath); fsyncPath(directory); unlinkSync(stage); fsyncPath(directory);
      if (!same(validateWorkerProcessRecoveryReceipt(JSON.parse(readProcessCustodyFile(receiptPath).bytes.toString("utf8"))), receipt)) refuse("readback-unproved");
    }
    if (!workerProcessRecoveryProved(capture.processLockRoot, capture.original)) refuse("readback-unproved");
    assertHeld();
    report = { state: receiptExists ? "already-recovered" : "recovered", acquisitionId: command.acquisitionId, captureDigest, receiptPath };
  } catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) { throw retainAuthoritySourceClosure([error], { admission: lease, restore }); }
    try { release(); } catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: lease, restore }); }
    throw error;
  }
  release();
  return { json: command.json, report };
}
