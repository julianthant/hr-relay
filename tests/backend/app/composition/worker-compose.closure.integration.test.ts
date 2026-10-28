import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { chromium } from "playwright";
import { it, vi } from "vitest";
import { composeWorkerRuntime } from "../../../../src/backend/app/composition/worker-compose.js";
import { composeSelectedProfileStorage, RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import * as accounts from "../../../../src/backend/accounts/chatgpt-account-service.js";
import * as workerLoop from "../../../../src/backend/runtime/workers/worker-loop.js";
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

for (const failure of ["close", "launch"] as const) it(failure === "close"
  ? "retains an unproved closure report while settling the worker lease as crashed"
  : "records a crashed lease for the real factory's generic launcher rejection", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  copyFileSync("package.json", join(f.workspace, "package.json"));
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  let report: workerLoop.WorkerLoopReport | undefined, issued: RuntimeAdmission | undefined;
  const lifetimeLock = await runtimeLifetimeLock();
  const managers: WorkerSessionManager[] = [];
  let launches = 0, launchFailure: Promise<never> | undefined;
  let closedWorkerDatabase: AuthorityDatabase | undefined, launchedDirectory: string | undefined;
  let custodyOraclesProved = false;
  const run = workerLoop.runWorkerLoop;
  const store = credentialStores.createCredentialStore;
  vi.spyOn(workerLoop, "runWorkerLoop").mockImplementation(async input => { report = await run(input); return report; });
  vi.spyOn(credentialStores, "createCredentialStore").mockImplementation(input => { issued = input.admission; return store(input); });
  if (failure === "close") vi.spyOn(WorkerSessionManager.prototype, "closeAll").mockImplementation(async function (this: WorkerSessionManager) {
    managers.push(this);
    throw new WorkerSessionClosureUnprovedError("closure-worker", [new Error("fixture cleanup failed")]);
  });
  else {
    const patch = { "features.duoWebAuthn": { set: false } };
    const applied = executeSettingsCommand({ authority: context.database, clock, ids: { uuid: randomUUID },
      settings: createSettingsApplicationExecutor(context.resolveSettings, context.credentials) }, {
      family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator",
      source: "settings-surface", target: { expectedRevision: context.settings.read().record.revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    assert.equal(applied.state, "applied");
    const active = context.database.authority.runtimeConfig.get(); assert.ok(active);
    const run = RunRecordSchema.parse(personLookupQueuedRun());
    const queued = context.database.withAuthorityTransaction(repositories => repositories.runs.enqueue({ ...run,
      envelope: { ...run.envelope, configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint } }));
    assert.equal(queued.state, "inserted");
    vi.spyOn(chromium, "launchPersistentContext").mockImplementation(directory => { launches += 1; launchedDirectory = directory; launchFailure = Promise.reject(new Error("uncertain launch failure")); return launchFailure; });
  }
  try {
    await assert.rejects(composeWorkerRuntime({ lifetimeLock, admission: f.machine, repoRoot: f.workspace, isolation: rebuildRuntimeIsolation,
      args: ["person-lookup", "--pool-index", "1", "--drain"], clock, env: {},
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      duoCeremony: duoCeremonyGatesOver(context.database, clock, new ManualScheduler(clock)),
      ...(failure === "close" ? { sessionFactory: happySessionHarness().factory } : {}),
      stopSignal: new AbortController().signal, write: () => undefined,
      closeDatabase: database => { database.close(); closedWorkerDatabase = database; } }), RuntimeCustodyUncertainError);
    assert.ok(report); assert.equal(report.closure, "unproved");
    if (failure === "close") assert.deepEqual(report.outcomes, []);
    else {
      assert.equal(launches, 1); assert.ok(launchedDirectory);
      const root = context.resolveSettings(context.settings.read().record.settings).config.paths.browserProfileRoot;
      const contained = relative(root, launchedDirectory);
      assert.ok(contained.length > 0 && !contained.startsWith("..") && !isAbsolute(contained));
      assert.ok(launchFailure); await assert.rejects(launchFailure);
    }
    const lease = context.database.authority.workerLeases.get(report.workerId);
    assert.ok(lease?.lifecycle.state === "stopped"); assert.equal(lease.lifecycle.reason, "crashed");
    assert.ok(issued); issued.assertLive(); lifetimeLock.assertHeld();
    assert.ok(closedWorkerDatabase);
    const closed = closedWorkerDatabase;
    assert.throws(() => closed.getMeta(), /closed/u);
    lifetimeLock.assertHeld();
    custodyOraclesProved = true;
  } finally {
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
    assert.equal(custodyOraclesProved, true, "worker-closure-fixture-custody-unproved");
    issued?.release(); await f.close();
  }
});

it("retains database, child and process custody when its actual OCR account cannot prove closure", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  copyFileSync("package.json", join(f.workspace, "package.json"));
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  const createAccount = accounts.createChatGptAccountService, run = workerLoop.runWorkerLoop;
  const lifetimeLock = await runtimeLifetimeLock();
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
