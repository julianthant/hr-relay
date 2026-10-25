import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { retireWorkerStartupCustody, authenticateWorkerBirthCustody, authenticateRetainedWorkerCustody, acquireRuntimeProcessLock, acquireRuntimeRestoreAdmission, assertWorkerProcessCustody, bindWorkerProcessAdmission, observeRuntimeLockSnapshot, RestoreAdmissionFileSchema, RuntimeProcessLockFileSchema, WorkerProcessLockFileSchema, type ProcessIdentityObserver, type RuntimeProcessLockHandle } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { createFirstInstallCustodyFixture } from "../../../support/helpers/storage/first-install-custody-fixtures.js";
import { HASH_A, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

{

const roots: string[] = [];
const _afterEachFixture0 = () => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); };
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-singleton-custody-"))); roots.push(root);
  const owners = new Map([[4100, "first"], [4200, "second"]]);
  const observer: ProcessIdentityObserver = pid => {
    const token = owners.get(pid);
    return token === undefined ? { state: "gone" } : { state: "alive", identity: { platform: "darwin", startToken: token } };
  };
  const clock = capturedInstantClock(NOW);
  const snapshot = () => observeRuntimeLockSnapshot({ processLockRoot: root, sourceDatabaseIdentity: HASH_A }, clock, { observeProcessIdentity: observer });
  return { root, owners, observer, clock, snapshot };
}
describe("immutable singleton process custody", () => {
afterEach(_afterEachFixture0);

  it("authenticates only the actual stable live worker acquisition and retains immutable recovery evidence", () => {
    const f = fixture();
    const workerId = "person-lookup-worker-1";
    const authorityPath = join(f.root, "state.db");
    const unbound = acquireRuntimeProcessLock({ processLockRoot: f.root, name: "workers", pid: 4100,
      admission: { kind: "unbound-worker", authorityPath: join(f.root, "state.db") } }, f.clock, { observeProcessIdentity: f.observer });
    expect(() => authenticateWorkerBirthCustody(unbound, workerId, 4100, authorityPath)).toThrow("worker-birth-custody-unavailable");
    const direct = acquireRuntimeProcessLock({ processLockRoot: f.root, name: "workers", pid: 4100, workerId }, f.clock, { observeProcessIdentity: f.observer });
    expect(() => authenticateWorkerBirthCustody(direct, workerId, 4100, authorityPath)).toThrow("worker-birth-custody-unavailable");
    direct.release();
    const { processLock: lock } = bindWorkerProcessAdmission({ processLockRoot: f.root, authorityPath, workerId, pid: 4100,
      clock: f.clock, hooks: { observeProcessIdentity: f.observer }, open: () => ({}), admit: () => WorkerIdSchema.parse(workerId), close: () => undefined });
    expect(() => authenticateWorkerBirthCustody(lock, workerId, 4100, join(f.root, "other.db"))).toThrow("worker-birth-custody-unavailable");
    const retained = authenticateWorkerBirthCustody(lock, workerId, 4100, authorityPath);
    expect(retained.owner).toMatchObject({ workerId, acquisitionId: lock.acquisitionId, releasedAt: null });
    expect(() => authenticateWorkerBirthCustody({ ...lock }, workerId, 4100, authorityPath)).toThrow("worker-birth-custody-unavailable");
    expect(() => authenticateWorkerBirthCustody(lock, "person-lookup-worker-2", 4100, authorityPath)).toThrow("worker-birth-custody-unavailable");
    expect(authenticateRetainedWorkerCustody(retained, { observeProcessIdentity: f.observer })).toBe("alive");
    expect(authenticateWorkerBirthCustody(lock, workerId, 4100, authorityPath, true).owner).toEqual(retained.owner);
    retireWorkerStartupCustody(lock);
    expect(() => authenticateWorkerBirthCustody(lock, workerId, 4100, authorityPath, true)).toThrow("worker-birth-custody-unavailable");
    expect(authenticateWorkerBirthCustody(lock, workerId, 4100, authorityPath).owner).toEqual(retained.owner);
    lock.release();
    expect(() => authenticateWorkerBirthCustody(lock, workerId, 4100, authorityPath)).toThrow("worker-birth-custody-unavailable");
    expect(authenticateRetainedWorkerCustody(retained, { observeProcessIdentity: f.observer })).toBe("released-alive");
    f.owners.delete(4100);
    expect(authenticateRetainedWorkerCustody(retained, { observeProcessIdentity: f.observer })).toBe("released");
    f.owners.set(4100, "reused-pid");
    expect(() => authenticateRetainedWorkerCustody(retained, { observeProcessIdentity: f.observer })).toThrow("worker-birth-process-identity-changed");
    f.owners.delete(4100);
    const path = join(f.root, "workers", `${lock.acquisitionId}.lock.json`);
    const current = readFileSync(path, "utf8");
    writeFileSync(path, JSON.stringify({ ...JSON.parse(current), acquiredAt: "2025-01-01T00:00:00.000Z" }));
    expect(() => authenticateRetainedWorkerCustody(retained, { observeProcessIdentity: f.observer })).toThrow("worker-birth-custody-changed");
    unlinkSync(path);
    expect(() => authenticateRetainedWorkerCustody(retained, { observeProcessIdentity: f.observer })).toThrow();
    unbound.release();
  });


  it.each(["server", "live-smoke"] as const)("refuses a stale %s acquisition after a competing owner publishes the same generation", role => {
    const f = fixture(); let winner: RuntimeProcessLockHandle | undefined;
    expect(() => acquireRuntimeProcessLock({ processLockRoot: f.root, name: role, pid: 4100 }, f.clock, {
      observeProcessIdentity: f.observer, afterSingletonGenerationRead: () => {
        winner = acquireRuntimeProcessLock({ processLockRoot: f.root, name: role, pid: 4200 }, f.clock, { observeProcessIdentity: f.observer });
      },
    })).toThrow(/EEXIST/u);
    expect(f.snapshot().processLocks[role]).toMatchObject({ state: "active", pid: 4200, generation: 2 });
    expect(() => acquireRuntimeProcessLock({ processLockRoot: f.root, name: role, pid: 4100 }, f.clock, { observeProcessIdentity: f.observer })).toThrow(/held by live pid/u);
    winner?.release(); expect(f.snapshot().processLocks[role].state).toBe("stopped");
  });
  it.each(["server", "live-smoke", "geocode"] as const)("keeps a newer %s owner active when the stale original owner releases after PID reuse", role => {
    const f = fixture();
    const first = acquireRuntimeProcessLock({ processLockRoot: f.root, name: role, pid: 4100 }, f.clock, { observeProcessIdentity: f.observer });
    const original = readFileSync(join(f.root, `${role}-claims`, "2.claim.json"));
    f.owners.set(4100, "reused-pid");
    const second = acquireRuntimeProcessLock({ processLockRoot: f.root, name: role, pid: 4200 }, f.clock, { observeProcessIdentity: f.observer });
    expect(second.generation).toBe(3); first.release(); first.release();
    expect(readFileSync(join(f.root, `${role}-claims`, "2.claim.json"))).toEqual(original);
    expect(f.snapshot().processLocks[role]).toMatchObject({ state: "active", pid: 4200, generation: 3 });
    second.release(); expect(f.snapshot().processLocks[role].state).toBe("stopped");
  });
  it.each(["identity", "release", "symlink"] as const)("refuses %s custody corruption without reporting stopped", fault => {
    const f = fixture(); const lock = acquireRuntimeProcessLock({ processLockRoot: f.root, name: "server", pid: 4100 }, f.clock, { observeProcessIdentity: f.observer });
    const path = join(f.root, "server-claims", "2.claim.json"), original = readFileSync(path);
    if (fault === "identity") { const record = JSON.parse(original.toString()) as Record<string, unknown>; writeFileSync(path, JSON.stringify({ ...record, generation: 3 })); }
    else if (fault === "release") writeFileSync(join(f.root, "server-claims", `2-${String(lock.acquisitionId)}.release.json`), "{}");
    else { const target = join(f.root, "forged.json"); writeFileSync(target, original); unlinkSync(path); symlinkSync(target, path); }
    expect(f.snapshot).toThrow(); expect(() => lock.release()).toThrow();
  });
});
}

{

const roots: string[] = [];
const _afterEachFixture0 = () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); };
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
afterEach(_afterEachFixture0);

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
afterEach(_afterEachFixture0);

  function initialFixture() {
    return createFirstInstallCustodyFixture(roots, HASH_A);
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
    } finally { admission.release(); f.close(); }
  });
});
}
