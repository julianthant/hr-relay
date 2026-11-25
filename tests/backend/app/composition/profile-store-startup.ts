/**
 * From the repository root, with a stopped private workspace under the system temp directory:
 * RELAY_RUNTIME_PROFILE=development node --import tsx tests/backend/app/composition/profile-store-startup.ts WORKSPACE
 * Set RELAY_RUNTIME_PROFILE to the copy's profile. The copy's workspace and active settings must already be rebound.
 * Use --seed with an empty workspace for synthetic data, or --boot-only with a copy that has no retained selection.
 * Booting the synthetic fixture exercises a retained browser root and requires the installed Chromium runtime.
 * Use a fresh copy of the same source for every run. Each run changes its own copy.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier.endsWith(".css") ? { url: "data:text/javascript,", shortCircuit: true } : nextResolve(specifier, context);
} });
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const phaseTimes = new Map<string, number[]>();
const record = (phase: string, elapsedMs: number) => {
  const times = phaseTimes.get(phase) ?? [];
  times.push(elapsedMs);
  phaseTimes.set(phase, times);
};
function timed<T>(phase: string, work: () => T): T {
  const started = performance.now();
  try { return work(); } finally { record(phase, performance.now() - started); }
}
async function timedAsync<T>(phase: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await work(); } finally { record(phase, performance.now() - started); }
}

function assertPrivateWorkspace(workspace: string): void {
  const within = relative(realpathSync(tmpdir()), workspace);
  const access = lstatSync(workspace);
  if (within === "" || within === ".." || within.startsWith(".." + sep) || isAbsolute(within)
    || !access.isDirectory() || realpathSync(workspace) !== workspace || (access.mode & 0o077) !== 0
    || (process.getuid !== undefined && access.uid !== process.getuid())) throw new Error("profile-startup-private-temp-workspace-required");
}

async function seed(workspace: string): Promise<void> {
  if (readdirSync(workspace).length > 0) throw new Error("profile-startup-seed-workspace-not-empty");
  const { useCopySigninFixtureWorkspace } = await import("../../../../src/backend/app/config/runtime-isolation.js");
  useCopySigninFixtureWorkspace(workspace);
  const { createBoundProfileFixture, boundProfileCredentials } = await import("../../../support/helpers/admission-fixture.js");
  const { CONFIG_SNAPSHOT } = await import("../../../support/fixtures/phase1c-contract-fixtures.js");
  const { createTimelineEmitter } = await import("../../../../src/backend/storage/events/timeline-emitter.js");
  const { createNoteTimelineWriter } = await import("../../../../src/backend/storage/events/note-timeline-writer.js");
  const { manualClock, systemClock } = await import("../../../../src/rules/time/clock.js");
  const { requireLifecycleApplied, RunRecordService } = await import("../../../../src/backend/runs/lifecycle/run-record-service.js");
  const { enqueueRun } = await import("../../../perf/dashboard-fixture.js");
  const { unexpectedWorkbookSync } = await import("../../../support/helpers/backend/workbook-sync.js");
  const { createWorkbookLibraryService } = await import("../../../../src/backend/workbooks/workbook-library-service.js");
  const { admitCommandBrowser, commandProfileDirectory, createBrowserRoots } = await import("../../../../src/backend/storage/browser-roots.js");
  const { backupRegisteredPeopleAtCleanShutdown, composeSelectedProfileStorage } = await import("../../../../src/backend/app/composition/storage-compose.js");
  const profile = await createBoundProfileFixture({ workspace });
  const clock = manualClock(systemClock.now());
  const now = clock.nowMs();
  try {
    const selected = composeSelectedProfileStorage({ machineAdmission: profile.machine, admission: profile.admission,
      credentials: boundProfileCredentials(profile.admission), hostFacts: { primaryDisplay: null }, clock });
    const { database } = selected;
    try {
      database.authority.configSnapshots.insert(CONFIG_SNAPSHOT);
      const spans = createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
      const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
      const context = { path: profile.path, workers: new Map<string, string>(), database, clock, spans, notes };
      const lifecycle = new RunRecordService({ database, clock, ids: { uuid: randomUUID }, publishQueued: () => {} });
      database.withAuthorityTransaction(() => {
        for (let index = 0; index < 191; index++) {
          const day = new Date(now - (17 - Math.floor(index / 12)) * 86_400_000).toISOString().slice(0, 10);
          const run = enqueueRun(context, { seed: index + 1, day, title: "Synthetic startup run", separations: index % 5 === 0 });
          const { runId, workflow, traceId } = run.envelope;
          for (let attempt = 1; attempt <= (index < 111 ? 7 : 6); attempt++) {
            const address = { ts: clock.now().toISOString(), workflow, runId, attempt: 1, traceId,
              spanPath: traceId + "/lookup#" + String(attempt), parentSpanPath: traceId };
            spans.emit({ ...address, t: "span.started", kind: "task", name: "lookup" });
            spans.emit({ ...address, t: "span.ended", kind: "task", outcome: "done" });
          }
          for (let note = 0; note < (index < 38 ? 10 : 9); note++) {
            notes.emitNote({ workflow, address: { runId, attempt: 1, traceId, spanPath: traceId }, level: "step",
              message: "Synthetic startup note ".repeat(9).trim() });
          }
          let previous = requireLifecycleApplied(lifecycle.transition({ commandId: randomUUID(), runId, expectedVersion: run.version,
            lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() } }));
          for (let revision = 1; revision <= (index < 56 ? 25 : 24); revision++) {
            previous = requireLifecycleApplied(lifecycle.transition({ commandId: randomUUID(), runId, expectedVersion: previous.version,
              displayName: "Synthetic startup run " + String(revision) }));
          }
        }
      });
      // The real source's legacy timeline combined diagnostics with workflow events. Schema 42 keeps diagnostics separately.
      const timeline = database.authority.timelineEvents;
      const at = clock.now().toISOString();
      const retentionDate = at.slice(0, 10);
      database.withAuthorityTransaction(() => {
        for (let index = 0; index < 52_042; index++) {
          timeline.append({ schemaVersion: 1, eventId: randomUUID(), scope: { kind: "transport", connectionId: "startup-profile" },
            occurredAt: at, recordedAt: at, retentionDate, source: { kind: "native" },
            payload: { kind: "debug", event: { category: "http", phase: "settled", area: "storage",
              reason: "synthetic-startup-profile", message: "Synthetic diagnostic entry ".repeat(5).trim(), correlationId: randomUUID(),
              build: "0.1.0", pid: 4242, pinned: false } },
          });
        }
      });
      const workbooks = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository: database.authority.workbooks, clock });
      const width = 32;
      for (let index = 0; index < 5; index++) {
        workbooks.create({ name: `Synthetic workbook ${String(index + 1)}`, hasFormulas: false, themes: [],
          sheets: [{ id: "sheet", name: "Synthetic rows", width, hidden: [],
            rows: Array.from({ length: 1_200 }, (_, row) => ({
              id: `row-${String(row + 1)}`,
              cells: Array.from({ length: width }, (_, column) => ({ value: `Sample row ${String(row + 1).padStart(4, "0")} cell ${String(column + 1).padStart(2, "0")}` })),
            })),
          }],
        });
      }
      const profileRoot = join(profile.admission.stateRoot, "browsers"), profileDirectory = commandProfileDirectory(profileRoot);
      const capability = admitCommandBrowser(profile.admission, { profileRoot, commandId: randomUUID(), requestDigest: "a".repeat(64) });
      const launch = createBrowserRoots(profile.admission).beginLaunch({ profileId: profile.admission.profileBinding.profileId,
        profileRoot, profileDirectory, owner: { kind: "command", capability }, credentialFingerprint: null });
      mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
      launch.closing();
      launch.closed();
    } finally { await selected.account.close(); database.close(); }
  } finally { await profile.closeController(); }
  const { RuntimeLifetimeLock } = await import("../../../../src/backend/storage/admission/lifetime-lock.js");
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  try {
    for (let index = 0; index < 3; index++) {
      clock.advanceWall(1_000);
      await backupRegisteredPeopleAtCleanShutdown(workspace, lifetime, clock);
    }
  } finally { await lifetime.close(); }
  process.stdout.write("Seeded current-schema authority with 191 runs, 4,831 lifecycle commands, 56,695 timeline and diagnostic events, five workbooks, one retained browser root and three verified backups.\n");
}

async function measure(workspace: string, bootOnly: boolean): Promise<void> {
  if (!existsSync(join(workspace, ".tracker", "control", "installation.json"))) throw new Error("profile-startup-established-copy-required");
  const fixtureKeys = existsSync(join(workspace, ".tracker", "fixture-keychain"));
  const { rebuildRuntimeIsolation, useCopySigninFixtureWorkspace } = await import("../../../../src/backend/app/config/runtime-isolation.js");
  if (fixtureKeys) useCopySigninFixtureWorkspace(workspace);
  const localhostFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("profile-startup-external-fetch-refused"); };
  const { osCredentialSecretStore } = await import("../../../../src/backend/storage/configuration/credential-key-custody.js");
  const refuseCredentialChange = () => { throw new Error("profile-startup-keychain-write-refused"); };
  osCredentialSecretStore.set = refuseCredentialChange;
  osCredentialSecretStore.delete = refuseCredentialChange;
  const { hostConfigFacts } = await import("../../../../src/models/config/host-display.js");
  const { PublicProfileStateSchema } = await import("../../../../src/models/profiles/public-profile.js");
  const { profileBrowserClosure } = await import("../../../../src/backend/runtime/browser/profile-browser-closure.js");
  const { acquireDashboardEntrypointAdmission } = await import("../../../../src/backend/storage/admission/bootstrap-admission.js");
  const { RuntimeLifetimeLock } = await import("../../../../src/backend/storage/admission/lifetime-lock.js");
  const { createProfileVerifiers } = await import("../../../../src/backend/storage/configuration/verifier-store.js");
  const { AuthorityDatabase } = await import("../../../../src/backend/storage/sqlite/authority-database.js");
  const { composeDashboardApplication } = await import("../../../../src/backend/app/composition/dashboard/compose.js");
  const { StartupObservationSchema, startupObservations } = await import("../../../../src/backend/app/composition/dashboard/startup-observation.js");
  const { completePendingShutdownBackup } = await import("../../../../src/backend/app/bootstrap/secure-env-bootstrap.js");
  const storage = await import("../../../../src/backend/app/composition/storage-compose.js");
  const { systemClock } = await import("../../../../src/rules/time/clock.js");
  const inspect = AuthorityDatabase.inspectRegisteredPersonAtStartup.bind(AuthorityDatabase);
  const recoverOpen = AuthorityDatabase.openStoppedStartupRecovery.bind(AuthorityDatabase);
  const inspectEvidence = AuthorityDatabase.inspectEvidenceSchemaUpgrade.bind(AuthorityDatabase);
  const open = AuthorityDatabase.open.bind(AuthorityDatabase);
  const probeBrowsers = profileBrowserClosure.probeClosed.bind(profileBrowserClosure);
  let recoveryOpens = 0;
  AuthorityDatabase.inspectRegisteredPersonAtStartup = (...args) => timed("registered inspection", () => inspect(...args));
  AuthorityDatabase.inspectEvidenceSchemaUpgrade = (...args) => timed("evidence upgrade inspection", () => inspectEvidence(...args));
  AuthorityDatabase.openStoppedStartupRecovery = (...args) => timed("recovery authority open", () => {
    const database = recoverOpen(...args);
    recoveryOpens++;
    return database;
  });
  profileBrowserClosure.probeClosed = (...args) => timedAsync("retained browser closure", () => probeBrowsers(...args));
  AuthorityDatabase.open = (...args) => {
    const database = timed("profile authority open", () => open(...args));
    const history = database.dashboardHistory.bind(database);
    database.dashboardHistory = () => timed("history admission", history);
    return database;
  };
  const firstPasses = new Map<string, string>();
  const observe = (message: unknown): void => {
    const { phase, elapsedMs, outcome } = StartupObservationSchema.parse(message);
    record(phase, elapsedMs);
    firstPasses.set(phase, outcome);
  };
  startupObservations.subscribe(observe);
  record("launch to startup admission", performance.now());
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  try {
    const host = hostConfigFacts({});
    const unboundSource = join(workspace, "startup-profile-unused-source");
    if (existsSync(unboundSource)) throw new Error("profile-startup-unbound-source-required");
    await timedAsync("fixed layout admission", () => storage.prepareApplicationDataWorkspace(unboundSource, workspace, lifetime, host));
    await timedAsync("person-store startup", () => storage.initializeRegisteredPersonStores(workspace, lifetime, host));
    if (fixtureKeys && recoveryOpens !== 1) throw new Error("profile-startup-fixture-recovery-unproved");
    await timedAsync("pending backup closure", () => completePendingShutdownBackup({
      read: () => storage.readPendingShutdownBackup(workspace), remove: () => storage.removePendingShutdownBackup(workspace),
      write: remaining => storage.writePendingShutdownBackup(workspace, remaining),
      backup: people => storage.backupRegisteredPeopleAtCleanShutdown(workspace, lifetime, systemClock, people),
    }));
    const admission = await acquireDashboardEntrypointAdmission(profileBrowserClosure, workspace, "shared", lifetime);
    let app: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
    let authorityReady = false;
    try {
      if (fixtureKeys && admission.readProfileRegistry().activeProfileId === null) throw new Error("profile-startup-fixture-selection-lost");
      app = await composeDashboardApplication({ admission, isolation: rebuildRuntimeIsolation, repoRoot, lifetimeLock: lifetime,
        backendPortOverride: 0, frontendPortOverride: 0, loopDelay: false, env: {}, shutdownBackup: async () => {},
        onInitialPreflight: report => { authorityReady = report.results.some(result => result.check === "authority.health" && result.status === "pass"); },
        workerProcess: { spawn: () => { throw new Error("profile-startup-workflow-worker-refused"); } },
      });
      const origin = `http://127.0.0.1:${String(app.port)}`;
      const stateResponse = await localhostFetch(origin + "/api/v1/profile/state");
      const state = PublicProfileStateSchema.parse(await stateResponse.json());
      if (!stateResponse.ok || state.state !== "signed-out" || state.signUpRequired) throw new Error("profile-startup-shell-not-ready");
      record("launch to shell ready", performance.now());
      if (bootOnly) return;
      const registry = admission.readProfileRegistry();
      const profileId = registry.activeProfileId;
      if (profileId === null) throw new Error("profile-startup-resumable-selection-required");
      const proof = createProfileVerifiers(admission.stateRoot).issueResumeProof({ installationId: registry.installationId,
        profileId, epoch: registry.sessionGeneration, origin });
      await timedAsync("resume to profile ready", async () => {
        const response = await localhostFetch(origin + "/api/v1/profile/resume", { method: "POST",
          headers: { origin, "content-type": "application/json", "x-relay-resume": proof }, body: "{}" });
        const active = PublicProfileStateSchema.parse(await response.json());
        if (!response.ok || active.state !== "active") throw new Error(`profile-startup-resume-${active.state}${"code" in active ? `-${active.code}` : ""}`);
        if (!authorityReady) throw new Error("profile-startup-authority-preflight-unproved");
      });
      const deadline = performance.now() + 60_000;
      while (firstPasses.size < 3 && performance.now() < deadline) await delay(10);
      if (firstPasses.size !== 3 || [...firstPasses.values()].includes("failed")) throw new Error("profile-startup-observer-first-pass-unproved");
    } finally { if (app === undefined) admission.release(); else await app.stop(); }
  } finally {
    await lifetime.close();
    startupObservations.unsubscribe(observe);
    console.table([...phaseTimes].map(([phase, ms]) => ({ phase, calls: ms.length, totalMs: Math.round(ms.reduce((sum, value) => sum + value, 0)),
      outcome: firstPasses.get(phase) ?? "" })));
  }
}

try {
  const [first, second, extra] = process.argv.slice(2);
  const seedRequested = first === "--seed";
  const bootOnly = first === "--boot-only";
  const hasOption = seedRequested || bootOnly;
  const selected = hasOption ? second : first;
  if (selected === undefined || selected.startsWith("--") || (hasOption ? extra !== undefined : second !== undefined))
    throw new Error("usage: profile-store-startup [--seed|--boot-only] WORKSPACE");
  const workspace = resolve(selected);
  assertPrivateWorkspace(workspace);
  if (seedRequested) await seed(workspace);
  else await measure(workspace, bootOnly);
} catch (error) {
  const { serializeErrorCauses } = await import("../../../../src/models/failures/error-origins.js");
  const causes = serializeErrorCauses(error).map(({ name, code }) => ({ name, code }));
  const reason = error instanceof Error && /^profile-startup-[A-Za-z0-9_-]+$/u.test(error.message) ? error.message : undefined;
  process.stderr.write(JSON.stringify({ code: "profile-store-startup-failed", reason, causes }) + "\n");
  process.exitCode = 1;
} finally { hooks.deregister(); }
