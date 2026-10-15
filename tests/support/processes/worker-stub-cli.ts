
import { randomUUID } from "node:crypto";
import { admitDirectWorker, admitSupervisedWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { WorkerPoolMemberSchema } from "../../../src/models/run/worker-slot.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { PositiveIntSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { dirname, join, resolve } from "node:path";
import { bindWorkerProcessAdmission } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";

const [dbPath, lockRoot, fixtureKind, subcommand, workflowRaw, poolIndexFlag, poolIndexRaw, ...launchArgs] = process.argv.slice(2);
if (
  dbPath === undefined
  || lockRoot === undefined
  || !["installed", "synthetic"].includes(fixtureKind ?? "")
  || subcommand !== "worker"
  || workflowRaw === undefined
  || poolIndexFlag !== "--pool-index"
  || poolIndexRaw === undefined
) {
  throw new Error(
    `worker-stub-cli refused argv ${JSON.stringify(process.argv.slice(2))}; expected `
    + "<db-path> <lock-root> worker <workflow-id> --pool-index <n>",
  );
}

const workflowId = WorkflowIdSchema.parse(workflowRaw);
const poolIndex = PositiveIntSchema.parse(Number(poolIndexRaw));
const launch = launchArgs.length === 0 ? undefined : (() => {
  const [workerIdFlag, workerId, ordinalFlag, ordinal, revisionFlag, revision, commandFlag, commandId] = launchArgs;
  if (launchArgs.length !== 8 || workerIdFlag !== "--worker-id" || ordinalFlag !== "--ordinal"
    || revisionFlag !== "--membership-revision" || commandFlag !== "--launch-command-id" || commandId === undefined) {
    throw new Error("worker-stub-cli launch identity arguments are invalid");
  }
  return { member: WorkerPoolMemberSchema.parse({ workflowId, poolIndex, workerId,
    ordinal: Number(ordinal), membershipRevision: Number(revision) }), commandId };
})();

const stateRoot = dirname(dbPath);
const installed = fixtureKind === "installed";
const repoRoot = resolve(stateRoot, ...rebuildRuntimeIsolation.stateRoot.split("/").map(() => ".."));
const admission = installed
  ? acquireEntrypointAdmission(repoRoot, "shared")
  : RuntimeAdmission.syntheticFixture(dbPath);
if (installed && (dbPath !== join(admission.stateRoot, "state.db") || lockRoot !== join(repoRoot, rebuildRuntimeIsolation.processLockRoot))) {
  admission.release();
  throw new Error("worker-stub-cli fixture storage pair mismatch");
}
const bound = bindWorkerProcessAdmission({
  processLockRoot: lockRoot, authorityPath: dbPath, pid: process.pid, clock: systemClock,
  ...(launch === undefined ? {} : { workerId: launch.member.workerId }),
  open: () => AuthorityDatabase.open(admission, { path: dbPath, busyTimeoutMs: 5_000,
    migrationOwner: "worker-stub-cli" }, systemClock),
  close: database => database.close(),
  admit: (database, acquisitionId) => database.withAuthorityTransaction(repositories => {
    const now = systemClock.now().toISOString();
    if (launch !== undefined) return admitSupervisedWorker(repositories, { ...launch, now });
    return admitDirectWorker(repositories, { commandId: randomUUID(), workflow: workflowId, poolIndex,
      expectedPoolVersion: repositories.workerPools.get(workflowId)?.version ?? 0,
      processId: process.pid, processAcquisitionId: acquisitionId, authorityPath: dbPath,
      processLockRoot: lockRoot, now }, randomUUID()).workerId;
  }),
});
const { value: database, workerId, processLock: lock } = bound;

const started = database.startOwnedWorker({
  workerId,
  workflow: workflowId,
  // This supervision-only stub loads no workflow descriptor and opens no browser.
  browserSystems: [],
  processId: process.pid,
  requestedBy: "local-operator",
  now: systemClock.now().toISOString(),
}, lock);
if (started.state !== "started") {
  throw new Error(`worker-stub-cli ${workerId} could not start its lease: ${JSON.stringify(started)}`);
}
const { leaseGeneration } = started.lease;
const { startedAt } = started.lease.lifecycle;
process.stdout.write(`WORKER-STUB BORN ${workerId} ${String(process.pid)}\n`);

let shuttingDown = false;

const shutdown = (reason: "operator" | "shutdown"): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(directivePoll);
  process.removeAllListeners("SIGTERM");
  const now = systemClock.now().toISOString();
  const reported = database.authority.workerLeases.reportLifecycle({
    workerId,
    leaseGeneration,
    lifecycle: { state: "stopped", startedAt, stoppedAt: now, reason },
    now,
  });
  if (reported.state !== "applied") {
    throw new Error(
      `worker-stub-cli ${workerId} could not report its stopped lifecycle: ${JSON.stringify(reported)}`,
    );
  }
  process.stdout.write(`WORKER-STUB STOPPED ${workerId} ${reason}\n`);
  lock.release();
  database.close();
  admission.release();
  // Clearing listeners, timers and the database lets the child exit naturally.
};

const directivePoll = setInterval(() => {
  if (shuttingDown) return;
  const lease = database.authority.workerLeases.get(workerId);
  if (lease === undefined) {
    throw new Error(`worker-stub-cli ${workerId} found its lease missing after birth`);
  }
  if (lease.control.directive === "stop") shutdown("operator");
}, 25);

process.on("SIGTERM", () => {
  shutdown("shutdown");
});
