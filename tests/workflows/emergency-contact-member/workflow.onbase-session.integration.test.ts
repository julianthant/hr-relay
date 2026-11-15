import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "vitest";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { BrowserProfileAdmissionSchema, PlaywrightWorkerSessionFactory } from "../../../src/backend/runtime/browser/browser-session-factory.js";
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

describe("Emergency Contact member OnBase filing and the exclusive OnBase session", () => {
  it("member workers share the exclusive OnBase session: a second worker's filing waits and opens once the first worker parks for member work", async () => {
    // Each lease poll advances the shared clock, so a never-released lease reaches the acquisition deadline quickly.
    const clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
    const scheduler = { schedule: (_deadline: number, callback: () => void) => { const timer = setTimeout(() => { clock.advanceMonotonic(200); callback(); }, 1); return { cancel: () => clearTimeout(timer) }; } };
    const f = createBrowserSessionFactoryFixtures(clock, "11111111-1111-4111-8111-111111111111", scheduler);
    const fingerprint = FingerprintSchema.parse("1".repeat(64));
    await f.withTempRuntime(async ({ config, root }) => {
      const { database, repository } = exclusiveLeaseFixture();
      const managers: WorkerSessionManager[] = [];
      try {
        const bindings: BrowserSystemBindings = { onbase: { system: "onbase", exclusive: true, createDriver: () => ({ system: "onbase" }),
          login: async () => "logged-in", verifyAuthenticated: async context => {
            const probe = await f.verifierFor().verify(context);
            return probe.authenticated ? { ...probe, evidence: { ...probe.evidence, system: "onbase" } } : probe;
          } } };
        const worker = async (ordinal: number, sessionId: string, harness: ReturnType<typeof f.fakeLauncher>) => {
          const factory = new PlaywrightWorkerSessionFactory({ ...mockBrowserRootPort(), config: { ...config, paths: { ...config.paths, browserProfileRoot: join(root, "profiles") } },
            browserOwner: { profileId: "22222222-2222-4222-8222-222222222222", database: { authority: { exclusiveSessionLeases: repository } } as AuthorityDatabase },
            protectedSecrets: protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-value" }), clock, scheduler, isolation: rebuildRuntimeIsolation,
            assertCurrent() {}, slotOrdinal: () => ordinal, newSessionId: () => sessionId, bindings, launcher: harness.launcher,
            admitProfile: async identity => BrowserProfileAdmissionSchema.parse({ ...identity, profileRevision: 1, resetRequired: false }) });
          const manager = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(`onbase-worker-${String(ordinal)}`), workflowId: onbase, stores: taskStoreRegistry, factory, clock, scheduler: new ManualScheduler(clock),
            acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS, duoCeremony: await fixtureDuoCeremonyGates(clock), browserScreenshotCapture: { capture: async () => undefined } });
          managers.push(manager);
          manager.bindRunConfigFingerprint(fingerprint, undefined, { runId: `00000000-0000-4000-8000-00000000009${String(ordinal)}`, descriptorFingerprint: fingerprint });
          return manager;
        };
        const launcher1 = f.fakeLauncher(), launcher2 = f.fakeLauncher();
        const first = await worker(1, "11111111-1111-4111-8111-111111111111", launcher1);
        const second = await worker(2, "33333333-3333-4333-8333-333333333333", launcher2);
        await first.withDriver(need, "prod", new AbortController().signal, async driver => { assert.equal(driver.system, "onbase"); });
        assert.equal(launcher1.launches().length, 1);

        const filing = second.withDriver(need, "prod", new AbortController().signal, async driver => { assert.equal(driver.system, "onbase"); });
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(launcher2.launches().length, 0, "the second filing waits for the lease instead of failing or launching");

        first.releaseRunConfigFingerprint();
        await first.parkForExecution(member, taskStoreRegistry);
        assert.equal(database.prepare("SELECT released_at FROM exclusive_session_leases").get()?.released_at !== null, true);

        await filing;
        assert.equal(launcher2.launches().length, 1);
      } finally {
        for (const manager of managers) { try { manager.releaseRunConfigFingerprint(); } catch { /* already released */ } await manager.closeAll("worker-stop").catch(() => undefined); }
        database.close();
      }
    });
  });
});
