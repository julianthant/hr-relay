/**
 * 2i-B: the notification lifecycle arms and the day-wire mapping.
 *
 * Read/unread and snooze are INDEPENDENT axes (D138): marking read preserves
 * the snooze, snoozing preserves the read state, and a snoozed row reads as
 * `snoozed` on the wire only while the snooze is in force — an expired
 * snooze reads as its underlying status again. Every arm CASes on the row
 * version and belongs to exactly one actor.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createCommandKernel, type CommandKernel } from "../../src/core/command-kernel.js";
import { manualClock } from "../../src/domain/clock.js";
import { notificationWireOf } from "../../src/domain/dashboard/projection.js";
import { NotificationRecordSchema } from "../../src/domain/notifications.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { HASH_A, LATER, NOW, UUID_2, UUID_7 } from "./fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

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

function harness(): { database: AuthorityDatabase; kernel: CommandKernel } {
  const clock = manualClock(new Date(LATER));
  const root = mkdtempSync(join(tmpdir(), "hrauto-inbox-"));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "inbox-test" },
    clock,
  );
  disposers.push(() => database.close());
  const kernel = createCommandKernel({
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: {
      withAuthorityTransaction: (work) => database.withAuthorityTransaction(
        (repositories) => work(repositories),
      ),
    },
    clock,
    ids: sequentialIdFactory("c"),
    descriptors: { resolve: () => undefined },
    writeResolution: {
      resolvePresent: () => { throw new Error("unused"); },
      resolveAbsent: () => { throw new Error("unused"); },
    },
    workerRuntime: {
      planWorkerCount: () => { throw new Error("unused"); },
      spawnWorker: () => { throw new Error("unused"); },
      refreshBrowser: () => { throw new Error("unused"); },
      reopenBrowser: () => { throw new Error("unused"); },
    },
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

describe("notification lifecycle arms", () => {
  it("marks read preserving the snooze, and unread preserving it too", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({
      snooze: { state: "snoozed", until: "2026-07-31T18:00:00.000Z" },
    }));

    assert.equal(kernel.execute(command("notification-read", 1)).state, "applied");
    const read = database.authority.notifications.get(UUID_7);
    assert.equal(read?.status, "read");
    assert.deepEqual(read?.snooze, { state: "snoozed", until: "2026-07-31T18:00:00.000Z" });

    assert.equal(kernel.execute(command("notification-unread", 2)).state, "applied");
    assert.equal(database.authority.notifications.get(UUID_7)?.status, "unread");
  });

  it("snoozes preserving the read state, and refuses a snooze that ends in the past", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record({ status: "read", version: 1 }));

    const snoozed = kernel.execute(command("notification-snooze", 1, {
      payload: { until: "2026-07-31T19:00:00.000Z" },
    }));
    assert.equal(snoozed.state, "applied");
    const row = database.authority.notifications.get(UUID_7);
    assert.equal(row?.status, "read");
    assert.deepEqual(row?.snooze, { state: "snoozed", until: "2026-07-31T19:00:00.000Z" });

    const past = kernel.execute(command("notification-snooze", 2, {
      payload: { until: NOW },
    }));
    assert.equal(past.state, "rejected");
  });

  it("rejects a stale version and a foreign actor", () => {
    const { database, kernel } = harness();
    database.authority.notifications.create(record());

    const stale = kernel.execute(command("notification-read", 7));
    assert.equal(stale.state, "rejected");
    if (stale.state === "rejected") assert.match(stale.message, /reload the inbox/u);

    const foreign = kernel.execute({
      ...command("notification-read", 1),
      target: { notificationId: UUID_7, actorId: "other-operator", expectedVersion: 1 },
    });
    assert.equal(foreign.state, "rejected");
    if (foreign.state === "rejected") assert.match(foreign.message, /belongs to/u);
  });
});

describe("notificationWireOf", () => {
  const nowMs = Date.parse(LATER);

  it("maps severity by trigger and state by status", () => {
    const wire = notificationWireOf(record(), nowMs);
    assert.equal(wire.severity, "error");
    assert.equal(wire.state, "unread");
    assert.equal(wire.revision, 1);
    assert.equal(notificationWireOf(record({ trigger: "gate-waiting" }), nowMs).severity, "warning");
    assert.equal(
      notificationWireOf(record({ trigger: "verified-done", channel: "inbox" }), nowMs).severity,
      "info",
    );
  });

  it("reads snoozed only while the snooze is in force", () => {
    const active = notificationWireOf(record({
      snooze: { state: "snoozed", until: "2026-07-31T19:00:00.000Z" },
    }), nowMs);
    assert.equal(active.state, "snoozed");
    const expired = notificationWireOf(record({
      status: "read",
      snooze: { state: "snoozed", until: "2026-07-31T17:00:30.000Z" },
      updatedAt: "2026-07-31T17:00:29.000Z",
    }), nowMs);
    assert.equal(expired.state, "read");
  });
});
