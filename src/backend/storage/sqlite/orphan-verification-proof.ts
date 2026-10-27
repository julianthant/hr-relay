import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { readAppSettings } from "./settings-storage.js";
import { derivePersistedSettingsFingerprint } from "../../../models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { DuoCeremonyLeaseRecordSchema } from "../../../rules/sessions/duo-ceremony-lease.js";
import { profileProcessQuery, proveProfileRootsUnused } from "../maintenance/process-closure.js";
export const orphanProcessQuery = profileProcessQuery;
import { lstatSync } from "node:fs";
import { join } from "node:path";
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
  const releaseName = `${grant.owner.generation}-${grant.owner.acquisitionId}.release.json`;
  const releaseEntry = lstatSync(join(grant.processLockRoot, "live-smoke-claims", releaseName), { throwIfNoEntry: false });
  const released = releaseEntry === undefined ? null
    : z.strictObject({ generation: z.number().int().positive(), acquisitionId: z.uuid(), releasedAt: IsoInstantSchema })
      .parse(JSON.parse(readLiveSmokeRuntimeFile(grant.processLockRoot, releaseName).text));
  if (!same(original, grant.owner) || released !== null && (released.acquisitionId !== original.acquisitionId
      || released.generation !== original.generation || Date.parse(released.releasedAt) < Date.parse(original.acquiredAt)
      || Date.parse(released.releasedAt) > Date.parse(now)) || observeProcessIdentity(original.pid).state !== "gone") refuse();
  const record = readLiveSmokeRuntimeFile(join(grant.processLockRoot, "live-smoke-slots"), `${original.acquisitionId}.slot.json`);
  const claim = WorkerVerificationClaimSchema.parse(JSON.parse(record.text));
  const runtime = observeRuntimeLockSnapshot({ processLockRoot: grant.processLockRoot, sourceDatabaseIdentity: sha256Hex(canonicalJsonStringify(grant)) }, capturedInstantClock(now));
  if (Object.values(runtime.processLocks).some(lock => lock.state !== "stopped")) refuse();
  const profileRoots: [string, string] = [join(grant.stateRoot, "scratch", "live-smoke"), join(grant.stateRoot, "browsers")];
  try { proveProfileRootsUnused(profileRoots); }
  catch (error) { throw new Error("orphan-verification-retirement-unproved", { cause: error }); }
  return WorkerVerificationOrphanProofSchema.parse({ admission: grant, slot, ownerRelease: released, claim, claimCustody: record.custody,
    claimFingerprint: sha256Hex(canonicalJsonStringify(claim)), profileConfiguration, profileRoots, runtime,
    exclusiveAdmission: true, ownerGone: true, processesAbsent: true, openFilesAbsent: true, workingDirectoriesAbsent: true, duoReleased: true, checkedAt: now });
}
