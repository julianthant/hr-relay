import type { BoundProfileStorageFixture } from "../admission-fixture.js";
import { seedSyntheticRuntimeConfig } from "../../fixtures/operator-command-fixtures.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../admission-fixture.js";
import assert from "node:assert/strict";

import { createCommandKernel, type CommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";

import { NotificationRecordSchema } from "../../../../src/models/notifications/notifications.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { HASH_A, LATER, NOW, UUID_2, UUID_7 } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

export function createNotificationInboxTestWorld(profileFixture: () => Promise<BoundProfileStorageFixture> = createBoundProfileFixture) {
  const disposers: (() => void | Promise<void>)[] = [];
  const _afterEachFixture0 = async () => {
    const failures: unknown[] = [];
    for (const dispose of disposers.splice(0)) { try { await dispose(); } catch (error) { failures.push(error); } }
    if (failures.length > 0) throw new AggregateError(failures, "notification fixture cleanup failed");
  };

  const ACTOR = "local-operator";

  function record(overrides: Record<string, unknown> = {}) {
    return NotificationRecordSchema.parse({
      notificationId: UUID_7,
      actorId: ACTOR,
      dedupeFingerprint: HASH_A,
      trigger: "failed",
      channel: "ping",
      status: "unread",
      snooze: { state: "not-snoozed" },
      title: "Run failed",
      summary: "person-lookup run failed at cross-verify",
      links: [{ kind: "run", runId: UUID_2 }],
      count: 1,
      lastSeenAt: NOW,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    });
  }

  async function harness(mapRepositories: (repositories: AuthorityRepositories) => AuthorityRepositories = repositories => repositories): Promise<{ database: AuthorityDatabase; kernel: CommandKernel }> {
    const clock = manualClock(new Date(LATER));
    const profile = await profileFixture();
    const opened: { database?: AuthorityDatabase } = {};
    disposers.push(async () => { opened.database?.close(); await profile.close(); });
    const database = AuthorityDatabase.open(profile.admission,
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: "inbox-test" }, clock,
      undefined, undefined, undefined, boundProfileCredentials(profile.admission));
    opened.database = database;
    seedSyntheticRuntimeConfig(database);
    const active = database.authority.runtimeConfig.get(); assert.ok(active);
    const kernel = createCommandKernel({
      lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
      appVersion: "0.1.0",
      configIdentity: { configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId },
      intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS,
      authority: {
        withAuthorityTransaction: (work) => database.withAuthorityTransaction(
          (repositories) => work(mapRepositories(repositories)),
        ),
      },
      clock,
      ids: sequentialIdFactory("c"),
      descriptors: { resolve: () => undefined },
      writeResolution: {
        recheck: () => { throw new Error("unused"); },
        resolveAbsent: () => { throw new Error("unused"); },
      },
      workerRuntime: { pool: { planPoolWorkerCount: () => { throw new Error("unexpected worker command"); }, spawnPoolWorker: () => { throw new Error("unexpected worker command"); }, refreshPoolBrowser: () => { throw new Error("unexpected worker command"); }, reopenPoolBrowser: () => { throw new Error("unexpected worker command"); }, stopPoolWorker: () => { throw new Error("unexpected worker command"); }, pausePoolWorker: () => { throw new Error("unexpected worker command"); }, resumePoolWorker: () => { throw new Error("unexpected worker command"); } } },
    });
    return { database, kernel };
  }

  let sequence = 0;
  function command(type: string, expectedVersion: number, extra: Record<string, unknown> = {}) {
    sequence += 1;
    const tail = String(sequence).padStart(4, "0");
    return {
      commandId: `eeeeeeee-${tail}-4000-8000-${tail}00000000`,
      requestedAt: LATER,
      requestedBy: ACTOR,
      source: "notification-bell",
      family: "notification",
      type,
      target: { notificationId: UUID_7, actorId: ACTOR, expectedVersion },
      ...extra,
    };
  }

  return { disposers, _afterEachFixture0, ACTOR, record, harness, command };
}
