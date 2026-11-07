import assert from "node:assert/strict";
import { copyFileSync,readFileSync } from "node:fs";
import * as filesystem from "node:fs/promises";
import { join } from "node:path";
import { it,vi } from "vitest";
import * as accounts from "../../../../../src/backend/accounts/chatgpt-account-service.js";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import * as explorerComposition from "../../../../../src/backend/app/composition/dashboard/explorer.js";
import { composeProfileRuntime,RuntimeCustodyUncertainError } from "../../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { ProfileSessionRefusedError } from "../../../../../src/backend/profiles/profile-errors.js";
import * as kernel from "../../../../../src/backend/runs/commands/command-kernel.js";
import { RuntimeAlreadyRunningError,RuntimeLifetimeLock } from "../../../../../src/backend/storage/admission/lifetime-lock.js";
import * as artifactReaders from "../../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import * as streams from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";

vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>() }));

async function fixture() {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
  const runtime = composeProfileRuntime({ admission: f.machine, clock, hostFacts: { primaryDisplay: null } });
  const signIn = () => runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  const active = signIn(); assert.equal(active.state, "active");
  if (active.state !== "active") throw new Error("synthetic active profile required");
  const input = { lifetimeLock: f.lifetime, admission: f.machine, profile: { runtime, token: active.token }, repoRoot: f.workspace, clock,
    isolation: rebuildRuntimeIsolation, backendPortOverride: 0 as const, frontendPortOverride: 0 as const, env: {},
    preflightRunnerFactory: healthyRuntimePreflightRunners };
  return { ...f, clock, runtime, active, signIn, input };
}

it("refuses another profile controller before opening dashboard storage or changing its current context", async () => {
  const f = await fixture(), other = await fixture();
  const context = f.runtime.selectedContext(f.active.token), generation = context.database.getMeta().authorityGeneration;
  const before = context.database.readProfileResourceCustody();
  const open = vi.spyOn(AuthorityDatabase, "open");
  try {
    await assert.rejects(composeDashboardRuntime({ ...f.input, lifetimeLock: other.lifetime }), /runtime-lifetime-admission-mismatch/u);
    assert.equal(open.mock.calls.length, 0);
    context.assertCurrent();
    assert.equal(context.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(context.database.readProfileResourceCustody(), before);
    f.lifetime.assertHeld(); other.lifetime.assertHeld();
  } finally { open.mockRestore(); await f.runtime.close(); await other.runtime.close(); await f.close(); await other.close(); }
});

it("starts the actual dashboard from the same token-owned context and proves resource/child/process/parent shutdown", async () => {
  const f = await fixture();
  let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
  const kernelFactory = vi.spyOn(kernel, "createCommandKernel");
  try {
    dashboard = await composeDashboardRuntime(f.input);
    const context = f.runtime.selectedContext(f.active.token);
    assert.equal(context.database.getMeta().profileId, f.active.profileId);
    assert.equal(context.admission.stateRoot, f.stateRoot);
    const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(dashboard.port)}` });
    const readPreference = client.assistantModelPreference?.bind(client); assert.ok(readPreference);
    const preference = await readPreference();
    assert.deepEqual({ profileId: preference.profileId, epoch: preference.epoch }, { profileId: f.active.profileId, epoch: context.profileEpoch });
    assert.throws(() => f.runtime.bindSupervisor(f.active.token, { memberEvidence: () => undefined, drainOwnedChildren: async () => undefined }), /owner-mismatch/u);
    await dashboard.stop(); dashboard = undefined;
    assert.throws(() => context.database.getMeta(), /closed/u);
    assert.throws(() => context.admission.assertLive());
    f.machine.assertLive(); f.machine.release();
    assert.throws(() => f.machine.assertLive());
  } finally { kernelFactory.mockRestore(); if (dashboard !== undefined) await dashboard.stop(); await f.close(); }
});

for (const problem of ["absent", "stale", "foreign", "logged-out"] as const) it(`refuses ${problem} dashboard context before ordinary database opening`, async () => {
  const f = await fixture();
  const other = problem === "foreign" ? await fixture() : undefined;
  try {
    if (problem === "stale") assert.equal(f.signIn().state, "active");
    if (problem === "logged-out") {
      await f.runtime.drainForLogout(f.active.token);
      const logout = f.runtime.session.logOut(f.active.token, { at: f.clock.now().toISOString() });
      assert.equal(logout.state, "cancelling");
      await f.runtime.awaitClosurePreparation(f.active.profileId);
    }
    const open = vi.spyOn(AuthorityDatabase, "open");
    await assert.rejects(composeDashboardRuntime({ ...f.input,
      ...(problem === "absent" ? { profile: undefined } : problem === "foreign" ? { profile: other!.input.profile } : {}) }));
    assert.equal(open.mock.calls.length, 0);
    open.mockRestore();
  } finally {
    vi.restoreAllMocks();
    await f.runtime.close(); await f.close();
    if (other !== undefined) { await other.runtime.close(); await other.close(); }
  }
});

it("revokes runtime, command and retained producer authority before held actual account closure without changing the session epoch", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }), closing = new Promise<void>(resolve => { entered = resolve; });
  const createAccount = accounts.createChatGptAccountService;
  const factory = vi.spyOn(accounts, "createChatGptAccountService").mockImplementation(options => {
    const actual = createAccount(options);
    return { ...actual, close: async () => { entered(); await barrier; await actual.close(); } };
  });
  const kernelFactory = vi.spyOn(kernel, "createCommandKernel");
  let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined, stopping: Promise<void> | undefined;
  try {
    dashboard = await composeDashboardRuntime(f.input);
    const context = f.runtime.selectedContext(f.active.token), epoch = f.machine.readProfileRegistry().sessionGeneration;
    const protectedBefore = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
    stopping = dashboard.stop();
    await closing;
    assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch);
    assert.throws(() => f.runtime.selectedContext(f.active.token), ProfileSessionRefusedError);
    assert.throws(() => context.protectedSecrets.read(), ProfileSessionRefusedError);
    assert.throws(() => context.settings.read(), ProfileSessionRefusedError);
    await assert.rejects(context.accountAuthority.readAuthority(), ProfileSessionRefusedError);
    const authority = kernelFactory.mock.calls[0]?.[0].authority; assert.ok(authority);
    let effects = 0;
    assert.throws(() => authority.withAuthorityTransaction(() => { effects += 1; }), ProfileSessionRefusedError);
    assert.equal(effects, 0);
    assert.equal(context.database.getMeta().profileId, f.active.profileId);
    context.admission.assertLive();
    const origin = `http://127.0.0.1:${String(dashboard.port)}`;
    await assert.rejects(fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" }), TypeError);
    release(); await stopping; dashboard = undefined;
    assert.equal(readFileSync(join(f.stateRoot, "credentials", "protected.json")).equals(protectedBefore), true);
    assert.throws(() => context.database.getMeta(), /closed/u);
    assert.throws(() => context.admission.assertLive());
  } finally {
    release(); if (stopping !== undefined) await stopping;
    if (dashboard !== undefined && stopping === undefined) await dashboard.stop();
    factory.mockRestore(); kernelFactory.mockRestore(); await f.close();
  }
});

for (const failure of ["account", "database"] as const) it(`retains exact dashboard custody after unproved ${failure} closure and refuses new ordinary work`, async () => {
  const f = await fixture(), primary = new Error(`synthetic ${failure} closure failure`);
  const createAccount = accounts.createChatGptAccountService;
  const factory = vi.spyOn(accounts, "createChatGptAccountService").mockImplementation(options => ({ ...createAccount(options) }));
  let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
  let context: ReturnType<typeof f.runtime.selectedContext> | undefined;
  try {
    dashboard = await composeDashboardRuntime(f.input);
    context = f.runtime.selectedContext(f.active.token);
    const before = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
    const failing = failure === "account" ? vi.spyOn(context.account, "close").mockRejectedValue(primary)
      : vi.spyOn(context.database, "close").mockImplementation(() => { throw primary; });
    await assert.rejects(dashboard.stop(), error => error instanceof RuntimeCustodyUncertainError);
    failing.mockRestore();
    assert.equal(readFileSync(join(f.stateRoot, "credentials", "protected.json")).equals(before), true);
    f.machine.assertLive(); context.admission.assertLive();
    assert.equal(context.database.getMeta().profileId, f.active.profileId);
    assert.throws(() => f.runtime.selectedContext(f.active.token), ProfileSessionRefusedError);
    assert.throws(() => context?.protectedSecrets.read(), ProfileSessionRefusedError);
    assert.equal(f.signIn().state, "refused");
    f.lifetime.assertHeld();
    await assert.rejects(RuntimeLifetimeLock.acquire(f.lifetime.port), RuntimeAlreadyRunningError);
  } finally {
    vi.restoreAllMocks();
    if (context !== undefined) { await context.account.close(); context.database.close(); context.admission.release(); }
    factory.mockRestore(); await f.close();
  }
});

for (const failure of ["http", "http-and-feed"] as const) it(`unwinds actual startup with ${failure} failure without releasing unproved producer custody`, async () => {
  const f = await fixture(), context = f.runtime.selectedContext(f.active.token);
  const primary = new Error("synthetic actual HTTP starter rejection"), feedFailure = new Error("synthetic actual feed closure failure");
  const createHub = streams.createDashboardStreamHub;
  let closeFeed: (() => void) | undefined;
  const hubFactory = vi.spyOn(streams, "createDashboardStreamHub").mockImplementation(input => {
    const actual = createHub(input), close = actual.close.bind(actual);
    closeFeed = close;
    vi.spyOn(actual, "close").mockImplementation(() => {
      if (failure === "http-and-feed") throw feedFailure;
      close();
    });
    return actual;
  });
  try {
    await assert.rejects(composeDashboardRuntime({ ...f.input, httpServerStarter: async () => { throw primary; } }), error => {
      if (failure === "http") return error === primary;
      assert.ok(error instanceof RuntimeCustodyUncertainError);
      const contains = (value: unknown, target: unknown): boolean => value === target
        || value instanceof AggregateError && value.errors.some(member => contains(member, target));
      assert.equal(contains(error, primary), true);
      assert.equal(contains(error, feedFailure), true);
      return true;
    });
    assert.ok(closeFeed);
    assert.throws(() => f.runtime.selectedContext(f.active.token), ProfileSessionRefusedError);
    f.lifetime.assertHeld();
    await assert.rejects(RuntimeLifetimeLock.acquire(f.lifetime.port), RuntimeAlreadyRunningError);
    if (failure === "http-and-feed") {
      context.admission.assertLive(); f.machine.assertLive();
      assert.equal(context.database.getMeta().profileId, f.active.profileId);
    } else {
      assert.throws(() => context.admission.assertLive());
      assert.throws(() => context.database.getMeta(), /closed/u);
    }
  } finally {
    hubFactory.mockRestore(); closeFeed?.();
    await f.runtime.close(); await f.close();
  }
});


it("settles actual artifact initialization before releasing startup database and profile custody after a constructor failure", async () => {
  const f = await fixture(), context = f.runtime.selectedContext(f.active.token);
  const primary = new Error("synthetic Explorer constructor failure");
  let release!: () => void, entered!: () => void, readyObserved!: () => void, databaseClosing!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const rootEntered = new Promise<void>(resolve => { entered = resolve; });
  const applicationReady = new Promise<void>(resolve => { readyObserved = resolve; });
  const databaseClosed = new Promise<void>(resolve => { databaseClosing = resolve; });
  let initializingReader = false, initialized = false, closedBeforeInitialization = false;
  let initializationFailure: unknown, observation: Promise<void> | undefined;
  const nativeLstat = filesystem.lstat;
  const filesystemProbe = vi.spyOn(filesystem, "lstat").mockImplementation(async (...args) => {
    if (initializingReader && args[0] === context.admission.artifactRoot) { entered(); await barrier; }
    return nativeLstat(...args);
  });
  const createReader = artifactReaders.createServerVerifiedArtifactReader;
  const readerFactory = vi.spyOn(artifactReaders, "createServerVerifiedArtifactReader").mockImplementation(options => {
    initializingReader = true;
    const actual = createReader(options);
    initializingReader = false;
    const ready = actual.ready;
    observation = ready.then(() => { initialized = true; }, error => { initialized = true; initializationFailure = error; });
    return { verify: actual.verify.bind(actual), prepare: actual.prepare.bind(actual), get ready() { readyObserved(); return ready; } };
  });
  const constructor = vi.spyOn(explorerComposition, "composeExplorer").mockImplementation(() => { throw primary; });
  const close = context.database.close.bind(context.database);
  const databaseClose = vi.spyOn(context.database, "close").mockImplementation(() => {
    closedBeforeInitialization ||= !initialized;
    databaseClosing(); close();
  });
  const boot = composeDashboardRuntime(f.input).then(
    () => { throw new Error("startup unexpectedly accepted"); },
    (error: unknown) => error,
  );
  try {
    await rootEntered;
    await Promise.race([applicationReady, databaseClosed]);
    release();
    assert.equal(await boot, primary);
    await observation;
    assert.equal(initializationFailure, undefined);
    assert.equal(closedBeforeInitialization, false);
    assert.throws(() => context.admission.assertLive());
    assert.throws(() => context.database.getMeta(), /closed/u);
  } finally {
    release(); await boot; await observation;
    filesystemProbe.mockRestore(); readerFactory.mockRestore(); constructor.mockRestore(); databaseClose.mockRestore();
    await f.runtime.close(); await f.close();
  }
});
