import { mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,readdirSync as readdirSync_m1,readFileSync as readFileSync_m0,readFileSync as readFileSync_m1,realpathSync as realpathSync_m0,realpathSync as realpathSync_m1,rmSync as rmSync_m0,rmSync as rmSync_m1,symlinkSync as symlinkSync_m0,symlinkSync as symlinkSync_m1,unlinkSync as unlinkSync_m0,unlinkSync as unlinkSync_m1,writeFileSync as writeFileSync_m0,writeFileSync as writeFileSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { afterEach as afterEach_m0,afterEach as afterEach_m1,describe as describe_m0,describe as describe_m1,expect as expect_m0,expect as expect_m1,it as it_m0,it as it_m1,vi } from "vitest";
import { z as z_m1 } from "zod";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m1 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m1 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase as AuthorityDatabase_m1 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeProcessLock as acquireRuntimeProcessLock_m0,acquireRuntimeProcessLock as acquireRuntimeProcessLock_m1,acquireRuntimeRestoreAdmission as acquireRuntimeRestoreAdmission_m1,assertWorkerProcessCustody as assertWorkerProcessCustody_m1,bindWorkerProcessAdmission as bindWorkerProcessAdmission_m1,observeRuntimeLockSnapshot as observeRuntimeLockSnapshot_m0,observeRuntimeLockSnapshot as observeRuntimeLockSnapshot_m1,RestoreAdmissionFileSchema as RestoreAdmissionFileSchema_m1,RuntimeProcessLockFileSchema as RuntimeProcessLockFileSchema_m1,WorkerProcessLockFileSchema as WorkerProcessLockFileSchema_m1,type ProcessIdentityObserver as ProcessIdentityObserver_m0,type ProcessIdentityObserver as ProcessIdentityObserver_m1,type RuntimeProcessLockHandle as RuntimeProcessLockHandle_m0,type RuntimeProcessLockHandle as RuntimeProcessLockHandle_m1 } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { WorkerIdSchema as WorkerIdSchema_m1 } from "../../../../src/rules/identity/ids.js";
import { capturedInstantClock as capturedInstantClock_m0,capturedInstantClock as capturedInstantClock_m1 } from "../../../../src/rules/time/clock.js";
import { HASH_A as HASH_A_m0,HASH_A as HASH_A_m1,NOW as NOW_m0,NOW as NOW_m1 } from "../../../support/fixtures/phase1c-contract-fixtures.js";


{

const roots: string[] = [];
const _afterEachFixture0 = () => { for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true }); };
function fixture() {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "relay-singleton-custody-"))); roots.push(root);
  const owners = new Map([[4100, "first"], [4200, "second"]]);
  const observer: ProcessIdentityObserver_m0 = pid => {
    const token = owners.get(pid);
    return token === undefined ? { state: "gone" } : { state: "alive", identity: { platform: "darwin", startToken: token } };
  };
  const clock = capturedInstantClock_m0(NOW_m0);
  const snapshot = () => observeRuntimeLockSnapshot_m0({ processLockRoot: root, sourceDatabaseIdentity: HASH_A_m0 }, clock, { observeProcessIdentity: observer });
  return { root, owners, observer, clock, snapshot };
}
describe_m0("immutable singleton process custody", () => {
afterEach_m0(_afterEachFixture0);

  it_m0.each(["server", "live-smoke"] as const)("refuses a stale %s acquisition after a competing owner publishes the same generation", role => {
    const f = fixture(); let winner: RuntimeProcessLockHandle_m0 | undefined;
    expect_m0(() => acquireRuntimeProcessLock_m0({ processLockRoot: f.root, name: role, pid: 4100 }, f.clock, {
      observeProcessIdentity: f.observer, afterSingletonGenerationRead: () => {
        winner = acquireRuntimeProcessLock_m0({ processLockRoot: f.root, name: role, pid: 4200 }, f.clock, { observeProcessIdentity: f.observer });
      },
    })).toThrow(/EEXIST/u);
    expect_m0(f.snapshot().processLocks[role]).toMatchObject({ state: "active", pid: 4200, generation: 2 });
    expect_m0(() => acquireRuntimeProcessLock_m0({ processLockRoot: f.root, name: role, pid: 4100 }, f.clock, { observeProcessIdentity: f.observer })).toThrow(/held by live pid/u);
    winner?.release(); expect_m0(f.snapshot().processLocks[role].state).toBe("stopped");
  });
  it_m0.each(["server", "live-smoke", "geocode"] as const)("keeps a newer %s owner active when the stale original owner releases after PID reuse", role => {
    const f = fixture();
    const first = acquireRuntimeProcessLock_m0({ processLockRoot: f.root, name: role, pid: 4100 }, f.clock, { observeProcessIdentity: f.observer });
    const original = readFileSync_m0(join_m0(f.root, `${role}-claims`, "2.claim.json"));
    f.owners.set(4100, "reused-pid");
    const second = acquireRuntimeProcessLock_m0({ processLockRoot: f.root, name: role, pid: 4200 }, f.clock, { observeProcessIdentity: f.observer });
    expect_m0(second.generation).toBe(3); first.release(); first.release();
    expect_m0(readFileSync_m0(join_m0(f.root, `${role}-claims`, "2.claim.json"))).toEqual(original);
    expect_m0(f.snapshot().processLocks[role]).toMatchObject({ state: "active", pid: 4200, generation: 3 });
    second.release(); expect_m0(f.snapshot().processLocks[role].state).toBe("stopped");
  });
  it_m0.each(["identity", "release", "symlink"] as const)("refuses %s custody corruption without reporting stopped", fault => {
    const f = fixture(); const lock = acquireRuntimeProcessLock_m0({ processLockRoot: f.root, name: "server", pid: 4100 }, f.clock, { observeProcessIdentity: f.observer });
    const path = join_m0(f.root, "server-claims", "2.claim.json"), original = readFileSync_m0(path);
    if (fault === "identity") { const record = JSON.parse(original.toString()) as Record<string, unknown>; writeFileSync_m0(path, JSON.stringify({ ...record, generation: 3 })); }
    else if (fault === "release") writeFileSync_m0(join_m0(f.root, "server-claims", `2-${String(lock.acquisitionId)}.release.json`), "{}");
    else { const target = join_m0(f.root, "forged.json"); writeFileSync_m0(target, original); unlinkSync_m0(path); symlinkSync_m0(target, path); }
    expect_m0(f.snapshot).toThrow(); expect_m0(() => lock.release()).toThrow();
  });
});
}

{

const roots: string[] = [];
const _afterEachFixture0 = () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync_m1(root, { recursive: true, force: true }); };
const identity = { platform: "darwin" as const, startToken: "offline-owned-process" };
const observer: ProcessIdentityObserver_m1 = () => ({ state: "alive", identity });
function fixture() {
  const root = realpathSync_m1(mkdtempSync_m1(join_m1(tmpdir_m1(), "relay-worker-custody-"))); roots.push(root);
  const authorityPath = join_m1(root, "state.db"), clock = capturedInstantClock_m1(NOW_m1);
  const snapshot = () => observeRuntimeLockSnapshot_m1({ processLockRoot: root, sourceDatabaseIdentity: HASH_A_m1 }, clock, { observeProcessIdentity: observer });
  const records = () => readdirSync_m1(join_m1(root, "workers")).filter(name => name.endsWith(".lock.json"))
    .map(name => ({ path: join_m1(root, "workers", name), record: WorkerProcessLockFileSchema_m1.parse(JSON.parse(readFileSync_m1(join_m1(root, "workers", name), "utf8"))) }));
  return { root, authorityPath, clock, snapshot, records };
}
describe_m1("unbound worker process custody", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("refuses historical process and restore records without authenticated OS custody", () => {
    expect_m1(RuntimeProcessLockFileSchema_m1.safeParse({ schemaVersion: 1, name: "server", pid: 4100,
      generation: 1, acquiredAt: NOW_m1, releasedAt: null }).success).toBe(false);
    expect_m1(WorkerProcessLockFileSchema_m1.safeParse({ schemaVersion: 2, name: "workers", pid: 4100,
      workerId: "fixture-graph-worker-17", acquisitionId: "11111111-1111-4111-8111-111111111111",
      acquiredAt: NOW_m1, releasedAt: null }).success).toBe(false);
    expect_m1(RestoreAdmissionFileSchema_m1.safeParse({ schemaVersion: 1, pid: 4100,
      admissionId: "11111111-1111-4111-8111-111111111111", acquiredAt: NOW_m1 }).success).toBe(false);
    const f = fixture();
    writeFileSync_m1(join_m1(f.root, "workers.lock.json"), JSON.stringify({ schemaVersion: 1, name: "workers", pid: 4100,
      generation: 1, acquiredAt: NOW_m1, releasedAt: null }), { mode: 0o600 });
    expect_m1(f.snapshot).toThrow(/malformed/u);
  });
  it_m1("holds real unbound ownership before open and slot admission, then transfers without an observation gap", () => {
    const f = fixture(); let closed = false, acquisitions = 0;
    const bound = bindWorkerProcessAdmission_m1({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer, afterInitialAdmissionCheck: () => {
        acquisitions += 1; if (acquisitions === 2) expect_m1(f.snapshot().processLocks.workers.state).toBe("active");
      } },
      open: () => { expect_m1(f.snapshot().processLocks.workers.state).toBe("active");
        const original = f.records()[0]?.record; expect_m1(original).toMatchObject({ admission: { kind: "unbound-worker", authorityPath: f.authorityPath, processLockRoot: f.root }, pid: 4100, processIdentity: identity });
        expect_m1(original).not.toHaveProperty("workerId"); return { opened: true }; },
      admit: () => { expect_m1(f.snapshot().processLocks.workers.state).toBe("active"); return WorkerIdSchema_m1.parse("fixture-graph-worker-17"); },
      close: () => { closed = true; } });
    expect_m1(closed).toBe(false); expect_m1(bound.workerId).toBe("fixture-graph-worker-17");
    expect_m1(f.records().filter(value => value.record.releasedAt === null)).toHaveLength(1);
    assertWorkerProcessCustody_m1({ processLockRoot: f.root, acquisitionId: z_m1.uuid().parse(bound.processLock.acquisitionId), pid: 4100, workerId: bound.workerId }, { observeProcessIdentity: observer });
    bound.processLock.release(); expect_m1(f.snapshot().processLocks.workers.state).toBe("stopped");
  });
  it_m1("refuses restore racing before open without opening any authority", () => {
    const f = fixture(); let opened = false;
    expect_m1(() => bindWorkerProcessAdmission_m1({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer, afterInitialAdmissionCheck: () => {
        acquireRuntimeRestoreAdmission_m1({ processLockRoot: f.root, pid: 4200 }, f.clock, { observeProcessIdentity: observer });
      } }, open: () => { opened = true; return {}; }, admit: () => WorkerIdSchema_m1.parse("fixture-graph-worker-17"), close: () => {} })).toThrow(/restore admission/u);
    expect_m1(opened).toBe(false); expect_m1(f.snapshot().processLocks.workers.state).toBe("stopped");
  });
  it_m1("blocks restoration during admission and retains custody until closure after stable acquisition failure", () => {
    const f = fixture(); let acquisitions = 0, closed = false;
    expect_m1(() => bindWorkerProcessAdmission_m1({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer, afterInitialAdmissionCheck: () => {
        acquisitions += 1; if (acquisitions === 2) { expect_m1(f.snapshot().processLocks.workers.state).toBe("active"); throw new Error("stable-acquisition-fault"); }
      } }, open: () => ({}), admit: () => { expect_m1(f.snapshot().processLocks.workers.state).toBe("active"); return WorkerIdSchema_m1.parse("fixture-graph-worker-17"); },
      close: () => { expect_m1(f.snapshot().processLocks.workers.state).toBe("active"); closed = true; } })).toThrow("stable-acquisition-fault");
    expect_m1(closed).toBe(true); expect_m1(f.snapshot().processLocks.workers.state).toBe("stopped");
  });
  it_m1("refuses restore racing during transfer and closes authority before releasing bootstrap custody", () => {
    const f = fixture(); let acquisitions = 0, closed = false;
    expect_m1(() => bindWorkerProcessAdmission_m1({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer, afterInitialAdmissionCheck: () => {
        acquisitions += 1;
        if (acquisitions === 2) {
          expect_m1(f.snapshot().processLocks.workers.state).toBe("active");
          acquireRuntimeRestoreAdmission_m1({ processLockRoot: f.root, pid: 4200 }, f.clock, { observeProcessIdentity: observer });
        }
      } }, open: () => ({}), admit: () => WorkerIdSchema_m1.parse("fixture-graph-worker-17"),
      close: () => { expect_m1(f.snapshot().processLocks.workers.state).toBe("active"); closed = true; } })).toThrow(/restore admission/u);
    expect_m1(closed).toBe(true); expect_m1(f.snapshot().processLocks.workers.state).toBe("stopped");
  });
  it_m1("reports release uncertainty after closure when bootstrap custody bytes are forged", () => {
    const f = fixture(); let acquisitions = 0, closed = false;
    expect_m1(() => bindWorkerProcessAdmission_m1({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer, afterInitialAdmissionCheck: () => {
        acquisitions += 1;
        if (acquisitions === 2) { const original = f.records()[0]; if (original === undefined) throw new Error("missing admission"); writeFileSync_m1(original.path, "{}"); }
      } }, open: () => ({}), admit: () => WorkerIdSchema_m1.parse("fixture-graph-worker-17"),
      close: () => { closed = true; } })).toThrow(/custody is uncertain/u);
    expect_m1(closed).toBe(true); expect_m1(f.snapshot).toThrow(/malformed/u);
  });
  it_m1("retains blocking admission when authority close fails after slot admission", () => {
    const f = fixture();
    expect_m1(() => bindWorkerProcessAdmission_m1({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer }, open: () => ({}), admit: () => { throw new Error("after-slot-fault"); },
      close: () => { throw new Error("database-close-unproved"); } })).toThrow(/custody is uncertain/u);
    expect_m1(f.snapshot().processLocks.workers.state).toBe("active");
    expect_m1(f.records()[0]?.record.releasedAt).toBeNull();
  });
  it_m1("refuses PID reuse and malformed, forged or unsafe bootstrap records", () => {
    const f = fixture(); let bootstrapId = "";
    expect_m1(() => bindWorkerProcessAdmission_m1({ processLockRoot: f.root, authorityPath: f.authorityPath, pid: 4100, clock: f.clock,
      hooks: { observeProcessIdentity: observer }, open: () => ({}), admit: (_value, acquisitionId) => { bootstrapId = acquisitionId; throw new Error("retain"); },
      close: () => { throw new Error("retain-open"); } })).toThrow();
    expect_m1(() => assertWorkerProcessCustody_m1({ processLockRoot: f.root, acquisitionId: bootstrapId, pid: 4100, authorityPath: f.authorityPath },
      { observeProcessIdentity: () => ({ state: "alive", identity: { ...identity, startToken: "reused-pid" } }) })).toThrow(/not-held/u);
    const saved = f.records()[0]; if (saved === undefined) throw new Error("missing admission"); const bytes = readFileSync_m1(saved.path, "utf8");
    writeFileSync_m1(saved.path, "{}"); expect_m1(f.snapshot).toThrow(/malformed/u);
    writeFileSync_m1(saved.path, bytes.replace(f.authorityPath, "relative.db")); expect_m1(f.snapshot).toThrow(/malformed/u);
    unlinkSync_m1(saved.path); const external = join_m1(f.root, "external.json"); writeFileSync_m1(external, bytes); symlinkSync_m1(external, saved.path);
    expect_m1(f.snapshot).toThrow(/unexpected|unsafe/u);
  });
});

describe_m1("first installation worker custody", () => {
afterEach_m1(_afterEachFixture0);

  function initialFixture() {
    const workspace = realpathSync_m1(mkdtempSync_m1(join_m1(tmpdir_m1(), "relay-first-worker-"))); roots.push(workspace);
    const root = join_m1(workspace, rebuildRuntimeIsolation_m1.processLockRoot);
    const authorityPath = join_m1(workspace, rebuildRuntimeIsolation_m1.stateRoot, "state.db");
    let custody: RuntimeProcessLockHandle_m1 | undefined;
    const snapshot = () => observeRuntimeLockSnapshot_m1({ processLockRoot: root, sourceDatabaseIdentity: HASH_A_m1 });
    const acquire = () => acquireEntrypointAdmission_m1(workspace, "shared", pair => {
      expect_m1(join_m1(pair.stateRoot, "state.db")).toBe(authorityPath);
      custody ??= acquireRuntimeProcessLock_m1({ processLockRoot: root, name: "workers", pid: process.pid,
        admission: { kind: "unbound-worker", authorityPath } });
    });
    return { root, authorityPath, snapshot, acquire, custody: () => {
      if (custody === undefined) throw new Error("missing first-install custody"); return custody;
    } };
  }
  it_m1("holds the same genuine admission inside first-install open and subsequent composition open", () => {
    const f = initialFixture(), originalOpen = AuthorityDatabase_m1.open.bind(AuthorityDatabase_m1);
    const openings: string[] = [];
    vi.spyOn(AuthorityDatabase_m1, "open").mockImplementation((admission, options, clock) => {
      expect_m1(f.snapshot().processLocks.workers.state).toBe("active");
      openings.push(z_m1.uuid().parse(f.custody().acquisitionId));
      return originalOpen(admission, options, clock);
    });
    const admission = f.acquire();
    try {
      expect_m1(f.snapshot().processLocks.workers.state).toBe("active");
      const bound = bindWorkerProcessAdmission_m1({ processLockRoot: f.root, authorityPath: f.authorityPath,
        pid: process.pid, clock: capturedInstantClock_m1(NOW_m1), initialCustody: f.custody(),
        workerId: "fixture-graph-worker-17",
        open: () => AuthorityDatabase_m1.open(admission, { path: f.authorityPath, busyTimeoutMs: 250, migrationOwner: "unit-test" }),
        admit: () => WorkerIdSchema_m1.parse("fixture-graph-worker-17"), close: database => database.close() });
      expect_m1(openings).toHaveLength(2); expect_m1(new Set(openings).size).toBe(1);
      expect_m1(bound.processLock.acquisitionId).not.toBe(f.custody().acquisitionId);
      bound.value.close(); bound.processLock.release();
      expect_m1(f.snapshot().processLocks.workers.state).toBe("stopped");
    } finally { admission.release(); }
  });
});
}
