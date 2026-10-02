/**
 * D222: the backup-health watch — the first wired producer of ref dashboard-surfaces §2.6's
 * `storage` trigger.
 *
 * The load-bearing arms are the two publishing rules: a TRANSITION into (or
 * between) `stale`/`missing` publishes exactly once, a standing state on the
 * next tick publishes nothing (the fold marks a row unread again, so a
 * per-tick publish would make the inbox unreadable-forever — the spam §2.6
 * forbids); and a publish that THROWS advances nothing, so the next
 * observation retries the same transition instead of treating the alert as
 * sent. The durable rows themselves go through the REAL inbox over a real
 * authority database, because the dedupe fold is half the contract.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { createNotificationInbox, type NotificationInbox } from "../../../../../../src/backend/runs/notifications/inbox.js";
import {
  backupHealthDiagnosticFingerprint,
  createBackupHealthNotifier,
} from "../../../../../../src/backend/runs/notifications/storage-health.js";
import { NOW } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function world(): { inbox: NotificationInbox } {
  const clock = manualClock(new Date(NOW));
  const root = mkdtempSync(join(tmpdir(), "hrauto-storage-health-"));
  disposers.push(() => rmSync(root, { recursive: true, force: true }));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "storage-health-test" },
    clock,
  );
  disposers.push(() => database.close());
  const inbox = createNotificationInbox({
    authority: database,
    clock,
    ids: sequentialIdFactory("d"),
    actorId: LOCAL_OPERATOR_ACTOR_ID,
  });
  return { inbox };
}

describe("backup-health notifier (D222)", () => {
  it("publishes nothing while the backup reads current", async () => {
    const { inbox } = world();
    const notifier = createBackupHealthNotifier({ inbox });
    const report = await notifier.observed("current");
    assert.deepEqual(report, { published: false, state: "current" });
    assert.equal(inbox.list(LOCAL_OPERATOR_ACTOR_ID).length, 0);
  });

  it("a transition to stale publishes ONE durable storage ping; the standing state stays silent", async () => {
    const { inbox } = world();
    const notifier = createBackupHealthNotifier({ inbox });
    await notifier.observed("current");

    const first = await notifier.observed("stale");
    assert.equal(first.published, true);
    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.ok(row !== undefined);
    assert.equal(row.trigger, "storage");
    assert.equal(row.channel, "ping");
    assert.equal(row.title, "Storage degraded — backup");
    assert.deepEqual(row.links, [
      { kind: "storage", diagnosticFingerprint: backupHealthDiagnosticFingerprint("stale") },
    ]);

    // The next tick observes the SAME standing state: no publish, no fold, no
    // version bump — the row the operator may already have read stays read.
    const second = await notifier.observed("stale");
    assert.deepEqual(second, { published: false, state: "stale" });
    const unchanged = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(unchanged.length, 1);
    assert.equal(unchanged[0]?.count, 1);
    assert.equal(unchanged[0]?.version, 1);
  });

  it("retains distinct legacy health identities without treating a source replay as a new occurrence", async () => {
    const { inbox } = world();
    const notifier = createBackupHealthNotifier({ inbox });
    await notifier.observed("stale");
    await notifier.observed("missing");

    const rows = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(rows.length, 2);
    assert.ok(rows.some((row) => row.title === "Storage failed — backup"));

    // This retired producer has no durable occurrence identity. Replaying its
    // same event cannot invent a new occurrence under the publication contract.
    // The production health observer proves distinct episodes separately.
    await notifier.observed("current");
    await notifier.observed("stale");
    const after = inbox.list(LOCAL_OPERATOR_ACTOR_ID);
    assert.equal(after.length, 2);
    const staleRow = after.find((row) => row.title === "Storage degraded — backup");
    assert.equal(staleRow?.count, 1);
    assert.deepEqual(staleRow, rows.find((row) => row.title === "Storage degraded — backup"));
  });

  it("a failed publish forgets nothing: the same transition retries on the next observation", async () => {
    const published: unknown[] = [];
    let failures = 1;
    const { inbox } = world();
    const flaky: Pick<NotificationInbox, "publish"> = {
      publish: async (event: unknown) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("authority is briefly unavailable");
        }
        published.push(event);
        return inbox.publish(event);
      },
    };
    const notifier = createBackupHealthNotifier({ inbox: flaky });
    await assert.rejects(() => notifier.observed("stale"), /briefly unavailable/);
    assert.equal(published.length, 0);

    const retried = await notifier.observed("stale");
    assert.equal(retried.published, true);
    assert.equal(published.length, 1);
    assert.equal(inbox.list(LOCAL_OPERATOR_ACTOR_ID).length, 1);
  });

  it("refuses a reading outside the closed summary enum", async () => {
    const { inbox } = world();
    const notifier = createBackupHealthNotifier({ inbox });
    await assert.rejects(() => notifier.observed("corrupt"));
  });
});
