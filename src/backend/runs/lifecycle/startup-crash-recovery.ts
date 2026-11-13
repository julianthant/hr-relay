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
  for (const released of database.releaseHeldSessionLeases(lifetime, settlement.stoppedAt)) {
    appendRecoveryNotification(database.authority, "RUN_CRASH_RESOURCES_RELEASED", released, settlement.stoppedAt);
  }
}

type RecoveryInput = Readonly<{ machine: RuntimeAdmission; admission: RuntimeAdmission; database: AuthorityDatabase;
  lifecycle: RunRecordService; clock: Clock; lock: RuntimeLifetimeLock }>;

export function reconcileStartupCrash(input: RecoveryInput): void {
  reconcileInterruptedRuns(input, input.lock);
}

export function reconcileStoppedStartupCrash(input: RecoveryInput): void {
  reconcileInterruptedRuns(input, input.lock, undefined, true);
}

/** Settles one exited worker process: its claimed runs park or fail, and the Duo and exclusive-session leases it held are released. */
export function reconcileExitedWorker(input: RecoveryInput & { workerId: string }): void {
  reconcileInterruptedRuns(input, input.lock, input.workerId);
}

function reconcileInterruptedRuns(input: RecoveryInput, lock: RuntimeLifetimeLock,
  workerId?: string, stopped = false): void {
  const { machine, admission, database, lifecycle, clock } = input;
  const notify = (code: CleanupCode, identity: unknown, runId?: string) => appendRecoveryNotification(database.authority, code, identity, clock.now().toISOString(), runId);

  try {
    if (stopped) admission.assertStoppedProfile(admission.maintenanceOperation()); else admission.assertProfileRuntime();
    machine.assertLive();
    if (!(lock instanceof RuntimeLifetimeLock)) throw new Error("crash-recovery-lock-required");
    lock.assertHeld();
    if (machine.lifetime !== lock || admission.lifetime !== lock) throw new Error("crash-recovery-controller-mismatch");
    database.withAuthorityTransaction(() => {
      const facts = database.readProfileResourceCustody();
      for (const run of facts.runs) {
        const claim = runClaim(run);
        if (claim !== undefined) {
          if (workerId !== undefined && claim.workerId !== workerId) continue;
          const result = requireLifecycleApplied(lifecycle.recoverCrash({ commandId: lifecycleCommandId("startup-crash", { runId: run.envelope.runId, version: run.version, claim }),
            runId: run.envelope.runId, expectedVersion: run.version, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration },
            now: clock.now().toISOString() }, lock));
          notify(result.lifecycle.state === "parked-write" ? "RUN_CRASH_WRITE_UNRESOLVED" : "RUN_INTERRUPTED_BY_CRASH", { runId: run.envelope.runId, version: run.version }, run.envelope.runId);
        } else if (workerId === undefined && run.lifecycle.state === "queued" && run.pause === undefined && run.claimGeneration === 0
          && localDatePart(new Date(run.envelope.enqueuedAt)) < clock.todayLocal()) {
          database.assertPristineQueuedRun(run.envelope.runId, run.version);
          requireLifecycleApplied(lifecycle.transition({ commandId: lifecycleCommandId("startup-stale-queue", { runId: run.envelope.runId, version: run.version }),
            runId: run.envelope.runId, expectedVersion: run.version,
            lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString(), errorSummary: `RUN_STALE_QUEUE_CANCELLED: ${ERROR_CATALOG.RUN_STALE_QUEUE_CANCELLED.text}` } }));
          notify("RUN_STALE_QUEUE_CANCELLED", run.envelope.runId, run.envelope.runId);
        }
      }
      // Holding the port proves no earlier holder lives, so a boot releases every held lease.
      const released = workerId === undefined ? database.releaseHeldSessionLeases(lock, clock.now().toISOString())
        : database.settleInterruptedWorker(lock, workerId, clock.now().toISOString());
      for (const lease of released) notify("RUN_CRASH_RESOURCES_RELEASED", lease);
    });
  } catch (cause) {
    if (cause instanceof AuthoritySourceClosureUnprovedError) throw cause;
    throw new StartupCrashRecoveryRefusedError(cause);
  }
}
