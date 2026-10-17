import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { readAppSettings } from "./settings-storage.js";
import { derivePersistedSettingsFingerprint } from "../../../models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { DuoCeremonyLeaseRecordSchema } from "../../../rules/sessions/duo-ceremony-lease.js";
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import type { RuntimeAdmission } from "../admission/admission.js";
import { RuntimeProcessLockFileSchema, observeProcessIdentity, observeRuntimeLockSnapshot, readLiveSmokeRuntimeFile } from "./runtime-process-locks.js";
import { WorkerVerificationAdmissionRequestSchema, WorkerVerificationClaimSchema, WorkerVerificationOrphanProofSchema } from "./run-store-contracts.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import { capturedInstantClock } from "../../../rules/time/clock.js";
import type { WorkerSlotRecord } from "../../../models/run/worker-slot.js";

type Grant = z.infer<typeof WorkerVerificationAdmissionRequestSchema>;
type Proof = z.infer<typeof WorkerVerificationOrphanProofSchema>;
const same = (left: unknown, right: unknown) => canonicalJsonStringify(left) === canonicalJsonStringify(right);
const refuse = (): never => { throw new Error("orphan-verification-retirement-unproved"); };

function requireRoot(path: string, descendants = false): void {
  if (resolve(path) !== path) refuse();
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info === undefined) { const parent = dirname(path); if (parent !== path) requireRoot(parent); return; }
  if (info.isSymbolicLink() || !info.isDirectory() || realpathSync(path) !== path) refuse();
  if (descendants) for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) refuse();
    if (entry.isDirectory()) requireRoot(join(path, entry.name), true);
  }
}

/** Process arguments and filenames stay private. An incomplete OS query never proves absence. */
function proveOrphanProfileRootsUnused(roots: readonly string[]): void {
  if (process.platform !== "darwin") refuse();
  const query = (command: string, args: string[], absenceAllowed = false) => {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024 });
    if (result.error !== undefined || result.signal !== null || result.stderr.length !== 0
      || result.status !== 0 && !(absenceAllowed && result.status === 1 && result.stdout.length === 0)) refuse();
    return result.stdout;
  };
  const processes = query("/bin/ps", ["-axo", "pid=,command=", "-ww"]);
  if (processes.trim().length === 0 || processes.split("\n").filter(Boolean).some(line => !/^\s*\d+\s+\S/u.test(line))
    || roots.some(root => processes.includes(root))) refuse();
  for (const root of roots) {
    requireRoot(root, true);
    const exists = lstatSync(root, { throwIfNoEntry: false }) !== undefined;
    const files = query("/usr/sbin/lsof", ["-nP", "-F", "pfn", ...(exists ? ["+D", root] : [])], exists);
    if (exists && files.length !== 0 || !exists && (files.length === 0
      || files.split("\n").filter(Boolean).some(line => !/^(?:p\d+|f.*|n.*)$/u.test(line)))) refuse();
    if (files.split("\n").some(line => line.startsWith("n") && (line.slice(1) === root || line.slice(1).startsWith(`${root}${sep}`)))) refuse();
  }
}

export function createOrphanRetirementProof(database: DatabaseSync, admission: RuntimeAdmission, grant: Grant, slot: WorkerSlotRecord,
  now: string): Proof {
  admission.assertExclusive();
  admission.assertStorageRootsSafe();
  const installation = admission.readInstallationContext();
  if (installation !== undefined && grant.processLockRoot !== join(installation.workspace, rebuildRuntimeIsolation.processLockRoot)) refuse();
  if (admission.stateRoot !== grant.stateRoot || slot.retiredAt !== null || slot.reservationCommandId !== grant.commandId
    || database.prepare("SELECT 1 FROM worker_controls WHERE scope=? AND audited_at IS NULL").get(`worker-pool:${slot.workflow}`) !== undefined
    || database.prepare("SELECT 1 FROM worker_leases WHERE worker_id=? AND state<>'stopped'").get(slot.workerId) !== undefined) refuse();
  for (const value of database.prepare("SELECT state,payload_json FROM auth_leases").all()) {
    const row = z.strictObject({ state: z.string(), payload_json: z.string() }).parse(value);
    const lease = DuoCeremonyLeaseRecordSchema.parse(JSON.parse(row.payload_json));
    if (lease.state !== row.state || lease.state === "held") refuse();
  }
  const app = readAppSettings(database);
  const settings = app === undefined ? {} : app.saved?.settings ?? app.initialization.settings.settings;
  const snapshotId = app?.active?.configSnapshotId ?? app?.initialization.configSnapshotId;
  let activeSnapshot: z.infer<typeof ConfigSnapshotRecordSchema> | null = null;
  if (snapshotId !== undefined) {
    const row = z.strictObject({ payload_json: z.string() }).parse(database.prepare("SELECT payload_json FROM settings_snapshots WHERE id=?").get(snapshotId));
    activeSnapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(row.payload_json));
  }
  const ordinaryRoot = join(grant.stateRoot, "browsers");
  if (settings.paths?.browserProfileRoot !== undefined && settings.paths.browserProfileRoot !== ordinaryRoot
    || activeSnapshot !== null && activeSnapshot.config.paths.browserProfileRoot !== ordinaryRoot) refuse();
  const profileConfiguration = { settings, settingsFingerprint: derivePersistedSettingsFingerprint(settings), activeSnapshot };
  const original = RuntimeProcessLockFileSchema.parse(JSON.parse(readLiveSmokeRuntimeFile(grant.processLockRoot, `${grant.owner.generation}.claim.json`).text));
  const released = z.strictObject({ generation: z.number().int().positive(), acquisitionId: z.uuid(), releasedAt: IsoInstantSchema })
    .parse(JSON.parse(readLiveSmokeRuntimeFile(grant.processLockRoot, `${grant.owner.generation}-${grant.owner.acquisitionId}.release.json`).text));
  if (!same(original, grant.owner) || released.acquisitionId !== original.acquisitionId || released.generation !== original.generation
    || Date.parse(released.releasedAt) < Date.parse(original.acquiredAt) || Date.parse(released.releasedAt) > Date.parse(now) || observeProcessIdentity(original.pid).state !== "gone") refuse();
  const record = readLiveSmokeRuntimeFile(join(grant.processLockRoot, "live-smoke-slots"), `${original.acquisitionId}.slot.json`);
  const claim = WorkerVerificationClaimSchema.parse(JSON.parse(record.text));
  const runtime = observeRuntimeLockSnapshot({ processLockRoot: grant.processLockRoot, sourceDatabaseIdentity: sha256Hex(canonicalJsonStringify(grant)) }, capturedInstantClock(now));
  if (Object.values(runtime.processLocks).some(lock => lock.state !== "stopped")) refuse();
  const profileRoots: [string, string] = [join(grant.stateRoot, "scratch", "live-smoke"), join(grant.stateRoot, "browsers")];
  proveOrphanProfileRootsUnused(profileRoots);
  return WorkerVerificationOrphanProofSchema.parse({ admission: grant, slot, ownerRelease: released, claim, claimCustody: record.custody,
    claimFingerprint: sha256Hex(canonicalJsonStringify(claim)), profileConfiguration, profileRoots, runtime,
    exclusiveAdmission: true, ownerGone: true, processesAbsent: true, openFilesAbsent: true, workingDirectoriesAbsent: true, duoReleased: true, checkedAt: now });
}
