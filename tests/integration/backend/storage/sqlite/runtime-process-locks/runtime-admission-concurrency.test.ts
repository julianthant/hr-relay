import * as filesystem from "node:fs";
import * as processLocks from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { AdmissionMutexBusyError } from "../../../../../../src/backend/storage/admission/installation.js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, it, vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../../../../src/backend/storage/admission/bootstrap-admission.js";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdirSync: vi.fn(actual.mkdirSync), lstatSync: vi.fn(actual.lstatSync) };
});

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function launch(code: string, root: string): { child: ChildProcess; next: () => Promise<{ state: string; detail?: string }> } {
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, root],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] });
  children.push(child);
  const queued: { state: string; detail?: string }[] = [];
  const readers: ((value: { state: string; detail?: string }) => void)[] = [];
  let output = "";
  child.stderr?.on("data", chunk => { output += String(chunk); });
  child.on("message", value => {
    const parsed = value as { state: string; detail?: string };
    const reader = readers.shift();
    if (reader === undefined) queued.push(parsed); else reader(parsed);
  });
  child.on("exit", code => {
    while (readers.length > 0) readers.shift()?.({ state: "exited", detail: `${String(code)} ${output}` });
  });
  return { child, next: () => {
    const value = queued.shift();
    return value === undefined ? new Promise(resolve => readers.push(resolve)) : Promise.resolve(value);
  } };
}
it("admits and releases simultaneous installed children after a live mutex holder leaves its critical section", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "runtime-admission-concurrent-")));
  roots.push(root);
  acquireEntrypointAdmission(root, "exclusive").release();
  const bootUrl = pathToFileURL(join(process.cwd(), "src/backend/storage/admission/bootstrap-admission.ts")).href;
  const locksUrl = pathToFileURL(join(process.cwd(), "src/backend/storage/sqlite/runtime-process-locks.ts")).href;
  const holder = launch(`
    import { mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
    import { join } from "node:path";
    import { randomUUID } from "node:crypto";
    const { observeProcessIdentity } = await import(${JSON.stringify(locksUrl)});
    const root = process.argv[1];
    const mutex = join(root, ".runtime-control", "admission-mutex");
    mkdirSync(mutex, { mode: 0o700 });
    const observed = observeProcessIdentity(process.pid);
    if (observed.state !== "alive") throw new Error("holder identity unavailable");
    writeFileSync(join(mutex, "owner.json"), JSON.stringify({ schemaVersion: 1, acquisitionId: randomUUID(),
      phase: "admitting", pid: process.pid, processIdentity: observed.identity }), { mode: 0o600 });
    process.on("message", () => { unlinkSync(join(mutex, "owner.json")); rmdirSync(mutex);
      process.send({ state: "released" }); process.disconnect(); });
    process.send({ state: "held" });
  `, root);
  assert.equal((await holder.next()).state, "held");
  const code = `
    const { acquireEntrypointAdmission } = await import(${JSON.stringify(bootUrl)});
    process.send({ state: "attempting" });
    try { const admission = acquireEntrypointAdmission(process.argv[1], "shared");
      admission.assertLive(); admission.release(); process.send({ state: "admitted-and-released" }); }
    catch (error) { process.send({ state: "refused", detail: error.message }); }
    process.disconnect();
  `;
  const first = launch(code, root);
  const second = launch(code, root);
  assert.equal((await first.next()).state, "attempting");
  assert.equal((await second.next()).state, "attempting");
  holder.child.send("release");
  assert.equal((await holder.next()).state, "released");
  assert.deepEqual(await Promise.all([first.next(), second.next()]),
    [{ state: "admitted-and-released" }, { state: "admitted-and-released" }]);
  const exclusive = acquireEntrypointAdmission(root, "exclusive");
  exclusive.release();
});

function initializedRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "runtime-admission-refusal-")));
  roots.push(root);
  acquireEntrypointAdmission(root, "exclusive").release();
  return root;
}
it.each(["live", "empty", "malformed", "unknown"] as const)("preserves %s owner custody without attempting abandoned-owner recovery", condition => {
  const root = initializedRoot();
  const mutex = join(root, ".runtime-control", "admission-mutex");
  mkdirSync(mutex, { mode: 0o700 });
  if (condition !== "empty") {
    const observation = processLocks.observeProcessIdentity(process.pid);
    assert.ok(observation.state === "alive");
    writeFileSync(join(mutex, "owner.json"), condition === "malformed" ? "not-json" : JSON.stringify({
      schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: process.pid,
      processIdentity: observation.identity,
    }), { mode: 0o600 });
  }
  const before = readdirSync(mutex).map(name => ({ name, bytes: readFileSync(join(mutex, name)) }));
  const unknown = new Error("process birth identity unavailable");
  if (condition === "unknown") vi.spyOn(processLocks, "observeProcessIdentity").mockImplementation(() => { throw unknown; });
  if (condition === "unknown") assert.throws(() => acquireEntrypointAdmission(root, "shared"), error => error === unknown);
  else if (condition === "malformed") assert.throws(() => acquireEntrypointAdmission(root, "shared"), SyntaxError);
  else assert.throws(() => acquireEntrypointAdmission(root, "shared"), AdmissionMutexBusyError);
  assert.deepEqual(readdirSync(mutex).map(name => ({ name, bytes: readFileSync(join(mutex, name)) })), before);
  assert.equal(existsSync(join(root, ".runtime-control", "admission-mutex-recovery")), false);
});
it("propagates non-EEXIST mutex mkdir failures without translating them to busy", () => {
  const root = initializedRoot();
  const mutex = join(root, ".runtime-control", "admission-mutex");
  const failure = Object.assign(new Error("injected mkdir access failure"), { code: "EACCES" });
  vi.mocked(filesystem.mkdirSync).mockImplementationOnce(() => { throw failure; });
  assert.throws(() => acquireEntrypointAdmission(root, "shared"), error => error === failure);
  assert.equal(String(vi.mocked(filesystem.mkdirSync).mock.calls.at(-1)?.[0]), mutex);
  assert.equal(existsSync(mutex), false);
});
it("refuses symlink mutex custody and preserves an immediate exclusive lease conflict", () => {
  const root = initializedRoot();
  const admission = acquireEntrypointAdmission(root, "exclusive");
  assert.throws(() => acquireEntrypointAdmission(root, "shared"), /installation lease busy/u);
  admission.release();
  const target = initializedRoot();
  symlinkSync(join(target, ".runtime-control"), join(root, ".runtime-control", "admission-mutex"));
  assert.throws(() => acquireEntrypointAdmission(root, "shared"), /unsafe directory/u);
  assert.equal(existsSync(join(target, ".runtime-control", "installation.json")), true);
});

it("propagates installation lstat access failure instead of treating the path as absent", () => {
  const root = initializedRoot();
  const failure = Object.assign(new Error("injected lstat access failure"), { code: "EACCES" });
  vi.mocked(filesystem.lstatSync).mockImplementationOnce(() => { throw failure; });
  assert.throws(() => acquireEntrypointAdmission(root, "shared"), error => error === failure);
});
