import { initializeAdmissionFixture, fixtureAdmission, releaseAdmissionFixture } from "../../../support/helpers/admission-fixture.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { validateNativeLifecycleRequest } from "../../../../src/backend/storage/sqlite/native-lifecycle-request.js";
import { RunLifecycleCommandRecordSchema } from "../../../../src/rules/commands/commands.js";
import { WorkerVerificationRetirementRequestSchema } from "../../../../src/backend/storage/sqlite/run-store-contracts.js";
import * as childProcess from "node:child_process";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import * as locks from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { admitWorkerVerification, retireWorkerVerification } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { WorkerVerificationClaimSchema } from "../../../../src/backend/storage/sqlite/run-store-contracts.js";
import { recordSmokeSlot } from "../../../../scripts/verify/browser-login.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});
const nativeChildProcess = await vi.importActual<typeof import("node:child_process")>("node:child_process");
beforeEach(() => { vi.mocked(childProcess.spawnSync).mockImplementation(nativeChildProcess.spawnSync); });

const nativeObserveProcessIdentity = locks.observeProcessIdentity;
const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-orphan-")));
  const stateRoot = resolve(workspace, rebuildRuntimeIsolation.stateRoot);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const admission = RuntimeAdmission.syntheticRoots(stateRoot, join(stateRoot, "artifacts"));
  const clock = manualClock(new Date("2026-10-16T10:00:00.000Z"));
  const database = AuthorityDatabase.open(admission, { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "orphan-test" }, clock);
  const processLockRoot = resolve(workspace, rebuildRuntimeIsolation.processLockRoot);
  const original = locks.acquireRuntimeProcessLock({ processLockRoot, name: "live-smoke", pid: process.pid }, clock);
  const owner = locks.readRuntimeProcessLock(processLockRoot, "live-smoke");
  if (owner === undefined) throw new Error("fixture owner unavailable");
  database.authority.workerPools.plan({ workflow: "person-lookup", expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: clock.now().toISOString() });
  const peer = database.authority.workerSlots.allocate({ workflow: "person-lookup", poolIndex: 1, commandId: null, now: clock.now().toISOString() });
  const slot = database.withAuthorityTransaction(repositories => admitWorkerVerification(repositories, {
    commandId: randomUUID(), workflow: "person-lookup", expectedPoolVersion: 1,
    processLockRoot, stateRoot, owner, now: clock.now().toISOString(),
  }, randomUUID()));
  const credentialKey = FingerprintSchema.parse("ab".repeat(32));
  recordSmokeSlot({ database, processLockRoot, slot, profileRunId: owner.acquisitionId, system: "ucpath", credentialKey });
  const claimRoot = join(processLockRoot, "live-smoke-slots");
  const claimPath = join(claimRoot, "live-smoke-claims", `${owner.acquisitionId}.slot.json`);
  const claim = WorkerVerificationClaimSchema.parse(JSON.parse(readFileSync(claimPath, "utf8")));
  writeFileSync(claimPath, JSON.stringify({ ...claim, profileRunId: randomUUID() }));
  const profileRoots = [join(stateRoot, "scratch", "live-smoke"), resolve(workspace, rebuildRuntimeIsolation.browserProfileRoot)];
  const profiles = profileRoots.map(root => join(root, randomUUID(), "browsers", "w1", "ucpath"));
  for (const profile of profiles) { mkdirSync(profile, { recursive: true, mode: 0o700 }); writeFileSync(join(profile, "retain"), "unchanged"); }
  original.release();
  vi.spyOn(locks, "observeProcessIdentity").mockReturnValue({ state: "gone" });
  const invoke = (plan = false, selectedAdmission = admission, extra: string[] = []) => composeStorageCommand(rebuildRuntimeIsolation,
    ["retire-orphan-verification", "--acquisition", owner.acquisitionId, ...(plan ? ["--plan"] : []), "--json", ...extra], clock, workspace, selectedAdmission);
  const snapshot = () => ({ generation: database.getMeta().authorityGeneration, slot: database.authority.workerSlots.get(slot.workerId), pool: database.authority.workerPools.get(slot.workflow) });
  const retained = () => { for (const profile of profiles) expect(readFileSync(join(profile, "retain"), "utf8")).toBe("unchanged"); expect(existsSync(claimPath)).toBe(true); };
  cleanups.push(() => { database.close(); admission.release(); rmSync(workspace, { recursive: true, force: true }); });
  return { workspace, stateRoot, admission, clock, database, processLockRoot, owner, slot: claim.slot, peer, credentialKey, claimPath, profileRoots, profiles, invoke, snapshot, retained };
}

async function refuses(f: ReturnType<typeof fixture>, plan = false) {
  const before = f.snapshot();
  const outcome = await f.invoke(plan);
  expect(outcome.exitCode).toBe(1);
  expect(outcome.output).toContain("ORPHAN_VERIFICATION_RETIREMENT_REFUSED");
  expect(f.snapshot()).toEqual(before);
  f.retained();
}

describe("offline orphan verification retirement", () => {
  it("keeps an unbound orphan blocking allocation before retirement", () => {
    const f = fixture();
    expect(() => f.database.authority.workerSlots.allocate({ workflow: f.slot.workflow, poolIndex: 2, commandId: null, now: f.clock.now().toISOString() })).toThrow("worker-verification-reserved");
  });

  it("plans without mutation, retires the exact orphan and leaves all profiles and claim evidence", async () => {
    const f = fixture();
    const before = f.snapshot();
    const plan = await f.invoke(true);
    expect(plan.exitCode, plan.output).toBe(0);
    expect(JSON.parse(plan.output)).toMatchObject({ state: "planned", acquisitionId: f.owner.acquisitionId, workerId: f.slot.workerId });
    expect(f.snapshot()).toEqual(before);
    const result = await f.invoke();
    expect(result.exitCode, result.output).toBe(0);
    expect(f.database.authority.workerSlots.get(f.slot.workerId)?.retiredAt).toBe(f.clock.now().toISOString());
    expect(f.database.authority.workerPools.get(f.slot.workflow)?.desiredWorkers).toBe(1);
    const commandId = f.database.authority.workerSlots.get(f.slot.workerId)?.retirementCommandId;
    expect(commandId).toBeTruthy();
    const command = f.database.authority.lifecycleJournal.getCommand(String(commandId));
    expect(command).toMatchObject({ operation: "worker-verification-retirement", request: { cleanup: { evidence: "orphan-retired", mode: "offline", proof: { profileRoots: f.profileRoots } } } });
    expect(() => f.database.authority.workerSlots.requireVerificationRetirements(f.slot.workflow)).not.toThrow();
    f.retained();
  });

  it.each([false, true])("refuses an unknown owner without mutation (plan=%s)", async plan => {
    const f = fixture();
    vi.mocked(locks.observeProcessIdentity).mockImplementation(() => { throw new Error("fixture owner unknown"); });
    await refuses(f, plan);
  });

  it("refuses a live original owner", async () => {
    const f = fixture();
    vi.mocked(locks.observeProcessIdentity).mockReturnValue({ state: "alive", identity: f.owner.processIdentity });
    await refuses(f);
  });

  it.each(["own", "peer"])("refuses any held Duo lease: %s", async kind => {
    const f = fixture();
    f.database.authority.duoCeremonyLeases.acquire({ credentialKey: f.credentialKey, workerId: kind === "own" ? f.slot.workerId : f.peer.workerId, system: "ucpath", now: f.clock.now().toISOString(), ttlMs: 60_000 });
    await refuses(f);
  });

  it.each([0, 1])("refuses a real open file anywhere in browser root %s", async index => {
    const f = fixture();
    const profile = f.profiles[index];
    if (profile === undefined) throw new Error("fixture profile missing");
    const fd = openSync(join(profile, "open"), "w");
    try { await refuses(f); } finally { closeSync(fd); }
  });

  it.each(["cwd", "arguments"])("refuses an owned child using a profile through %s", async mode => {
    const f = fixture();
    const profile = f.profiles[0];
    if (profile === undefined) throw new Error("fixture profile missing");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ...(mode === "arguments" ? [profile] : [])], { cwd: mode === "cwd" ? profile : f.workspace, stdio: "ignore" });
    await new Promise<void>((resolveSpawn, reject) => { child.once("spawn", resolveSpawn); child.once("error", reject); });
    try { await refuses(f); } finally {
      const closed = new Promise<void>(resolveClose => { child.once("close", () => resolveClose()); });
      child.kill(); await closed;
    }
  });

  it("refuses a symlink escape in either profile root", async () => {
    const f = fixture();
    const profile = f.profiles[0];
    const root = f.profileRoots[0];
    if (profile === undefined || root === undefined) throw new Error("fixture profile missing");
    symlinkSync(f.workspace, join(root, "escape"));
    await refuses(f);
  });

  it.each(["ps-error", "ps-empty", "ps-malformed", "ps-signal", "ps-status", "ps-spawn", "lsof-error", "lsof-malformed"])("refuses an incomplete process query: %s", async mode => {
    const f = fixture();
    vi.mocked(childProcess.spawnSync).mockImplementation((...args: Parameters<typeof childProcess.spawnSync>) => {
      if (args[0] === "/bin/ps" && Array.isArray(args[1]) && args[1][0] === "-axo") {
        return { pid: 0, output: [], stdout: mode === "ps-empty" ? "" : mode === "ps-malformed" ? "unparseable\n" : `${process.pid} node\n`,
          stderr: mode === "ps-error" ? "failure" : "", status: mode === "ps-status" ? 2 : 0, signal: mode === "ps-signal" ? "SIGTERM" : null, ...(mode === "ps-spawn" ? { error: new Error("fixture spawn failed") } : {}) };
      }
      if (args[0] === "/usr/sbin/lsof") return { pid: 0, output: [], stdout: mode === "lsof-malformed" ? "unparseable\n" : "", stderr: mode === "lsof-error" ? "failure" : "", status: mode === "lsof-error" ? 2 : 0, signal: null };
      return nativeChildProcess.spawnSync(...args);
    });
    await refuses(f);
  });

  it("refuses actual shared installation admission for plan and execution", async () => {
    const f = fixture();
    const sharedWorkspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-shared-orphan-")));
    vi.mocked(locks.observeProcessIdentity).mockImplementation(nativeObserveProcessIdentity);
    initializeAdmissionFixture(sharedWorkspace);
    const shared = fixtureAdmission(sharedWorkspace);
    const before = f.snapshot();
    try {
      for (const plan of [true, false]) {
        const outcome = await f.invoke(plan, shared);
        expect(outcome.exitCode).toBe(1);
        expect(outcome.output).toContain("ORPHAN_VERIFICATION_RETIREMENT_REFUSED");
        expect(f.snapshot()).toEqual(before);
      }
    } finally { releaseAdmissionFixture(sharedWorkspace); rmSync(sharedWorkspace, { recursive: true, force: true }); }
  });

  it("refuses a released admission without mutation", async () => {
    const f = fixture();
    const before = f.snapshot();
    f.admission.release();
    await expect(f.invoke(true)).rejects.toThrow("missing or released admission");
    await expect(f.invoke()).rejects.toThrow("missing or released admission");
    expect(f.snapshot()).toEqual(before);
    f.retained();
  });

  it.each(["owner", "slot", "claim", "custody", "root", "time", "runtime", "configuration", "provenance", "expired", "claim-file", "owner-release"])("native retirement rejects a complete changed proof: %s", async field => {
    const f = fixture();
    const planned = await f.invoke(true);
    expect(planned.exitCode, planned.output).toBe(0);
    const proof = f.database.authority.workerSlots.planOrphanRetirement({ acquisitionId: f.owner.acquisitionId, now: f.clock.now().toISOString() }).proof;
    if (field === "claim-file") writeFileSync(f.claimPath, JSON.stringify({ ...proof.claim, profileRunId: randomUUID() }));
    if (field === "expired") f.clock.advanceWall(30_001);
    const changed = field === "expired" || field === "claim-file" ? proof : field === "owner" ? { ...proof, admission: { ...proof.admission, owner: { ...proof.admission.owner, acquisitionId: randomUUID() } } }
      : field === "slot" ? { ...proof, slot: { ...proof.slot, ordinal: proof.slot.ordinal + 1 } }
      : field === "claim" ? { ...proof, claim: { ...proof.claim, profileRunId: randomUUID() } }
      : field === "custody" ? { ...proof, claimCustody: { ...proof.claimCustody, ino: proof.claimCustody.ino + 1 } }
      : field === "root" ? { ...proof, profileRoots: [join(f.stateRoot, "narrowed"), proof.profileRoots[1]] }
      : field === "owner-release" ? { ...proof, ownerRelease: { ...proof.ownerRelease, acquisitionId: randomUUID() } }
      : field === "configuration" ? { ...proof, profileConfiguration: { ...proof.profileConfiguration, settingsFingerprint: "cd".repeat(32) } }
      : field === "provenance" ? { ...proof, runtime: { ...proof.runtime, sourceDatabaseIdentity: "cd".repeat(32) } }
      : field === "time" ? { ...proof, checkedAt: "2026-10-15T10:00:00.000Z" }
      : { ...proof, runtime: { ...proof.runtime, processLocks: { ...proof.runtime.processLocks, server: { state: "active", pid: process.pid, generation: 1 } } } };
    const before = f.snapshot();
    expect(() => f.database.withAuthorityTransaction(repositories => retireWorkerVerification(repositories, {
      commandId: randomUUID(), grantCommandId: f.slot.reservationCommandId, workerId: f.slot.workerId,
      expectedRevision: f.slot.membershipRevision, expectedPoolVersion: repositories.workerPools.get(f.slot.workflow)?.version,
      now: f.clock.now().toISOString(), cleanup: { acquisitionId: f.owner.acquisitionId, mode: "offline", evidence: "orphan-retired", proof: changed },
    }, randomUUID()))).toThrow();
    expect(f.snapshot()).toEqual(before);
    f.retained();
  });

  it("native retirement rechecks an actual open descriptor after a successful plan", async () => {
    const f = fixture();
    const planned = await f.invoke(true);
    expect(planned.exitCode, planned.output).toBe(0);
    const proof = f.database.authority.workerSlots.planOrphanRetirement({ acquisitionId: f.owner.acquisitionId, now: f.clock.now().toISOString() }).proof;
    const profile = f.profiles[0];
    if (profile === undefined) throw new Error("fixture profile missing");
    const fd = openSync(join(profile, "late-open"), "w");
    const before = f.snapshot();
    try {
      expect(() => f.database.withAuthorityTransaction(repositories => retireWorkerVerification(repositories, {
        commandId: randomUUID(), grantCommandId: f.slot.reservationCommandId, workerId: f.slot.workerId,
        expectedRevision: f.slot.membershipRevision, expectedPoolVersion: repositories.workerPools.get(f.slot.workflow)?.version,
        now: f.clock.now().toISOString(), cleanup: { acquisitionId: f.owner.acquisitionId, mode: "offline", evidence: "orphan-retired", proof },
      }, randomUUID()))).toThrow();
      expect(f.snapshot()).toEqual(before);
    } finally { closeSync(fd); }
  });

  it.each(["server", "workers", "live-smoke", "geocode"] as const)("refuses an actual held %s runtime lock", async name => {
    const f = fixture();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: f.workspace, stdio: "ignore" });
    await new Promise<void>((resolveSpawn, reject) => { child.once("spawn", resolveSpawn); child.once("error", reject); });
    const pid = child.pid;
    if (pid === undefined) throw new Error("fixture child missing");
    const observe = (observedPid: number) => observedPid === f.owner.pid ? { state: "gone" as const } : nativeObserveProcessIdentity(observedPid);
    vi.mocked(locks.observeProcessIdentity).mockImplementation(observe);
    const held = locks.acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name, pid,
      ...(name === "workers" ? { workerId: f.peer.workerId } : {}) }, f.clock, { observeProcessIdentity: observe });
    try { await refuses(f); } finally {
      held.release();
      const closed = new Promise<void>(resolveClose => { child.once("close", () => resolveClose()); });
      child.kill(); await closed;
    }
  });

  it.each([false, true])("refuses a configured custom ordinary profile root before appending (plan=%s)", async plan => {
    const f = fixture();
    const custom = join(f.workspace, "custom-browser-root");
    mkdirSync(custom, { mode: 0o700 });
    const config = { ...CONFIG_SNAPSHOT.config, paths: { ...CONFIG_SNAPSHOT.config.paths, browserProfileRoot: custom } };
    f.database.authority.runtimeConfig.initialize({ ...CONFIG_SNAPSHOT, config, fingerprint: sha256Hex(canonicalJsonStringify(config)) });
    const fd = openSync(join(custom, "open"), "w");
    try { await refuses(f, plan); } finally { closeSync(fd); }
  });

  it("historical native proof stays readable offline checks later change, and refuses captured configuration tampering", async () => {
    const f = fixture();
    const result = await f.invoke();
    expect(result.exitCode, result.output).toBe(0);
    const commandId = f.database.authority.workerSlots.get(f.slot.workerId)?.retirementCommandId;
    const command = RunLifecycleCommandRecordSchema.parse(f.database.authority.lifecycleJournal.getCommand(String(commandId)));
    const request = WorkerVerificationRetirementRequestSchema.parse(command.request);
    if (request.cleanup.evidence !== "orphan-retired") throw new Error("fixture orphan evidence missing");
    const profile = f.profiles[0];
    if (profile === undefined) throw new Error("fixture profile missing");
    const fd = openSync(join(profile, "later-open"), "w");
    try {
      f.clock.advanceWall(60_000);
      expect(() => validateNativeLifecycleRequest(command)).not.toThrow();
      expect(() => f.database.authority.workerSlots.requireVerificationRetirements(f.slot.workflow)).not.toThrow();
      const changed = { ...request, cleanup: { ...request.cleanup, proof: { ...request.cleanup.proof,
        profileConfiguration: { ...request.cleanup.proof.profileConfiguration, settingsFingerprint: "cd".repeat(32) } } } };
      const changedCommand = { ...command, request: changed, requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0worker-verification-retirement\0${canonicalJsonStringify(changed)}`) };
      expect(() => validateNativeLifecycleRequest(changedCommand)).toThrow();
    } finally { closeSync(fd); }
  });

  it("proves unused missing profile roots without recreating them", async () => {
    const f = fixture();
    for (const root of f.profileRoots) rmSync(root, { recursive: true });
    const before = f.snapshot();
    const plan = await f.invoke(true);
    expect(plan.exitCode, plan.output).toBe(0);
    expect(f.snapshot()).toEqual(before);
    const result = await f.invoke();
    expect(result.exitCode, result.output).toBe(0);
    for (const root of f.profileRoots) expect(existsSync(root)).toBe(false);
    expect(existsSync(f.claimPath)).toBe(true);
  });

  it("native retirement refuses forged offline proof before a journal append", () => {
    const f = fixture();
    const before = f.snapshot();
    expect(() => f.database.withAuthorityTransaction(repositories => retireWorkerVerification(repositories, {
      commandId: randomUUID(), grantCommandId: f.slot.reservationCommandId, workerId: f.slot.workerId,
      expectedRevision: f.slot.membershipRevision, expectedPoolVersion: repositories.workerPools.get(f.slot.workflow)?.version,
      now: f.clock.now().toISOString(), cleanup: { acquisitionId: f.owner.acquisitionId, mode: "offline", evidence: "orphan-retired", proof: {} },
    }, randomUUID()))).toThrow();
    expect(f.snapshot()).toEqual(before);
  });
});
