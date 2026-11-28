import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../src/backend/app/composition/dashboard/compose.js";
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
import { CommandExecutor } from "../../../src/dashboard/app/commands/command-executor.js";
import { createDashboardClient, createRowStore } from "../../../src/dashboard/client/index.js";
import { RunStateChips } from "../../../src/dashboard/surfaces/run-detail/run-state-chips.js";
import { projectRunLogs, readRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { NEEDS_DUO_LABEL, isNeedsDuo, isStarting, queueBatches } from "../../../src/dashboard/surfaces/queue/queue-model.js";
import { launchWorkflows } from "../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { createSessionPreviewPort } from "../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { sessionWorkerAuthorityKey, sessionsFromDay } from "../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import { parseWorkflows } from "../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { descriptorRuntimeNodes, workflowProjections } from "../../../src/workflow-kit/workflow.js";
import workflowSources from "../../../config/dashboard-workflow-sources.json" with { type: "json" };
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
const servedModules = WORKFLOW_MODULES.filter(({ descriptor }) => (workflowSources as Record<string, string>)[descriptor.id] === "served");
const hasBrowsers = (workflowId: string) => WORKFLOW_MODULES.some(({ descriptor }) => descriptor.id === workflowId && workflowProjections(descriptor).systems.length > 0);
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
  const preflight = vi.fn(healthyRuntimePreflightRunners);
  const dashboard = await composeDashboardRuntime({ lifetimeLock: lock, admission: machine, profile: { runtime, token: active.token },
    repoRoot: workspace, clock, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {},
    preflightRunnerFactory: preflight, workerProcess: { spawn } });
  cleanups.push(() => dashboard.stop());
  return { client: createDashboardClient({ baseUrl: `http://127.0.0.1:${String(dashboard.port)}` }), outbound, spawn, preflight };
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
          const timelines = generated.map(row => history.authority.timelineEvents.page({ runId: row.envelope.runId, limit: 200 }));
          return { generated, notices, analytics, timelines };
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

  const { client, outbound, spawn, preflight } = await openSeededDashboard(workspace);
  const days = new Set([imported, ...seeded.generated].map(row => searchPartitionDay(new Date(row.envelope.enqueuedAt))));
  expect(days.size).toBe(90);
  const rows = new Map<string, Awaited<ReturnType<typeof client.dashboardDay>>["queueSurfaces"][number]>();
  for (const day of days) for (const row of (await client.dashboardDay(day)).queueSurfaces) rows.set(row.runId, row);
  const notificationIds = (await client.notificationSnapshot()).map(row => row.notificationId);
  expect(notificationIds).toEqual(expect.arrayContaining([importedNotice, ...seeded.notices].map(row => row.notificationId)));
  await expectTimelines(client, seeded.generated, rows);
  await expectLiveSamples(client, seeded.generated, preflight);
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
  expect(seeded.generated.every(row => row.displayName?.startsWith("Synthetic ") === true && row.envelope.dryRun === (row.lifecycle.state !== "parked-write"))).toBe(true);
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
  expect(JSON.parse(first.stdout)).toMatchObject({ todayByState: { queued: servedModules.length, running: servedModules.length,
    "needs-duo": servedModules.filter(({ descriptor }) => hasBrowsers(descriptor.id)).length } });
});

/** The header status each seeded state must draw. */
const HEADER_STATUS: Record<string, string> = { queued: "Queued", running: "Running", cancelling: "Cancelling", "needs-duo": NEEDS_DUO_LABEL,
  paused: "Paused", waiting: "Review", succeeded: "Done", failed: "Failed", cancelled: "Cancelled", "needs-review": "Write parked" };

/** Every generated run reads as a real one: its recorded setup leads its Logs in order, its state card follows, and the header says its state. */
async function expectTimelines(client: ReturnType<typeof createDashboardClient>, generated: readonly RunRecord[],
  rows: ReadonlyMap<string, Awaited<ReturnType<typeof client.dashboardDay>>["queueSurfaces"][number]>) {
  for (const run of generated) {
    const row = rows.get(run.envelope.runId), name = run.displayName ?? "";
    assert.ok(row !== undefined, name);
    const state = name.split(" ").at(-1) ?? "";
    expect(renderToStaticMarkup(createElement(RunStateChips, { row })).replace(/<[^>]*>/gu, " "), name).toContain(HEADER_STATUS[state]);
    expect(isStarting(row), name).toBe(false);
    expect(isNeedsDuo(row), name).toBe(state === "needs-duo");
    if (run.claimGeneration === 0) {
      expect(state, name).toBe("queued");
      expect((await client.runDetail(run.envelope.runId)).runId).toBe(run.envelope.runId);
      continue;
    }
    const logs = await readRunLogs(client, { row, workflowLabel: row.workflowId }, new AbortController().signal);
    expect(logs.detail.runId).toBe(run.envelope.runId);
    const { steps } = projectRunLogs(logs, client);
    expect(steps.map(step => step.time), name).not.toContain("—");
    const descriptor = WORKFLOW_MODULES.find(module => module.descriptor.id === run.envelope.workflow)?.descriptor;
    assert.ok(descriptor !== undefined, name);
    const noted = steps.flatMap((step, index) => descriptor.timeline.some(group => group.label === step.title) ? [{ index, title: step.title }] : []);
    expect(steps.map(step => step.title), name).not.toContain("Run note");
    // Every started step has a row under its descriptor title, in descriptor order.
    const spanless = new Set<string>(descriptorRuntimeNodes(descriptor).filter(node => node.kind === "gate" || node.kind === "child-run").map(node => node.id));
    const order = descriptor.timeline.filter(group => group.nodes.some(node => !spanless.has(node.id)));
    const positions = noted.map(note => order.findIndex(group => group.label === note.title));
    expect(noted.length, name).toBeGreaterThan(0);
    expect(positions.every(position => position >= 0), name).toBe(true);
    expect([...positions].sort((left, right) => left - right), name).toEqual(positions);
    if (state === "succeeded") expect(new Set(noted.map(note => note.title)).size, name).toBe(order.length);
    // Each recorded step is its own row with its title, state and time, even when several share one group.
    const stepRows = steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "note" && / · (Done|Running)$/u.test(entry.message) ? [entry] : []));
    expect(stepRows.every(row => row.time !== "—"), name).toBe(true);
    if (state === "succeeded") expect(stepRows.length, name).toBe(descriptor.timeline.flatMap(group => group.nodes).filter(node => !spanless.has(node.id)).length);
    if (state === "needs-duo") expect(noted.map(note => note.title), name).toEqual([order[0]?.label]);
    const cards = steps.flatMap((step, index) => step.entries.some(entry => entry.kind === "decision") || step.title === "Run cancelled" ? [{ index, title: step.title }] : []);
    const parkedWrite = run.lifecycle.state === "parked-write";
    const hasGate = descriptorRuntimeNodes(descriptor).some(node => node.kind === "gate" && node.resolvedBy === "operator");
    const expected = ["paused", "cancelled", "needs-review", "failed"].includes(state) ? 1 : 0;
    if (state === "waiting" && hasGate) expect(["note", "decision"], name).toContain(steps.at(-1)?.entries.at(-1)?.kind);
    else expect(cards, name).toHaveLength(expected);
    if (state === "paused") {
      expect(cards[0]?.title, name).toBe("Run paused");
      // The pause is recorded after the last finished step, never at the run's start.
      const clock = (time: string | undefined) => Date.parse(`2000-01-01 ${time ?? ""}`);
      const pauseAt = clock(steps[cards[0]?.index ?? -1]?.time);
      const lastRow = stepRows.at(-1);
      if (lastRow !== undefined) expect(pauseAt, name).toBeGreaterThanOrEqual(clock(lastRow.time));
    }
    if (state === "cancelled") expect(cards[0]?.title, name).toBe("Run cancelled");
    if (parkedWrite) expect(steps[cards[0]?.index ?? -1]?.entries.flatMap(entry => entry.kind === "decision" ? [entry.decision.title] : []).join(), name).toMatch(/termination/iu);
    else if (state === "needs-review") expect(cards[0]?.title, name).toBe("Run not responding");
    for (const card of cards) expect(card.index, name).toBeGreaterThanOrEqual(noted.at(-1)?.index ?? -1);
  }
  expect(generated.filter(run => run.lifecycle.state === "parked-write").map(run => run.envelope.workflow)).toEqual(["separations"]);
}

/** Today's sample queue and Sessions show every live state, and every action on them is refused or stays on the card. */
async function expectLiveSamples(client: ReturnType<typeof createDashboardClient>, generated: readonly RunRecord[], preflight: { mock: { calls: unknown[] } }) {
  const today = searchPartitionDay(clock.now());
  const live = generated.filter(row => row.displayName?.includes(" today ") === true);
  const served = new Set(servedModules.map(({ descriptor }) => descriptor.id));
  expect(live.every(row => served.has(row.envelope.workflow))).toBe(true);
  for (const { descriptor } of servedModules) {
    const runs = live.filter(row => row.envelope.workflow === descriptor.id);
    expect(new Set(runs.map(row => row.lifecycle.state)), descriptor.id)
      .toEqual(new Set(["queued", "running", "parked-gate", "terminal", ...descriptor.id === "separations" ? ["parked-write"] : []]));
    expect(runs.some(row => row.cancelRequested === true), descriptor.id).toBe(true);
    expect(runs.some(row => row.pause?.state === "paused"), descriptor.id).toBe(true);
    expect(runs.every(row => searchPartitionDay(new Date(row.envelope.enqueuedAt)) === today), descriptor.id).toBe(true);
  }
  const day = await client.dashboardDay(today);
  const rows = day.queueSurfaces.filter(row => live.some(run => run.envelope.runId === row.runId));
  expect(rows).toHaveLength(live.length);
  expect(new Set(rows.map(row => row.status))).toEqual(new Set(["queued", "running", "cancelling", "awaiting-approval", "blocked", "done", "failed", "cancelled"]));
  for (const workflowId of served) {
    const statuses = rows.filter(row => row.workflowId === workflowId).map(row => row.status);
    // A browserless workflow has no Duo wait, so it shows exactly one Running row.
    expect(statuses.filter(status => status === "running"), workflowId).toHaveLength(1);
    for (const status of ["queued", "cancelling", "done", "failed", "cancelled"]) expect(statuses, workflowId).toContain(status);
    expect(live.some(row => row.envelope.workflow === workflowId && row.displayName?.endsWith(" needs-duo") === true), workflowId).toBe(hasBrowsers(workflowId));
  }
  const groups = queueBatches(day.queueSurfaces).filter(batch => batch.members.every(member => live.some(run => run.envelope.runId === member.runId)));
  expect(groups.map(batch => [batch.workflowId, batch.status])).toEqual([["person-lookup", "partial"]]);
  const cards = day.workerCards.filter(card => card.sample === true);
  expect(day.workerCards.filter(card => card.workerId.includes("-sample-"))).toEqual(cards);
  expect(cards.every(card => served.has(card.workflowId))).toBe(true);
  assert.ok(day.workerAuthority.state === "present");
  expect(day.workerAuthority.members.filter(member => cards.some(card => card.workerId === member.workerId))).toEqual([]);
  const boot = await client.bootstrap();
  const catalog = buildWorkflowCatalog(launchWorkflows(parseWorkflows(boot.workflows)), undefined, boot.featureAvailability);
  const sessions = sessionsFromDay(day, catalog, clock.now().toISOString());
  assert.ok(sessions.state === "ready", JSON.stringify(sessions));
  expect(sessions.workers.map(worker => worker.id)).toEqual(expect.arrayContaining(cards.map(card => card.workerId)));
  expect(new Set(cards.map(card => card.state))).toEqual(new Set(["running", "idle", "waiting", "starting", "failed"]));
  // A stopping worker reads as a real one does: still running its cancelled step, with the stop pending.
  const stopping = cards.filter(card => card.directive === "stop");
  expect(stopping.length).toBeGreaterThan(0);
  for (const card of stopping) {
    expect(sessions.workers.find(worker => worker.id === card.workerId), card.workerId).toMatchObject({ state: "running", note: "This step is cancelled" });
  }
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
  // The review card's own answers are refused too, before any resolver reads the sample's intent.
  const underReview = live.find(row => row.lifecycle.state === "parked-write");
  assert.ok(underReview?.lifecycle.state === "parked-write");
  for (const type of ["recheck-write", "resolve-write-absent"] as const) {
    const command = { ...envelope("run-detail"), family: "run", type, target: { runId: underReview.envelope.runId, expectedVersion: underReview.version,
      writeIntentId: underReview.lifecycle.writeIntentId, intentGeneration: 1, writeAttemptId: randomUUID(), bindingProofDigest: "a".repeat(64) },
      payload: { occurrenceKeyDigest: "a".repeat(64) } };
    expect(await client.executeCommand(command)).toMatchObject({ state: "rejected", code: "SAMPLE_RUN_REFUSED" });
  }
  const bulk = envelope("queue");
  const targets = live.slice(0, 2).map(sample => ({ runId: sample.envelope.runId, expectedVersion: sample.version }));
  const bulkResult = await client.executeBulkCommand({ ...bulk, bulkCommandId: bulk.commandId, family: "run", type: "resume", mode: "best-effort", targets });
  assert.equal(bulkResult.state, "vector");
  expect(bulkResult.results.map(result => result.outcome === "refused" && result.code)).toEqual(["SAMPLE_RUN_REFUSED", "SAMPLE_RUN_REFUSED"]);
  expect((await client.notificationSnapshot()).some(notice => notice.kind === "command"
    && notice.link.kind === "bulk-result" && notice.link.bulkCommandId === bulk.commandId)).toBe(false);

  const parked = live.find(row => row.lifecycle.state === "parked-gate");
  assert.ok(parked?.lifecycle.state === "parked-gate");
  const answer = { ...envelope("run-detail"), family: "gate", type: "answer-gate-arm",
    target: { runId: parked.envelope.runId, gateId: parked.lifecycle.gateId, expectedVersion: parked.version }, payload: { arm: "approve" } };
  expect(await client.executeCommand(answer)).toEqual({ state: "rejected", commandId: answer.commandId, code: "SAMPLE_RUN_REFUSED", message: "Sample run: nothing runs." });
  const preflights = preflight.mock.calls.length;
  await expect(client.submitStartPlan({ workflowId: running.envelope.workflow, dryRun: true, submissions: [running.input.raw], browserMode: "headless", captureBrowserScreenshots: false,
    rerunSource: { runId: running.envelope.runId, expectedVersion: running.version, intent: "rerun", selectedStepKeys: ["all"] } })).rejects.toMatchObject({ status: 409, code: "SAMPLE_RUN_REFUSED" });
  expect(preflight.mock.calls).toHaveLength(preflights);

  // Stop on a running card and close on an idle one each remove the card from the served Sessions.
  const scope = { actorId: "local-operator", client, authority: {}, dayRequest: {} };
  const executor = new CommandExecutor(() => scope);
  let snapshot = day;
  const port = createSessionPreviewPort(() => ({ catalog, binding: {
    client, executor, scope, day: today, now: () => clock.now().toISOString(),
    dayState: { request: scope.dayRequest, rows: createRowStore(), day: { state: "loaded", value: snapshot },
      connection: { state: "live" }, subscribePublications: () => { throw new Error("fixture publications are not served"); }, refresh() {} },
  } }));
  const removed = [["stop", cards.find(entry => entry.state === "running" && entry.directive === "run")], ["remove", cards.find(entry => entry.state === "idle")]] as const;
  for (const [action, card] of removed) {
    assert.ok(card?.controls?.basis.state === "present", action);
    const result = await port.send({ id: randomUUID(), target: card.workerId, action, authorityKey: sessionWorkerAuthorityKey(card) });
    expect(result.state, action).toBe("confirmed");
    assert.ok(result.data?.state === "ready", JSON.stringify(result));
    expect(result.data.workers.some(worker => worker.id === card.workerId), action).toBe(false);
    snapshot = await client.dashboardDay(today);
    expect(snapshot.workerCards.some(entry => entry.workerId === card.workerId), action).toBe(false);
  }
  expect((await client.runDetail(running.envelope.runId)).runId).toBe(running.envelope.runId);
}
