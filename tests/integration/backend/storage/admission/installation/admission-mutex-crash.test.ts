import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as filesystem from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AdmissionMutexBusyError, recoverAbandonedAdmissionMutex } from "../../../../../../src/backend/storage/admission/installation.js";
import * as locks from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});
const roots: string[] = [];
const children: ChildProcess[] = [];
async function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGKILL"); });
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(children.splice(0).map(kill));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "admission-crash-")));
  roots.push(root);
  acquireEntrypointAdmission(root, "exclusive").release();
  return root;
}
async function pausedChild(root: string, window: string): Promise<ChildProcess> {
  const url = pathToFileURL(join(process.cwd(), "src/backend/storage/admission/bootstrap-admission.ts")).href;
  const code = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const window = ${JSON.stringify(window)};
    const pause = () => { fs.writeSync(1, 'PAUSED\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
    const mkdir = fs.mkdirSync, rename = fs.renameSync, unlink = fs.unlinkSync;
    fs.mkdirSync = (...args) => { const result = mkdir(...args);
      if (window === 'pre-owner' && String(args[0]).includes('.admission-mutex-tmp-')) pause(); return result; };
    fs.renameSync = (...args) => { const result = rename(...args);
      if (window === 'prepared' && String(args[1]).endsWith('/owner.json') && String(args[1]).includes('admission-mutex')) pause();
      if (window === 'released' && String(args[0]).endsWith('/admission-mutex')) pause(); return result; };
    fs.unlinkSync = (...args) => { const result = unlink(...args);
      if (window === 'released' && String(args[0]).endsWith('/admission-mutex/owner.json')) pause(); return result; };
    syncBuiltinESMExports();
    const { acquireEntrypointAdmission } = await import(${JSON.stringify(url)});
    acquireEntrypointAdmission(process.argv[1], 'shared').release();
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, root], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", chunk => { output += String(chunk); if (output.includes("PAUSED")) resolve(); });
    child.stderr?.on("data", chunk => { output += String(chunk); });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`child exited ${String(code)}: ${output}`)));
  });
  return child;
}
it.each(["prepared", "released"])("cleans an actual killed child's %s folder without a canonical empty lock", async window => {
  const root = fixture();
  const child = await pausedChild(root, window);
  await kill(child);
  const control = join(root, ".tracker/control");
  expect(existsSync(join(control, "admission-mutex"))).toBe(false);
  expect(readdirSync(control).some(name => name.startsWith(".admission-mutex-"))).toBe(true);
  acquireEntrypointAdmission(root, "shared").release();
  expect(readdirSync(control).filter(name => name.startsWith(".admission-mutex-"))).toEqual([]);
});
it("preserves a live temporary folder before owner publication and cleans it only after death", async () => {
  const root = fixture();
  const child = await pausedChild(root, "pre-owner");
  const control = join(root, ".tracker/control");
  const name = readdirSync(control).find(entry => entry.startsWith(".admission-mutex-tmp-"));
  expect(name).toBeDefined();
  acquireEntrypointAdmission(root, "shared").release();
  expect(readdirSync(join(control, name!))).toEqual([]);
  await kill(child);
  acquireEntrypointAdmission(root, "shared").release();
  expect(existsSync(join(control, name!))).toBe(false);
});
it("refuses an empty canonical lock immediately and archives its empty custody with a receipt", () => {
  const root = fixture();
  const path = join(root, ".tracker/control", "admission-mutex");
  mkdirSync(path, { mode: 0o700 });
  const wait = vi.spyOn(Atomics, "wait");
  let failure: unknown;
  try { acquireEntrypointAdmission(root, "shared"); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AdmissionMutexBusyError);
  expect(failure).toMatchObject({ name: "AdmissionMutexEmptyError" });
  expect(String(failure)).toContain("storage recover-admission --empty");
  expect(wait).not.toHaveBeenCalled();
  wait.mockRestore();
  const restore = locks.acquireRuntimeRestoreAdmission({ processLockRoot: join(root, ".tracker/data", "locks"), pid: process.pid });
  try {
    const result = recoverAbandonedAdmissionMutex(root, restore, "empty");
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(join(root, ".tracker/control", "admission-mutex-recovery", result.acquisitionId))).toEqual([]);
    const receipt: unknown = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt).toMatchObject({ custody: "empty", acquisitionId: result.acquisitionId });
    expect(receipt).not.toHaveProperty("pid");
  } finally { restore.release(); }
  acquireEntrypointAdmission(root, "shared").release();
});
it.each(["lease", "journal", "server", "workers"])("preserves empty lock custody when %s blocks recovery", condition => {
  const root = fixture();
  const control = join(root, ".tracker/control");
  const path = join(control, "admission-mutex");
  mkdirSync(path, { mode: 0o700 });
  const current = locks.observeProcessIdentity(process.pid);
  if (current.state !== "alive") throw new Error("current identity unavailable");
  if (condition === "lease") writeFileSync(join(control, "leases", `${randomUUID()}.json`), JSON.stringify({
    schemaVersion: 1, admissionId: randomUUID(), mode: "shared", pid: process.pid, processIdentity: current.identity,
  }), { mode: 0o600 });
  if (condition === "journal") writeFileSync(join(control, "journal.json"), "{}", { mode: 0o600 });
  const restore = locks.acquireRuntimeRestoreAdmission({ processLockRoot: join(root, ".tracker/data", "locks"), pid: process.pid });
  try {
    if (condition === "server" || condition === "workers") {
      const original = locks.observeRuntimeLockSnapshot;
      vi.spyOn(locks, "observeRuntimeLockSnapshot").mockImplementation(input => {
        const snapshot = original(input);
        return { ...snapshot, processLocks: { ...snapshot.processLocks, [condition]: { state: "active", generation: 1, pid: process.pid } } };
      });
    }
    expect(() => recoverAbandonedAdmissionMutex(root, restore, "empty")).toThrow(condition === "lease"
      ? /installation lease may still be live/u : condition === "journal"
        ? /unexpected installation control entry/u : /runtime process lock may still be live/u);
    expect(readdirSync(path)).toEqual([]);
    expect(existsSync(join(control, "admission-mutex-recovery"))).toBe(false);
  } finally { restore.release(); }
});

it("retries acquisition when an observed empty canonical folder disappears during inspection", async () => {
  const root = fixture();
  const path = join(root, ".tracker/control", "admission-mutex");
  mkdirSync(path, { mode: 0o700 });
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  let removed = false;
  vi.mocked(filesystem.readdirSync).mockImplementation(((target: Parameters<typeof actual.readdirSync>[0]) => {
    const entries = actual.readdirSync(target);
    if (String(target) === path && !removed) { removed = true; rmdirSync(path); }
    return entries;
  }) as typeof actual.readdirSync);
  acquireEntrypointAdmission(root, "shared").release();
  expect(removed).toBe(true);
  expect(existsSync(path)).toBe(false);
});
it("preserves a temporary folder when exact birth identity observation fails", () => {
  const root = fixture();
  const observed = locks.observeProcessIdentity(process.pid);
  if (observed.state !== "alive") throw new Error("current identity unavailable");
  const digest = createHash("sha256").update(canonicalJsonStringify(observed.identity)).digest("hex");
  const path = join(root, ".tracker/control", `.admission-mutex-tmp-${process.pid}-${digest}-${randomUUID()}`);
  mkdirSync(path, { mode: 0o700 });
  const failure = new Error("identity observation unavailable");
  vi.spyOn(locks, "observeProcessIdentity").mockImplementation(() => { throw failure; });
  expect(() => acquireEntrypointAdmission(root, "shared")).toThrow(failure);
  expect(readdirSync(path)).toEqual([]);
});
it("cleans a pre-owner folder for a reused PID using exact birth identity", () => {
  const root = fixture();
  const digest = createHash("sha256").update(canonicalJsonStringify({ platform: process.platform, startToken: "previous-process" })).digest("hex");
  const path = join(root, ".tracker/control", `.admission-mutex-tmp-${process.pid}-${digest}-${randomUUID()}`);
  mkdirSync(path, { mode: 0o700 });
  acquireEntrypointAdmission(root, "shared").release();
  expect(existsSync(path)).toBe(false);
});
it("preserves a remnant whose complete owner disagrees with its process identity name", () => {
  const root = fixture();
  const current = locks.observeProcessIdentity(process.pid);
  if (current.state !== "alive") throw new Error("current identity unavailable");
  const acquisitionId = randomUUID();
  const path = join(root, ".tracker/control", `.admission-mutex-tmp-${process.pid}-${"0".repeat(64)}-${acquisitionId}`);
  mkdirSync(path, { mode: 0o700 });
  const ownerPath = join(path, "owner.json");
  const bytes = JSON.stringify({ schemaVersion: 1, acquisitionId, phase: "admitting", pid: process.pid, processIdentity: current.identity });
  writeFileSync(ownerPath, bytes, { mode: 0o600 });
  expect(() => acquireEntrypointAdmission(root, "shared")).toThrow(/mutex temporary owner identity mismatch/u);
  expect(readFileSync(ownerPath, "utf8")).toBe(bytes);
});
