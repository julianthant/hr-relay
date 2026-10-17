import { DatabaseSync } from "node:sqlite";
import { WorkerControlRecordSchema } from "../../../src/models/run/worker-control.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import * as childProcess from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proveSmokeProfileUnused, recoverOwnedSmokeSlot, SmokeSlotRecoveryRefusedError } from "../../../scripts/verify/browser-login-recovery.js";
import { recordSmokeSlot, retireOwnedSmokeSlots, SmokeSlotOwnershipUnavailableError } from "../../../scripts/verify/browser-login.js";
import * as processLocks from "../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { admitWorkerVerification } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-database-admission.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { WorkerVerificationRecoveryProofSchema, WorkerVerificationClaimSchema } from "../../../src/backend/storage/sqlite/run-store-contracts.js";

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

const nativeChildProcess = await vi.importActual<typeof import("node:child_process")>("node:child_process");
beforeEach(() => { vi.mocked(childProcess.spawnSync).mockImplementation(nativeChildProcess.spawnSync); });
const fixtures: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of fixtures.splice(0)) cleanup(); });
const credentialKey = FingerprintSchema.parse("ab".repeat(32));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "relay-recovery-"));
  const clock = manualClock(new Date("2026-10-16T10:00:00.000Z"));
  const database = AuthorityDatabase.open({ path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "recovery-test" }, clock);
  const processLockRoot = join(root, "locks");
  const original = processLocks.acquireRuntimeProcessLock({ processLockRoot, name: "live-smoke", pid: process.pid }, clock);
  database.authority.workerPools.plan({ workflow: "person-lookup", expectedVersion: 0, desiredWorkers: 1, requestedBy: "local-operator", now: clock.now().toISOString() });
  const peer = database.authority.workerSlots.allocate({ workflow: "person-lookup", poolIndex: 1, commandId: null, now: clock.now().toISOString() });
  const slot = database.withAuthorityTransaction(repositories => admitWorkerVerification(repositories, {
    commandId: randomUUID(), workflow: "person-lookup", expectedPoolVersion: repositories.workerPools.get("person-lookup")?.version,
    processLockRoot, stateRoot: root, owner: processLocks.readRuntimeProcessLock(processLockRoot, "live-smoke"), now: clock.now().toISOString(),
  }, randomUUID()));
  const profileRunId = randomUUID();
  recordSmokeSlot({ database, processLockRoot, slot, profileRunId, system: "ucpath", credentialKey });
  const acquisitionId = z.uuid().parse(original.acquisitionId);
  const claimRoot = join(processLockRoot, "live-smoke-slots");
  const claimName = `${original.acquisitionId}.slot.json`;
  const claimPath = join(claimRoot, "live-smoke-claims", claimName);
  const claim = WorkerVerificationClaimSchema.parse(JSON.parse(processLocks.readLiveSmokeRuntimeFile(claimRoot, claimName).text));
  const profile = join(root, "scratch", "live-smoke", profileRunId, "browsers", `w${slot.ordinal}`, "ucpath");
  const neighbor = join(root, "scratch", "live-smoke", profileRunId, "browsers", `w${slot.ordinal}`, "crm");
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  mkdirSync(neighbor, { mode: 0o700 });
  writeFileSync(join(neighbor, "retain"), "peer");
  const lease = database.authority.duoCeremonyLeases.acquire({ credentialKey, workerId: slot.workerId, system: "ucpath", now: clock.now().toISOString(), ttlMs: 60000 });
  if (lease.state !== "acquired") throw new Error("fixture lease unavailable");
  database.authority.duoCeremonyLeases.release({ token: lease.token, now: clock.now().toISOString() });
  original.release();
  const recovery = processLocks.acquireRuntimeProcessLock({ processLockRoot, name: "live-smoke", pid: process.pid }, clock);
  const actual = processLocks.observeProcessIdentity(process.pid);
  const processSpy = vi.spyOn(processLocks, "observeProcessIdentity");
  const absentOwner = () => processSpy.mockReset().mockReturnValueOnce(actual).mockReturnValueOnce({ state: "gone" }).mockReturnValueOnce({ state: "gone" }).mockReturnValue(actual);
  const realSpawn = nativeChildProcess.spawnSync;
  const query = vi.spyOn(childProcess, "spawnSync").mockImplementation((...args: Parameters<typeof childProcess.spawnSync>) => {
    if (args[0] === "/bin/ps" && Array.isArray(args[1]) && args[1][0] === "-axo") return { pid: 0, output: [null, `${process.pid} node\n`, ""], stdout: `${process.pid} node\n`, stderr: "", status: 0, signal: null };
    if (args[0] === "/usr/sbin/lsof") {
      const exists = Array.isArray(args[1]) && args[1].includes("+D");
      return { pid: 0, output: [null, "", ""], stdout: exists ? "" : `p${process.pid}\nn/usr/fixture\n`, stderr: "", status: exists ? 1 : 0, signal: null };
    }
    return realSpawn(...args);
  });
  const recover = () => { absentOwner(); return recoverOwnedSmokeSlot({ database, processLockRoot, stateRoot: root, acquisitionId, clock }); };
  fixtures.push(() => { recovery.release(); database.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, database, clock, processLockRoot, original, recovery, acquisitionId, slot: claim.slot, peer, profile, neighbor, claimPath, claim, claimRoot, recover, processSpy, actual, absentOwner, query };
}

describe("targeted missing closure proof recovery", () => {
  it("retires exactly its native reservation, leaves peer and historical residue, and never creates closed proof", () => {
    const f = fixture();
    const unrelated = join(f.claimRoot, "live-smoke-claims", "old-process-only.txt");
    writeFileSync(unrelated, "retain");
    f.recover();
    const raw = new DatabaseSync(join(f.root, "authority.sqlite"));
    try {
      expect(raw.prepare("SELECT count(*) AS count FROM write_intents").get()).toEqual({ count: 0 });
      expect(raw.prepare("SELECT count(*) AS count FROM write_attempts").get()).toEqual({ count: 0 });
    } finally { raw.close(); }
    expect(f.database.authority.workerSlots.get(f.slot.workerId)?.retiredAt).toBe(f.clock.now().toISOString());
    expect(f.database.authority.workerSlots.get(f.peer.workerId)).toEqual(f.peer);
    expect(f.database.authority.workerPools.get("person-lookup")?.desiredWorkers).toBe(1);
    expect(f.database.authority.workerSlots.verification(f.slot.workerId)).toBeUndefined();
    expect(f.database.authority.duoCeremonyLeases.get(credentialKey)?.state).toBe("released");
    expect(existsSync(f.profile)).toBe(false);
    expect(readFileSync(join(f.neighbor, "retain"), "utf8")).toBe("peer");
    expect(readFileSync(unrelated, "utf8")).toBe("retain");
    expect(readdirSync(join(f.claimRoot, "live-smoke-claims"))).toEqual(["old-process-only.txt"]);
    expect(() => retireOwnedSmokeSlots({ database: f.database, processLockRoot: f.processLockRoot, stateRoot: f.root })).toThrow(SmokeSlotOwnershipUnavailableError);
    expect(f.database.authority.lifecycleJournal.getCommand(String(f.database.authority.workerSlots.get(f.slot.workerId)?.retirementCommandId))).toMatchObject({ request: { cleanup: { evidence: "recovered", recoveryAcquisitionId: f.recovery.acquisitionId } } });
  });

  it("refuses an unresolved native control before profile deletion", () => {
    const f = fixture();
    const commandId = randomUUID();
    const pending = WorkerControlRecordSchema.parse({ commandId, request: { commandId, family: "worker-browser",
      type: "spawn-worker", source: "dashboard", requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(),
      target: { workflowId: f.slot.workflow, expectedVersion: f.database.authority.workerPools.get(f.slot.workflow)?.version },
      payload: { workerId: f.slot.workerId } }, scope: `worker-pool:${f.slot.workflow}`, executorId: randomUUID(),
      admittedAt: f.clock.now().toISOString(), expiresAt: "2026-10-16T10:03:00.000Z",
      basisVersion: f.database.authority.workerPools.get(f.slot.workflow)?.version, phase: { state: "admitted" } });
    f.database.authority.commands.insert(pending.request);
    const raw = new DatabaseSync(join(f.root, "authority.sqlite"));
    try { raw.prepare("INSERT INTO worker_controls(command_id,scope,worker_id,phase,audited_at,payload_json,created_at) VALUES(?,?,?,'admitted',NULL,?,?)")
      .run(commandId, pending.scope, f.slot.workerId, JSON.stringify(pending), f.clock.now().toISOString()); }
    finally { raw.close(); }
    expect(f.recover).toThrow(SmokeSlotRecoveryRefusedError);
    expect(existsSync(f.profile)).toBe(true);
    expect(f.database.authority.workerSlots.get(f.slot.workerId)).toEqual(f.slot);
  });

  it.each(["alive", "unknown"] as const)("refuses a %s original owner before probing or removing profiles", state => {
    const f = fixture();
    if (state === "alive") f.processSpy.mockReset().mockReturnValue(f.actual);
    else f.processSpy.mockReset().mockImplementation(() => { throw new Error("fixture identity query failed"); });
    expect(() => recoverOwnedSmokeSlot({ database: f.database, processLockRoot: f.processLockRoot, stateRoot: f.root, acquisitionId: f.acquisitionId, clock: f.clock })).toThrow(SmokeSlotRecoveryRefusedError);
    expect(existsSync(f.profile)).toBe(true);
    expect(f.database.authority.workerSlots.get(f.slot.workerId)).toEqual(f.slot);
  });

  it.each(["slot", "root", "system"])("refuses mismatched %s binding", field => {
    const f = fixture();
    if (field !== "root") writeFileSync(f.claimPath, JSON.stringify({ ...f.claim,
      ...(field === "slot" ? { slot: { ...f.claim.slot, membershipRevision: 2 } } : field === "profileRunId" ? { profileRunId: randomUUID() } : { system: "crm" }) }));
    f.absentOwner();
    expect(() => recoverOwnedSmokeSlot({ database: f.database, processLockRoot: f.processLockRoot, stateRoot: field === "root" ? join(f.root, "foreign") : f.root, acquisitionId: f.acquisitionId, clock: f.clock })).toThrow();
    expect(existsSync(f.profile)).toBe(true);
    expect(f.database.authority.workerSlots.get(f.slot.workerId)).toEqual(f.slot);
  });

  it.each(["missing", "held", "foreign"])("requires its exact released Duo lease: %s refuses", mode => {
    const f = fixture();
    if (mode === "missing") writeFileSync(f.claimPath, JSON.stringify({ ...f.claim, credentialKey: "cd".repeat(32) }));
    else {
      const lease = f.database.authority.duoCeremonyLeases.acquire({ credentialKey, workerId: mode === "foreign" ? f.peer.workerId : f.slot.workerId, system: "ucpath", now: f.clock.now().toISOString(), ttlMs: 60000 });
      if (lease.state !== "acquired") throw new Error("fixture lease unavailable");
      if (mode === "foreign") f.database.authority.duoCeremonyLeases.release({ token: lease.token, now: f.clock.now().toISOString() });
    }
    expect(f.recover).toThrow(SmokeSlotRecoveryRefusedError);
    expect(existsSync(f.profile)).toBe(true);
    expect(f.database.authority.workerSlots.get(f.slot.workerId)).toEqual(f.slot);
  });

  it.each(["symlink", "permissions", "singleton"])("preserves unsafe %s profiles", mode => {
    const f = fixture();
    if (mode === "symlink") { rmSync(f.profile, { recursive: true }); symlinkSync(f.neighbor, f.profile); }
    if (mode === "permissions") chmodSync(f.profile, 0o777);
    if (mode === "singleton") writeFileSync(join(f.profile, "SingletonLock"), "retain");
    expect(f.recover).toThrow();
    expect(existsSync(f.profile)).toBe(true);
    expect(f.database.authority.workerSlots.get(f.slot.workerId)).toEqual(f.slot);
  });

  it.each(["process", "open-file", "query"])("refuses fresh %s evidence without retirement", mode => {
    const f = fixture();
    f.query.mockImplementation((...args: Parameters<typeof childProcess.spawnSync>) => {
      if (args[0] === "/bin/ps" && Array.isArray(args[1]) && args[1][0] === "-axo") return { pid: 0, output: [], stdout: mode === "process" ? `${process.pid} browser --user-data-dir=${f.profile}\n` : `${process.pid} node\n`, stderr: mode === "query" ? "fixture query failure" : "", status: 0, signal: null };
      if (args[0] === "/usr/sbin/lsof") return { pid: 0, output: [], stdout: `p${process.pid}\nn${f.profile}/open\n`, stderr: "", status: 0, signal: null };
      return nativeChildProcess.spawnSync(...args);
    });
    expect(f.recover).toThrow(SmokeSlotRecoveryRefusedError);
    expect(existsSync(f.profile)).toBe(true);
    expect(f.database.authority.workerSlots.get(f.slot.workerId)).toEqual(f.slot);
  });

  it.each(["fingerprint", "profile", "recovery-owner", "time", "revision"])("native retirement rejects a changed recovery proof %s", field => {
    const f = fixture();
    const transact = f.database.withAuthorityTransaction.bind(f.database);
    vi.spyOn(f.database, "withAuthorityTransaction").mockImplementationOnce(work => {
      const name = `${f.acquisitionId}-${f.recovery.acquisitionId}.recovered.json`;
      const proof = WorkerVerificationRecoveryProofSchema.parse(JSON.parse(processLocks.readLiveSmokeRuntimeFile(f.claimRoot, name).text));
      const changed = field === "fingerprint" ? { ...proof, claimFingerprint: "cd".repeat(32) }
        : field === "profile" ? { ...proof, profileDirectory: f.neighbor }
        : field === "recovery-owner" ? { ...proof, recoveryOwner: { ...proof.recoveryOwner, acquisitionId: randomUUID() } }
        : field === "time" ? { ...proof, checkedAt: "2026-10-15T10:00:00.000Z" }
        : { ...proof, membershipRevision: proof.membershipRevision + 1 };
      writeFileSync(join(f.claimRoot, "live-smoke-claims", name), JSON.stringify(changed));
      return transact(work);
    });
    expect(f.recover).toThrow("worker-verification-cleanup-unproved");
    expect(f.database.authority.workerSlots.get(f.slot.workerId)).toEqual(f.slot);
    expect(existsSync(f.claimPath)).toBe(true);
  });

  it("retains fresh recovery evidence after transaction failure", () => {
    const f = fixture();
    vi.spyOn(f.database, "withAuthorityTransaction").mockImplementationOnce(() => { throw new Error("fixture transaction failure"); });
    expect(f.recover).toThrow("fixture transaction failure");
    expect(existsSync(f.profile)).toBe(false);
    expect(f.database.authority.workerSlots.get(f.slot.workerId)).toEqual(f.slot);
    const files = readdirSync(join(f.claimRoot, "live-smoke-claims"));
    expect(files).toContain(`${f.original.acquisitionId}-${f.recovery.acquisitionId}.recovered.json`);
    expect(files.some(name => name.endsWith(".closed.json"))).toBe(false);
    const proof = WorkerVerificationRecoveryProofSchema.parse(JSON.parse(processLocks.readLiveSmokeRuntimeFile(f.claimRoot, `${f.original.acquisitionId}-${f.recovery.acquisitionId}.recovered.json`).text));
    expect(proof).toMatchObject({ acquisitionId: f.acquisitionId, recoveryOwner: { acquisitionId: f.recovery.acquisitionId }, profileDirectory: f.profile });
    f.recovery.release();
    const next = processLocks.acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "live-smoke", pid: process.pid }, f.clock);
    try {
      f.recover();
      expect(f.database.authority.workerSlots.get(f.slot.workerId)?.retiredAt).toBe(f.clock.now().toISOString());
      expect(readdirSync(join(f.claimRoot, "live-smoke-claims"))).toEqual([`${f.original.acquisitionId}-${f.recovery.acquisitionId}.recovered.json`]);
    } finally { next.release(); }
  });
});

describe("local Darwin process and open-file observations", () => {
  it("rejects a live process whose arguments name the exact profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-process-probe-"));
    const child = nativeChildProcess.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", root], { stdio: "ignore" });
    try {
      await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      expect(() => proveSmokeProfileUnused(root)).toThrow(SmokeSlotRecoveryRefusedError);
    } finally {
      const closed = new Promise<void>(resolve => { child.once("close", () => resolve()); });
      child.kill();
      await closed;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts an unused profile and rejects an actually open file", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-profile-probe-"));
    try {
      proveSmokeProfileUnused(root);
      const fd = openSync(join(root, "open"), "w");
      try { expect(() => proveSmokeProfileUnused(root)).toThrow(SmokeSlotRecoveryRefusedError); }
      finally { closeSync(fd); }
      proveSmokeProfileUnused(root);
      rmSync(root, { recursive: true });
      proveSmokeProfileUnused(root);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
