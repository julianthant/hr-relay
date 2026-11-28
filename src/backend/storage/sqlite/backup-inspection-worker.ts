import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { z } from "zod";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { createPrivateDirectory, fsyncPath } from "../private-path.js";
import { isAuthorityInspectionIntegrityFailure } from "./authority-errors.js";
import { inspectOpenDatabase, type BackupCopyInspection } from "./backup-inspection.js";
import { backupReadOnlyDatabase, readonlyAuthorityCopyPrefix, withReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { restoreLogDatabases } from "./profile-local-databases.js";
import { BackupCopyInspectionSchema } from "./recovery-contracts.js";

const PROTOCOL = "relay.backup-inspection.v1";
const COPY_PROTOCOL = "relay.backup-copy.v1";
const LOG_BACKUP_PROTOCOL = "relay.log-backup.v1";
const INTEGRITY_FAILURE_CODE = "authority-inspection-integrity-failed";
const InspectionRequestSchema = z.strictObject({ protocol: z.literal(PROTOCOL), path: z.string().min(1), expectedSchemaVersion: z.number().int().positive().optional(),
  busyTimeoutMs: z.number().int().nonnegative() });
const CopyRequestSchema = z.strictObject({ protocol: z.literal(COPY_PROTOCOL), source: z.string().min(1), destination: z.string().min(1),
  busyTimeoutMs: z.number().int().positive() });
const LogBackupRequestSchema = z.strictObject({ protocol: z.literal(LOG_BACKUP_PROTOCOL), source: z.string().min(1), destination: z.string().min(1) });
const FailedReplySchema = z.strictObject({ kind: z.literal("failed"), name: z.string(), message: z.string(), code: z.string().optional() });
const InspectionReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("inspected"), inspection: BackupCopyInspectionSchema }),
  FailedReplySchema,
]);
const CopyReplySchema = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("copied") }), FailedReplySchema]);
type InspectionRequest = z.infer<typeof InspectionRequestSchema>;
type CopyRequest = z.infer<typeof CopyRequestSchema>;
type WorkerReply = z.infer<typeof InspectionReplySchema> | z.infer<typeof CopyReplySchema>;
type ReplyVerdict<Value> = Readonly<{ value: Value } | { error: Error; invalid: boolean }>;

/** Each queued request waits for the previous worker thread to exit, so at most one runs in this process. */
let previousThread: Promise<void> = Promise.resolve();

/** Resolves after the worker threads started so far exit and finish scratch cleanup. */
export function backupThreadIdle(): Promise<void> { return previousThread; }

function failureError(reply: z.infer<typeof FailedReplySchema>): Error {
  return Object.assign(new Error(reply.message), reply.code === undefined ? {} : { code: reply.code });
}

export function hasInspectionIntegrityFailureCode(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === INTEGRITY_FAILURE_CODE;
}

/**
 * One request on a worker thread: resolves only from the worker's verdict; a failed reply, a worker error or a worker exit
 * without a verdict rejects. An abort rejects at once and terminates the worker without waiting for it; the thread's scratch
 * folder is removed when it exits.
 */
function runOnWorkerThread<Value>(request: unknown, signal: AbortSignal | undefined, interpret: (message: unknown) => ReplyVerdict<Value>): Promise<Value> {
  let releaseTurn!: () => void;
  const turn = previousThread;
  previousThread = new Promise(resolve => { releaseTurn = resolve; });
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
    const stopWhileQueued = () => fail(abortReason(signal));
    if (signal?.aborted === true) stopWhileQueued(); else signal?.addEventListener("abort", stopWhileQueued, { once: true });
    void turn.then(async () => {
      signal?.removeEventListener("abort", stopWhileQueued);
      if (settled) { releaseTurn(); return; }
      let scratchDirectory: string, worker: Worker;
      try {
        scratchDirectory = createScratchDirectory();
      } catch (error) { releaseTurn(); fail(new Error("backup-inspection-scratch-failed", { cause: error })); return; }
      try {
        worker = new Worker(new URL("./backup-inspection-worker.js", import.meta.url), { name: "relay-backup-inspection", execArgv: workerExecArgv(),
          // os.tmpdir() reads the thread's own environment, so the snapshot copy lands in the folder removed on its exit.
          env: { ...workerBootstrapEnvironment(), TMPDIR: scratchDirectory, TMP: scratchDirectory, TEMP: scratchDirectory },
          workerData: request });
      } catch (error) {
        await removeScratchDirectory(scratchDirectory);
        releaseTurn();
        fail(new Error("backup-inspection-worker-failed", { cause: error }));
        return;
      }
      const stop = () => { fail(abortReason(signal)); void worker.terminate(); };
      signal?.addEventListener("abort", stop, { once: true });
      worker.once("message", (message: unknown) => {
        if (settled) return;
        const verdict = interpret(message);
        if ("value" in verdict) { settled = true; resolve(verdict.value); return; }
        fail(verdict.error);
        if (verdict.invalid) void worker.terminate();
      });
      worker.once("error", error => fail(new Error("backup-inspection-worker-failed", { cause: error })));
      worker.once("messageerror", error => fail(new Error("backup-inspection-worker-failed", { cause: error })));
      worker.once("exit", exitCode => {
        signal?.removeEventListener("abort", stop);
        void removeScratchDirectory(scratchDirectory).then(() => {
          releaseTurn();
          fail(new Error(`backup-inspection-worker-exited: ${String(exitCode)}`));
        });
      });
    });
  });
}

/**
 * The full read-only inspection of a private database file, run on a worker thread: path in, inspection out.
 */
export function inspectBackupFileOffThread(path: string, expectedSchemaVersion: number | undefined,
  options: Readonly<{ signal?: AbortSignal; busyTimeoutMs?: number }> = {}): Promise<BackupCopyInspection> {
  const { signal, busyTimeoutMs = 250 } = options;
  const request = InspectionRequestSchema.parse({ protocol: PROTOCOL, path, ...(expectedSchemaVersion === undefined ? {} : { expectedSchemaVersion }), busyTimeoutMs });
  return runOnWorkerThread<BackupCopyInspection>(request, signal, message => {
    const reply = InspectionReplySchema.safeParse(message);
    if (!reply.success) return { error: new Error("backup-inspection-reply-invalid"), invalid: true };
    if (reply.data.kind === "inspected") return { value: deepFreeze(reply.data.inspection) };
    return { error: failureError(reply.data), invalid: false };
  });
}

/** The same inspection as inspectAuthorityBackupReadOnly, admitted here on the main thread and run on a worker thread. */
export async function inspectAuthorityBackupOffThread(admission: RuntimeAdmission, pathInput: string, expectedSchemaVersion: number | undefined,
  options: Readonly<{ signal?: AbortSignal; busyTimeoutMs?: number }> = {}): Promise<BackupCopyInspection> {
  const path = resolve(pathInput);
  requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
  return inspectBackupFileOffThread(path, expectedSchemaVersion, options);
}

/**
 * A consistent copy of the live authority database written by a worker thread: the source is only opened read-only,
 * the destination is a new file that is flushed before this resolves.
 */
export async function copyAuthorityOffThread(admission: RuntimeAdmission, sourcePathInput: string, destinationPathInput: string,
  options: Readonly<{ signal?: AbortSignal; busyTimeoutMs?: number }> = {}): Promise<void> {
  const source = resolve(sourcePathInput), destination = resolve(destinationPathInput);
  const owner = requireRuntimeAdmission(admission);
  owner.assertReadOnlyAuthorityDatabase(source);
  owner.assertAuthorityBackupWrite(destination);
  const request = CopyRequestSchema.parse({ protocol: COPY_PROTOCOL, source, destination, busyTimeoutMs: options.busyTimeoutMs ?? 250 });
  await runOnWorkerThread<undefined>(request, options.signal, message => {
    const reply = CopyReplySchema.safeParse(message);
    if (!reply.success) return { error: new Error("backup-copy-reply-invalid"), invalid: true };
    if (reply.data.kind === "copied") return { value: undefined };
    return { error: failureError(reply.data), invalid: false };
  });
}

export async function buildBackupLogsOffThread(source: string, destination: string, signal?: AbortSignal): Promise<void> {
  const request = LogBackupRequestSchema.parse({ protocol: LOG_BACKUP_PROTOCOL, source, destination });
  await runOnWorkerThread<undefined>(request, signal, message => {
    const reply = CopyReplySchema.safeParse(message);
    if (!reply.success) return { error: new Error("log-backup-reply-invalid"), invalid: true };
    return reply.data.kind === "copied" ? { value: undefined } : { error: failureError(reply.data), invalid: false };
  });
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException("backup inspection stopped", "AbortError");
}

/** The worker needs the TypeScript loader explicitly: a test runner's fork has none to inherit, and a bare `tsx` would resolve from a changed cwd. */
export function workerExecArgv(parentExecArgv: readonly string[] = process.execArgv): string[] {
  const conditions: string[] = [];
  for (let index = 0; index < parentExecArgv.length; index++) {
    const argument = parentExecArgv[index];
    if (argument.startsWith("--conditions=")) conditions.push(argument);
    else if ((argument === "--conditions" || argument === "-C") && index + 1 < parentExecArgv.length) conditions.push(`--conditions=${parentExecArgv[++index]}`);
  }
  return [...conditions, "--import", import.meta.resolve("tsx")];
}

/** Named like the snapshot copies, so a folder left by a hard-killed process is removed by the next start's sweep. */
function createScratchDirectory(): string {
  const prefix = join(realpathSync(tmpdir()), `${readonlyAuthorityCopyPrefix}${String(process.pid)}-inspection-`);
  if (process.platform !== "win32") return mkdtempSync(prefix);
  const directory = `${prefix}${randomUUID()}`;
  createPrivateDirectory(directory, { mode: 0o700 });
  return directory;
}

async function removeScratchDirectory(directory: string): Promise<void> {
  try { await rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
  catch { /* The next start's sweep removes a folder this process could not. */ }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The thread's answer to its start data: nothing for another module's worker, a failure for a request that does not parse. */
export function answerInspectionRequest(data: unknown): WorkerReply | Promise<WorkerReply> | undefined {
  const protocol = z.looseObject({ protocol: z.string() }).safeParse(data);
  if (!protocol.success) return undefined;
  if (protocol.data.protocol === PROTOCOL) {
    const request = InspectionRequestSchema.safeParse(data);
    return request.success ? runInspection(request.data) : { kind: "failed", name: "Error", message: "backup-inspection-request-invalid" };
  }
  if (protocol.data.protocol === COPY_PROTOCOL) {
    const request = CopyRequestSchema.safeParse(data);
    return request.success ? runCopy(request.data) : { kind: "failed", name: "Error", message: "backup-copy-request-invalid" };
  }
  if (protocol.data.protocol === LOG_BACKUP_PROTOCOL) {
    const request = LogBackupRequestSchema.safeParse(data);
    if (!request.success) return { kind: "failed", name: "Error", message: "log-backup-request-invalid" };
    try { restoreLogDatabases(request.data.source, request.data.destination); return { kind: "copied" }; }
    catch (error) { return failedReply(error); }
  }
  return undefined;
}

function failedReply(error: unknown): z.infer<typeof FailedReplySchema> {
  const failure = error instanceof Error ? error : new Error(String(error));
  const code = (failure as { code?: unknown }).code;
  return { kind: "failed", name: failure.name, message: failure.message, ...(typeof code === "string" ? { code } : {}) };
}

function runInspection(request: InspectionRequest): WorkerReply {
  try {
    return { kind: "inspected", inspection: BackupCopyInspectionSchema.parse(withReadonlyAuthoritySnapshot(request.path, database => inspectOpenDatabase(database, request.expectedSchemaVersion), request.busyTimeoutMs)) };
  } catch (error) {
    const failure = failedReply(error);
    return request.expectedSchemaVersion === undefined && isAuthorityInspectionIntegrityFailure(error)
      ? { ...failure, code: INTEGRITY_FAILURE_CODE } : failure;
  }
}

async function runCopy(request: CopyRequest): Promise<WorkerReply> {
  try {
    if (existsSync(request.destination)) throw new Error("backup-copy-destination-exists");
    await backupReadOnlyDatabase(request.source, request.destination, request.busyTimeoutMs);
    fsyncPath(request.destination);
    return { kind: "copied" };
  } catch (error) { return failedReply(error); }
}

if (!isMainThread && parentPort !== null) {
  const port = parentPort;
  const reply = answerInspectionRequest(workerData);
  if (reply !== undefined) void Promise.resolve(reply).then(answer => { port.postMessage(answer); });
}
