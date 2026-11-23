import { join } from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { z } from "zod";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import { TimelineEventRecordSchema, TimelinePageRequestSchema } from "../../../models/events/timeline.js";
import { ProfileDatabaseBindingSchema } from "../../../models/profiles/profile.js";
import { FileIdentitySchema } from "../../../models/storage/file-identity.js";
import { BrowserSystemIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema, RunSessionIdSchema,
  WorkerIdSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { fileStatus, sameDirectory } from "../file-identity.js";
import { privatePathRejects } from "../private-path.js";
import { type AuthorityDatabase, createDashboardSnapshotQuery } from "./authority-database.js";
import { workerExecArgv } from "./backup-inspection-worker.js";
import { openReadOnlyDatabase } from "./readonly-authority-snapshot.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";

const PROTOCOL = "relay.dashboard-background-read.v1";
const StartSchema = z.strictObject({ protocol: z.literal(PROTOCOL), path: z.string().min(1),
  binding: ProfileDatabaseBindingSchema, identity: FileIdentitySchema });
const WorkerCursorSchema = z.strictObject({ offset: PositiveIntSchema, digest: FingerprintSchema });
const RequestSchema = TimelinePageRequestSchema.pick({ after: true, through: true, limit: true, spanTypes: true })
  .extend({ nowMs: z.number().int(), workerCursor: WorkerCursorSchema.optional() });
export type DashboardBackgroundReadRequest = z.output<typeof RequestSchema>;

const ResultSchema = z.strictObject({
  records: z.array(TimelineEventRecordSchema).max(1000), cursor: z.number().int().nonnegative(), through: z.number().int().nonnegative(),
  workers: z.strictObject({ fingerprint: FingerprintSchema, next: WorkerCursorSchema.nullable(), slotWorkflows: z.array(WorkflowIdSchema).max(1000),
    batchVersions: z.array(z.strictObject({ sessionId: RunSessionIdSchema, version: PositiveIntSchema })).max(1000),
    heldDuoLeases: z.array(z.strictObject({ workerId: WorkerIdSchema, system: BrowserSystemIdSchema, since: IsoInstantSchema, expiresAt: IsoInstantSchema })).max(1000) }),
});
/** cursor resumes the timeline through its captured high water. workers.next resumes the same durable facts. */
export type DashboardBackgroundReadResult = z.infer<typeof ResultSchema>;
const ReplySchema = z.union([ResultSchema, z.strictObject({ error: z.string() })]);

function sourceIdentity(path: string, requireWal = false) {
  requireDatabaseSourcePath(path);
  const source = fileStatus(path);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const file = path + suffix, status = suffix === "" ? source : fileStatus(file, true);
    if (requireWal && status === undefined && (suffix === "-wal" || suffix === "-shm")) throw new Error("dashboard-background-wal-source-missing");
    if (status !== undefined && (!status.isFile() || BigInt(status.nlink) !== 1n || privatePathRejects(file, status, "group-write"))) {
      throw new Error("profile-database-identity-invalid");
    }
  }
  return { device: String(source.dev), inode: String(source.ino) };
}

/** One in-flight page per profile reader. close() drains the accepted page and awaits native connection closure and thread exit. */
export function createDashboardBackgroundReader(admission: RuntimeAdmission, source: AuthorityDatabase) {
  const owner = requireRuntimeAdmission(admission);
  owner.assertProfileRuntime();
  const path = join(owner.stateRoot, "state.db");
  owner.assertReadOnlyAuthorityDatabase(path);
  const start = StartSchema.parse({ protocol: PROTOCOL, path, binding: owner.profileBinding, identity: sourceIdentity(path) });
  const admit = () => {
    owner.assertProfileRuntime();
    owner.assertReadOnlyAuthorityDatabase(path);
    if (!sameDirectory(sourceIdentity(path), start.identity)) throw new Error("profile-database-open-source-changed");
  };
  const releaseSource = source.retainDashboardReadSource(owner, start.identity);
  let worker: Worker;
  try {
    worker = new Worker(new URL(import.meta.url), { name: "relay-dashboard-background-read", workerData: start,
      execArgv: workerExecArgv(), env: workerBootstrapEnvironment() });
  } catch (error) { releaseSource(); throw error; }
  let closing = false;
  let failure: Error | undefined;
  let pending: ReturnType<typeof Promise.withResolvers<DashboardBackgroundReadResult>> | undefined;
  const fail = (error: Error) => {
    failure = error;
    pending?.reject(error);
    pending = undefined;
  };
  worker.on("error", (error: unknown) => fail(error instanceof Error ? error : new Error("dashboard-background-worker-failed", { cause: error })));
  worker.on("messageerror", (error: Error) => { fail(error); void worker.terminate(); });
  worker.on("message", (message: unknown) => {
    const read = pending;
    pending = undefined;
    if (read === undefined) return;
    try {
      const reply = ReplySchema.parse(message);
      if ("error" in reply) throw new Error(reply.error);
      admit();
      read.resolve(reply);
    } catch (error) { read.reject(error instanceof Error ? error : new Error("dashboard-background-reply-invalid", { cause: error })); }
  });
  const exit = new Promise<void>(resolve => worker.once("exit", code => {
    releaseSource();
    if (failure === undefined && (!closing || code !== 0 || pending !== undefined)) fail(new Error(`dashboard-background-worker-exited: ${String(code)}`));
    resolve();
  }));
  return {
    async read(input: DashboardBackgroundReadRequest): Promise<DashboardBackgroundReadResult> {
      if (failure !== undefined) throw failure;
      if (closing) throw new Error("dashboard-background-reader-closed");
      if (pending !== undefined) throw new Error("dashboard-background-read-pending");
      const request = RequestSchema.parse(input);
      admit();
      const read = Promise.withResolvers<DashboardBackgroundReadResult>();
      worker.postMessage(request);
      pending = read;
      return read.promise;
    },
    async close(): Promise<void> {
      if (!closing) { closing = true; worker.postMessage(null); }
      await exit;
      if (failure !== undefined) throw failure;
    },
  };
}

if (!isMainThread && parentPort !== null && z.object({ protocol: z.literal(PROTOCOL) }).safeParse(workerData).success) {
  const port = parentPort, start = StartSchema.parse(workerData);
  const checkSource = () => {
    if (!sameDirectory(sourceIdentity(start.path, true), start.identity)) throw new Error("profile-database-open-source-changed");
  };
  checkSource();
  const database = openReadOnlyDatabase(start.path, 250);
  try {
    checkSource();
    database.exec("PRAGMA query_only=ON");
    const query = createDashboardSnapshotQuery(database, start.binding);
    port.on("message", (input: unknown) => {
      if (input === null) { database.close(); port.close(); return; }
      try {
        checkSource();
        const result = query(RequestSchema.parse(input));
        port.postMessage(result);
      } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : "dashboard-background-read-failed" }); }
    });
  } catch (error) { database.close(); throw error; }
}
