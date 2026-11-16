import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { createPrivateDirectory } from "../private-path.js";
import { inspectOpenDatabase, type BackupCopyInspection } from "./backup-inspection.js";
import { withReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";

const PROTOCOL = "relay.backup-inspection.v1";
type InspectionRequest = Readonly<{ protocol: typeof PROTOCOL; path: string; expectedSchemaVersion?: number; busyTimeoutMs: number; scratchDirectory: string }>;
type InspectionReply = { kind: "inspected"; inspection: BackupCopyInspection } | { kind: "failed"; name: string; message: string; code?: string };

/** Each queued inspection waits for the previous worker thread to exit, so at most one runs in this process. */
let previousThread: Promise<void> = Promise.resolve();

/**
 * The full read-only inspection of a private database file, run on a worker thread: path in, inspection out.
 * Resolves only from the worker's verdict; a failed inspection, a worker error or a worker exit without a verdict
 * rejects. An abort rejects at once and terminates the worker without waiting for it; the thread's scratch
 * folder is removed when it exits.
 */
export function inspectBackupFileOffThread(path: string, expectedSchemaVersion: number | undefined,
  options: Readonly<{ signal?: AbortSignal; busyTimeoutMs?: number }> = {}): Promise<BackupCopyInspection> {
  const { signal, busyTimeoutMs = 250 } = options;
  let releaseTurn!: () => void;
  const turn = previousThread;
  previousThread = new Promise(resolve => { releaseTurn = resolve; });
  return new Promise<BackupCopyInspection>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
    const stopWhileQueued = () => fail(abortReason(signal));
    if (signal?.aborted === true) stopWhileQueued(); else signal?.addEventListener("abort", stopWhileQueued, { once: true });
    void turn.then(() => {
      signal?.removeEventListener("abort", stopWhileQueued);
      if (settled) { releaseTurn(); return; }
      let scratchDirectory: string, worker: Worker;
      try {
        scratchDirectory = createScratchDirectory();
      } catch (error) { releaseTurn(); fail(new Error("backup-inspection-scratch-failed", { cause: error })); return; }
      try {
        worker = new Worker(new URL("./backup-inspection-worker.js", import.meta.url), { name: "relay-backup-inspection", execArgv: workerExecArgv(),
          workerData: { protocol: PROTOCOL, path, ...(expectedSchemaVersion === undefined ? {} : { expectedSchemaVersion }), busyTimeoutMs, scratchDirectory } satisfies InspectionRequest });
      } catch (error) { removeScratchDirectory(scratchDirectory); releaseTurn(); fail(new Error("backup-inspection-worker-failed", { cause: error })); return; }
      const stop = () => { fail(abortReason(signal)); void worker.terminate(); };
      signal?.addEventListener("abort", stop, { once: true });
      worker.once("message", (reply: InspectionReply) => {
        if (settled) return;
        if (reply.kind === "inspected") { settled = true; resolve(deepFreeze(reply.inspection)); return; }
        fail(Object.assign(new Error(reply.message), reply.code === undefined ? {} : { code: reply.code }));
      });
      worker.once("error", error => fail(new Error("backup-inspection-worker-failed", { cause: error })));
      worker.once("messageerror", error => fail(new Error("backup-inspection-worker-failed", { cause: error })));
      worker.once("exit", exitCode => {
        signal?.removeEventListener("abort", stop);
        removeScratchDirectory(scratchDirectory);
        releaseTurn();
        fail(new Error(`backup-inspection-worker-exited: ${String(exitCode)}`));
      });
    });
  });
}

/** The same inspection as inspectAuthorityBackupReadOnly, admitted here on the main thread and run on a worker thread. */
export async function inspectAuthorityBackupOffThread(admission: RuntimeAdmission, pathInput: string, expectedSchemaVersion: number | undefined,
  options: Readonly<{ signal?: AbortSignal; busyTimeoutMs?: number }> = {}): Promise<BackupCopyInspection> {
  const path = resolve(pathInput);
  requireRuntimeAdmission(admission).assertReadOnlyAuthorityDatabase(path);
  return inspectBackupFileOffThread(path, expectedSchemaVersion, options);
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
  const prefix = join(realpathSync(tmpdir()), `relay-readonly-authority-pid${String(process.pid)}-inspection-`);
  if (process.platform !== "win32") return mkdtempSync(prefix);
  const directory = `${prefix}${randomUUID()}`;
  createPrivateDirectory(directory, { mode: 0o700 });
  return directory;
}

function removeScratchDirectory(directory: string): void {
  try { rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); }
  catch { /* The next start's sweep removes a folder this process could not. */ }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isInspectionRequest(value: unknown): value is InspectionRequest {
  return typeof value === "object" && value !== null && (value as { protocol?: unknown }).protocol === PROTOCOL;
}

function runInspection(request: InspectionRequest): InspectionReply {
  // os.tmpdir() reads this thread's own environment, so the snapshot copy lands in the folder the parent removes.
  for (const key of ["TMPDIR", "TMP", "TEMP"]) process.env[key] = request.scratchDirectory;
  try {
    return { kind: "inspected", inspection: withReadonlyAuthoritySnapshot(request.path, database => inspectOpenDatabase(database, request.expectedSchemaVersion), request.busyTimeoutMs) };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const code = (failure as { code?: unknown }).code;
    return { kind: "failed", name: failure.name, message: failure.message, ...(typeof code === "string" ? { code } : {}) };
  }
}

if (!isMainThread && parentPort !== null && isInspectionRequest(workerData)) parentPort.postMessage(runInspection(workerData));
