import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { BrowserRootsSchema, createBrowserRoots, type BrowserRootLaunchInput, type BrowserProfileProbeOptions, onboardingProfileDirectory } from "../../../src/backend/storage/browser-roots.js";
import { SignUpOperationSchema } from "../../../src/models/profiles/profile.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { detachBoundFixtureWorkers, registerBoundFixtureWorker, stopSyntheticDatabaseWorkers } from "../../support/helpers/synthetic-database-admission.js";
import { boundProfileCredentials, createBoundProfileFixture, withOfflineMaintenance } from "../../support/helpers/admission-fixture.js";
import { createBrowserSessionFactoryFixtures } from "../../support/helpers/browser/session-factory-fixtures.js";
import { testAdmittedWorker } from "../../support/fixtures/run-lifecycle-fixtures.js";

const clock = manualClock(new Date("2026-11-01T12:00:01.000Z"));
const scheduler = { schedule: () => ({ cancel() {} }) };
const browser = createBrowserSessionFactoryFixtures(clock, randomUUID(), scheduler);

async function fixture() {
  const f = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "browser-roots-tests" }, clock, undefined, undefined, undefined, boundProfileCredentials(f.admission));
  const worker = testAdmittedWorker(database, clock, { path: f.path, workflow: "person-lookup", poolIndex: 1, browserSystems: ["crm"] });
  const profileRoot = join(f.stateRoot, "browsers"), profileDirectory = join(profileRoot, "w1", "crm");
  const input: BrowserRootLaunchInput = { profileId: f.admission.profileBinding.profileId, profileRoot, profileDirectory,
    credentialFingerprint: "a".repeat(64), owner: { kind: "worker", database, workerId: worker.workerId } };
  const roots = createBrowserRoots(f.admission), path = join(f.machine.stateRoot, "machine", "browser-roots.json");
  const options = (launcher = browser.fakeLauncher().launcher): BrowserProfileProbeOptions => ({ clock, scheduler,
    closeProofMs: 100, launchTimeoutMs: 100, signal: new AbortController().signal, launcher });
  return { f, database, roots, input, path, options,
    close: async () => { database.close(); await f.close(); } };
}

it("persists intent before directory creation and rejects old callbacks after a replacement generation", async () => {
  const w = await fixture();
  try {
    const first = w.roots.beginLaunch(w.input);
    assert.equal(existsSync(w.input.profileDirectory), false);
    const durable = BrowserRootsSchema.parse(JSON.parse(readFileSync(w.path, "utf8")));
    assert.equal(durable.roots[0]?.launch.launchId, first.launchId);
    assert.equal(durable.roots[0]?.launch.state, "launching");
    first.opened(); first.closing(); first.closed();
    const next = w.roots.beginLaunch(w.input), before = readFileSync(w.path);
    assert.ok(next.generation > first.generation);
    assert.notEqual(next.launchId, first.launchId);
    assert.throws(() => first.opened()); assert.throws(() => first.closed());
    assert.deepEqual(readFileSync(w.path), before);
    next.closing(); next.closed();
    assert.equal(createBrowserRoots(w.f.admission).inventory().roots[0]?.launch.launchId, next.launchId);
  } finally { await w.close(); }
});

it("requires the exact native database owner and current real worker membership before publication", async () => {
  const w = await fixture(), foreign = await fixture();
  try {
    const before = readFileSync(w.path);
    assert.throws(() => w.roots.beginLaunch({ ...w.input, owner: foreign.input.owner }));
    assert.throws(() => w.roots.beginLaunch({ ...w.input, profileId: randomUUID() }));
    assert.throws(() => w.roots.beginLaunch({ ...w.input, profileDirectory: join(w.input.profileRoot, "w2", "crm") }));
    assert.throws(() => w.roots.beginLaunch({ ...w.input, owner: { kind: "worker", database: w.database, workerId: "person-lookup-worker-2" } }));
    assert.deepEqual(readFileSync(w.path), before);
    assert.equal(existsSync(w.input.profileDirectory), false);
  } finally { await foreign.close(); await w.close(); }
});

it("does not adopt an existing unregistered directory or remove an absent registry member", async () => {
  const w = await fixture();
  try {
    mkdirSync(w.input.profileDirectory, { recursive: true, mode: 0o700 });
    const marker = join(w.input.profileDirectory, "retained"); writeFileSync(marker, "owned fixture", { mode: 0o600 });
    const before = readFileSync(w.path), native = browser.fakeLauncher(); let effects = 0;
    assert.throws(() => w.roots.beginLaunch(w.input));
    await assert.rejects(w.roots.withUnused(w.input.profileDirectory, w.options(native.launcher), async () => { effects++; }, w.input));
    assert.equal(native.launches().length, 0); assert.equal(effects, 0);
    assert.deepEqual(readFileSync(w.path), before); assert.equal(readFileSync(marker, "utf8"), "owned fixture");
  } finally { await w.close(); }
});

it("refuses missing, corrupt, nonprivate and unknown-stage registry sources without changing their bytes", async () => {
  const w = await fixture();
  try {
    const original = readFileSync(w.path);
    for (const bytes of [Buffer.from("{"), Buffer.from(JSON.stringify({ ...w.roots.inventory(), installationId: randomUUID() }))]) {
      writeFileSync(w.path, bytes, { mode: 0o600 });
      assert.throws(() => w.roots.inventory()); assert.deepEqual(readFileSync(w.path), bytes);
      writeFileSync(w.path, original, { mode: 0o600 });
    }
    chmodSync(w.path, 0o660);
    try { assert.throws(() => w.roots.inventory()); assert.deepEqual(readFileSync(w.path), original); }
    finally { chmodSync(w.path, 0o600); }
    const stage = join(w.f.machine.stateRoot, "machine", `.browser-roots.${randomUUID()}.tmp`);
    writeFileSync(stage, "unowned retained stage", { mode: 0o600 });
    try { assert.throws(() => w.roots.inventory()); assert.equal(readFileSync(stage, "utf8"), "unowned retained stage"); }
    finally { rmSync(stage); }
    rmSync(w.path);
    try { assert.throws(() => w.roots.inventory()); assert.equal(existsSync(w.path), false); }
    finally { writeFileSync(w.path, original, { mode: 0o600 }); }
    assert.equal(Object.isFrozen(w.roots.inventory().roots), true);
  } finally { await w.close(); }
});

it("fresh native acquisition sees durable intent and a closed row never substitutes for another native acquisition", async () => {
  const w = await fixture(), native = browser.fakeLauncher(); let acquisitions = 0;
  const launcher = { launch: async (input: Parameters<typeof native.launcher.launch>[0]) => {
    const row = createBrowserRoots(w.f.admission).inventory().roots[0]; assert.ok(row);
    assert.equal(input.nativeOnly, true); assert.equal(input.headless, true);
    assert.equal(input.acceptDownloads, false); assert.equal(input.profileDirectory, w.input.profileDirectory);
    if (acquisitions++ === 0) { assert.equal(row.launch.state, "launching"); assert.equal(row.native, undefined); }
    else { assert.ok(row.native); assert.equal(row.native.phase, "probing"); assert.ok(row.native.generation > row.launch.generation); }
    return native.launcher.launch(input);
  } };
  try {
    await w.roots.probe(w.input, w.options(launcher));
    assert.equal(w.roots.inventory().roots[0]?.launch.state, "closed");
    await w.roots.withUnused(w.input.profileDirectory, w.options(launcher), async () => {
      assert.equal(w.roots.inventory().roots[0]?.native?.phase, "observed");
      assert.equal(native.contextClosed(), true);
    }, w.input);
    assert.equal(acquisitions, 2); assert.equal(w.roots.inventory().roots[0]?.native, undefined);
  } finally { await w.close(); }
});

it("holds same-row exclusion across awaited native acquisition and revokes the scoped remover on return", async () => {
  const w = await fixture(), native = browser.fakeLauncher();
  let release = () => {}, reached = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { reached = resolve; });
  try {
    await w.roots.probe(w.input, w.options());
    const retained: { remove?: () => void } = {};
    const action = w.roots.withUnused(w.input.profileDirectory, w.options({ launch: async input => {
      assert.equal(w.roots.inventory().roots[0]?.native?.phase, "probing"); reached();
      await blocked; return native.launcher.launch(input);
    } }), async ({ remove }) => { retained.remove = remove; return "fresh observation"; }, w.input);
    await started;
    const before = readFileSync(w.path);
    assert.throws(() => w.roots.beginLaunch(w.input));
    await assert.rejects(w.roots.withUnused(w.input.profileDirectory, w.options(), async () => undefined, w.input));
    assert.deepEqual(readFileSync(w.path), before);
    release(); assert.equal(await action, "fresh observation");
    assert.ok(retained.remove); assert.throws(retained.remove);
    assert.equal(existsSync(w.input.profileDirectory), true);
    assert.equal(w.roots.inventory().roots[0]?.native, undefined);
  } finally { release(); await w.close(); }
});

it("removes only the exact freshly observed directory and row while preserving sibling data", async () => {
  const w = await fixture();
  try {
    await w.roots.probe(w.input, w.options());
    const sibling = join(w.input.profileRoot, "retained-sibling");
    mkdirSync(sibling, { mode: 0o700 }); writeFileSync(join(sibling, "keep"), "sibling bytes", { mode: 0o600 });
    const generation = w.roots.inventory().nextGeneration;
    await w.roots.withUnused(w.input.profileDirectory, w.options(), async ({ remove }) => {
      assert.equal(w.roots.inventory().roots[0]?.native?.phase, "observed"); remove();
      assert.equal(w.roots.inventory().roots[0]?.native?.phase, "deleting");
    }, w.input);
    assert.equal(existsSync(w.input.profileDirectory), false);
    assert.equal(w.roots.inventory().roots.length, 0);
    assert.ok(w.roots.inventory().nextGeneration > generation);
    assert.equal(readFileSync(join(sibling, "keep"), "utf8"), "sibling bytes");
    assert.equal(readdirSync(join(w.f.machine.stateRoot, "machine")).some(name => name.startsWith(".browser-roots.") && name !== ".browser-roots.lock"), false);
  } finally { await w.close(); }
});


it("discovers retained roots independently of an unreadable person database", async () => {
  const w = await fixture();
  try {
    const launch = w.roots.beginLaunch(w.input); launch.closing(); launch.closed();
    const inventory = w.roots.inventory(), registry = readFileSync(w.path);
    w.database.close();
    const databaseBytes = readFileSync(w.f.path);
    try {
      writeFileSync(w.f.path, "unreadable person database", { mode: 0o600 });
      assert.deepEqual(createBrowserRoots(w.f.admission).inventory(), inventory);
      assert.deepEqual(readFileSync(w.path), registry);
    } finally { writeFileSync(w.f.path, databaseBytes, { mode: 0o600 }); }
  } finally { await w.close(); }
});

for (const phase of ["publishing", "abort"] as const)
  it(`allows exact registered signup cleanup during ${phase} while refusing a new launch`, async () => {
    const f = await createBoundProfileFixture({ pending: "onboarding" });
    try {
      const operations = join(f.machine.stateRoot, "machine", "operations"), names = readdirSync(operations).filter(name => name.endsWith(".json"));
      assert.equal(names.length, 1); const name = names[0]; assert.ok(name);
      const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(operations, name), "utf8")));
      assert.ok(operation.onboarding);
      const owner = { kind: "signup" as const, operationId: operation.operationId, accountId: operation.onboarding.accountId,
        providerGeneration: operation.onboarding.generation };
      const profileRoot = join(f.machine.stateRoot, "browsers", "onboarding");
      const input: BrowserRootLaunchInput = { profileId: operation.profileId, profileRoot,
        profileDirectory: onboardingProfileDirectory(profileRoot, { operationId: owner.operationId, profileId: operation.profileId,
          accountId: owner.accountId, generation: owner.providerGeneration }), credentialFingerprint: null, owner };
      const roots = createBrowserRoots(f.machine), options = { clock, scheduler, closeProofMs: 100, launchTimeoutMs: 100,
        signal: new AbortController().signal, launcher: browser.fakeLauncher().launcher };
      await roots.probe(input, options);
      const updated = SignUpOperationSchema.parse(phase === "publishing" ? { ...operation, phase } : { ...operation,
        onboarding: { ...operation.onboarding, abort: { operationId: randomUUID(), generation: operation.credentials.generation + 1 } } });
      f.machine.publishProfileOperation(updated);
      const path = join(f.machine.stateRoot, "machine", "browser-roots.json"), before = readFileSync(path);
      assert.throws(() => roots.beginLaunch(input));
      await assert.rejects(roots.probe(input, options));
      assert.deepEqual(readFileSync(path), before);
      const wrongOwner = { ...input, owner: { ...owner, accountId: randomUUID() } };
      await assert.rejects(roots.withUnused(input.profileDirectory, options, async () => assert.fail("wrong signup cannot clean"), wrongOwner));
      assert.deepEqual(readFileSync(path), before);
      await roots.withUnused(input.profileDirectory, options, async ({ remove }) => { remove(); }, input);
      assert.equal(roots.inventory().roots.length, 0); assert.equal(existsSync(input.profileDirectory), false);
    } finally { await f.close(); }
  });


for (const state of ["launching", "open", "closed"] as const)
  it(`requires the prior ${state} launch to close before a newer real worker lease can probe and take ownership`, async () => {
    const w = await fixture();
    try {
      const old = w.roots.beginLaunch(w.input);
      if (state === "open") old.opened();
      if (state === "closed") { old.closing(); old.closed(); }
      mkdirSync(w.input.profileDirectory, { recursive: true, mode: 0o700 });
      assert.equal(w.input.owner.kind, "worker");
      if (w.input.owner.kind !== "worker") assert.fail("worker fixture required");
      const workerId = w.input.owner.workerId;
      const prior = w.database.authority.workerLeases.get(workerId); assert.ok(prior);
      stopSyntheticDatabaseWorkers({ database: w.database, path: w.f.path });
      detachBoundFixtureWorkers(w.database);
      const started = w.database.authority.workerLeases.start({ workerId, workflow: "person-lookup", browserSystems: ["crm"],
        processId: process.pid, requestedBy: "local-operator", now: clock.now().toISOString() });
      assert.equal(started.state, "started");
      const successor = w.database.authority.workerLeases.get(workerId); assert.ok(successor);
      assert.ok(successor.leaseGeneration > prior.leaseGeneration);
      registerBoundFixtureWorker({ database: w.database, path: w.f.path, workerId,
        generation: successor.leaseGeneration, processId: process.pid, clock });
      const native = browser.fakeLauncher(), before = readFileSync(w.path);
      if (state !== "closed") {
        await assert.rejects(w.roots.withUnused(w.input.profileDirectory, w.options(native.launcher), async () => assert.fail("live predecessor cannot be adopted"), w.input));
        assert.equal(native.launches().length, 0); assert.deepEqual(readFileSync(w.path), before);
        old.closing(); old.closed();
      }
      await w.roots.withUnused(w.input.profileDirectory, w.options(native.launcher), async () => undefined, w.input);
      assert.equal(native.launches().length, 1);
      const row = w.roots.inventory().roots[0]; assert.ok(row && row.owner.kind === "worker");
      assert.equal(row.owner.leaseGeneration, successor.leaseGeneration);
      assert.equal(row.launch.state, "closed"); assert.equal(row.native, undefined);
      const settled = readFileSync(w.path); assert.throws(() => old.closed()); assert.deepEqual(readFileSync(w.path), settled);
    } finally { await w.close(); }
  });

it("excludes another registry factory throughout the body of the same genuine offline maintenance operation", async () => {
  const w = await fixture(); let resume = () => {};
  try {
    await w.roots.probe(w.input, w.options()); w.database.close();
    await withOfflineMaintenance(w.f.machine, async () => {
      const a = createBrowserRoots(w.f.machine), b = createBrowserRoots(w.f.machine);
      let reached = () => {};
      const started = new Promise<void>(resolve => { reached = resolve; });
      const blocked = new Promise<void>(resolve => { resume = resolve; });
      const first = a.withUnused(w.input.profileDirectory, w.options(), async ({ remove }) => { reached(); await blocked; remove(); });
      await started;
      const before = readFileSync(w.path), native = browser.fakeLauncher(); let effects = 0;
      await assert.rejects(b.withUnused(w.input.profileDirectory, w.options(native.launcher), async () => { effects++; }));
      assert.equal(native.launches().length, 0); assert.equal(effects, 0); assert.deepEqual(readFileSync(w.path), before);
      assert.equal(a.inventory().roots[0]?.native?.phase, "observed");
      resume(); await first;
      assert.equal(a.inventory().roots.length, 0); assert.equal(existsSync(w.input.profileDirectory), false);
    });
  } finally { resume(); await w.close(); }
});
