import { readFileSync } from "node:fs";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { composeQueueSummaries } from "../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { DESCRIPTORS, descriptorSetHash, READABLE_WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import type { WorkerMemberView } from "../../../../src/backend/runtime/workers/worker-pool.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createDashboardReadHost } from "../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { WorkerActivitySchema } from "../../../../src/backend/runtime/workers/worker-messages.js";
import { workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { foundationFixture, id } from "../database-foundation/fixtures.js";

/** The lane entry the dashboard's composition starts its read lanes from. */
export const COMPOSED_LANE_ENTRY = new URL("../../../../src/backend/app/composition/dashboard/read-lane-entry.js", import.meta.url);
const APP_VERSION = (JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")) as { version: string }).version;
const SET_HASH = descriptorSetHash(DESCRIPTORS.map(descriptor => descriptor.contractFingerprint));

/** Methods the host needs to hold the lanes and close the store; every other main-connection read refuses. */
const HOST_METHODS = new Set(["constructor", "holdCheckpointCustody", "retainDashboardReadSource", "close"]);

/** Makes every read on main's own connection throw, until the returned restore runs. */
export function refuseMainReads(database: AuthorityDatabase): () => void {
  const names = Object.getOwnPropertyNames(AuthorityDatabase.prototype).filter(name => !HOST_METHODS.has(name)
    && typeof Object.getOwnPropertyDescriptor(AuthorityDatabase.prototype, name)?.value === "function");
  const authority = Object.getOwnPropertyDescriptor(database, "authority");
  for (const name of names) Object.defineProperty(database, name, { configurable: true, value: () => { throw new Error(`main-connection-read: ${name}`); } });
  Object.defineProperty(database, "authority", { configurable: true, get: () => { throw new Error("main-connection-read: authority"); } });
  return () => {
    for (const name of names) Reflect.deleteProperty(database, name);
    if (authority !== undefined) Object.defineProperty(database, "authority", authority);
  };
}

/**
 * A foundation store served through the composition's navigation lane. `main` reads its day on the lane; `local()` builds a
 * fresh request-thread projection over the same store and process facts. `members` is the pool's member list main sends.
 */
export async function composedQueueLane(cleanups: (() => unknown)[]) {
  const f = await foundationFixture();
  cleanups.push(() => f.dispose());
  const lanes = createDashboardReadHost({ admission: f.profile.admission, database: f.db, clock: f.clock, lanes: ["navigation"], entry: COMPOSED_LANE_ENTRY });
  cleanups.push(() => lanes.close());
  await lanes.ready;
  const reader = new RunRecordService({ database: f.db, clock: f.clock, ids: { uuid: () => id(9901) }, publishQueued: () => {} });
  const servedReader = { read: reader.read.bind(reader), list: reader.list.bind(reader), withRunTreeSnapshot: reader.withRunTreeSnapshot.bind(reader),
    summaries: { ...composeQueueSummaries(f.db), activity: () => { throw new Error("activity-unserved"); } } };
  const members: WorkerMemberView[] = [];
  const options = { database: f.db, stateRoot: f.root, clock: f.clock, appVersion: APP_VERSION, descriptorSetHash: SET_HASH,
    ledger: createTransactionHistory(f.db.authority),
    // The descriptors the lane's replica resolves, as the dashboard's composition passes them to main.
    descriptors: { resolve: (workflowId: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === workflowId)?.descriptor },
    reader: servedReader, workerMembers: () => [...members] };
  const main = createOperatorProjection({ ...options, readLanes: lanes });
  /** The running member view of the worker that claimed `runId`, as main's pool reports it. */
  const memberOf = (runId: string, version: number): WorkerMemberView => {
    const run = f.db.authority.runs.get(runId);
    if (run === undefined || run.lifecycle.state !== "running") throw new Error(`composed-queue-lane: ${runId} is not running`);
    const slot = f.db.authority.workerSlots.get(run.lifecycle.workerId);
    if (slot === undefined) throw new Error(`composed-queue-lane: no slot for ${run.lifecycle.workerId}`);
    return { member: workerPoolMember(slot), lifetimeId: "aaaaaaaa-0001-4000-8000-000100000000", version, state: "running", directive: "run",
      pid: 4242, startedAt: f.clock.now().toISOString(), activity: WorkerActivitySchema.parse({ state: "busy", runId }), browsers: [],
      exit: undefined, held: undefined };
  };
  return { f, lanes, main, members, memberOf, local: () => createOperatorProjection(options) };
}
