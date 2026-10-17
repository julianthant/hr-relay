import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { join, sep } from "node:path";
import { z } from "zod";
import { ERROR_CATALOG } from "../../src/models/failures/error-catalog.js";
import { deleteOwnedBrowserProfile, workerProfileDirectory } from "../../src/backend/runtime/browser/browser-session-factory.js";
import { WorkerVerificationClaimSchema, WorkerVerificationRecoveryProofSchema } from "../../src/backend/storage/sqlite/run-store-contracts.js";
import { observeProcessIdentity, readLiveSmokeRuntimeFile, readRuntimeProcessLock, removeOwnedLiveSmokeRuntimeFile, RuntimeProcessLockFileSchema, writeLiveSmokeRuntimeFileExclusive } from "../../src/backend/storage/sqlite/runtime-process-locks.js";
import { retireWorkerVerification } from "../../src/backend/storage/sqlite/worker-slots.js";
import type { AuthorityDatabase } from "../../src/backend/storage/sqlite/authority-database.js";
import { IsoInstantSchema, PositiveIntSchema } from "../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../src/rules/validation/sha256.js";
import { systemClock, type Clock } from "../../src/rules/time/clock.js";

export class SmokeSlotRecoveryRefusedError extends Error {
  readonly code = "LIVE_SMOKE_RECOVERY_REFUSED";
  constructor() { super(ERROR_CATALOG.LIVE_SMOKE_RECOVERY_REFUSED.text); this.name = "SmokeSlotRecoveryRefusedError"; }
}

/** Query output stays private: process arguments and open filenames can contain secrets. */
export function proveSmokeProfileUnused(profileDirectory: string): void {
  if (process.platform !== "darwin") throw new SmokeSlotRecoveryRefusedError();
  const query = (command: string, args: string[], absenceAllowed = false) => {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024 });
    if (result.error !== undefined || result.signal !== null || result.stderr.length !== 0
      || result.status !== 0 && !(absenceAllowed && result.status === 1 && result.stdout.length === 0)) throw new SmokeSlotRecoveryRefusedError();
    return result.stdout;
  };
  const processes = query("/bin/ps", ["-axo", "pid=,command=", "-ww"]);
  if (processes.trim().length === 0 || processes.split("\n").filter(Boolean).some(line => !/^\s*\d+\s+\S/u.test(line))
    || processes.includes(profileDirectory)) throw new SmokeSlotRecoveryRefusedError();
  const exists = lstatSync(profileDirectory, { throwIfNoEntry: false }) !== undefined;
  const files = query("/usr/sbin/lsof", ["-nP", "-F", "pn", ...(exists ? ["+D", profileDirectory] : [])], exists);
  if (exists && files.length !== 0 || files.split("\n").some(line => line.startsWith("n")
    && (line.slice(1) === profileDirectory || line.slice(1).startsWith(`${profileDirectory}${sep}`)))) throw new SmokeSlotRecoveryRefusedError();
  if (!exists && (files.length === 0 || files.split("\n").filter(Boolean).some(line => !/^(?:p\d+|f.*|n.*)$/u.test(line)))) throw new SmokeSlotRecoveryRefusedError();
}

function observeRecoveryProcess(pid: number) {
  try { return observeProcessIdentity(pid); }
  catch { throw new SmokeSlotRecoveryRefusedError(); }
}

export function recoverOwnedSmokeSlot(input: Readonly<{ database: AuthorityDatabase; processLockRoot: string;
  stateRoot: string; acquisitionId: string; clock?: Clock }>): void {
  const acquisitionId = z.uuid().parse(input.acquisitionId);
  const clock = input.clock ?? systemClock;
  const root = join(input.processLockRoot, "live-smoke-slots");
  const name = `${acquisitionId}.slot.json`;
  const record = readLiveSmokeRuntimeFile(root, name);
  const claim = WorkerVerificationClaimSchema.parse(JSON.parse(record.text));
  const original = RuntimeProcessLockFileSchema.parse(JSON.parse(readLiveSmokeRuntimeFile(input.processLockRoot, `${claim.process.generation}.claim.json`).text));
  const release = z.strictObject({ generation: PositiveIntSchema, acquisitionId: z.uuid(), releasedAt: IsoInstantSchema })
    .parse(JSON.parse(readLiveSmokeRuntimeFile(input.processLockRoot, `${claim.process.generation}-${acquisitionId}.release.json`).text));
  let recoveryOwner: ReturnType<typeof readRuntimeProcessLock>;
  try { recoveryOwner = readRuntimeProcessLock(input.processLockRoot, "live-smoke"); }
  catch { throw new SmokeSlotRecoveryRefusedError(); }
  const recoveryProcess = recoveryOwner === undefined ? undefined : observeRecoveryProcess(recoveryOwner.pid);
  const hold = input.database.authority.workerSlots.verification(claim.slot.workerId);
  const lease = input.database.authority.duoCeremonyLeases.get(claim.credentialKey);
  const profileRoot = join(input.stateRoot, "scratch", "live-smoke", claim.profileRunId, "browsers");
  const profileDirectory = workerProfileDirectory({ profileRoot, slotOrdinal: claim.slot.ordinal, system: claim.system });
  const same = (a: unknown, b: unknown) => canonicalJsonStringify(a) === canonicalJsonStringify(b);
  if (claim.process.acquisitionId !== acquisitionId || !same(original, claim.process)
    || release.generation !== original.generation || release.acquisitionId !== acquisitionId
    || observeRecoveryProcess(original.pid).state !== "gone"
    || recoveryOwner === undefined || recoveryOwner.pid !== process.pid || recoveryOwner.releasedAt !== null
    || recoveryProcess?.state !== "alive" || !same(recoveryProcess.identity, recoveryOwner.processIdentity)
    || recoveryOwner.acquisitionId === acquisitionId
    || hold === undefined || !same(hold.slot, claim.slot) || !same(hold.request.owner, original)
    || hold.request.stateRoot !== input.stateRoot || hold.request.processLockRoot !== input.processLockRoot
    || input.database.authority.workerControls.pending(`worker-pool:${claim.slot.workflow}`).length !== 0
    || lease?.state !== "released" || lease.holder.workerId !== claim.slot.workerId || lease.holder.system !== claim.system
    || lstatSync(join(root, "live-smoke-claims", `${acquisitionId}.closed.json`), { throwIfNoEntry: false }) !== undefined) throw new SmokeSlotRecoveryRefusedError();
  proveSmokeProfileUnused(profileDirectory);
  deleteOwnedBrowserProfile(profileRoot, profileDirectory);
  if (lstatSync(profileDirectory, { throwIfNoEntry: false }) !== undefined) throw new SmokeSlotRecoveryRefusedError();
  proveSmokeProfileUnused(profileDirectory);
  const checkedAt = clock.now().toISOString();
  const proofName = `${acquisitionId}-${recoveryOwner.acquisitionId}.recovered.json`;
  const proof = WorkerVerificationRecoveryProofSchema.parse({ acquisitionId, recoveryOwner, workerId: claim.slot.workerId,
    membershipRevision: claim.slot.membershipRevision, claimFingerprint: sha256Hex(canonicalJsonStringify(claim)),
    profileDirectory, processAbsent: true, openFilesAbsent: true, profileRemoved: true, checkedAt });
  const proofCustody = writeLiveSmokeRuntimeFileExclusive(root, proofName, canonicalJsonStringify(proof));
  input.database.withAuthorityTransaction(repositories => retireWorkerVerification(repositories, {
    commandId: randomUUID(), grantCommandId: hold.command.commandId, workerId: claim.slot.workerId,
    expectedRevision: claim.slot.membershipRevision, expectedPoolVersion: repositories.workerPools.get(claim.slot.workflow)?.version,
    now: checkedAt, cleanup: { acquisitionId, browsersClosed: true, profilesReleased: true, duoReleased: true,
      mode: "recovery", evidence: "recovered", recoveryAcquisitionId: recoveryOwner.acquisitionId },
  }, randomUUID()));
  removeOwnedLiveSmokeRuntimeFile(root, proofName, proofCustody);
  removeOwnedLiveSmokeRuntimeFile(root, name, record.custody);
}
