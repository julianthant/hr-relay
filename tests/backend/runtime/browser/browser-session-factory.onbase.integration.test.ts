import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { PlaywrightWorkerSessionFactory, BrowserProfileAdmissionSchema, OnbaseSessionHeldError } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
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

describe("OnBase exclusive browser lifetime", () => {
  it("does not launch a second identity session until the first has proved closed and released", async () => {
    await f.withTempRuntime(async ({ config }) => {
      const { database, repository } = exclusiveLeaseFixture();
      try {
        const bindings: BrowserSystemBindings = { onbase: { system: "onbase", createDriver: () => ({ system: "onbase" }),
          login: async () => "logged-in", verifyAuthenticated: f.verifierFor().verify } };
        const factory = (ordinal: number, sessionId: string, harness: ReturnType<typeof f.fakeLauncher>) => new PlaywrightWorkerSessionFactory({
          ...mockBrowserRootPort(), browserOwner: { profileId: "22222222-2222-4222-8222-222222222222", database: { authority: { exclusiveSessionLeases: repository } } as AuthorityDatabase },
          config, protectedSecrets: protectedSecretSource({ ucpathUserId: ordinal === 1 ? "Fixture-User" : "fixture-user", ucpathPassword: "fixture-value" }),
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
    await f.withTempRuntime(async ({ config }) => {
      const { database, repository } = exclusiveLeaseFixture();
      try {
        const factory = new PlaywrightWorkerSessionFactory({ ...mockBrowserRootPort(), config,
          browserOwner: { profileId: "22222222-2222-4222-8222-222222222222", database: { authority: { exclusiveSessionLeases: repository } } as AuthorityDatabase },
          clock, scheduler, isolation: rebuildRuntimeIsolation, protectedSecrets: protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-value" }),
          newSessionId: () => "11111111-1111-4111-8111-111111111111", assertCurrent() {}, slotOrdinal: () => 1,
          admitProfile: async identity => BrowserProfileAdmissionSchema.parse({ ...identity, profileRevision: 1, resetRequired: false }),
          bindings: { onbase: { system: "onbase", createDriver: () => ({ system: "onbase" }), login: async () => "logged-in", verifyAuthenticated: f.verifierFor().verify } },
          launcher: { launch: async () => { throw new Error("launch acknowledgement lost"); } },
        });
        await assert.rejects(factory.open(input), /closure is unproved/u);
        const row = database.prepare("SELECT released_at FROM exclusive_session_leases").get(); assert.ok(row); assert.equal(row.released_at, null);
      } finally { database.close(); }
    });
  });
});
