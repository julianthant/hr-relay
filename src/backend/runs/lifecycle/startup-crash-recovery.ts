import type { LogoutOperation } from "../../../models/profiles/profile.js";
import { RuntimeLifetimeLock } from "../../storage/admission/lifetime-lock.js";
import { AuthoritySourceClosureUnprovedError } from "../../storage/source-closure.js";
import type { RuntimeAdmission } from "../../storage/admission/admission.js";
import type { AuthorityDatabase, AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { capturedInstantClock, localDatePart, type Clock } from "../../../rules/time/clock.js";
import { deriveStableUuid, lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { runClaim } from "../../../models/run/record.js";
import { requireLifecycleApplied, RunRecordService } from "./run-record-service.js";

export class StartupCrashRecoveryRefusedError extends Error {
  readonly code = "STARTUP_CRASH_RECOVERY_REFUSED";
  constructor(cause: unknown) { super(ERROR_CATALOG.STARTUP_CRASH_RECOVERY_REFUSED.text, { cause }); }
}

type CleanupCode = "RUN_CRASH_RESOURCES_RELEASED" | "RUN_STALE_QUEUE_CANCELLED" | "RUN_INTERRUPTED_BY_CRASH" | "RUN_CRASH_WRITE_UNRESOLVED";


function appendRecoveryNotification(repositories: AuthorityRepositories, code: CleanupCode, identity: unknown, now: string, runId?: string): void {
  const fingerprint = sha256Hex(canonicalJsonStringify({ code, identity }));
  if (repositories.notifications.findByDedupe(LOCAL_OPERATOR_ACTOR_ID, fingerprint) !== undefined) return;
  repositories.notifications.create({ notificationId: lifecycleCommandId("startup-notification", fingerprint),
    actorId: LOCAL_OPERATOR_ACTOR_ID, dedupeFingerprint: fingerprint, trigger: "storage", channel: "ping", status: "unread",
    snooze: { state: "not-snoozed" }, title: code, summary: ERROR_CATALOG[code].text,
    links: runId === undefined ? [{ kind: "storage", diagnosticFingerprint: fingerprint }] : [{ kind: "run", runId }],
    count: 1, lastSeenAt: now, version: 1, createdAt: now, updatedAt: now });
}

export function reconcileStoppedLogout(database: AuthorityDatabase, operation: LogoutOperation, lifetime: RuntimeLifetimeLock): void {
  const settlement = operation.settlement;
  if (settlement === undefined) throw new Error("profile-logout-settlement-unprepared");
  const clock = capturedInstantClock(settlement.stoppedAt);
  let sequence = 0;
  const lifecycle = new RunRecordService({ database, clock, lifecycleEventProcessId: settlement.processId,
    ids: { uuid: () => deriveStableUuid(`logout:${operation.operationId}`, String(sequence++)) },
    publishQueued: () => { throw new Error("profile-logout-cannot-enqueue"); } });
  for (const request of settlement.requests) {
    const run = requireLifecycleApplied(lifecycle.recoverCrash(request, lifetime));
    appendRecoveryNotification(database.authority, run.lifecycle.state === "parked-write" ? "RUN_CRASH_WRITE_UNRESOLVED" : "RUN_INTERRUPTED_BY_CRASH",
      { runId: request.runId, version: request.expectedVersion }, settlement.stoppedAt, request.runId);
  }
  for (const worker of settlement.workers) {
    const slot = database.authority.workerSlots.get(worker.member.workerId), lease = database.authority.workerLeases.get(worker.member.workerId);
    if (slot === undefined || lease === undefined || lease.processId !== worker.processId || lease.leaseGeneration !== worker.leaseGeneration
      || slot.workerId !== worker.member.workerId || slot.workflow !== worker.member.workflowId
      || slot.ordinal !== worker.member.ordinal || slot.poolIndex !== worker.member.poolIndex || slot.membershipRevision !== worker.member.membershipRevision) throw new Error("profile-logout-exit-source-changed");
    for (const released of database.settleInterruptedWorker(lifetime, worker.member.workerId, worker.leaseGeneration, settlement.stoppedAt)) {
      appendRecoveryNotification(database.authority, "RUN_CRASH_RESOURCES_RELEASED", released, settlement.stoppedAt);
    }
  }
}

type RecoveryInput = Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; database: AuthorityDatabase;
  lifecycle: RunRecordService; clock: Clock; lock: RuntimeLifetimeLock }>;

export function reconcileStartupCrash(input: RecoveryInput): void {
  reconcileInterruptedRuns(input, input.lock);
}

export function reconcileExitedWorker(input: RecoveryInput & {
  workerId: string; leaseGeneration: number;
}): void {
  reconcileInterruptedRuns(input, input.lock, { workerId: input.workerId, leaseGeneration: input.leaseGeneration });
}

function reconcileInterruptedRuns(input: RecoveryInput, lock: RuntimeLifetimeLock,
  worker?: Readonly<{ workerId: string; leaseGeneration: number }>): void {
  const { machine, admission, database, lifecycle, clock } = input;
  const notify = (code: CleanupCode, identity: unknown, runId?: string) => appendRecoveryNotification(database.authority, code, identity, clock.now().toISOString(), runId);

  try {
    admission.assertProfileRuntime(); machine.assertLive();
    if (!(lock instanceof RuntimeLifetimeLock)) throw new Error("crash-recovery-lock-required");
    lock.assertHeld();
    if (machine.lifetime !== lock || admission.lifetime !== lock) throw new Error("crash-recovery-controller-mismatch");
    database.withAuthorityTransaction(() => {
      const facts = database.readProfileResourceCustody();
      for (const run of facts.runs) {
        const claim = runClaim(run);
        if (claim !== undefined) {
          if (worker !== undefined && claim.workerId !== worker.workerId) continue;
          const identity = database.crashRunRecoveryIdentity(run.envelope.runId);
          if (worker !== undefined && identity.workerLifetime.leaseGeneration !== worker.leaseGeneration) throw new Error("worker-exit-lifetime-changed");
          const result = requireLifecycleApplied(lifecycle.recoverCrash({ commandId: lifecycleCommandId("startup-crash", { runId: run.envelope.runId, version: run.version, ...identity }),
            runId: run.envelope.runId, expectedVersion: run.version, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration },
            ...identity, now: clock.now().toISOString() }, lock));
          notify(result.lifecycle.state === "parked-write" ? "RUN_CRASH_WRITE_UNRESOLVED" : "RUN_INTERRUPTED_BY_CRASH", { runId: run.envelope.runId, version: run.version }, run.envelope.runId);
        } else if (worker === undefined && run.lifecycle.state === "queued" && run.claimGeneration === 0
          && localDatePart(new Date(run.envelope.enqueuedAt)) < clock.todayLocal()) {
          database.assertPristineQueuedRun(run.envelope.runId, run.version);
          requireLifecycleApplied(lifecycle.transition({ commandId: lifecycleCommandId("startup-stale-queue", { runId: run.envelope.runId, version: run.version }),
            runId: run.envelope.runId, expectedVersion: run.version,
            lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString(), errorSummary: `RUN_STALE_QUEUE_CANCELLED: ${ERROR_CATALOG.RUN_STALE_QUEUE_CANCELLED.text}` } }));
          notify("RUN_STALE_QUEUE_CANCELLED", run.envelope.runId, run.envelope.runId);
        }
      }
      if (worker === undefined) for (const slot of facts.slots) {
        if (slot.retiredAt !== null) continue;
        const hold = database.authority.workerSlots.verification(slot.workerId);
        if (hold === undefined) continue;
        const pool = database.authority.workerPools.get(slot.workflow);
        if (pool === undefined) throw new Error("worker-verification-pool-unavailable");
        const retired = database.retireVerificationWorker({ ...admission.profileBinding, commandId: lifecycleCommandId("startup-verification", {
          workerId: slot.workerId, revision: slot.membershipRevision, reservation: hold.command.commandId }),
          grantCommandId: hold.command.commandId, workerId: slot.workerId, expectedRevision: slot.membershipRevision,
          expectedPoolVersion: pool.version, now: clock.now().toISOString(), cleanup: "interrupted" }, lock);
        for (const released of retired.released) notify("RUN_CRASH_RESOURCES_RELEASED", released);
      }
      for (const lease of facts.leases) {
        if (worker !== undefined && lease.workerId !== worker.workerId) continue;
        for (const released of database.settleInterruptedWorker(lock, lease.workerId,
          worker?.leaseGeneration ?? lease.leaseGeneration, clock.now().toISOString())) {
          notify("RUN_CRASH_RESOURCES_RELEASED", released);
        }
      }
    });
  } catch (cause) {
    if (cause instanceof AuthoritySourceClosureUnprovedError) throw cause;
    throw new StartupCrashRecoveryRefusedError(cause);
  }
}
