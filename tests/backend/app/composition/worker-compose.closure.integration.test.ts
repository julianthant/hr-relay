import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import { basename, join, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { chromium } from "playwright";
import { it, vi } from "vitest";
import { composeWorkerRuntime, WorkerLaunchUncertainError } from "../../../../src/backend/app/composition/worker-compose.js";
import { DEFAULT_BROWSER_LAUNCHER } from "../../../../src/backend/runtime/browser/native-browser.js";
import { BrowserRootsSchema } from "../../../../src/backend/storage/browser-root-contract.js";
import { hasUnprovedSourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { withReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { WorkerLeaseRecordSchema, type WorkerLeaseRecord } from "../../../../src/models/run/worker.js";
import { composeSelectedProfileStorage, RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import * as accounts from "../../../../src/backend/accounts/chatgpt-account-service.js";
import * as workerLoop from "../../../../src/backend/runtime/workers/worker-loop.js";
import * as debugEvents from "../../../../src/backend/logs/debug-events.js";
import { WorkerSessionClosureUnprovedError, WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";

import * as credentialStores from "../../../../src/backend/storage/configuration/credential-store.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { duoCeremonyGatesOver } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { happySessionHarness, ManualScheduler, personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const retainedLaunchCustody: object[] = [];

for (const { mode: failure, name } of [
  { mode: "close", name: "retains an unproved closure report while settling the worker lease as crashed" },
  { mode: "close-log", name: "retains unproved closure when its diagnostic fails and the next diagnostic succeeds" },
  { mode: "runtime-log", name: "retains the original session closure failure when runtime diagnostics fail" },
  { mode: "launch", name: "reports launch-uncertain with custody held and leaves the worker lease unchanged" },
] as const) it(name, async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  copyFileSync("package.json", join(f.workspace, "package.json"));
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  let report: workerLoop.WorkerLoopReport | undefined, issued: RuntimeAdmission | undefined;
  const lifetimeLock = f.lifetime;
  const managers: WorkerSessionManager[] = [];
  let launches = 0, probes = 0, launchFailure: Promise<never> | undefined;
  let closedWorkerDatabase: AuthorityDatabase | undefined, launchedDirectory: string | undefined;
  let beforeLaunch: WorkerLeaseRecord | undefined, launchReport: WorkerLaunchUncertainError | undefined;
  let profileRoot: string | undefined;
  const machineRoot = f.admission.captureBrowserRegistryContext().machineRoot;
  const registryPath = join(machineRoot, "machine", "browser-roots.json");
  let custodyOraclesProved = false, primary: unknown;
  const run = workerLoop.runWorkerLoop;
  const loggingFailure = new Error("injected-diagnostic-failure");
  const runtimeFailure = new WorkerSessionClosureUnprovedError("closure-worker", [new Error("injected-session-failure")]);
  let failedWorkerId: string | undefined, injectedLoggingFailures = 0;
  const createWriter = debugEvents.createDebugEventWriter;
  if (failure === "close-log" || failure === "runtime-log") vi.spyOn(debugEvents, "createDebugEventWriter").mockImplementation(options => {
    const writer = createWriter(options);
    return { emit(...args: Parameters<typeof writer.emit>) {
      const input = args[0];
      const code = failure === "close-log" ? "WORKER_SESSION_CLOSURE_UNPROVED" : "WORKER_RUNTIME_FAILED";
      if (typeof input === "object" && input !== null && "code" in input && input.code === code && injectedLoggingFailures === 0) {
        injectedLoggingFailures++;
        throw loggingFailure;
      }
      return writer.emit(...args);
    } };
  });
  const store = credentialStores.createCredentialStore;
  vi.spyOn(workerLoop, "runWorkerLoop").mockImplementation(async input => {
    if (failure === "runtime-log") { failedWorkerId = input.workerId; throw runtimeFailure; }
    report = await run(input); return report;
  });
  vi.spyOn(credentialStores, "createCredentialStore").mockImplementation(input => { issued = input.admission; return store(input); });
  if (failure === "close" || failure === "close-log") vi.spyOn(WorkerSessionManager.prototype, "closeAll").mockImplementation(async function (this: WorkerSessionManager) {
    managers.push(this);
    throw new WorkerSessionClosureUnprovedError("closure-worker", [new Error("fixture cleanup failed")]);
  });
  else if (failure === "launch") {
    const patch = { "features.duoWebAuthn": { set: false } };
    const applied = executeSettingsCommand({ authority: context.database, clock, ids: { uuid: randomUUID },
      settings: createSettingsApplicationExecutor(context.resolveSettings, context.credentials) }, {
      family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator",
      source: "settings-surface", target: { expectedRevision: context.settings.read().record.revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    assert.equal(applied.state, "applied");
    profileRoot = context.resolveSettings(context.settings.read().record.settings).config.paths.browserProfileRoot;
    const active = context.database.authority.runtimeConfig.get(); assert.ok(active);
    const run = RunRecordSchema.parse(personLookupQueuedRun());
    const queued = context.database.withAuthorityTransaction(repositories => repositories.runs.enqueue({ ...run,
      envelope: { ...run.envelope, configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint } }));
    assert.equal(queued.state, "inserted");
    const nativeLaunch = DEFAULT_BROWSER_LAUNCHER.launch.bind(DEFAULT_BROWSER_LAUNCHER);
    vi.spyOn(DEFAULT_BROWSER_LAUNCHER, "launch").mockImplementation(input => {
      if (input.ownedProcess !== undefined) {
        assert.equal(input.nativeOnly, true); assert.equal(input.headless, true);
        assert.equal(input.timeoutMs, context.resolveSettings(context.settings.read().record.settings).config.timeouts.sessionAcquireMs);
        probes += 1;
      }
      return nativeLaunch(input);
    });
    vi.spyOn(chromium, "launchPersistentContext").mockImplementation((directory, options) => {
      assert.deepEqual(options?.args, ["--disable-extensions"]);
      beforeLaunch = context.database.authority.workerLeases.get("person-lookup-worker-1"); assert.ok(beforeLaunch);
      launches += 1; launchedDirectory = directory; launchFailure = Promise.reject(new Error("uncertain launch failure")); return launchFailure;
    });
  }
  try {
    await assert.rejects(composeWorkerRuntime({ lifetimeLock, admission: f.machine, repoRoot: f.workspace, isolation: rebuildRuntimeIsolation,
      args: ["person-lookup", "--pool-index", "1", "--drain"], clock, env: {},
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      duoCeremony: duoCeremonyGatesOver(context.database, clock, new ManualScheduler(clock)),
      ...(failure !== "launch" ? { sessionFactory: happySessionHarness().factory } : {}),
      stopSignal: new AbortController().signal, write: () => undefined,
      closeDatabase: database => { database.close(); closedWorkerDatabase = database; } }), error => {
      assert.ok(error instanceof RuntimeCustodyUncertainError);
      if (failure === "runtime-log") {
        const contains = (value: unknown, target: unknown): boolean => value === target
          || value instanceof AggregateError && value.errors.some(member => contains(member, target));
        assert.equal(contains(error, runtimeFailure), true);
        assert.equal(contains(error, loggingFailure), true);
      }
      if (failure === "launch") { assert.ok(error instanceof WorkerLaunchUncertainError); launchReport = error; }
      return true;
    });
    if (failure === "close" || failure === "close-log") {
      assert.ok(report); assert.equal(report.closure, "unproved"); assert.deepEqual(report.outcomes, []);
      const lease = context.database.authority.workerLeases.get(report.workerId);
      assert.ok(lease?.lifecycle.state === "stopped"); assert.equal(lease.lifecycle.reason, "crashed");
    }
    else if (failure === "runtime-log") {
      assert.equal(report, undefined); assert.ok(failedWorkerId);
      const lease = context.database.authority.workerLeases.get(failedWorkerId);
      assert.ok(lease?.lifecycle.state === "stopped"); assert.equal(lease.lifecycle.reason, "crashed");
    }
    else {
      assert.equal(report, undefined); assert.ok(launchReport); assert.ok(beforeLaunch);
      assert.deepEqual(launchReport.report, { state: "launch-uncertain", custody: "held", workerId: beforeLaunch.workerId, workflowId: "person-lookup" });
      assert.equal(hasUnprovedSourceClosure(launchReport), true);
      const expectedLease = beforeLaunch;
      const lease = withReadonlyAuthoritySnapshot(f.path, database => {
        const row = database.prepare("SELECT payload_json FROM worker_leases WHERE worker_id=?").get(expectedLease.workerId);
        assert.ok(row && typeof row.payload_json === "string");
        return WorkerLeaseRecordSchema.parse(JSON.parse(row.payload_json));
      });
      assert.notEqual(lease.lifecycle.state, "stopped"); assert.deepEqual(lease, expectedLease);
      assert.ok(probes > 0); assert.equal(launches, 1); assert.ok(launchedDirectory);
      const registry = BrowserRootsSchema.parse(JSON.parse(readFileSync(registryPath, "utf8")));
      const owned = registry.roots.filter(row => row.owner.kind === "worker" && row.owner.workerId === expectedLease.workerId);
      assert.deepEqual(owned.map(row => basename(row.directory)).sort(), [...expectedLease.browserSystems].sort());
      const uncertain = owned.find(row => join(machineRoot, row.directory) === launchedDirectory);
      assert.ok(uncertain); assert.equal(uncertain.launch.state, "unknown");
      for (const row of owned) {
        assert.equal(row.native, undefined);
        if (row !== uncertain) assert.equal(row.launch.state, "closed");
      }
      assert.ok(profileRoot); const contained = relative(profileRoot, launchedDirectory);
      assert.ok(contained.length > 0 && !contained.startsWith("..") && !isAbsolute(contained));
      assert.ok(launchFailure); await assert.rejects(launchFailure);
    }
    if (failure === "close-log" || failure === "runtime-log") assert.equal(injectedLoggingFailures, 1);
    assert.ok(issued); issued.assertLive(); lifetimeLock.assertHeld();
    assert.ok(closedWorkerDatabase);
    const closed = closedWorkerDatabase;
    assert.throws(() => closed.getMeta(), /closed/u);
    lifetimeLock.assertHeld();
    custodyOraclesProved = true;
  } catch (error) { primary = error; throw error; } finally {
    vi.restoreAllMocks();
    for (const manager of managers) await manager.closeAll("worker-stop");
    await context.account.close();
    const databaseNames = () => {
      const descriptors = spawnSync("lsof", ["-a", "-p", String(process.pid), "-Fn"], { encoding: "utf8" });
      assert.equal(descriptors.error, undefined); assert.equal(descriptors.stderr, "");
      assert.equal(descriptors.status, 0);
      return new Set(descriptors.stdout.split("\n").filter(field => field.startsWith("n")).map(field => field.slice(1)));
    };
    assert.equal(databaseNames().has(f.path), true, "descriptor inspection must see the actual open readback database");
    context.database.close();
    const closedNames = databaseNames();
    for (const path of [f.path, `${f.path}-wal`, `${f.path}-shm`, `${f.path}-journal`]) {
      assert.equal(closedNames.has(path), false, "closed database cannot retain a descriptor");
      assert.equal(closedNames.has(`${path} (deleted)`), false, "closed database cannot retain a deleted descriptor");
    }
    assert.equal(custodyOraclesProved, true, new Error("worker-closure-fixture-custody-unproved", { cause: primary }));
    if (failure === "launch") {
      assert.ok(issued); const heldAdmission = issued;
      assert.throws(() => heldAdmission.release(), hasUnprovedSourceClosure);
      lifetimeLock.assertHeld(); retainedLaunchCustody.push({ f, issued, launchReport });
    } else { issued?.release(); await f.close(); }
  }
});

it("retains database, child and process custody when its actual OCR account cannot prove closure", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  copyFileSync("package.json", join(f.workspace, "package.json"));
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  const createAccount = accounts.createChatGptAccountService, run = workerLoop.runWorkerLoop;
  const lifetimeLock = f.lifetime;
  let workerDatabase: AuthorityDatabase | undefined, credentials: ReturnType<typeof credentialStores.createCredentialStore> | undefined;
  const createStore = credentialStores.createCredentialStore;
  vi.spyOn(credentialStores, "createCredentialStore").mockImplementation(options => {
    issued = options.admission; credentials = createStore(options); return credentials;
  });
  let issued: RuntimeAdmission | undefined;
  let account: accounts.ChatGptAccountService | undefined, report: workerLoop.WorkerLoopReport | undefined;
  let networkCalls = 0, databaseCloses = 0, proved = false;
  let primary: { readonly error: unknown } | undefined;
  const failure = new Error("synthetic account closure unavailable");
  vi.spyOn(accounts, "createChatGptAccountService").mockImplementation(options => {
    issued = options.admission;
    account = createAccount({ ...options, fetch: async () => { networkCalls++; throw new Error("no network in account closure proof"); } });
    return { ...account, close: async () => { throw failure; } };
  });
  vi.spyOn(workerLoop, "runWorkerLoop").mockImplementation(async input => { report = await run(input); return report; });
  const launch = vi.spyOn(chromium, "launchPersistentContext").mockImplementation(async () => { throw new Error("no browser in account closure proof"); });
  try {
    await assert.rejects(composeWorkerRuntime({ lifetimeLock, admission: f.machine, repoRoot: f.workspace, isolation: rebuildRuntimeIsolation,
      args: ["person-lookup", "--pool-index", "1", "--drain"], clock, env: {},
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      duoCeremony: duoCeremonyGatesOver(context.database, clock, new ManualScheduler(clock)),
      stopSignal: new AbortController().signal, write: () => undefined,
      openDatabase: (options, openClock) => {
        assert.ok(issued); assert.ok(credentials);
        workerDatabase = AuthorityDatabase.open(issued, options, openClock, undefined, undefined, undefined, credentials);
        return workerDatabase;
      },
      closeDatabase: database => { databaseCloses++; database.close(); } }), RuntimeCustodyUncertainError);
    assert.ok(report); assert.notEqual(report.closure, "unproved"); assert.deepEqual(report.outcomes, []);
    assert.equal(databaseCloses, 0); assert.equal(networkCalls, 0); assert.equal(launch.mock.calls.length, 0);
    assert.ok(workerDatabase); assert.ok(account);
    assert.ok(workerDatabase instanceof AuthorityDatabase); workerDatabase.getMeta();
    lifetimeLock.assertHeld();
    proved = true;
  } catch (error) { primary = { error }; throw error; }
  finally {
    vi.restoreAllMocks();
    assert.equal(proved, true, new Error("account-closure-fixture-custody-unproved", { cause: primary?.error }));
    assert.ok(account); assert.ok(workerDatabase);
    await account.close(); await context.account.close();
    assert.ok(workerDatabase instanceof AuthorityDatabase); workerDatabase.close(); context.database.close();
    const descriptors = spawnSync("lsof", ["-a", "-p", String(process.pid), "-Fn"], { encoding: "utf8" });
    assert.equal(descriptors.error, undefined); assert.equal(descriptors.stderr, ""); assert.equal(descriptors.status, 0);
    const names = new Set(descriptors.stdout.split("\n").filter(field => field.startsWith("n")).map(field => field.slice(1)));
    for (const path of [f.path, `${f.path}-wal`, `${f.path}-shm`, `${f.path}-journal`]) {
      assert.equal(names.has(path), false); assert.equal(names.has(`${path} (deleted)`), false);
    }
    // The empty loop and zero transport calls precede this test-owned custody release.
    assert.ok(issued); issued.release(); await f.close();
  }
});
