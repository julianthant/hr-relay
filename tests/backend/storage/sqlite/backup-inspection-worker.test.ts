import { existsSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, rm: vi.fn(fs.rm) };
});

vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  class Worker extends EventEmitter {
    static started: Worker[] = [];
    terminated = false;
    exited = false;
    readonly previousExited = Worker.started.every(worker => worker.exited);
    constructor(readonly entry: URL, readonly options: { execArgv: string[]; env: Record<string, string>; workerData: { path: string } }) {
      super();
      this.once("exit", () => { this.exited = true; });
      Worker.started.push(this);
    }
    terminate(): Promise<number> { this.terminated = true; return Promise.resolve(1); }
  }
  return { Worker, isMainThread: true, parentPort: null, workerData: null };
});

const { answerInspectionRequest, inspectBackupFileOffThread, workerExecArgv } = await import("../../../../src/backend/storage/sqlite/backup-inspection-worker.js");
type StubWorker = import("node:events").EventEmitter & { terminated: boolean; previousExited: boolean; options: { execArgv: string[]; env: Record<string, string>; workerData: { path: string } } };
const StubWorker = (await import("node:worker_threads")).Worker as unknown as { started: StubWorker[] };

const verdict = { applicationId: 1_217_249_861, schemaVersion: 30, pageCount: 3, authorityGeneration: 7, authorityContentFingerprint: "a".repeat(64), quickCheck: "ok",
  foreignKeyViolations: 0, invariants: { state: "valid", violations: [] }, tables: [{ name: "runs", classification: "authority" }, { name: "worker_leases", classification: "authority" }],
  counts: { pendingCommands: 0, unresolvedWriteIntents: 0, providerReservations: 0, artifactOutbox: 0 }, invariantViolations: [], exactTableRegistry: true };
const started = async (count: number) => { await vi.waitFor(() => expect(StubWorker.started).toHaveLength(count)); return StubWorker.started[count - 1]; };
const outcome = (promise: Promise<unknown>) => promise.then(value => ({ value }),
  (error: Error & { code?: unknown }) => ({ error: { name: error.name, message: error.message, code: error.code } }));
const reset = () => { StubWorker.started.length = 0; };

describe("backup inspection worker", () => {
  it("returns the inspection and holds the next worker until asynchronous scratch cleanup completes", async () => {
    reset();
    const first = inspectBackupFileOffThread("/backups/a.sqlite", 22);
    const second = inspectBackupFileOffThread("/backups/b.sqlite", 22);
    const worker = await started(1);
    expect(worker.options.workerData.path).toBe("/backups/a.sqlite");
    worker.emit("message", { kind: "inspected", inspection: verdict });
    const inspection = await first;
    expect(inspection).toEqual(verdict);
    expect(Object.isFrozen(inspection.invariants)).toBe(true);
    expect(StubWorker.started).toHaveLength(1);
    const cleanup = Promise.withResolvers<void>();
    const filesystem = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rm).mockImplementationOnce(async (path, options) => {
      await cleanup.promise;
      await filesystem.rm(path, options);
    });
    try {
      worker.emit("exit", 0);
      expect(rm).toHaveBeenLastCalledWith(worker.options.env.TMPDIR, { recursive: true, force: true, maxRetries: 3 });
      expect(existsSync(worker.options.env.TMPDIR)).toBe(true);
      expect(StubWorker.started).toHaveLength(1);
    } finally { cleanup.resolve(); }
    const next = await started(2);
    expect(next.previousExited).toBe(true);
    expect(existsSync(worker.options.env.TMPDIR)).toBe(false);
    next.emit("message", { kind: "inspected", inspection: verdict }); next.emit("exit", 0);
    await expect(second).resolves.toEqual(verdict);
  });

  it("never passes an inspection that failed, threw in the worker or ended without a verdict", async () => {
    reset();
    const failed = outcome(inspectBackupFileOffThread("/backups/a.sqlite", 22));
    const one = await started(1);
    one.emit("message", { kind: "failed", name: "Error", message: "authority-readonly-source-changed", code: "SOURCE" }); one.emit("exit", 0);
    expect(await failed).toEqual({ error: { name: "Error", message: "authority-readonly-source-changed", code: "SOURCE" } });
    const threw = outcome(inspectBackupFileOffThread("/backups/a.sqlite", 22));
    const two = await started(2);
    two.emit("error", new Error("worker crashed")); two.emit("exit", 1);
    expect(await threw).toEqual({ error: { name: "Error", message: "backup-inspection-worker-failed" } });
    const died = outcome(inspectBackupFileOffThread("/backups/a.sqlite", 22));
    const three = await started(3);
    three.emit("exit", 1);
    expect(await died).toEqual({ error: { name: "Error", message: "backup-inspection-worker-exited: 1" } });
  });

  it("never passes a reply that is malformed, incomplete or carries an unknown field, and ends that worker", async () => {
    reset();
    const { quickCheck: _quickCheck, ...incomplete } = verdict;
    const replies: unknown[] = [null, "inspected", { kind: "inspected", inspection: {} }, { kind: "inspected", inspection: incomplete },
      { kind: "inspected", inspection: { ...verdict, extra: 1 } }, { kind: "inspected", inspection: { ...verdict, quickCheck: "failed" } },
      { kind: "inspected", inspection: verdict, extra: 1 }, { kind: "failed", message: 5 }, { kind: "other" }];
    for (const [index, reply] of replies.entries()) {
      const result = outcome(inspectBackupFileOffThread("/backups/a.sqlite", 22));
      const worker = await started(index + 1);
      const scratch = worker.options.env.TMPDIR;
      worker.emit("message", reply);
      expect(await result).toEqual({ error: { name: "Error", message: "backup-inspection-reply-invalid" } });
      expect(worker.terminated).toBe(true);
      worker.emit("exit", 1);
      await vi.waitFor(() => expect(existsSync(scratch)).toBe(false));
    }
  });

  it("the thread answers a malformed request with a failure, never an inspection, and ignores another module's start data", () => {
    const request = { protocol: "relay.backup-inspection.v1", path: "/backups/a.sqlite", busyTimeoutMs: 250 };
    const invalid = { kind: "failed", name: "Error", message: "backup-inspection-request-invalid" };
    expect(answerInspectionRequest({ protocol: "relay.backup-inspection.v1" })).toEqual(invalid);
    expect(answerInspectionRequest({ ...request, path: 5 })).toEqual(invalid);
    expect(answerInspectionRequest({ ...request, path: "" })).toEqual(invalid);
    expect(answerInspectionRequest({ ...request, expectedSchemaVersion: "22" })).toEqual(invalid);
    expect(answerInspectionRequest({ ...request, extra: true })).toEqual(invalid);
    expect(answerInspectionRequest(null)).toBeUndefined();
    expect(answerInspectionRequest({ protocol: "another-worker" })).toBeUndefined();
  });

  it("a stop terminates the running worker without waiting for it, never starts a queued one and leaves no scratch folder", async () => {
    reset();
    const stop = new AbortController();
    const running = outcome(inspectBackupFileOffThread("/backups/a.sqlite", 22, { signal: stop.signal }));
    const queued = outcome(inspectBackupFileOffThread("/backups/b.sqlite", 22, { signal: stop.signal }));
    const worker = await started(1);
    const scratch = worker.options.env.TMPDIR;
    expect(scratch.startsWith(`${realpathSync(tmpdir())}/relay-readonly-authority-pid${String(process.pid)}-inspection-`)).toBe(true);
    expect(existsSync(scratch)).toBe(true);
    expect([worker.options.env.TMP, worker.options.env.TEMP]).toEqual([scratch, scratch]);
    stop.abort();
    expect(await running).toEqual({ error: { name: "AbortError", message: "This operation was aborted", code: 20 } });
    expect(await queued).toEqual({ error: { name: "AbortError", message: "This operation was aborted", code: 20 } });
    expect(worker.terminated).toBe(true);
    worker.emit("exit", 1);
    await vi.waitFor(() => expect(existsSync(scratch)).toBe(false));
    const after = outcome(inspectBackupFileOffThread("/backups/c.sqlite", 22));
    const next = await started(2);
    expect(next.options.workerData.path).toBe("/backups/c.sqlite");
    next.emit("message", { kind: "inspected", inspection: verdict }); next.emit("exit", 0);
    expect(await after).toEqual({ value: verdict });
  });

  it("starts the worker with the TypeScript loader by absolute URL and the parent's export conditions", () => {
    const argv = workerExecArgv(["--conditions", "development", "--conditions=node", "--require", "x.cjs"]);
    expect(argv.slice(0, 3)).toEqual(["--conditions=development", "--conditions=node", "--import"]);
    expect(argv[3]).toMatch(/^file:\/\/.*\/tsx\//u);
    expect(argv).toHaveLength(4);
  });
});
