import { fork } from "node:child_process";
import { once, on } from "node:events";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { testProcessImport } from "../../../support/compiled-process.js";
import { credentialKeychainTestEnvironment } from "../../../support/helpers/credential-keychain-fake.js";
import { scaledMs } from "../../../support/time-scale.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmdirSync, mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { composeProfileActivity, composeSelectedProfileStorage } from "../../../../src/backend/app/composition/storage-compose.js";
import { composeProfileClosureInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { createCommandBrowserManager, CommandBrowserError } from "../../../../src/backend/runtime/browser/command-browser.js";
import type { CommandBrowserInput } from "../../../../src/backend/systems/browser-shared/command-session.js";
import { workerProfileDirectory } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import { createBrowserRoots, commandProfileDirectory } from "../../../../src/backend/storage/browser-roots.js";
import { probeStoppedProfileBrowsersClosed } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";

const clock = manualClock(new Date("2026-11-01T12:00:01.000Z"));
const scheduler = { schedule: () => ({ cancel() {} }) };
const browsers = createBrowserSessionFactoryFixtures(clock, randomUUID(), scheduler);
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const f = await createBoundProfileFixture();
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, clock,
    { stateRoot: f.stateRoot, artifactRoot: f.admission.artifactRoot }).config;
  const config = { ...resolved, features: { ...resolved.features, duoWebAuthn: false } };
  const native = browsers.fakeLauncher();
  const manager = createCommandBrowserManager({ admission: f.admission, leases: context.database.authority.duoCeremonyLeases,
    clock, scheduler, launcher: native.launcher, recordEvidence: () => {} });
  const input: CommandBrowserInput = { commandId: randomUUID(), requestDigest: "a".repeat(64), config,
    signal: new AbortController().signal, assertCurrent: context.assertCurrent,
    protectedSecrets: protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-password" }) };
  return { f, context, config, native, manager, input, profileId: f.admission.profileBinding.profileId,
    async close() { await context.account.close(); context.database.close(); await f.close(); } };
}

it("keeps logical command custody through import after actual browser closure", async () => {
  const w = await fixture(), importing = deferred(), release = deferred();
  try {
    const operation = w.manager.withCommand(w.input, async scope => {
      assert.equal(await scope.withBrowser(async browser => {
        browser.assertCurrent(); assert.equal(browser.credentials.userId, "fixture-user"); return "downloaded";
      }), "downloaded");
      assert.equal(w.native.contextClosed(), true);
      importing.resolve(); await release.promise; return "imported";
    });
    await importing.promise;
    assert.equal(w.manager.hasUnquiescedWork(w.profileId), true);
    await assert.rejects(w.manager.withCommand({ ...w.input, commandId: randomUUID() }, async () => {}), CommandBrowserError);
    release.resolve(); assert.equal(await operation, "imported");
    assert.equal(w.manager.hasUnquiescedWork(w.profileId), false);
    const row = createBrowserRoots(w.f.admission).inventory().roots[0];
    assert.equal(row?.owner.kind, "command"); assert.equal(row?.launch.state, "closed");
    if (row?.owner.kind !== "command") throw new Error("command owner missing");
    assert.equal(row.owner.commandId, w.input.commandId); assert.equal(row.owner.requestDigest, w.input.requestDigest);
    assert.equal(w.native.launches()[0]?.profileDirectory, commandProfileDirectory(w.config.paths.browserProfileRoot));
  } finally { release.resolve(); await w.close(); }
});

for (const changed of ["profile", "config", "protected"] as const) it(`closes its captured browser after ${changed} ownership changes`, async () => {
  const w = await fixture(); let current = true;
  const stale = new Error(`${changed}-source-changed`);
  try {
    await assert.rejects(w.manager.withBrowser({ ...w.input, assertCurrent: () => { w.input.assertCurrent(); if (!current) throw stale; } }, async browser => {
      current = false;
      assert.throws(browser.assertCurrent, error => error === stale);
    }), error => error === stale);
    assert.equal(w.native.contextClosed(), true);
    assert.equal(createBrowserRoots(w.f.admission).inventory().roots[0]?.launch.state, "closed");
    assert.equal(w.manager.hasUnquiescedWork(w.profileId), false);
  } finally { await w.close(); }
});

it("drains cancellation and actual browser closure before selection revocation", async () => {
  const w = await fixture(), started = deferred();
  try {
    const operation = w.manager.withBrowser(w.input, async browser => {
      started.resolve();
      await new Promise<void>(resolve => browser.signal.addEventListener("abort", () => resolve(), { once: true }));
      browser.assertCurrent();
    });
    const rejected = assert.rejects(operation, CommandBrowserError);
    await started.promise;
    const activity = composeProfileActivity({ admission: w.f.admission, database: w.context.database, clock,
      commandActivities: new Set([w.manager]), supervisor: { state: "not-constructed" },
      lifecycle: { read: () => { throw new Error("no runs"); }, transition: () => { throw new Error("no runs"); } } });
    assert.equal(activity.hasUnquiescedWork(w.profileId), true);
    activity.requestCancellation(w.profileId); await activity.awaitCancellation(); await rejected;
    assert.equal(w.native.contextClosed(), true);
    assert.equal(activity.hasUnquiescedWork(w.profileId), false);
    w.context.assertCurrent();
    await assert.rejects(w.manager.withBrowser(w.input, async () => {}), CommandBrowserError);
  } finally { await w.close(); }
});

it("includes a successful command in ordinary logout and the stopped native census", async () => {
  const w = await fixture();
  try {
    await w.manager.withBrowser(w.input, async browser => { browser.assertCurrent(); });
    const inventory = composeProfileClosureInventory({ admission: w.f.admission, database: w.context.database,
      clock, hostFacts: { primaryDisplay: null } });
    await inventory.prepare();
    let observed = false;
    await probeStoppedProfileBrowsersClosed(w.f.admission, clock, { workerDirectory: workerProfileDirectory,
      async probeClosed(profiles) {
        observed = true;
        assert.deepEqual(profiles, [{ profileRoot: w.config.paths.browserProfileRoot,
          profileDirectory: join(w.config.paths.browserProfileRoot, "commands", "sharepoint"), cleanupCompleted: true }]);
      } });
    assert.equal(observed, true);
  } finally { await w.close(); }
});

for (const failure of ["profile-in-use", "fingerprint"] as const) it(`sanitizes ${failure} acquisition detail while retaining its private cause`, async () => {
  const w = await fixture();
  const raw = new Error(failure === "profile-in-use" ? "Failed to create a ProcessSingleton for your profile directory. /private/fixture/account" : "fixture protected source /private/fixture/account");
  let callbacks = 0;
  const manager = createCommandBrowserManager({ admission: w.f.admission, leases: w.context.database.authority.duoCeremonyLeases,
    clock, scheduler, recordEvidence: () => {}, launcher: { launch: async () => { throw raw; } } });
  try {
    await assert.rejects(manager.withBrowser({ ...w.input,
      ...(failure === "fingerprint" ? { protectedSecrets: { read: () => { throw raw; } } } : {}) }, async () => { callbacks++; }), error => {
      assert.ok(error instanceof CommandBrowserError);
      assert.equal(error.code, "COMMAND_BROWSER_UNAVAILABLE");
      assert.equal(error.message, ERROR_CATALOG.COMMAND_BROWSER_UNAVAILABLE.text);
      assert.equal(error.cause, raw); return true;
    });
    assert.equal(callbacks, 0); assert.equal(manager.hasUnquiescedWork(w.profileId), false);
    await composeProfileClosureInventory({ admission: w.f.admission, database: w.context.database,
      clock, hostFacts: { primaryDisplay: null } }).prepare();
  } finally { await w.close(); }
});

it("refuses unregistered command directories during credential inventory", async () => {
  const w = await fixture();
  const unexpected = join(w.config.paths.browserProfileRoot, "commands", "unregistered");
  try {
    await w.manager.withBrowser(w.input, async () => {});
    mkdirSync(unexpected, { mode: 0o700 });
    const inventory = composeProfileClosureInventory({ admission: w.f.admission, database: w.context.database,
      clock, hostFacts: { primaryDisplay: null } });
    await assert.rejects(inventory.prepare(), { message: "profile-inventory-browser-membership-unavailable" });
    rmdirSync(unexpected); await inventory.prepare();
  } finally { await w.close(); }
});

it("attempts command drainage even when worker drainage fails", async () => {
  const w = await fixture(), started = deferred();
  const workerFailure = new Error("fixture worker drain failure");
  try {
    const operation = w.manager.withBrowser(w.input, async browser => {
      started.resolve(); await new Promise<void>(resolve => browser.signal.addEventListener("abort", () => resolve(), { once: true }));
      browser.assertCurrent();
    });
    const rejected = assert.rejects(operation, CommandBrowserError);
    await started.promise;
    const activity = composeProfileActivity({ admission: w.f.admission, database: w.context.database, clock,
      commandActivities: new Set([w.manager]), supervisor: { memberEvidence: () => undefined, drainOwnedChildren: async () => { throw workerFailure; } },
      lifecycle: { read: () => { throw new Error("no runs"); }, transition: () => { throw new Error("no runs"); } } });
    activity.requestCancellation(w.profileId);
    await assert.rejects(activity.awaitCancellation(), error => error instanceof AggregateError && error.errors.includes(workerFailure));
    await rejected;
    assert.equal(w.native.contextClosed(), true); assert.equal(w.manager.hasUnquiescedWork(w.profileId), false);
  } finally { await w.close(); }
});

for (const changed of ["abort", "revoked"] as const) it(`leaves no unowned empty command parent when ${changed} after verified removal`, async () => {
  const w = await fixture(), controller = new AbortController();
  const revoked = new Error("fixture selection revoked after verified removal");
  const directory = commandProfileDirectory(w.config.paths.browserProfileRoot);
  try {
    await w.manager.withBrowser(w.input, async () => {});
    const manager = createCommandBrowserManager({ admission: w.f.admission, leases: w.context.database.authority.duoCeremonyLeases,
      clock, scheduler, launcher: browsers.fakeLauncher().launcher, recordEvidence: () => {} });
    let observed = false;
    await assert.rejects(manager.withBrowser({ ...w.input, commandId: randomUUID(), signal: controller.signal, assertCurrent: () => {
      w.input.assertCurrent();
      if (!existsSync(directory)) {
        observed = true;
        if (changed === "abort") { controller.abort(new CommandBrowserError("COMMAND_BROWSER_CANCELLED")); controller.signal.throwIfAborted(); }
        throw revoked;
      }
    } }, async () => { throw new Error("replacement callback must not run"); }), error => {
      assert.ok(error instanceof CommandBrowserError);
      assert.equal(error.code, changed === "abort" ? "COMMAND_BROWSER_CANCELLED" : "COMMAND_BROWSER_UNAVAILABLE");
      if (changed === "revoked") assert.equal(error.cause, revoked);
      return true;
    });
    assert.equal(observed, true); assert.equal(existsSync(join(w.config.paths.browserProfileRoot, "commands")), false);
    assert.equal(createBrowserRoots(w.f.admission).inventory().roots.length, 0);
    assert.equal(manager.hasUnquiescedWork(w.profileId), false);
    await composeProfileClosureInventory({ admission: w.f.admission, database: w.context.database,
      clock, hostFacts: { primaryDisplay: null } }).prepare();
  } finally { await w.close(); }
});

for (const scenario of ["native-close", "stale-release", "launch-rejected"] as const) it(`retains genuine command sources after ${scenario} uncertainty`, async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-command-custody-")));
  const child = fork(fileURLToPath(new URL("../../../support/processes/command-custody-worker.ts", import.meta.url)), [workspace, scenario],
    { execArgv: ["--import", testProcessImport()], env: credentialKeychainTestEnvironment(process.env), stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const closed = once(child, "close"), events = on(child, "message", { signal: AbortSignal.timeout(scaledMs(20_000)) });
  let stderrBytes = 0;
  child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; if (stderrBytes > 65_536) child.kill("SIGKILL"); });
  try {
    const next = await Promise.race([events.next(), closed.then(() => { throw new Error("command-child-closed-before-proof"); })]);
    assert.equal(next.done, false);
    const message = z.union([z.strictObject({ scenario: z.literal(scenario), assertionsComplete: z.literal(true) }),
      z.strictObject({ scenario: z.literal(scenario), assertionsComplete: z.literal(false), failure: z.string() })]).parse(next.value?.[0]);
    assert.equal(message.assertionsComplete, true, "failure" in message ? message.failure : "Command custody proof did not complete");
    assert.equal(child.exitCode, null); assert.equal(child.signalCode, null); assert.equal(stderrBytes, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) assert.equal(child.kill("SIGKILL"), true);
    const result = await closed;
    assert.deepEqual(result, [null, "SIGKILL"]);
    await events.return?.();
    rmSync(workspace, { recursive: true });
  }
});

it("requires the genuine current registry during ordinary credential inventory", async () => {
  const w = await fixture(), path = join(w.f.machine.stateRoot, "machine", "browser-roots.json");
  const original = readFileSync(path);
  const inventory = composeProfileClosureInventory({ admission: w.f.admission, database: w.context.database,
    clock, hostFacts: { primaryDisplay: null } });
  try {
    assert.equal(w.f.admission.hasCurrentBrowserRegistry(), true);
    unlinkSync(path); await assert.rejects(inventory.prepare());
    writeFileSync(path, "{", { mode: 0o600 }); await assert.rejects(inventory.prepare());
    writeFileSync(path, original, { mode: 0o600 }); await inventory.prepare();
  } finally { writeFileSync(path, original, { mode: 0o600 }); await w.close(); }
});

it("finishes verified reset cleanup when cancellation arrives during native probe closure", async () => {
  const w = await fixture(), controller = new AbortController(), probe = browsers.fakeLauncher();
  const cancelled = new CommandBrowserError("COMMAND_BROWSER_CANCELLED");
  try {
    await w.manager.withBrowser(w.input, async () => {});
    const manager = createCommandBrowserManager({ admission: w.f.admission, leases: w.context.database.authority.duoCeremonyLeases,
      clock, scheduler, recordEvidence: () => {}, launcher: { launch: async input => {
        const context = await probe.launcher.launch(input), close = context.close.bind(context);
        context.close = async options => { await close(options); controller.abort(cancelled); };
        return context;
      } } });
    await assert.rejects(manager.withBrowser({ ...w.input, commandId: randomUUID(), signal: controller.signal }, async () => {
      throw new Error("replacement callback must not run");
    }), error => error === cancelled);
    assert.equal(probe.contextClosed(), true); assert.equal(probe.launches().length, 1);
    assert.equal(manager.hasUnquiescedWork(w.profileId), false);
    assert.equal(existsSync(join(w.config.paths.browserProfileRoot, "commands")), false);
    assert.equal(createBrowserRoots(w.f.admission).inventory().roots.length, 0);
    await composeProfileClosureInventory({ admission: w.f.admission, database: w.context.database,
      clock, hostFacts: { primaryDisplay: null } }).prepare();
  } finally { await w.close(); }
});
