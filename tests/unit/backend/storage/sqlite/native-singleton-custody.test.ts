import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireRuntimeProcessLock, observeRuntimeLockSnapshot, type ProcessIdentityObserver, type RuntimeProcessLockHandle } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { capturedInstantClock } from "../../../../../src/rules/time/clock.js";
import { HASH_A, NOW } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
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
