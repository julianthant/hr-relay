import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "vitest";
import { z } from "zod";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { BrowserProfileAdmissionSchema, OnbaseSessionHeldError, PlaywrightWorkerSessionFactory } from "../../../src/backend/runtime/browser/browser-session-factory.js";
import type { BrowserSystemBindings } from "../../../src/backend/runtime/browser/system-bindings.js";
import type { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { WorkerSessionManager } from "../../../src/backend/runtime/workers/worker-sessions.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { exclusiveLeaseFixture } from "../../support/helpers/exclusive-session-leases.js";
import { createBrowserSessionFactoryFixtures } from "../../support/helpers/browser/session-factory-fixtures.js";
import { mockBrowserRootPort } from "../../support/helpers/browser/browser-roots.js";
import { protectedSecretSource } from "../../support/helpers/protected-secret-source.js";
import { fixtureDuoCeremonyGates } from "../../support/helpers/duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "../../support/helpers/phase1f-executor-harness.js";

const onbase = WorkflowIdSchema.parse("onbase"), member = WorkflowIdSchema.parse("emergency-contact-member");
const need = { system: "onbase", access: "read", session: "reuse-worker", exclusive: true } as const;

const ACTIVE_RUN_STATES = "('claimed', 'validating', 'running')";
const ActiveOwnerSchema = z.strictObject({ workerId: z.string(), runId: z.string() });

// Runs the two-worker scenario; `wait` lets a test drive the clock while the second filing is blocked.
async function withTwoWorkers(body: (w: Readonly<{ clock: ReturnType<typeof manualClock>; scheduler: ManualScheduler; database: ReturnType<typeof exclusiveLeaseFixture>["database"];
  first: WorkerSessionManager; second: WorkerSessionManager; launcher1: ReturnType<ReturnType<typeof createBrowserSessionFactoryFixtures>["fakeLauncher"]>; launcher2: ReturnType<ReturnType<typeof createBrowserSessionFactoryFixtures>["fakeLauncher"]> }>) => Promise<void>): Promise<void> {
  // Each lease poll advances the shared clock, so a never-released lease reaches the acquisition deadline quickly.
  const clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
  const pollScheduler = { schedule: (_deadline: number, callback: () => void) => { const timer = setTimeout(() => { clock.advanceMonotonic(200); callback(); }, 1); return { cancel: () => clearTimeout(timer) }; } };
  const f = createBrowserSessionFactoryFixtures(clock, "11111111-1111-4111-8111-111111111111", pollScheduler);
  const fingerprint = FingerprintSchema.parse("1".repeat(64));
  const sessionScheduler = new ManualScheduler(clock);
  await f.withTempRuntime(async ({ config, root }) => {
    const { database, repository } = exclusiveLeaseFixture();
    database.exec("ALTER TABLE runs ADD COLUMN workflow TEXT; UPDATE runs SET workflow='onbase'");
    const runs: Pick<AuthorityDatabase["authority"]["runs"], "listActiveOwners"> = { listActiveOwners: (workflow: string) => database.prepare(`SELECT owner_worker_id AS workerId, id AS runId FROM runs WHERE workflow = ? AND state IN ${ACTIVE_RUN_STATES}`)
      .all(workflow).map(row => ActiveOwnerSchema.parse(row)) };
    const managers: WorkerSessionManager[] = [];
    try {
      const bindings: BrowserSystemBindings = { onbase: { system: "onbase", exclusive: true, createDriver: () => ({ system: "onbase" }),
        login: async () => "logged-in", verifyAuthenticated: async context => {
          const probe = await f.verifierFor().verify(context);
          return probe.authenticated ? { ...probe, evidence: { ...probe.evidence, system: "onbase" } } : probe;
        } } };
      const worker = async (ordinal: number, sessionId: string, harness: ReturnType<typeof f.fakeLauncher>) => {
        const factory = new PlaywrightWorkerSessionFactory({ ...mockBrowserRootPort(), config: { ...config, paths: { ...config.paths, browserProfileRoot: join(root, "profiles") } },
          browserOwner: { profileId: "22222222-2222-4222-8222-222222222222", database: { authority: { exclusiveSessionLeases: repository, runs } } as AuthorityDatabase },
          protectedSecrets: protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-value" }), clock, scheduler: pollScheduler, isolation: rebuildRuntimeIsolation,
          assertCurrent() {}, slotOrdinal: () => ordinal, newSessionId: () => sessionId, bindings, launcher: harness.launcher,
          admitProfile: async identity => BrowserProfileAdmissionSchema.parse({ ...identity, profileRevision: 1, resetRequired: false }) });
        const manager = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(`onbase-worker-${String(ordinal)}`), workflowId: onbase, stores: taskStoreRegistry, factory, clock, scheduler: sessionScheduler,
          acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS, duoCeremony: await fixtureDuoCeremonyGates(clock), browserScreenshotCapture: { capture: async () => undefined } });
        managers.push(manager);
        manager.bindRunConfigFingerprint(fingerprint, undefined, { runId: `00000000-0000-4000-8000-00000000009${String(ordinal)}`, descriptorFingerprint: fingerprint });
        return manager;
      };
      const launcher1 = f.fakeLauncher(), launcher2 = f.fakeLauncher();
      const first = await worker(1, "11111111-1111-4111-8111-111111111111", launcher1);
      const second = await worker(2, "33333333-3333-4333-8333-333333333333", launcher2);
      await body({ clock, scheduler: sessionScheduler, database, first, second, launcher1, launcher2 });
    } finally {
      for (const manager of managers) { try { manager.releaseRunConfigFingerprint(); } catch { /* already released */ } await manager.closeAll("worker-stop").catch(() => undefined); }
      database.close();
    }
  });
}

const file = (manager: WorkerSessionManager) => manager.withDriver(need, "prod", new AbortController().signal, async driver => { assert.equal(driver.system, "onbase"); });
// Fires session-acquisition expiry timers that are due, as a real scheduler would.
const fireDue = (scheduler: ManualScheduler, clock: ReturnType<typeof manualClock>) => { for (const entry of scheduler.pending()) if (entry.deadlineMonotonicMs <= clock.monotonicMs()) entry.fire(); };

describe("Emergency Contact member OnBase filing and the exclusive OnBase session", () => {
  it("member workers share the exclusive OnBase session: a second worker's filing waits and opens once the first worker parks for member work", async () => {
    await withTwoWorkers(async ({ database, first, second, launcher1, launcher2 }) => {
      await file(first);
      assert.equal(launcher1.launches().length, 1);

      const filing = file(second);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(launcher2.launches().length, 0, "the second filing waits for the lease instead of failing or launching");

      first.releaseRunConfigFingerprint();
      await first.parkForExecution(member, taskStoreRegistry);
      assert.equal(database.prepare("SELECT released_at FROM exclusive_session_leases").get()?.released_at !== null, true);

      await filing;
      assert.equal(launcher2.launches().length, 1);
    });
  });

  it("a filing waits past sessionAcquireMs while another worker is still filing", async () => {
    await withTwoWorkers(async ({ clock, scheduler, database, first, second, launcher2 }) => {
      await file(first);
      const filing = file(second);
      let done = false, outcome: unknown;
      void filing.then(() => "opened", (error: unknown) => error).then(result => { outcome = result; done = true; });
      const started = clock.monotonicMs();
      while (!done && clock.monotonicMs() - started < 2 * FIXTURE_SESSION_ACQUIRE_MS) { await new Promise(resolve => setTimeout(resolve, 1)); fireDue(scheduler, clock); }
      assert.equal(done, false, `the waiting filing must not settle while the holder is actively running onbase: ${String(outcome)}`);
      assert.equal(launcher2.launches().length, 0);

      database.exec("UPDATE runs SET state='completed' WHERE id='run-1'");
      first.releaseRunConfigFingerprint();
      await first.parkForExecution(member, taskStoreRegistry);
      await filing;
      assert.equal(launcher2.launches().length, 1);
    });
  }, 60_000);

  it("a filing still fails with OnbaseSessionHeldError at the deadline when the holder has no active run", async () => {
    await withTwoWorkers(async ({ clock, scheduler, database, first, second, launcher2 }) => {
      await file(first);
      database.exec("UPDATE runs SET state='completed' WHERE id='run-1'");
      const filing = file(second);
      const settled = filing.then(() => undefined, (error: unknown) => error);
      const started = clock.monotonicMs();
      while (clock.monotonicMs() - started < 3 * FIXTURE_SESSION_ACQUIRE_MS) {
        if (await Promise.race([settled.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5))])) break;
        fireDue(scheduler, clock);
      }
      assert.ok(await settled instanceof OnbaseSessionHeldError);
      assert.equal(launcher2.launches().length, 0);
    });
  });
});
