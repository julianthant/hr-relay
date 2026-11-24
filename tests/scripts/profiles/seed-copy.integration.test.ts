import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { READABLE_WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { queryActivitySummaries } from "../../../src/backend/runs/queries/activity-summaries.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { importIsolatedProfileData } from "../../../src/backend/storage/maintenance/isolated-library-import.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { runtimeProfiles } from "../../../src/models/config/define-runtime-isolation.js";
import { NotificationTriggerSchema } from "../../../src/models/notifications/notifications.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT, NOTIFICATION } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { runRecordOf } from "../../support/helpers/backend/dashboard-harness.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { boundProfileCredentials } from "../../support/helpers/synthetic-database-admission.js";
import { createBackupFixtures } from "../../support/helpers/storage/backup-fixtures.js";

const entry = fileURLToPath(new URL("../../../scripts/profiles/seed-copy.ts", import.meta.url));
const cleanups: (() => void | Promise<void>)[] = [];
const clock = manualClock(new Date("2026-11-24T20:00:00.000Z"));
const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, clock);
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

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
    run(profile: string) {
      const env = { ...process.env, HOME: home, USERPROFILE: home, LOCALAPPDATA: home };
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

  const first = run("development");
  expect(first.error).toBeUndefined();
  expect(first.status, first.stderr).toBe(0);
  expect(readFileSync(copy.path)).toEqual(localBefore);
  const seeded = await readHistory();
  for (const { workflows, days } of seeded.analytics) {
    expect(workflows).toHaveLength(READABLE_WORKFLOW_MODULES.length);
    expect(days.every(day => day.runs > 0)).toBe(true);
    for (const workflow of workflows) {
      expect(Object.values(workflow.outcomes).every(count => count > 0)).toBe(true);
      expect(workflow.typicalTime.meanMs.state).toBe("present");
      expect(workflow.failedAt.some(step => step.state === "known")).toBe(true);
    }
  }
  expect(seeded.analytics.map(report => report.days.length)).toEqual([7, 30, 90]);
  expect(seeded.generated.every(row => row.displayName?.startsWith("Synthetic ") === true && row.envelope.dryRun)).toBe(true);
  for (const { descriptor } of READABLE_WORKFLOW_MODULES) {
    const runs = seeded.generated.filter(row => row.envelope.workflow === descriptor.id);
    expect(runs, descriptor.id).toEqual(expect.arrayContaining([
      expect.objectContaining({ lifecycle: expect.objectContaining({ state: "terminal", outcome: "done" }) }),
      expect.objectContaining({ lifecycle: expect.objectContaining({ state: "terminal", outcome: "failed" }) }),
      expect.objectContaining({ lifecycle: expect.objectContaining({ state: "parked-gate" }) }),
      expect.objectContaining({ pause: expect.objectContaining({ state: "paused" }) }),
      expect.objectContaining({ lifecycle: expect.objectContaining({ state: "terminal", outcome: "cancelled" }) }),
      expect.objectContaining({ lifecycle: expect.objectContaining({ state: "terminal", outcome: "interrupted" }) }),
    ]));
  }
  expect(new Set(seeded.notices.map(row => row.trigger))).toEqual(new Set(NotificationTriggerSchema.options));
  expect(seeded.notices.some(row => row.count > 1)).toBe(true);

  const second = run("development");
  expect(second.error).toBeUndefined();
  expect(second.status, second.stderr).toBe(0);
  assert.deepEqual(await readHistory(), seeded);
  expect(readFileSync(copy.path)).toEqual(localBefore);
});
