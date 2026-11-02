import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { BrowserRootUnavailableError, BrowserRootsSchema, createBrowserRoots, type BrowserProfileProbeOptions, type BrowserRootLaunchInput } from "../../../src/backend/storage/browser-roots.js";
import { DEFAULT_BROWSER_LAUNCHER, BrowserProfileStillClosingError } from "../../../src/backend/runtime/browser/native-browser.js";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { z } from "zod";
import { hasUnprovedSourceClosure } from "../../../src/backend/storage/source-closure.js";
import { manualClock, systemClock } from "../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../helpers/admission-fixture.js";
import { createBrowserSessionFactoryFixtures } from "../helpers/browser/session-factory-fixtures.js";
import { testAdmittedWorker } from "../fixtures/run-lifecycle-fixtures.js";

const retainedOwners = new Set<object>();
function contains(error: unknown, expected: unknown): boolean {
  const pending = [error], seen = new Set<unknown>();
  while (pending.length > 0) {
    const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
    if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
    if (value instanceof Error) pending.push(value.cause);
  }
  return seen.has(expected);
}

export async function runBrowserRootRetentionCase(input: Readonly<{ scenario: string; workspace: string; nonce: string }>): Promise<void> {
  if (input.scenario === "browser-root-unknown-seed" || input.scenario === "browser-root-unknown-resume") return runUnknownHandoff(input);
  const workspace = join(input.workspace, `.${input.scenario}-${input.nonce}`);
  assert.equal(fs.realpathSync(workspace), workspace);
  const f = await createBoundProfileFixture({ workspace });
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "browser-root-retention" }, systemClock, undefined, undefined, undefined, boundProfileCredentials(f.admission));
  const worker = testAdmittedWorker(database, systemClock, { path: f.path, workflow: "person-lookup", poolIndex: 1, browserSystems: ["crm"] });
  const roots = createBrowserRoots(f.admission), profileRoot = join(f.stateRoot, "browsers"), profileDirectory = join(profileRoot, "w1", "crm");
  const owner: BrowserRootLaunchInput = { profileId: f.admission.profileBinding.profileId, profileRoot, profileDirectory,
    credentialFingerprint: "a".repeat(64), owner: { kind: "worker", database, workerId: worker.workerId } };
  const registryPath = join(f.machine.stateRoot, "machine", "browser-roots.json");
  const document = () => BrowserRootsSchema.parse(JSON.parse(fs.readFileSync(registryPath, "utf8")));
  const held = { f, database, roots }; retainedOwners.add(held);
  const scheduler = { schedule(deadline: number, expire: () => void) {
    const timer = setTimeout(expire, Math.max(0, deadline - systemClock.monotonicMs()));
    return { cancel: () => clearTimeout(timer) };
  } };
  const fixtures = createBrowserSessionFactoryFixtures(manualClock(new Date()), randomUUID(), scheduler);
  const options = (launcher = fixtures.fakeLauncher().launcher): BrowserProfileProbeOptions => ({ clock: systemClock,
    scheduler, closeProofMs: 100, launchTimeoutMs: 5000, signal: new AbortController().signal, launcher });
  let launches = 0;
  if (input.scenario === "browser-root-native-success") {
    const launcher = { launch: async (launch: Parameters<typeof DEFAULT_BROWSER_LAUNCHER.launch>[0]) => {
      assert.equal(launch.nativeOnly, true); assert.equal(launch.profileDirectory, profileDirectory);
      const row = document().roots[0]; assert.ok(row);
      if (launches++ === 0) assert.equal(row.launch.state, "launching");
      else assert.equal(row.native?.phase, "probing");
      return DEFAULT_BROWSER_LAUNCHER.launch(launch);
    } };
    const realOptions = { ...options(launcher), closeProofMs: 5000 };
    await roots.probe(owner, realOptions);
    await roots.withUnused(profileDirectory, realOptions, async ({ remove }) => { remove(); }, owner);
    assert.equal(launches, 2); assert.equal(document().roots.length, 0); assert.equal(fs.existsSync(profileDirectory), false);
    database.close(); await f.closeController(); retainedOwners.delete(held); return;
  }
  const fault = new Error(`synthetic exact ${input.scenario} refusal`);
  let registryBefore = fs.readFileSync(registryPath);
  let late: ReturnType<typeof roots.beginLaunch> | undefined;
  let failure: unknown, descriptor: number | undefined, stagePath: string | undefined, stageIdentity: fs.Stats | undefined, stageBytes: Buffer | undefined;
  let boundaryHits = 0;
  let contextClosed: boolean;
  let busyLaunchFailure: Error | undefined;
  const credentialPath = join(f.stateRoot, "credentials", "protected.json"), credentials = fs.readFileSync(credentialPath);
  const originalClose = fs.closeSync, originalRename = fs.renameSync, originalRemove = fs.rmSync;
  if (input.scenario === "browser-root-stage-close") {
    late = roots.beginLaunch(owner); late.opened(); registryBefore = fs.readFileSync(registryPath);
    const second = { ...owner, profileDirectory: join(profileRoot, "w1", "ucpath") };
    fs.closeSync = fd => {
      const info = fs.fstatSync(fd);
      for (const name of fs.readdirSync(join(f.machine.stateRoot, "machine"))) {
        if (!name.startsWith(".browser-roots.") || !name.endsWith(".tmp")) continue;
        const path = join(f.machine.stateRoot, "machine", name), file = fs.lstatSync(path);
        if (file.dev === info.dev && file.ino === info.ino && descriptor === undefined) {
          descriptor = fd; stagePath = path; stageIdentity = info; stageBytes = fs.readFileSync(path); boundaryHits++; throw fault;
        }
      }
      originalClose(fd);
    };
    syncBuiltinESMExports();
    try { await roots.probe(second, options({ launch: async () => { launches++; throw new Error("Chrome must not launch after publication refusal"); } })); }
    catch (error) { failure = error; }
    assert.equal(launches, 0); assert.deepEqual(fs.readFileSync(registryPath), registryBefore);
    assert.ok(descriptor !== undefined && stagePath !== undefined && stageIdentity !== undefined && stageBytes !== undefined);
    assert.deepEqual([fs.fstatSync(descriptor).dev, fs.fstatSync(descriptor).ino], [stageIdentity.dev, stageIdentity.ino]);
    assert.deepEqual(fs.readFileSync(stagePath), stageBytes);
  } else {
    await roots.probe(owner, options());
    const row = document().roots[0]; assert.ok(row); const source = fs.lstatSync(profileDirectory);
    const marker = join(profileDirectory, "retained"); fs.writeFileSync(marker, "retained exact profile", { mode: 0o600 });
    const native = fixtures.fakeLauncher({ emitCloseEvent: input.scenario !== "browser-root-close-unproved" });
    if (input.scenario === "browser-root-rm-refusal") {
      fs.rmSync = (path, config) => { if (String(path) === profileDirectory) { boundaryHits++; throw fault; } originalRemove(path, config); };
    }
    if (input.scenario === "browser-root-observed-publication") {
      fs.renameSync = (from, to) => {
        if (String(to) === registryPath) {
          const candidate = BrowserRootsSchema.parse(JSON.parse(fs.readFileSync(String(from), "utf8")));
          if (candidate.roots[0]?.native?.phase === "observed") { stagePath = String(from); stageBytes = fs.readFileSync(stagePath); boundaryHits++; throw fault; }
        }
        originalRename(from, to);
      };
    }
    syncBuiltinESMExports();
    const launcher = { launch: async (launch: Parameters<typeof native.launcher.launch>[0]) => {
      launches++; const current = document().roots[0]; assert.ok(current?.native);
      assert.equal(current.native.phase, "probing"); assert.deepEqual(current.launch, row.launch);
      assert.deepEqual(current.native.source, { device: source.dev, inode: source.ino });
      if (input.scenario === "browser-root-busy") {
        boundaryHits++; busyLaunchFailure = new Error("Failed to create a ProcessSingleton for your profile directory.", { cause: fault }); throw busyLaunchFailure;
      }
      if (input.scenario === "browser-root-close-unproved") boundaryHits++;
      return native.launcher.launch(launch);
    } };
    let effects = 0;
    try { await roots.withUnused(profileDirectory, options(launcher), async ({ remove }) => { effects++; remove(); }, owner); }
    catch (error) { failure = error; }
    contextClosed = native.contextClosed(); assert.equal(launches, 1);
    assert.equal(effects, input.scenario === "browser-root-rm-refusal" ? 1 : 0);
    const retained = document().roots[0]; assert.ok(retained?.native);
    assert.deepEqual(retained.launch, row.launch); assert.deepEqual(retained.owner, row.owner);
    assert.equal(retained.native.phase, input.scenario === "browser-root-rm-refusal" ? "deleting" : "probing");
    assert.deepEqual(retained.native.source, { device: source.dev, inode: source.ino });
    assert.deepEqual([fs.lstatSync(profileDirectory).dev, fs.lstatSync(profileDirectory).ino], [source.dev, source.ino]);
    assert.equal(fs.readFileSync(marker, "utf8"), "retained exact profile");
    if (input.scenario === "browser-root-busy") {
      const errors: unknown[] = [failure]; let busy: BrowserProfileStillClosingError | undefined;
      for (let index = 0; index < errors.length; index++) {
        const error = errors[index]; if (error instanceof BrowserProfileStillClosingError) busy = error;
        if (error instanceof AggregateError) { const nested: readonly unknown[] = error.errors; errors.push(...nested); }
        if (error instanceof Error && error.cause !== undefined) errors.push(error.cause);
      }
      assert.ok(busy); assert.equal(busy.code, "BROWSER_PROFILE_STILL_CLOSING"); assert.equal(contains(busy, fault), true);
      assert.equal(failure, busy); assert.ok(busyLaunchFailure); assert.equal(busy.cause, busyLaunchFailure); assert.equal(busyLaunchFailure.cause, fault);
      assert.equal(hasUnprovedSourceClosure(failure), false);
      f.admission.assertProfileRuntime(); f.admission.assertBrowserRegistryCustody();
      f.lifetime.assertSourceCustody(); f.lifetime.assertRuntimeAvailable();
      const retainedBytes = fs.readFileSync(registryPath);
      assert.deepEqual(roots.inventory().roots[0], retained); assert.deepEqual(fs.readFileSync(registryPath), retainedBytes);
    }
    if (input.scenario === "browser-root-observed-publication") {
      assert.ok(stagePath && stageBytes); assert.equal(contextClosed, true); assert.deepEqual(fs.readFileSync(stagePath), stageBytes);
    }
  }
  fs.closeSync = originalClose; fs.renameSync = originalRename; fs.rmSync = originalRemove; syncBuiltinESMExports();
  assert.equal(boundaryHits, 1); assert.ok(failure instanceof Error);
  assert.deepEqual(fs.readFileSync(credentialPath), credentials);
  if (input.scenario !== "browser-root-busy") {
    assert.equal(hasUnprovedSourceClosure(failure), true);
    if (input.scenario !== "browser-root-close-unproved") assert.equal(contains(failure, fault), true);
    const retainedFailure = (error: unknown) => hasUnprovedSourceClosure(error)
      && contains(error, input.scenario === "browser-root-close-unproved" ? failure : fault);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => f.admission.release(), hasUnprovedSourceClosure);
      await assert.rejects(f.lifetime.close(), hasUnprovedSourceClosure); f.lifetime.assertHeld();
      assert.throws(() => roots.beginLaunch(owner), retainedFailure);
      assert.throws(() => roots.inventory(), retainedFailure);
      if (late !== undefined) { const captured = late; assert.throws(() => captured.closed(), retainedFailure); assert.deepEqual(fs.readFileSync(registryPath), registryBefore); }
      assert.deepEqual(fs.readFileSync(credentialPath), credentials);
      if (descriptor !== undefined) { assert.ok(stageIdentity); assert.equal(fs.fstatSync(descriptor).ino, stageIdentity.ino); }
    }
  }
}


async function runUnknownHandoff(input: Readonly<{ scenario: string; workspace: string; nonce: string }>): Promise<void> {
  const workspace = join(input.workspace, `.browser-root-unknown-${input.nonce}`);
  assert.equal(fs.realpathSync(workspace), workspace);
  const seedPath = join(input.workspace, `.browser-root-unknown-${input.nonce}.seed.json`);
  const closedPath = join(input.workspace, `.browser-root-unknown-${input.nonce}.closed.json`);
  const seedSchema = z.strictObject({ nonce: z.uuid(), processId: z.number().int().positive(), lifetimePort: z.number().int().positive(),
    profileId: z.uuid(), workerId: z.string(), leaseGeneration: z.number().int().positive(), registryHash: z.string().regex(/^[a-f0-9]{64}$/u) });
  const registryPath = join(workspace, rebuildRuntimeIsolation.stateRoot, "machine", "browser-roots.json");
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const scheduler = { schedule(deadline: number, expire: () => void) {
    const timer = setTimeout(expire, Math.max(0, deadline - systemClock.monotonicMs())); return { cancel: () => clearTimeout(timer) };
  } };
  if (input.scenario === "browser-root-unknown-seed") {
    const f = await createBoundProfileFixture({ workspace });
    const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "browser-root-unknown-seed" }, systemClock);
    const worker = testAdmittedWorker(database, systemClock, { path: f.path, workflow: "person-lookup", poolIndex: 1, browserSystems: ["crm"] });
    const roots = createBrowserRoots(f.admission), profileRoot = join(f.stateRoot, "browsers"), profileDirectory = join(profileRoot, "w1", "crm");
    retainedOwners.add({ f, database, roots });
    const owner: BrowserRootLaunchInput = { profileId: f.admission.profileBinding.profileId, profileRoot, profileDirectory,
      credentialFingerprint: "a".repeat(64), owner: { kind: "worker", database, workerId: worker.workerId } };
    const fault = new Error("owned unknown predecessor native launch failure"); let launches = 0, failure: unknown;
    try { await roots.probe(owner, { clock: systemClock, scheduler, closeProofMs: 100, launchTimeoutMs: 100,
      signal: new AbortController().signal, launcher: { launch: async () => { launches++; throw fault; } } }); }
    catch (error) { failure = error; }
    assert.equal(launches, 1); assert.equal(hasUnprovedSourceClosure(failure), true); assert.equal(contains(failure, fault), true);
    const row = BrowserRootsSchema.parse(JSON.parse(fs.readFileSync(registryPath, "utf8"))).roots[0]; assert.ok(row);
    assert.equal(row.launch.state, "unknown"); assert.equal(row.native, undefined);
    assert.equal(row.owner.kind, "worker"); assert.equal(row.profileId, owner.profileId);
    assert.throws(() => f.admission.release(), hasUnprovedSourceClosure); await assert.rejects(f.lifetime.close(), hasUnprovedSourceClosure); f.lifetime.assertHeld();
    const receipt = seedSchema.parse({ nonce: input.nonce, processId: process.pid, lifetimePort: f.lifetime.port,
      profileId: owner.profileId, workerId: worker.workerId, leaseGeneration: worker.lease.leaseGeneration, registryHash: hash(fs.readFileSync(registryPath)) });
    fs.writeFileSync(seedPath, JSON.stringify(receipt), { mode: 0o600, flag: "wx", flush: true }); return;
  }
  const seedBytes = fs.readFileSync(seedPath), seed = seedSchema.parse(JSON.parse(seedBytes.toString("utf8")));
  assert.equal(seed.nonce, input.nonce);
  const closed = z.strictObject({ nonce: z.uuid(), processId: z.number().int().positive(), seedHash: z.string(),
    code: z.null(), signal: z.literal("SIGKILL") }).parse(JSON.parse(fs.readFileSync(closedPath, "utf8")));
  assert.deepEqual(closed, { nonce: input.nonce, processId: seed.processId, seedHash: hash(seedBytes), code: null, signal: "SIGKILL" });
  const lifetime = await RuntimeLifetimeLock.acquire(seed.lifetimePort);
  assert.equal(lifetime.port, seed.lifetimePort); lifetime.assertHeld();
  const machine = acquireEntrypointAdmission(workspace, "shared", lifetime), admission = machine.admitProfile(seed.profileId);
  const database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "browser-root-unknown-resume" }, systemClock);
  const roots = createBrowserRoots(admission); retainedOwners.add({ lifetime, machine, admission, database, roots });
  const before = fs.readFileSync(registryPath), inventory = roots.inventory();
  assert.equal(hash(before), seed.registryHash); const row = inventory.roots[0]; assert.ok(row && row.owner.kind === "worker");
  assert.equal(row.launch.state, "unknown"); assert.equal(row.profileId, seed.profileId);
  assert.equal(row.owner.workerId, seed.workerId); assert.equal(row.owner.leaseGeneration, seed.leaseGeneration);
  const slot = database.authority.workerSlots.get(seed.workerId), prior = database.authority.workerLeases.get(seed.workerId);
  assert.ok(slot && prior); assert.equal(slot.retiredAt, null); assert.equal(slot.workerId, seed.workerId);
  assert.equal(prior.processId, seed.processId); assert.equal(prior.leaseGeneration, seed.leaseGeneration);
  assert.equal(prior.lifecycle.state, "starting");
  const now = systemClock.now().toISOString();
  const stopped = database.authority.workerLeases.reportLifecycle({ workerId: seed.workerId, leaseGeneration: prior.leaseGeneration, now,
    lifecycle: { state: "stopped", startedAt: prior.lifecycle.startedAt, stoppedAt: now, reason: "crashed" } });
  assert.equal(stopped.state, "applied");
  const started = database.authority.workerLeases.start({ workerId: seed.workerId, workflow: slot.workflow, browserSystems: ["crm"],
    processId: process.pid, requestedBy: "local-operator", now });
  assert.equal(started.state, "started");
  const successor = database.authority.workerLeases.get(seed.workerId); assert.ok(successor);
  assert.ok(successor.leaseGeneration > prior.leaseGeneration); assert.equal(successor.processId, process.pid);
  const profileRoot = join(machine.stateRoot, row.profileRoot), profileDirectory = join(machine.stateRoot, row.directory);
  const current = database.browserWorkerOwner(admission, seed.workerId, profileDirectory);
  assert.equal(current.leaseGeneration, successor.leaseGeneration); assert.equal(current.ordinal, row.owner.ordinal);
  const owner: BrowserRootLaunchInput = { profileId: seed.profileId, profileRoot, profileDirectory,
    credentialFingerprint: row.credentialFingerprint, owner: { kind: "worker", database, workerId: seed.workerId } };
  let launches = 0, effects = 0;
  await assert.rejects(roots.withUnused(profileDirectory, { clock: systemClock, scheduler, closeProofMs: 100, launchTimeoutMs: 100,
    signal: new AbortController().signal, launcher: { launch: async () => { launches++; throw new Error("unknown predecessor cannot launch"); } } },
  async () => { effects++; }, owner), error => error instanceof BrowserRootUnavailableError && !hasUnprovedSourceClosure(error));
  assert.equal(launches, 0); assert.equal(effects, 0); assert.deepEqual(fs.readFileSync(registryPath), before);
  assert.deepEqual(roots.inventory(), inventory); admission.assertProfileRuntime(); lifetime.assertHeld();
}
