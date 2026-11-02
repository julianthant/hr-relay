import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { PlaywrightWorkerSessionFactory, BrowserProfileAdmissionSchema, OnbaseSessionHeldError, type BrowserSessionFactoryOptions } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { exclusiveLeaseFixture } from "../../../support/helpers/exclusive-session-leases.js";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { mockBrowserRootPort } from "../../../support/helpers/browser/browser-roots.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import type { BrowserSystemBindings } from "../../../../src/backend/runtime/browser/system-bindings.js";

const clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
const scheduler = { schedule: (_deadline: number, callback: () => void) => { const timer = setTimeout(callback, 1); return { cancel: () => clearTimeout(timer) }; } };
const f = createBrowserSessionFactoryFixtures(clock, "11111111-1111-4111-8111-111111111111", scheduler);
const input = { workerId: WorkerIdSchema.parse("onbase-worker-1"), workflowId: WorkflowIdSchema.parse("onbase"), system: "onbase", instance: "prod",
  configFingerprint: FingerprintSchema.parse("a".repeat(64)), acceptDownloads: false, exclusive: true, signal: new AbortController().signal,
  duoCeremony: { withCeremony: async () => { throw new Error("fixture does not authenticate"); } } } as const;

function factoryFor({ config, root }: Readonly<{ config: BrowserSessionFactoryOptions["config"]; root: string }>, repository: ReturnType<typeof exclusiveLeaseFixture>["repository"],
  harness: ReturnType<typeof f.fakeLauncher>, options: Partial<BrowserSessionFactoryOptions> = {}) {
  return new PlaywrightWorkerSessionFactory({ ...mockBrowserRootPort(), config: { ...config, paths: { ...config.paths, browserProfileRoot: join(root, "profiles") } },
    browserOwner: { profileId: "22222222-2222-4222-8222-222222222222", database: { authority: { exclusiveSessionLeases: repository } } as AuthorityDatabase },
    clock, scheduler, isolation: rebuildRuntimeIsolation, protectedSecrets: protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-value" }),
    newSessionId: () => "11111111-1111-4111-8111-111111111111", assertCurrent() {}, slotOrdinal: () => 1,
    admitProfile: async identity => BrowserProfileAdmissionSchema.parse({ ...identity, profileRevision: 1, resetRequired: false }),
    bindings: { onbase: { system: "onbase", exclusive: true, createDriver: () => ({ system: "onbase" }), login: async () => "logged-in", verifyAuthenticated: f.verifierFor().verify } },
    launcher: harness.launcher, ...options,
  });
}

describe("OnBase exclusive browser lifetime", () => {
  it("refuses a nonexclusive request before acquiring or launching the registered exclusive binding", async () => {
    await f.withTempRuntime(async ({ config, root }) => {
      const { database, repository } = exclusiveLeaseFixture(), harness = f.fakeLauncher();
      try {
        await assert.rejects(factoryFor({ config, root }, repository, harness).open({ ...input, exclusive: false }), /browser-session-exclusivity-mismatch/u);
        assert.equal(harness.launches().length, 0);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM exclusive_session_leases").get()?.count, 0);
      } finally { database.close(); }
    });
  });

  it("retains the lease after an unproved context close and refuses another identity session", async () => {
    await f.withTempRuntime(async ({ config, root }) => {
      const { database, repository } = exclusiveLeaseFixture();
      try {
        const first = await factoryFor({ config, root }, repository, f.fakeLauncher({ emitCloseEvent: false })).open(input);
        await assert.rejects(first.close({ reason: "worker-stop" }), /closure is unproved/u);
        const held = database.prepare("SELECT released_at FROM exclusive_session_leases").get(); assert.ok(held); assert.equal(held.released_at, null);
        const other = f.fakeLauncher();
        await assert.rejects(factoryFor({ config, root }, repository, other, { slotOrdinal: () => 2,
          newSessionId: () => "33333333-3333-4333-8333-333333333333" }).open({ ...input, workerId: WorkerIdSchema.parse("onbase-worker-2"), acquisitionRemainingMs: () => 0 }), OnbaseSessionHeldError);
        assert.equal(other.launches().length, 0);
      } finally { database.close(); }
    });
  });

  it("cancels a waiting acquisition without launching, releasing or changing its owner's lease", async () => {
    await f.withTempRuntime(async ({ config, root }) => {
      const { database, repository } = exclusiveLeaseFixture();
      try {
        const first = await factoryFor({ config, root }, repository, f.fakeLauncher()).open(input);
        const before = database.prepare("SELECT * FROM exclusive_session_leases").get(), controller = new AbortController(), other = f.fakeLauncher();
        let scheduled!: () => void;
        const timerStarted = new Promise<void>(resolve => { scheduled = resolve; });
        let cancellations = 0;
        const waiting = factoryFor({ config, root }, repository, other, { slotOrdinal: () => 2, scheduler: { schedule: () => {
          scheduled(); return { cancel: () => { cancellations++; } };
        } }, newSessionId: () => "33333333-3333-4333-8333-333333333333" }).open({ ...input, workerId: WorkerIdSchema.parse("onbase-worker-2"), signal: controller.signal });
        const rejected = assert.rejects(waiting, /fixture cancellation/u);
        await timerStarted; controller.abort(new Error("fixture cancellation")); await rejected;
        assert.equal(cancellations, 1); assert.equal(other.launches().length, 0);
        assert.deepEqual(database.prepare("SELECT * FROM exclusive_session_leases").get(), before);
        await first.close({ reason: "worker-stop" });
      } finally { database.close(); }
    });
  });

  it("releases after setup fails only when page and context closure are proved", async () => {
    await f.withTempRuntime(async ({ config, root }) => {
      const { database, repository } = exclusiveLeaseFixture(), harness = f.fakeLauncher();
      try {
        const factory = factoryFor({ config, root }, repository, harness, { bindings: { onbase: { system: "onbase", exclusive: true,
          createDriver: () => { throw new Error("fixture driver construction failed"); }, login: async () => "logged-in", verifyAuthenticated: f.verifierFor().verify } } });
        await assert.rejects(factory.open(input), /driver construction failed/u);
        assert.equal(harness.page.closed, true); assert.equal(harness.contextClosed(), true);
        assert.equal(database.prepare("SELECT released_at FROM exclusive_session_leases").get()?.released_at, clock.now().toISOString());
        const replacement = await factoryFor({ config, root }, repository, f.fakeLauncher(), { newSessionId: () => "33333333-3333-4333-8333-333333333333" }).open(input);
        await replacement.close({ reason: "worker-stop" });
      } finally { database.close(); }
    });
  });

  it("releases a lease cancelled immediately after acquisition before any native launch", async () => {
    await f.withTempRuntime(async ({ config, root }) => {
      const { database, repository } = exclusiveLeaseFixture(), controller = new AbortController(), harness = f.fakeLauncher();
      try {
        const cancellingRepository = { ...repository, acquire: (request: Parameters<typeof repository.acquire>[0]) => {
          const result = repository.acquire(request); controller.abort(new Error("cancelled after acquisition")); return result;
        } };
        await assert.rejects(factoryFor({ config, root }, cancellingRepository, harness).open({ ...input, signal: controller.signal }), /cancelled after acquisition/u);
        assert.equal(harness.launches().length, 0);
        assert.equal(database.prepare("SELECT released_at FROM exclusive_session_leases").get()?.released_at, clock.now().toISOString());
      } finally { database.close(); }
    });
  });
  it("does not launch a second identity session until the first has proved closed and released", async () => {
    await f.withTempRuntime(async ({ config, root }) => {
      const { database, repository } = exclusiveLeaseFixture();
      try {
        const bindings: BrowserSystemBindings = { onbase: { system: "onbase", exclusive: true, createDriver: () => ({ system: "onbase" }),
          login: async () => "logged-in", verifyAuthenticated: f.verifierFor().verify } };
        const factory = (ordinal: number, sessionId: string, harness: ReturnType<typeof f.fakeLauncher>) => new PlaywrightWorkerSessionFactory({
          ...mockBrowserRootPort(), browserOwner: { profileId: "22222222-2222-4222-8222-222222222222", database: { authority: { exclusiveSessionLeases: repository } } as AuthorityDatabase },
          config: { ...config, paths: { ...config.paths, browserProfileRoot: join(root, "profiles") } }, protectedSecrets: protectedSecretSource({ ucpathUserId: ordinal === 1 ? "Fixture-User" : "fixture-user", ucpathPassword: "fixture-value" }),
          clock, scheduler, isolation: rebuildRuntimeIsolation, assertCurrent() {}, slotOrdinal: () => ordinal, newSessionId: () => sessionId,
          admitProfile: async identity => BrowserProfileAdmissionSchema.parse({ ...identity, profileRevision: 1, resetRequired: false }), bindings, launcher: harness.launcher,
        });
        const a = f.fakeLauncher(), b = f.fakeLauncher();
        const first = await factory(1, "11111111-1111-4111-8111-111111111111", a).open(input);
        const secondFactory = factory(2, "33333333-3333-4333-8333-333333333333", b);
        await assert.rejects(secondFactory.open({ ...input, workerId: WorkerIdSchema.parse("onbase-worker-2"), acquisitionRemainingMs: () => 0 }), OnbaseSessionHeldError);
        assert.equal(b.launches().length, 0);
        const waiting = secondFactory.open({ ...input, workerId: WorkerIdSchema.parse("onbase-worker-2") });
        assert.equal(b.launches().length, 0);
        const proof = await first.close({ reason: "worker-stop" }); assert.equal(proof.exclusiveLeaseReleased, true);
        assert.deepEqual(await first.close({ reason: "worker-stop" }), proof, "an already proved close cannot release the next owner's lease");
        const second = await waiting; assert.equal(b.launches().length, 1);
        await second.close({ reason: "worker-stop" });
      } finally { database.close(); }
    });
  });

  it("retains the identity lease after uncertain launch and emits no successful release proof", async () => {
    await f.withTempRuntime(async ({ config, root }) => {
      const { database, repository } = exclusiveLeaseFixture();
      try {
        const factory = new PlaywrightWorkerSessionFactory({ ...mockBrowserRootPort(), config: { ...config, paths: { ...config.paths, browserProfileRoot: join(root, "profiles") } },
          browserOwner: { profileId: "22222222-2222-4222-8222-222222222222", database: { authority: { exclusiveSessionLeases: repository } } as AuthorityDatabase },
          clock, scheduler, isolation: rebuildRuntimeIsolation, protectedSecrets: protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-value" }),
          newSessionId: () => "11111111-1111-4111-8111-111111111111", assertCurrent() {}, slotOrdinal: () => 1,
          admitProfile: async identity => BrowserProfileAdmissionSchema.parse({ ...identity, profileRevision: 1, resetRequired: false }),
          bindings: { onbase: { system: "onbase", exclusive: true, createDriver: () => ({ system: "onbase" }), login: async () => "logged-in", verifyAuthenticated: f.verifierFor().verify } },
          launcher: { launch: async () => { throw new Error("launch acknowledgement lost"); } },
        });
        await assert.rejects(factory.open(input), /closure is unproved/u);
        const row = database.prepare("SELECT released_at FROM exclusive_session_leases").get(); assert.ok(row); assert.equal(row.released_at, null);
      } finally { database.close(); }
    });
  });
});
