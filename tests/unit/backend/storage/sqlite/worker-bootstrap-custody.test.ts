import { mkdtempSync, realpathSync, rmSync, readdirSync, readFileSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { bindWorkerProcessAdmission, acquireRuntimeProcessLock, acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot,
  WorkerProcessLockFileSchema, RuntimeProcessLockFileSchema, RestoreAdmissionFileSchema, assertWorkerProcessCustody, type ProcessIdentityObserver, type RuntimeProcessLockHandle } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { WorkerIdSchema } from "../../../../../src/rules/identity/ids.js";
import { capturedInstantClock } from "../../../../../src/rules/time/clock.js";
import { HASH_A, NOW } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const identity = { platform: "darwin" as const, startToken: "offline-owned-process" };
const observer: ProcessIdentityObserver = () => ({ state: "alive", identity });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-worker-custody-"))); roots.push(root);
  const authorityPath = join(root, "state.db"), clock = capturedInstantClock(NOW);
  const snapshot = () => observeRuntimeLockSnapshot({ processLockRoot: root, sourceDatabaseIdentity: HASH_A }, clock, { observeProcessIdentity: observer });
  const records = () => readdirSync(join(root, "workers")).filter(name => name.endsWith(".lock.json"))
    .map(name => ({ path: join(root, "workers", name), record: WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(join(root, "workers", name), "utf8"))) }));
  return { root, authorityPath, clock, snapshot, records };
}
describe("unbound worker process custody", () => {
  it("refuses historical process and restore records without authenticated OS custody", () => {
    expect(RuntimeProcessLockFileSchema.safeParse({ schemaVersion: 1, name: "server", pid: 4100,
      generation: 1, acquiredAt: NOW, releasedAt: null }).success).toBe(false);
    expect(WorkerProcessLockFileSchema.safeParse({ schemaVersion: 2, name: "workers", pid: 4100,
      workerId: "fixture-graph-worker-17", acquisitionId: "11111111-1111-4111-8111-111111111111",
      acquiredAt: NOW, releasedAt: null }).success).toBe(false);
    expect(RestoreAdmissionFileSchema.safeParse({ schemaVersion: 1, pid: 4100,
      admissionId: "11111111-1111-4111-8111-111111111111", acquiredAt: NOW }).success).toBe(false);
    const f = fixture();
    writeFileSync(join(f.root, "workers.lock.json"), JSON.stringify({ schemaVersion: 1, name: "workers", pid: 4100,
      generation: 1, acquiredAt: NOW, releasedAt: null }), { mode: 0o600 });
    expect(f.snapshot).toThrow(/malformed/u);
  });
  it("holds real unbound ownership before open and slot admission, then transfers without an observation gap", () => {
    const f = fixture(); let closed = false, acquisitions = 0;
    const bound = bindWorkerProcessAdmission({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer, afterInitialAdmissionCheck: () => {
        acquisitions += 1; if (acquisitions === 2) expect(f.snapshot().processLocks.workers.state).toBe("active");
      } },
      open: () => { expect(f.snapshot().processLocks.workers.state).toBe("active");
        const original = f.records()[0]?.record; expect(original).toMatchObject({ admission: { kind: "unbound-worker", authorityPath: f.authorityPath, processLockRoot: f.root }, pid: 4100, processIdentity: identity });
        expect(original).not.toHaveProperty("workerId"); return { opened: true }; },
      admit: () => { expect(f.snapshot().processLocks.workers.state).toBe("active"); return WorkerIdSchema.parse("fixture-graph-worker-17"); },
      close: () => { closed = true; } });
    expect(closed).toBe(false); expect(bound.workerId).toBe("fixture-graph-worker-17");
    expect(f.records().filter(value => value.record.releasedAt === null)).toHaveLength(1);
    assertWorkerProcessCustody({ processLockRoot: f.root, acquisitionId: z.uuid().parse(bound.processLock.acquisitionId), pid: 4100, workerId: bound.workerId }, { observeProcessIdentity: observer });
    bound.processLock.release(); expect(f.snapshot().processLocks.workers.state).toBe("stopped");
  });
  it("refuses restore racing before open without opening any authority", () => {
    const f = fixture(); let opened = false;
    expect(() => bindWorkerProcessAdmission({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer, afterInitialAdmissionCheck: () => {
        acquireRuntimeRestoreAdmission({ processLockRoot: f.root, pid: 4200 }, f.clock, { observeProcessIdentity: observer });
      } }, open: () => { opened = true; return {}; }, admit: () => WorkerIdSchema.parse("fixture-graph-worker-17"), close: () => {} })).toThrow(/restore admission/u);
    expect(opened).toBe(false); expect(f.snapshot().processLocks.workers.state).toBe("stopped");
  });
  it("blocks restoration during admission and retains custody until closure after stable acquisition failure", () => {
    const f = fixture(); let acquisitions = 0, closed = false;
    expect(() => bindWorkerProcessAdmission({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer, afterInitialAdmissionCheck: () => {
        acquisitions += 1; if (acquisitions === 2) { expect(f.snapshot().processLocks.workers.state).toBe("active"); throw new Error("stable-acquisition-fault"); }
      } }, open: () => ({}), admit: () => { expect(f.snapshot().processLocks.workers.state).toBe("active"); return WorkerIdSchema.parse("fixture-graph-worker-17"); },
      close: () => { expect(f.snapshot().processLocks.workers.state).toBe("active"); closed = true; } })).toThrow("stable-acquisition-fault");
    expect(closed).toBe(true); expect(f.snapshot().processLocks.workers.state).toBe("stopped");
  });
  it("refuses restore racing during transfer and closes authority before releasing bootstrap custody", () => {
    const f = fixture(); let acquisitions = 0, closed = false;
    expect(() => bindWorkerProcessAdmission({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer, afterInitialAdmissionCheck: () => {
        acquisitions += 1;
        if (acquisitions === 2) {
          expect(f.snapshot().processLocks.workers.state).toBe("active");
          acquireRuntimeRestoreAdmission({ processLockRoot: f.root, pid: 4200 }, f.clock, { observeProcessIdentity: observer });
        }
      } }, open: () => ({}), admit: () => WorkerIdSchema.parse("fixture-graph-worker-17"),
      close: () => { expect(f.snapshot().processLocks.workers.state).toBe("active"); closed = true; } })).toThrow(/restore admission/u);
    expect(closed).toBe(true); expect(f.snapshot().processLocks.workers.state).toBe("stopped");
  });
  it("reports release uncertainty after closure when bootstrap custody bytes are forged", () => {
    const f = fixture(); let acquisitions = 0, closed = false;
    expect(() => bindWorkerProcessAdmission({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer, afterInitialAdmissionCheck: () => {
        acquisitions += 1;
        if (acquisitions === 2) { const original = f.records()[0]; if (original === undefined) throw new Error("missing admission"); writeFileSync(original.path, "{}"); }
      } }, open: () => ({}), admit: () => WorkerIdSchema.parse("fixture-graph-worker-17"),
      close: () => { closed = true; } })).toThrow(/custody is uncertain/u);
    expect(closed).toBe(true); expect(f.snapshot).toThrow(/malformed/u);
  });
  it("retains blocking admission when authority close fails after slot admission", () => {
    const f = fixture();
    expect(() => bindWorkerProcessAdmission({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer }, open: () => ({}), admit: () => { throw new Error("after-slot-fault"); },
      close: () => { throw new Error("database-close-unproved"); } })).toThrow(/custody is uncertain/u);
    expect(f.snapshot().processLocks.workers.state).toBe("active");
    expect(f.records()[0]?.record.releasedAt).toBeNull();
  });
  it("refuses PID reuse and malformed, forged or unsafe bootstrap records", () => {
    const f = fixture(); let bootstrapId = "";
    expect(() => bindWorkerProcessAdmission({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer }, open: () => ({}), admit: (_value, acquisitionId) => { bootstrapId = acquisitionId; throw new Error("retain"); },
      close: () => { throw new Error("retain-open"); } })).toThrow();
    expect(() => assertWorkerProcessCustody({ processLockRoot: f.root, acquisitionId: bootstrapId, pid: 4100, authorityPath: f.authorityPath },
      { observeProcessIdentity: () => ({ state: "alive", identity: { ...identity, startToken: "reused-pid" } }) })).toThrow(/not-held/u);
    const saved = f.records()[0]; if (saved === undefined) throw new Error("missing admission"); const bytes = readFileSync(saved.path, "utf8");
    writeFileSync(saved.path, "{}"); expect(f.snapshot).toThrow(/malformed/u);
    writeFileSync(saved.path, bytes.replace(f.authorityPath, "relative.db")); expect(f.snapshot).toThrow(/malformed/u);
    unlinkSync(saved.path); const external = join(f.root, "external.json"); writeFileSync(external, bytes); symlinkSync(external, saved.path);
    expect(f.snapshot).toThrow(/unexpected|unsafe/u);
  });
});

describe("first installation worker custody", () => {
  function initialFixture() {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-first-worker-"))); roots.push(workspace);
    const root = join(workspace, rebuildRuntimeIsolation.processLockRoot);
    const authorityPath = join(workspace, rebuildRuntimeIsolation.stateRoot, "state.db");
    let custody: RuntimeProcessLockHandle | undefined;
    const snapshot = () => observeRuntimeLockSnapshot({ processLockRoot: root, sourceDatabaseIdentity: HASH_A });
    const acquire = () => acquireEntrypointAdmission(workspace, "shared", pair => {
      expect(join(pair.stateRoot, "state.db")).toBe(authorityPath);
      custody ??= acquireRuntimeProcessLock({ processLockRoot: root, name: "workers", pid: process.pid,
        admission: { kind: "unbound-worker", authorityPath } });
    });
    return { root, authorityPath, snapshot, acquire, custody: () => {
      if (custody === undefined) throw new Error("missing first-install custody"); return custody;
    } };
  }
  it("holds the same genuine admission inside first-install open and subsequent composition open", () => {
    const f = initialFixture(), originalOpen = AuthorityDatabase.open.bind(AuthorityDatabase);
    const openings: string[] = [];
    vi.spyOn(AuthorityDatabase, "open").mockImplementation((admission, options, clock) => {
      expect(f.snapshot().processLocks.workers.state).toBe("active");
      openings.push(z.uuid().parse(f.custody().acquisitionId));
      return originalOpen(admission, options, clock);
    });
    const admission = f.acquire();
    try {
      expect(f.snapshot().processLocks.workers.state).toBe("active");
      const bound = bindWorkerProcessAdmission({ processLockRoot: f.root, authorityPath: f.authorityPath,
        pid: process.pid, clock: capturedInstantClock(NOW), initialCustody: f.custody(),
        workerId: "fixture-graph-worker-17",
        open: () => AuthorityDatabase.open(admission, { path: f.authorityPath, busyTimeoutMs: 250, migrationOwner: "unit-test" }),
        admit: () => WorkerIdSchema.parse("fixture-graph-worker-17"), close: database => database.close() });
      expect(openings).toHaveLength(2); expect(new Set(openings).size).toBe(1);
      expect(bound.processLock.acquisitionId).not.toBe(f.custody().acquisitionId);
      bound.value.close(); bound.processLock.release();
      expect(f.snapshot().processLocks.workers.state).toBe("stopped");
    } finally { admission.release(); }
  });
  it("retains blocking first-install custody on an AuthorityDatabase opening callback failure", () => {
    const f = initialFixture();
    vi.spyOn(AuthorityDatabase, "open").mockImplementation(() => {
      expect(f.snapshot().processLocks.workers.state).toBe("active"); throw new Error("initial-open-fault");
    });
    expect(f.acquire).toThrow("initial-open-fault");
    expect(f.snapshot().processLocks.workers.state).toBe("active"); f.custody().release();
  });
  it("retains blocking custody through a first-install close fault", () => {
    const f = initialFixture();
    const originalClose = Object.getOwnPropertyDescriptor(AuthorityDatabase.prototype, "close")?.value as (this: AuthorityDatabase) => void;
    vi.spyOn(AuthorityDatabase.prototype, "close").mockImplementation(function (this: AuthorityDatabase) {
      expect(f.snapshot().processLocks.workers.state).toBe("active");
      originalClose.call(this); throw new Error("initial-close-unproved");
    });
    expect(f.acquire).toThrow("initial-close-unproved");
    expect(f.snapshot().processLocks.workers.state).toBe("active"); f.custody().release();
  });
});
