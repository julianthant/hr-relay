import { AuthoritySourceClosureUnprovedError } from "../../storage/source-closure.js";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeAdmission } from "../../storage/admission/admission.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { observeProcessIdentity, processCustodyDigest, publishStartupProcessClosure, readProcessCustodyFile,
  readStartupProcessClosure, readStartupProcessRecords, workerProcessRecoveryProved } from "../../storage/sqlite/runtime-process-locks.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { localDatePart, type Clock } from "../../../rules/time/clock.js";
import { lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { runClaim } from "../../../models/run/record.js";
import { requireLifecycleApplied, type RunRecordService } from "./run-record-service.js";

export class StartupCrashRecoveryRefusedError extends Error {
  readonly code = "STARTUP_CRASH_RECOVERY_REFUSED";
  constructor(cause: unknown) { super(ERROR_CATALOG.STARTUP_CRASH_RECOVERY_REFUSED.text, { cause }); }
}

type CleanupCode = "STARTUP_PROCESS_CLOSED" | "RUN_STALE_QUEUE_CANCELLED" | "RUN_INTERRUPTED_BY_CRASH" | "RUN_CRASH_WRITE_UNRESOLVED";

/** Process closure never settles an external write. */
export function reconcileStartupCrash(input: { machine: RuntimeAdmission; admission: RuntimeAdmission; database: AuthorityDatabase;
  lifecycle: RunRecordService; processLockRoot: string; clock: Clock }) {
  const { machine, admission, database, lifecycle, processLockRoot, clock } = input;
  const notify = (code: CleanupCode, identity: unknown, runId?: string) => {
    const fingerprint = processCustodyDigest({ code, identity }), now = clock.now().toISOString();
    database.withAuthorityTransaction(repositories => {
      if (repositories.notifications.findByDedupe(LOCAL_OPERATOR_ACTOR_ID, fingerprint) !== undefined) return;
      repositories.notifications.create({ notificationId: lifecycleCommandId("startup-notification", fingerprint),
        actorId: LOCAL_OPERATOR_ACTOR_ID, dedupeFingerprint: fingerprint, trigger: "storage", channel: "ping", status: "unread",
        snooze: { state: "not-snoozed" }, title: code, summary: ERROR_CATALOG[code].text,
        links: runId === undefined ? [{ kind: "storage", diagnosticFingerprint: fingerprint }] : [{ kind: "run", runId }],
        count: 1, lastSeenAt: now, version: 1, createdAt: now, updatedAt: now });
    });
  };
  try {
    admission.assertProfileRuntime(); machine.assertLive();
    const installation = machine.readInstallationContext();
    if (installation === undefined) throw new Error("startup-installation-unavailable");
    machine.assertFixedProcessLockRoot(installation.workspace, processLockRoot);
    const authorityPath = join(admission.stateRoot, "state.db");
    const facts = database.readProfileResourceCustody();
    const browserRoots = [join(machine.stateRoot, "browsers"),
      ...machine.readProfileRegistry().profiles.map(profile => join(machine.stateRoot, "profiles", profile.profileId, "browsers"))];
    const witnesses = ["installation.json", "locator.json"].map(name => readProcessCustodyFile(join(installation.workspace, ".tracker", "control", name)).witness);
    const roots = [admission.stateRoot, admission.artifactRoot, processLockRoot].map(path => {
      const stat = lstatSync(path);
      return { path, device: stat.dev, inode: stat.ino, mode: stat.mode, owner: stat.uid };
    });
    for (const original of readStartupProcessRecords(processLockRoot)) {
      if (original.releasedAt !== null && !(original.name === "workers" && "workerId" in original
        && facts.runs.some(run => runClaim(run)?.workerId === original.workerId))) continue;
      const retained = readStartupProcessClosure(processLockRoot, original);
      if (retained !== undefined) {
        if (retained.profileId === admission.profileBinding.profileId) notify("STARTUP_PROCESS_CLOSED", retained.digest);
        continue;
      }
      if (original.name === "workers" && workerProcessRecoveryProved(processLockRoot, original)) continue;
      const observed = observeProcessIdentity(original.pid);
      if (observed.state === "alive") {
        if (canonicalJsonStringify(observed.identity) === canonicalJsonStringify(original.processIdentity)) continue;
        if (original.name === "workers") throw new Error("startup-process-identity-changed");
      }
      if (original.name === "workers") {
        if ("admission" in original && original.admission.authorityPath !== authorityPath) continue;
        if ("workerId" in original) {
          const custody = database.workerLifetimeCustody(original.workerId);
          if (canonicalJsonStringify(custody.birth.owner) !== canonicalJsonStringify({ ...original, releasedAt: null })) throw new Error("startup-worker-birth-changed");
        }
      }
      const filePath = original.name === "workers" ? join(processLockRoot, "workers", `${original.acquisitionId}.lock.json`)
        : join(processLockRoot, `${original.name}-claims`, `${original.generation}.claim.json`);
      const receipt = publishStartupProcessClosure({ processLockRoot, original,
        file: readProcessCustodyFile(filePath).witness, ...admission.profileBinding, authorityPath, witnesses, roots, browserRoots,
        heldWriteIntentIds: facts.writeIntents.filter(intent => intent.status !== "committed" && intent.status !== "observed-present").map(intent => intent.writeIntentId) }, clock);
      notify("STARTUP_PROCESS_CLOSED", receipt.digest);
    }
    database.withAuthorityTransaction(repositories => {
      for (const run of database.readProfileResourceCustody().runs) {
        const claim = runClaim(run);
        if (claim !== undefined) {
          const custody = database.workerLifetimeCustody(claim.workerId);
          if (custody.state === "alive" || custody.state === "released-alive") continue;
          const proof = database.crashRunRecoveryProof(run.envelope.runId);
          const result = requireLifecycleApplied(lifecycle.recoverCrash({ commandId: lifecycleCommandId("startup-crash", { runId: run.envelope.runId, version: run.version, ...proof }),
            runId: run.envelope.runId, expectedVersion: run.version, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, ...proof, now: clock.now().toISOString() }));
          notify(result.lifecycle.state === "parked-write" ? "RUN_CRASH_WRITE_UNRESOLVED" : "RUN_INTERRUPTED_BY_CRASH", { runId: run.envelope.runId, version: run.version }, run.envelope.runId);
        } else if (run.lifecycle.state === "queued" && run.claimGeneration === 0
          && localDatePart(new Date(run.envelope.enqueuedAt)) < clock.todayLocal()) {
          database.assertPristineQueuedRun(run.envelope.runId, run.version);
          requireLifecycleApplied(lifecycle.transition({ commandId: lifecycleCommandId("startup-stale-queue", { runId: run.envelope.runId, version: run.version }),
            runId: run.envelope.runId, expectedVersion: run.version,
            lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString(), errorSummary: `RUN_STALE_QUEUE_CANCELLED: ${ERROR_CATALOG.RUN_STALE_QUEUE_CANCELLED.text}` } }));
          notify("RUN_STALE_QUEUE_CANCELLED", run.envelope.runId, run.envelope.runId);
        }
      }
      for (const lease of facts.leases) {
        if (lease.lifecycle.state === "stopped") continue;
        const custody = database.workerLifetimeCustody(lease.workerId);
        if (custody.state !== "dead" && custody.state !== "released") continue;
        if (readStartupProcessClosure(processLockRoot, custody.birth.owner) === undefined) throw new Error("startup-worker-closure-unproved");
        const stopped = repositories.workerLeases.reportLifecycle({ workerId: lease.workerId, leaseGeneration: lease.leaseGeneration,
          lifecycle: { state: "stopped", startedAt: lease.lifecycle.startedAt, stoppedAt: clock.now().toISOString(), reason: "crashed" }, now: clock.now().toISOString() });
        if (stopped.state !== "applied") throw new Error("startup-worker-lifetime-changed");
      }
    });
  } catch (cause) {
    if (cause instanceof AuthoritySourceClosureUnprovedError) throw cause;
    throw new StartupCrashRecoveryRefusedError(cause);
  }
}
