/**
 * W5 (ref execution-and-sessions §7.1 / §11): the REAL-child stand-in for the
 * worker CLI, spawned by the parallel-proof suite as an actual OS process so
 * the supervisor's claims about processes are proved against processes.
 *
 * It performs exactly the birth/stop protocol the real worker CLI performs
 * against the durable worker lease — §11.3's only coordination channel:
 *
 * 1. acquire the per-worker `workers` process lock under the test's
 *    `.tracker-rebuild`-scoped lock root;
 * 2. open the SAME authority database the supervising dashboard serves from
 *    and prove birth by writing its own lease under its own OS pid;
 * 3. poll the lease's operator directive; on `stop`, report the `stopped`
 *    lifecycle, release the lock, close the database and exit cleanly;
 * 4. on SIGTERM, do the same with the `shutdown` reason.
 *
 * It deliberately runs NO workflow and opens NO browser — the W5 unit proves
 * supervision, not execution. Every unexpected state fails loud (a thrown
 * structured error and a non-zero exit), which the supervisor's birth-proof
 * path is required to surface as a typed rejection.
 *
 * argv (after the supervisor's fixed prefix): the suite passes
 * `<authority-db-path> <process-lock-root>` as prefix args, and the supervisor
 * appends its member-derived tail `worker <workflow-id> --pool-index <n>` —
 * byte-exactly the tail the real CLI receives.
 */
import { systemClock } from "../../src/domain/clock.js";
import { PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../../src/domain/ids.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { acquireRuntimeProcessLock } from "../../src/infra/sqlite/runtime-process-locks.js";

const [dbPath, lockRoot, subcommand, workflowRaw, poolIndexFlag, poolIndexRaw] = process.argv.slice(2);
if (
  dbPath === undefined
  || lockRoot === undefined
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
const database = AuthorityDatabase.open(
  { path: dbPath, busyTimeoutMs: 5_000, migrationOwner: "worker-stub-cli" },
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
  // No process.exit: with the poll cleared, the signal listener removed and
  // the database closed, the event loop empties and the process exits 0.
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
