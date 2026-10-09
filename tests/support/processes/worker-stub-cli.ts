
import { systemClock } from "../../../src/rules/time/clock.js";
import { PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { dirname, join } from "node:path";
import { acquireRuntimeProcessLock } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";

const [dbPath, lockRoot, fixtureKind, subcommand, workflowRaw, poolIndexFlag, poolIndexRaw] = process.argv.slice(2);
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
// The same derivation `poolWorkerId` mints (`<workflowId>-worker-<n>`),
// restated here so the stub's import closure stays at the domain layer.
const workerId = WorkerIdSchema.parse(`${workflowId}-worker-${String(poolIndex)}`);

const lock = acquireRuntimeProcessLock(
  { processLockRoot: lockRoot, name: "workers", workerId, pid: process.pid },
  systemClock,
);
const stateRoot = dirname(dbPath);
const installed = fixtureKind === "installed";
const admission = installed
  ? acquireEntrypointAdmission(dirname(stateRoot), "shared")
  : RuntimeAdmission.syntheticFixture(dbPath, "authority");
if (installed && (dbPath !== join(admission.stateRoot, "state.db") || lockRoot !== join(dirname(stateRoot), rebuildRuntimeIsolation.processLockRoot))) {
  admission.release();
  throw new Error("worker-stub-cli fixture storage pair mismatch");
}
const database = AuthorityDatabase.open(
  admission, { path: dbPath, busyTimeoutMs: 5_000, migrationOwner: "worker-stub-cli" },
  systemClock,
);

const started = database.authority.workerLeases.start({
  workerId,
  workflow: workflowId,
  // This supervision-only stub loads no workflow descriptor and opens no browser.
  browserSystems: [],
  processId: process.pid,
  requestedBy: "local-operator",
  now: systemClock.now().toISOString(),
});
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
