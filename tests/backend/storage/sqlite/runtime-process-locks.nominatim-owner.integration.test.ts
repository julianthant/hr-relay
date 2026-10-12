import assert from "node:assert/strict";
import { fork,type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { chmodSync,existsSync,linkSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,unlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,it,vi } from "vitest";
import { createNominatimGeocodeAdapter } from "../../../../src/backend/processing/providers/geocode-adapters.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { RuntimeProcessLockFileSchema,acquireRuntimeProcessLock,observeRuntimeLockSnapshot,readGeocodeRuntimeFile,readRuntimeProcessLock,writeGeocodeRuntimeFileExclusive } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { ProviderRequestEnvelopeSchema } from "../../../../src/models/providers/providers.js";
import { systemClock } from "../../../../src/rules/time/clock.js";


const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const request = ProviderRequestEnvelopeSchema.parse({ capability: "geocode.nominatim", payload: { schemaHash: "a".repeat(64), value: { street: "1 Test Road", country: "US" } } });
function root() { const path = mkdtempSync(join(tmpdir(), "relay-nominatim-")); cleanups.push(() => rmSync(path, { recursive: true, force: true })); return path; }
function options(milliseconds = 10_000, controller = new AbortController()) { return { requestId: randomUUID(), signal: controller.signal, deadlineMonotonicMs: systemClock.monotonicMs() + milliseconds }; }
function message(process: ChildProcess, kind: string): Promise<Record<string, unknown>> {
  return new Promise((done, reject) => {
    const timer = setTimeout(() => { process.removeListener("message", receive); reject(new Error(`synthetic child did not send ${kind}`)); }, 8000);
    const receive = (value: unknown) => { if (typeof value === "object" && value !== null && "kind" in value && value.kind === kind) { clearTimeout(timer); process.removeListener("message", receive); done(value); } };
    process.on("message", receive);
  });
}
it("shares pending and rejected stop while an injected fetch remains unsettled, retaining the exact acquisition", async () => {
  const path = root(); let started = () => {}; const entering = new Promise<void>(done => { started = done; }); let complete = () => {};
  const owner = createNominatimGeocodeAdapter({ processLockRoot: path, clock: systemClock, fetchFn: async () => { started(); return new Promise<Response>(done => { complete = () => done(Response.json([])); }); } });
  const pending = owner.invoke(request, options()); await entering;
  const before = readRuntimeProcessLock(path, "geocode"); const first = owner.stop(); const second = owner.stop(); assert.equal(first, second);
  let settled = false; void first.then(() => { settled = true; }, () => { settled = true; });
  await new Promise<void>(done => setTimeout(done, 30)); assert.equal(settled, false); assert.deepEqual(readRuntimeProcessLock(path, "geocode"), before);
  const replacement = createNominatimGeocodeAdapter({ processLockRoot: path, clock: systemClock, fetchFn: async () => { throw new Error("replacement overlapped unresolved fetch"); } });
  assert.equal((await replacement.invoke(request, options())).response.state, "unavailable"); await replacement.stop();
  await assert.rejects(first, /closure-unproven/u); assert.equal(owner.stop(), first); await assert.rejects(owner.stop(), /closure-unproven/u);
  assert.deepEqual(readRuntimeProcessLock(path, "geocode"), before); complete(); await pending;
  await new Promise<void>(done => setTimeout(done, 20)); assert.deepEqual(readRuntimeProcessLock(path, "geocode"), before);
}, 10_000);

it("admits exactly one of two processes that observed the same dead generation", async () => {
  const path = root(); const seed = acquireRuntimeProcessLock({ processLockRoot: path, name: "geocode", pid: process.pid });
  const seedPath = join(path, "geocode-claims", `${seed.generation}.claim.json`);
  const dead = { ...RuntimeProcessLockFileSchema.parse(JSON.parse(readFileSync(seedPath, "utf8"))), pid: 2147483647 }; writeFileSync(seedPath, JSON.stringify(dead));
  const contenders = ["a", "b"].map(name => {
    const contender = fork(join(import.meta.dirname, "../../../support/helpers/geocode/nominatim-election.ts"), [path, name], { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
    cleanups.push(async () => { if (contender.exitCode === null && contender.signalCode === null) { contender.kill("SIGKILL"); await once(contender, "exit"); } }); return contender;
  });
  const results = contenders.map(contender => message(contender, "election"));
  const deadline = performance.now() + 5000;
  while (!["a", "b"].every(name => existsSync(join(path, `${name}.ready`)))) { assert.ok(performance.now() < deadline); await new Promise<void>(done => setTimeout(done, 5)); }
  writeFileSync(join(path, "contend"), "go");
  const elected = await Promise.all(results); assert.equal(elected.filter(result => result.state === "owned").length, 1); assert.equal(elected.filter(result => result.state === "refused").length, 1);
  const winner = elected.findIndex(result => result.state === "owned"); const active = readRuntimeProcessLock(path, "geocode"); assert.equal(active?.generation, seed.generation + 1);
  const claimPath = join(path, "geocode-claims", `${active?.generation}.claim.json`); const bytes = readFileSync(claimPath);
  assert.throws(() => acquireRuntimeProcessLock({ processLockRoot: path, name: "geocode", pid: process.pid }), /owner-active/u); assert.deepEqual(readFileSync(claimPath), bytes);
  assert.equal(observeRuntimeLockSnapshot({ processLockRoot: path, sourceDatabaseIdentity: "a".repeat(64) }).processLocks.geocode?.state, "active");
  assert.ok(active && "acquisitionId" in active);
  const later = { ...active, generation: active.generation + 1, acquisitionId: randomUUID() };
  writeGeocodeRuntimeFileExclusive(path, `${later.generation}.claim.json`, JSON.stringify(later));
  writeGeocodeRuntimeFileExclusive(path, `${later.generation}-${later.acquisitionId}.release.json`, JSON.stringify({ generation: later.generation, acquisitionId: later.acquisitionId, releasedAt: systemClock.now().toISOString() }));
  assert.equal(readRuntimeProcessLock(path, "geocode")?.generation, active.generation);
  const observed = observeRuntimeLockSnapshot({ processLockRoot: path, sourceDatabaseIdentity: "a".repeat(64) }); assert.equal(observed.processLocks.geocode?.state, "active"); assert.equal(observed.processLocks.geocode?.generation, later.generation);
  const proofStore = new RecoveryStopProofStore({ processLockRoot: path, maxProofAgeMs: 10_000 }); proofStore.recordRuntimeState(observed);
  assert.throws(() => proofStore.issue({ sourceDatabaseIdentity: "a".repeat(64), observedBy: "local-operator" }), /active|stopped/u);
  const processWinner = contenders[winner]; assert.ok(processWinner); const exited = once(processWinner, "exit"); processWinner.send("release"); await exited;
  assert.deepEqual(readFileSync(claimPath), bytes); assert.ok(readRuntimeProcessLock(path, "geocode")?.releasedAt);
  const replacement = acquireRuntimeProcessLock({ processLockRoot: path, name: "geocode", pid: process.pid }); assert.equal(replacement.generation, seed.generation + 3); replacement.release();
}, 10_000);
it("refuses unsafe endpoint reads and exclusive publication without touching linked targets", () => {
  const path = root(); writeGeocodeRuntimeFileExclusive(path, "safe.channel.json", "private");
  const directory = join(path, "geocode-claims"); const target = join(path, "target"); writeFileSync(target, "unchanged", { mode: 0o600 }); const before = statSync(target);
  for (const kind of ["symlink", "hardlink"] as const) {
    const name = `${kind}.channel.json`; const endpoint = join(directory, name);
    if (kind === "symlink") symlinkSync(target, endpoint); else linkSync(target, endpoint);
    assert.throws(() => readGeocodeRuntimeFile(path, name)); assert.throws(() => writeGeocodeRuntimeFileExclusive(path, name, "overwrite"));
    assert.equal(readFileSync(target, "utf8"), "unchanged"); assert.equal(statSync(target).mode, before.mode); unlinkSync(endpoint);
  }
  chmodSync(join(directory, "safe.channel.json"), 0o644); assert.throws(() => readGeocodeRuntimeFile(path, "safe.channel.json"), /unsafe/u);
  chmodSync(join(directory, "safe.channel.json"), 0o600); writeFileSync(join(directory, "safe.channel.json"), "x".repeat(65_537)); assert.throws(() => readGeocodeRuntimeFile(path, "safe.channel.json"), /unsafe|oversize/u);
  mkdirSync(join(directory, "directory.channel.json")); assert.throws(() => readGeocodeRuntimeFile(path, "directory.channel.json"), /unsafe/u);
  const uid = process.getuid; assert.ok(uid); const mocked = vi.spyOn(process, "getuid").mockReturnValue(uid() + 1);
  try { assert.throws(() => readGeocodeRuntimeFile(path, "safe.channel.json"), /unsafe/u); } finally { mocked.mockRestore(); }
});
