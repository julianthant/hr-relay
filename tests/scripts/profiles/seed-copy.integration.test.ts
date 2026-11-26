import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../src/backend/app/composition/dashboard/compose.js";
import { SAMPLE_WORKER_ORDINAL_FLOOR } from "../../../src/backend/app/composition/dashboard/copy-samples.js";
import { composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { CHILD_ONLY_WORKFLOW_MODULES, READABLE_WORKFLOW_MODULES, WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { queryActivitySummaries } from "../../../src/backend/runs/queries/activity-summaries.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { importIsolatedProfileData } from "../../../src/backend/storage/maintenance/isolated-library-import.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { runtimeProfiles } from "../../../src/models/config/define-runtime-isolation.js";
import { searchPartitionDay } from "../../../src/models/dashboard/search-calendar.js";
import { NotificationTriggerSchema } from "../../../src/models/notifications/notifications.js";
import type { ProfileDatabaseBinding } from "../../../src/models/profiles/profile.js";
import type { RunRecord } from "../../../src/models/run/record.js";
import { canonicalInputSamples } from "../../../src/models/workflow/canonical-input.js";
import { WorkStudyCanonicalInput } from "../../../src/models/workflows/work-study/input.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT, NOTIFICATION } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../support/fixtures/preflight-seams.js";
import { runRecordOf } from "../../support/helpers/backend/dashboard-harness.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { credentialKeychainTestEnvironment, FakeKeyringEntry } from "../../support/helpers/credential-keychain-fake.js";
import { boundProfileCredentials } from "../../support/helpers/synthetic-database-admission.js";
import { createBackupFixtures } from "../../support/helpers/storage/backup-fixtures.js";

const entry = fileURLToPath(new URL("../../../scripts/profiles/seed-copy.ts", import.meta.url));
const cleanups: (() => void | Promise<void>)[] = [];
const clock = manualClock(new Date("2026-11-24T20:00:00.000Z"));
const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, clock);
afterEach(async () => { try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); } finally { vi.unstubAllGlobals(); } });

async function openSeededDashboard(workspace: string) {
  const lock = await acquireRuntimeLifetimeLock(0);
  cleanups.push(() => lock.close());
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lock);
  cleanups.push(() => machine.release());
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(workspace, name));
  const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
  cleanups.push(() => runtime.close());
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.ok(active.state === "active");
  const realFetch = globalThis.fetch, outbound: string[] = [];
  vi.stubGlobal("fetch", ((url, options) => {
    const host = new URL(url instanceof Request ? url.url : url).hostname;
    if (host !== "127.0.0.1") { outbound.push(host); throw new Error("unexpected-external-request"); }
    return realFetch(url, options);
  }) satisfies typeof fetch);
  const spawn = vi.fn(() => { throw new Error("unexpected-worker-start"); });
  const dashboard = await composeDashboardRuntime({ lifetimeLock: lock, admission: machine, profile: { runtime, token: active.token },
    repoRoot: workspace, clock, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {},
    preflightRunnerFactory: healthyRuntimePreflightRunners, workerProcess: { spawn } });
  cleanups.push(() => dashboard.stop());
  return { client: createDashboardClient({ baseUrl: `http://127.0.0.1:${String(dashboard.port)}` }), outbound, spawn };
}

function isolatedHome() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "relay-seed-copy-")));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const preload = join(home, "seed-copy-home.mjs");
  writeFileSync(preload, `
    import os from "node:os";
    import { syncBuiltinESMExports } from "node:module";
    const user = os.userInfo();
    os.userInfo = () => ({ ...user, homedir: process.env.HOME });
    syncBuiltinESMExports();
    const seedAt = ${String(clock.nowMs())};
    Date.now = () => seedAt;
    globalThis.Date = new Proxy(Date, {
      construct(target, args, newTarget) {
        return Reflect.construct(target, args.length === 0 ? [seedAt] : args, newTarget);
      },
    });
    globalThis.fetch = () => { throw new Error("unexpected outbound fetch"); };
  `);
  const data = process.platform === "win32" ? home : join(home, "Library", "Application Support");
  mkdirSync(data, { recursive: true, mode: 0o700 });
  return {
    data,
    run: (profile: string, binding?: ProfileDatabaseBinding) => {
      const env = credentialKeychainTestEnvironment({ ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: home });
      if (binding !== undefined) {
        const account = `${binding.installationId}:${binding.profileId}`;
        env.RELAY_TEST_KEYCHAIN = JSON.stringify(FakeKeyringEntry.snapshot()
          .map(([name, key]) => [name === `Relay:${account}` ? `Relay:${profile}:${account}` : name, key]));
      }
      return spawnSync(process.execPath, ["--import", "tsx", "--import", pathToFileURL(preload).href, entry, profile], {
        env, encoding: "utf8", timeout: 20_000,
      });
    },
  };
}

it("refuses production at the command line", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", entry, "production"], {
    encoding: "utf8", timeout: 20_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Usage: tsx scripts/profiles/seed-copy.ts <development|staging>");
});

it("refuses a copy path that aliases the production data root", () => {
  const { data, run } = isolatedHome();
  const production = join(data, "Relay");
  const sentinel = join(production, ".tracker", "control", "installation.json");
  mkdirSync(join(production, ".tracker", "control"), { recursive: true, mode: 0o700 });
  writeFileSync(sentinel, "production sentinel");
  symlinkSync(production, join(data, "Relay-development"), "junction");

  const result = run("development");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("seed-copy-target-refused");
  expect(readFileSync(sentinel, "utf8")).toBe("production sentinel");
});

it("refuses while the development lifetime port is held", async () => {
  const { run } = isolatedHome();
  const lock = await acquireRuntimeLifetimeLock(runtimeProfiles.development.lockPort);
  try {
    const result = run("development");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("seed-copy-profile-running");
  } finally { await lock.close(); }
});

it("replaces its synthetic history and retains imported rows outside operational authority", async () => {
  const { data, run } = isolatedHome();
  const workspace = join(data, "Relay-development");
  mkdirSync(workspace, { mode: 0o700 });
  const source = await openCurrentWorld();
  const copy = await createBoundProfileFixture({ workspace });
  cleanups.push(() => copy.close());
  if (source.database.authority.runtimeConfig.get() === undefined) source.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const imported = runRecordOf({ seed: 602, enqueuedAt: clock.now().toISOString(), displayName: "Imported example" });
  source.database.authority.runs.enqueue(imported);
  const { runId, workflow, attempt, traceId } = imported.envelope;
  createNoteTimelineWriter({ repository: source.database.authority.timelineEvents, clock }).emitNote({ workflow,
    address: { runId, attempt, traceId, spanPath: traceId }, level: "step", message: "Imported example step" });
  const importedTimeline = source.database.authority.timelineEvents.page({ runId, limit: 20 });
  expect(importedTimeline).toHaveLength(1);
  const importedNotice = { ...NOTIFICATION, links: [{ kind: "run", runId: imported.envelope.runId }] };
  source.database.authority.notifications.create(importedNotice);
  const backup = await takeBackup(source);
  const binding = copy.admission.profileBinding;
  const database = AuthorityDatabase.open(copy.admission, { path: copy.path, busyTimeoutMs: 250, migrationOwner: "seed-copy-test" },
    clock, undefined, undefined, undefined, boundProfileCredentials(copy.admission));
  let retained;
  try {
    await importIsolatedProfileData(copy.admission, database, { source: { manifestPath: backup.manifestPath, binding: source.admission.profileBinding },
      destination: binding }, clock);
    retained = database.dashboardHistory().authority.runs.get(imported.envelope.runId);
    expect(retained?.lifecycle).toMatchObject({ state: "terminal", outcome: "discarded" });
  } finally { database.close(); }
  await copy.closeController();
  const localBefore = readFileSync(copy.path);

  const readHistory = async () => {
    const lock = await acquireRuntimeLifetimeLock(0);
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lock);
    try {
      const admission = machine.admitProfile(binding.profileId);
      try {
        const native = AuthorityDatabase.open(admission, { path: copy.path, busyTimeoutMs: 250, migrationOwner: "seed-copy-test",
          openMode: "storage-doctor-read-only-no-migrate" }, clock);
        try {
          const history = native.dashboardHistory();
          const { runs, notifications } = history.authority;
          expect(native.authority.runs.listWorkflows()).toEqual([]);
          expect(native.authority.runs.listNonTerminal()).toEqual([]);
          expect(native.authority.runs.listParkedAtGate()).toEqual([]);
          expect(native.authority.notifications.listByActor("local-operator")).toEqual([]);
          expect(runs.get(imported.envelope.runId)).toEqual(retained);
          expect(notifications.get(importedNotice.notificationId)).toEqual(importedNotice);
          expect(history.authority.timelineEvents.page({ runId, limit: 20 })).toEqual(importedTimeline);
          const generated = runs.listWorkflows().flatMap(workflow => runs.listByWorkflow(workflow)).filter(row => row.envelope.runId !== imported.envelope.runId);
          const notices = notifications.listByActor("local-operator").filter(row => row.notificationId !== importedNotice.notificationId);
          const analytics = ["2026-11-18", "2026-10-26", "2026-08-27"].map(from => queryActivitySummaries(history,
            { from, to: "2026-11-24", generatedAt: clock.now().toISOString() },
            { ledger: createTransactionHistory(history.authority), descriptors: { resolve: id => READABLE_WORKFLOW_MODULES.find(row => row.descriptor.id === id)?.descriptor } }));
          return { generated, notices, analytics };
        } finally { native.close(); }
      } finally { admission.release(); }
    } finally { machine.release(); await lock.close(); }
  };

  const first = run("development", binding);
  expect(first.error).toBeUndefined();
  expect(first.status, first.stderr).toBe(0);
  expect(readFileSync(copy.path)).toEqual(localBefore);
  const seeded = await readHistory();
  const second = run("development", binding);
  expect(second.error).toBeUndefined();
  expect(second.status, second.stderr).toBe(0);
  assert.deepEqual(await readHistory(), seeded);
  expect(readFileSync(copy.path)).toEqual(localBefore);

  const { client, outbound, spawn } = await openSeededDashboard(workspace);
  const visible = new Set<string>();
  const days = new Set([imported, ...seeded.generated].map(row => searchPartitionDay(new Date(row.envelope.enqueuedAt))));
  expect(days.size).toBe(90);
  for (const day of days) for (const row of (await client.dashboardDay(day)).queueSurfaces) visible.add(row.runId);
  for (const { envelope } of seeded.generated) {
    expect(visible).toContain(envelope.runId);
    expect((await client.runDetail(envelope.runId)).runId).toBe(envelope.runId);
  }
  const notificationIds = (await client.notificationSnapshot()).map(row => row.notificationId);
  expect(notificationIds).toEqual(expect.arrayContaining([importedNotice, ...seeded.notices].map(row => row.notificationId)));
  await expectLiveSamples(client, seeded.generated);
  expect(outbound).toEqual([]);
  expect(spawn).not.toHaveBeenCalled();

  const workflowIds = WORKFLOW_MODULES.map(({ descriptor }) => descriptor.id);
  const skippedChildOnlyWorkflows = CHILD_ONLY_WORKFLOW_MODULES.map(({ descriptor }) => descriptor.id);
  expect(JSON.parse(first.stdout)).toMatchObject({ skippedChildOnlyWorkflows });
  expect(new Set(seeded.generated.map(row => row.envelope.workflow))).toEqual(new Set(workflowIds));
  for (const { workflows, days } of seeded.analytics) {
    expect(workflows).toHaveLength(workflowIds.length);
    expect(days.every(day => day.runs > 0)).toBe(true);
    for (const workflow of workflows) {
      expect(Object.values(workflow.outcomes).every(count => count > 0)).toBe(true);
      expect(workflow.typicalTime.meanMs.state).toBe("present");
      expect(workflow.failedAt.some(step => step.state === "known")).toBe(true);
    }
  }
  expect(seeded.analytics.map(report => report.days.length)).toEqual([7, 30, 90]);
  expect(seeded.generated.every(row => row.displayName?.startsWith("Synthetic ") === true && row.envelope.dryRun)).toBe(true);
  const workStudyEid = WorkStudyCanonicalInput.parse(canonicalInputSamples(WorkStudyCanonicalInput)[0]).emplId;
  for (const { descriptor } of WORKFLOW_MODULES) {
    const runs = seeded.generated.filter(row => row.envelope.workflow === descriptor.id);
    for (const { input } of runs) {
      expect(descriptor.canonicalInput.parse(descriptor.input.parse(input.raw))).toEqual(input.parsed.value);
      const values = JSON.stringify([input.raw, input.parsed.value]);
      expect(values).not.toMatch(/\b(?:\d{9}|\d{3}-\d{2}-\d{4})\b/u);
      expect(values.match(/\b10\d{6}\b/gu) ?? []).toEqual(descriptor.id === "work-study" ? [workStudyEid, workStudyEid] : []);
    }
    const outcomes = runs.flatMap(({ lifecycle }) => lifecycle.state === "terminal" ? [lifecycle.outcome] : []);
    for (const outcome of ["done", "failed", "cancelled", "interrupted"]) expect(outcomes, descriptor.id).toContain(outcome);
    expect(runs.some(({ lifecycle }) => lifecycle.state === "parked-gate"), descriptor.id).toBe(true);
    expect(runs.some(({ pause }) => pause?.state === "paused"), descriptor.id).toBe(true);
  }
  expect(new Set(seeded.notices.map(row => row.trigger))).toEqual(new Set(NotificationTriggerSchema.options));
  expect(seeded.notices.some(row => row.count > 1)).toBe(true);
  expect(JSON.parse(first.stdout)).toMatchObject({ todayByState: { queued: workflowIds.length, running: workflowIds.length, "needs-duo": workflowIds.length } });
});

/** Today's sample queue and Sessions show every live state, and every action on them is refused or stays on the card. */
async function expectLiveSamples(client: ReturnType<typeof createDashboardClient>, generated: readonly RunRecord[]) {
  const today = searchPartitionDay(clock.now());
  const live = generated.filter(row => row.displayName?.includes(" today ") === true);
  for (const { descriptor } of WORKFLOW_MODULES) {
    const runs = live.filter(row => row.envelope.workflow === descriptor.id);
    expect(new Set(runs.map(row => row.lifecycle.state)), descriptor.id).toEqual(new Set(["queued", "running", "parked-gate", "terminal"]));
    expect(runs.some(row => row.cancelRequested === true), descriptor.id).toBe(true);
    expect(runs.some(row => row.pause?.state === "paused"), descriptor.id).toBe(true);
    expect(runs.every(row => searchPartitionDay(new Date(row.envelope.enqueuedAt)) === today), descriptor.id).toBe(true);
  }
  const day = await client.dashboardDay(today);
  const rows = day.queueSurfaces.filter(row => live.some(run => run.envelope.runId === row.runId));
  expect(rows).toHaveLength(live.length);
  expect(new Set(rows.map(row => row.status))).toEqual(new Set(["queued", "running", "cancelling", "awaiting-approval", "blocked", "done", "failed", "cancelled"]));
  const cards = day.workerCards.filter(card => card.member.ordinal > SAMPLE_WORKER_ORDINAL_FLOOR);
  expect(new Set(cards.map(card => card.state))).toEqual(new Set(["running", "idle", "waiting", "starting", "failed"]));
  expect(cards.some(card => card.directive === "stop")).toBe(true);
  expect(new Set(cards.flatMap(card => card.browsers.map(browser => browser.signIn)))).toEqual(new Set(["signed-in", "needs-duo", "signing-in", "unknown"]));
  expect(cards.some(card => card.lastBrowsers?.length)).toBe(true);
  const claimed = live.filter(row => row.lifecycle.state === "running");
  for (const run of claimed) {
    const card = cards.find(entry => "workerId" in run.lifecycle && entry.workerId === run.lifecycle.workerId);
    expect(card?.currentRun).toEqual({ state: "present", runId: run.envelope.runId, traceId: run.envelope.traceId });
  }

  const envelope = (source: string) => ({ commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source });
  const [running] = claimed;
  for (const sample of [running, ...live.filter(row => row.lifecycle.state !== "running")]) {
    for (const type of ["pause", "cancel", "resume", "retry"] as const) {
      const command = { ...envelope("queue-row"), family: "run", type, target: { runId: sample.envelope.runId, expectedVersion: sample.version } };
      expect(await client.executeCommand(command)).toEqual({ state: "rejected", commandId: command.commandId, code: "SAMPLE_RUN_REFUSED", message: "Sample run: nothing runs." });
    }
    expect(await client.rerunValues({ runId: sample.envelope.runId, expectedVersion: sample.version })).toEqual({ state: "refused", code: "sample-run" });
  }

  const card = cards.find(entry => entry.state === "running");
  assert.ok(card?.controls?.basis.state === "present");
  const control = (type: "stop-worker" | "remove-worker", lifetimeId: string | null) => ({ ...envelope("sessions"), family: "worker-browser", type,
    target: { workerId: card.workerId, workflowId: card.workflowId, lifetimeId, expectedVersion: 1 } });
  expect((await client.executeCommand(control("stop-worker", card.controls.basis.value.lifetimeId))).state).toBe("applied");
  const stopped = (await client.dashboardDay(today)).workerCards.find(entry => entry.workerId === card.workerId);
  expect(stopped).toMatchObject({ state: "failed", stopReason: "operator" });
  assert.ok(stopped?.controls?.basis.state === "present");
  expect((await client.executeCommand(control("remove-worker", stopped.controls.basis.value.lifetimeId))).state).toBe("applied");
  expect((await client.dashboardDay(today)).workerCards.some(entry => entry.workerId === card.workerId)).toBe(false);
  expect((await client.runDetail(running.envelope.runId)).runId).toBe(running.envelope.runId);
}
