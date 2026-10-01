import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { DeletedRunRecordSchema } from "../../../src/domain/run/deleted-run.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { captureArchiveReport } from "../../../src/services/archive/report-capture.js";
import { transferArchiveReport } from "../../../src/services/archive/archive-transfer.js";
import { createRunLifecycleStorage } from "../../../src/infra/sqlite/lifecycle-storage.js";
import { createItemAttemptHistoryQuery } from "../../../src/server/dashboard/queries/item-attempt-history.js";
import { sqliteRunReader } from "../../helpers/canonical-run-reader.js";
import { makeWorld, runRecordOf, traceOf, uuidOf } from "../../unit/server/helpers/dashboard-harness.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

describe("same-item attempt history", () => {
  it("keeps attempt one selected while returning a later retry from the same item", () => {
    const world = makeWorld();
    cleanups.push(() => world.dispose());
    const itemId = uuidOf(9890);
    const firstBase = runRecordOf({ seed: 890, attempt: 1, enqueuedAt: "2026-08-03T06:30:00.000Z" });
    const first = RunRecordSchema.parse({ ...firstBase, envelope: { ...firstBase.envelope, itemId } });
    world.database.authority.runs.enqueue(first);
    const secondBase = runRecordOf({ seed: 891, attempt: 2, enqueuedAt: "2026-08-03T07:30:00.000Z" });
    const second = RunRecordSchema.parse({
      ...secondBase,
      envelope: { ...secondBase.envelope, itemId, retryOf: first.envelope.runId },
    });
    world.database.authority.runs.enqueue(second);

    const history = createItemAttemptHistoryQuery({
      database: world.database,
      reader: sqliteRunReader(world.database, world.clock),
    }).read(first.envelope.runId, { limit: 50 });
    assert.equal(history.state, "available");
    if (history.state !== "available") throw new Error("attempt one history unavailable");
    assert.equal(history.selected.state, "present");
    if (history.selected.state !== "present") throw new Error("attempt one selection was not present");
    assert.equal(history.selected.runId, first.envelope.runId);
    const entries = history.page.entries.map((entry) => {
      if (entry.disposition === "deleted") throw new Error("the live fixture unexpectedly returned a deleted entry");
      return { runId: entry.runId, attempt: entry.attempt, partitionDay: entry.partitionDay };
    });
    assert.deepEqual(entries, [
      { runId: first.envelope.runId, attempt: 1, partitionDay: "2026-08-02" },
      { runId: second.envelope.runId, attempt: 2, partitionDay: "2026-08-03" },
    ]);
  });

  it("keeps deleted history associated, orders attempts, and refuses a cursor after authority changes", () => {
    const world = makeWorld();
    cleanups.push(() => world.dispose());
    const database = world.database;
    const reader = sqliteRunReader(database, world.clock);
    const itemId = uuidOf(9900);
    const first = RunRecordSchema.parse({
      ...runRecordOf({ seed: 901, attempt: 1 }),
      envelope: { ...runRecordOf({ seed: 901, attempt: 1 }).envelope, itemId },
    });
    database.authority.runs.enqueue(first);
    const secondBase = runRecordOf({ seed: 902, attempt: 2 });
    const second = RunRecordSchema.parse({
      ...secondBase,
      envelope: { ...secondBase.envelope, itemId, retryOf: first.envelope.runId },
    });
    database.authority.runs.enqueue(second);

    const transition = database.withAuthorityTransaction((repositories) => repositories.runs.transition({
      runId: first.envelope.runId, expectedVersion: first.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: world.clock.now().toISOString() },
      now: world.clock.now().toISOString(),
    }));
    assert.equal(transition.state, "applied");
    if (transition.state !== "applied") throw new Error("fixture run did not terminalize");
    const tombstone = database.withAuthorityTransaction((repositories) => repositories.runs.delete({
      runId: first.envelope.runId, commandId: uuidOf(912), now: world.clock.now().toISOString(), origin: "queue",
    }));
    assert.equal(tombstone.runId, first.envelope.runId);

    const history = createItemAttemptHistoryQuery({ database, reader });
    const firstPage = history.read(second.envelope.runId, { limit: 1 });
    assert.equal(firstPage.state, "available");
    if (firstPage.state !== "available") throw new Error("attempt history unavailable");
    assert.equal(firstPage.selected.state, "present");
    assert.equal(firstPage.selected.disposition, "live");
    assert.deepEqual(firstPage.page.entries.map(({ attempt, disposition }) => ({ attempt, disposition })), [
      { attempt: 1, disposition: "deleted" },
    ]);
    assert.ok(firstPage.page.nextCursor);
    const wrongRun = history.read(first.envelope.runId, { limit: 1, cursor: firstPage.page.nextCursor });
    assert.deepEqual(wrongRun, {
      schemaVersion: 1, state: "refused", selectedRunId: first.envelope.runId,
      reason: "cursor-run-mismatch",
    });

    database.authority.runs.enqueue(runRecordOf({ seed: 903, attempt: 1 }));
    const stale = history.read(second.envelope.runId, { limit: 1, cursor: firstPage.page.nextCursor });
    assert.deepEqual(stale, {
      schemaVersion: 1, state: "stale", selectedRunId: second.envelope.runId,
      reason: "authority-changed",
    });

    const selectedDeleted = history.read(first.envelope.runId, { limit: 10 });
    assert.equal(selectedDeleted.state, "available");
    if (selectedDeleted.state !== "available") throw new Error("deleted run history unavailable");
    assert.equal(selectedDeleted.selected.state, "deleted");
    assert.equal(selectedDeleted.selected.disposition, "deleted");
    assert.deepEqual(selectedDeleted.page.entries.map(({ attempt, disposition }) => ({ attempt, disposition })), [
      { attempt: 1, disposition: "deleted" },
      { attempt: 2, disposition: "live" },
    ]);
  });

  it("refuses to associate a legacy tombstone whose item coordinate is null", () => {
    const world = makeWorld();
    cleanups.push(() => world.dispose());
    const runId = uuidOf(9920);
    const tombstone = DeletedRunRecordSchema.parse({
      runId,
      workflow: "person-lookup",
      traceId: traceOf(9920),
      itemId: null,
      attempt: null,
      origin: "queue",
      commandId: uuidOf(9921),
      deletedAt: world.clock.now().toISOString(),
      removed: [],
    });
    const query = createItemAttemptHistoryQuery({
      database: world.database,
      reader: { read: () => ({ state: "deleted", tombstone }) },
    });
    assert.deepEqual(query.read(runId, { limit: 25 }), {
      schemaVersion: 1,
      state: "unavailable",
      selected: {
        state: "deleted", disposition: "deleted", runId,
        workflowId: "person-lookup", itemId: null, attempt: null,
        deletedAt: tombstone.deletedAt,
      },
      reason: "item-identity-unknown",
    });
  });

  it("serves a verified transferred archive, then follows its exact deleted disposition across generations", () => {
    const world = makeWorld();
    cleanups.push(() => world.dispose());
    const database = world.database;
    const reader = sqliteRunReader(database, world.clock);
    const itemId = uuidOf(9300);
    const archivedBase = runRecordOf({ seed: 301, attempt: 1, enqueuedAt: "2026-08-03T06:30:00.000Z" });
    const archivedRun = RunRecordSchema.parse({
      ...archivedBase, envelope: { ...archivedBase.envelope, itemId },
    });
    database.authority.runs.enqueue(archivedRun);
    const liveBase = runRecordOf({ seed: 302, attempt: 2 });
    const liveRun = RunRecordSchema.parse({
      ...liveBase, envelope: { ...liveBase.envelope, itemId, retryOf: archivedRun.envelope.runId },
    });
    database.authority.runs.enqueue(liveRun);

    const terminal = database.withAuthorityTransaction((repositories) => repositories.runs.transition({
      runId: archivedRun.envelope.runId, expectedVersion: archivedRun.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: world.clock.now().toISOString() },
      now: world.clock.now().toISOString(),
    }));
    assert.equal(terminal.state, "applied");
    if (terminal.state !== "applied") throw new Error("archive candidate did not terminalize");
    const storage = createRunLifecycleStorage(database);
    const report = captureArchiveReport({
      snapshot: storage.capture(archivedRun.envelope.runId),
      transferId: uuidOf(303),
      capturedAt: world.clock.now().toISOString(),
      sections: [],
      files: [],
    });
    const beforeTransfer = database.getMeta().authorityGeneration;
    assert.ok(transferArchiveReport(storage, report, terminal.run.version));
    const afterTransfer = database.getMeta().authorityGeneration;
    assert.ok(afterTransfer > beforeTransfer, "archive transfer must advance main authority generation");

    const history = createItemAttemptHistoryQuery({ database, reader });
    Object.defineProperty(database, "transferredRun", { configurable: true, value: () => undefined });
    assert.throws(
      () => history.read(liveRun.envelope.runId, { limit: 1 }),
      /attempt-history-archive-transfer-missing/u,
    );
    delete (database as unknown as { transferredRun?: unknown }).transferredRun;
    const firstPage = history.read(liveRun.envelope.runId, { limit: 1 });
    assert.equal(firstPage.state, "available");
    if (firstPage.state !== "available") throw new Error("archive history unavailable");
    assert.deepEqual(firstPage.page.entries.map(({ runId, attempt, disposition }) => ({ runId, attempt, disposition })), [
      { runId: archivedRun.envelope.runId, attempt: 1, disposition: "archived" },
    ]);
    const archivedEntry = firstPage.page.entries[0];
    assert.ok(archivedEntry);
    assert.equal(archivedEntry.disposition, "archived");
    if (archivedEntry.disposition === "archived") assert.equal(archivedEntry.partitionDay, "2026-08-02");
    assert.ok(firstPage.page.nextCursor);
    const secondPage = history.read(liveRun.envelope.runId, { limit: 1, cursor: firstPage.page.nextCursor });
    assert.equal(secondPage.state, "available");
    if (secondPage.state !== "available") throw new Error("live sibling history unavailable");
    assert.deepEqual(secondPage.page.entries.map(({ runId, attempt, disposition }) => ({ runId, attempt, disposition })), [
      { runId: liveRun.envelope.runId, attempt: 2, disposition: "live" },
    ]);
    const liveEntry = secondPage.page.entries[0];
    assert.ok(liveEntry);
    assert.equal(liveEntry.disposition, "live");
    if (liveEntry.disposition === "live") assert.equal(liveEntry.partitionDay, "2026-08-03");

    const beforeDeletion = database.getMeta().authorityGeneration;
    const receipt = database.withAuthorityTransaction((repositories) => repositories.runs.delete({
      runId: archivedRun.envelope.runId,
      commandId: uuidOf(304),
      now: world.clock.now().toISOString(),
      origin: "archive",
    }));
    assert.equal(receipt.runId, archivedRun.envelope.runId);
    database.settleArchivedDeletion(archivedRun.envelope.runId);
    const afterDeletion = database.getMeta().authorityGeneration;
    assert.ok(afterDeletion > beforeDeletion, "tombstone deletion must advance main authority generation");
    const stale = history.read(liveRun.envelope.runId, { limit: 1, cursor: firstPage.page.nextCursor });
    assert.deepEqual(stale, {
      schemaVersion: 1, state: "stale", selectedRunId: liveRun.envelope.runId,
      reason: "authority-changed",
    });
    const deletedHistory = history.read(liveRun.envelope.runId, { limit: 10 });
    assert.equal(deletedHistory.state, "available");
    if (deletedHistory.state !== "available") throw new Error("tombstoned history unavailable");
    assert.equal(deletedHistory.page.entries[0]?.disposition, "deleted");
    assert.equal(deletedHistory.page.entries[1]?.disposition, "live");
  });

  it("pages all 500 supported peers and refuses a 501st rather than returning a partial history", () => {
    const pageAll = (count: number) => {
      const world = makeWorld();
      cleanups.push(() => world.dispose());
      const itemId = uuidOf(9400);
      for (let attempt = 1; attempt <= count; attempt += 1) {
        const base = runRecordOf({ seed: attempt, attempt });
        world.database.authority.runs.enqueue(RunRecordSchema.parse({
          ...base, envelope: { ...base.envelope, itemId },
        }));
      }
      const query = createItemAttemptHistoryQuery({
        database: world.database,
        reader: sqliteRunReader(world.database, world.clock),
      });
      const selectedRunId = uuidOf(1);
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const response = query.read(selectedRunId, { limit: 50, ...(cursor === undefined ? {} : { cursor }) });
        assert.equal(response.state, "available");
        if (response.state !== "available") throw new Error("bounded history unavailable");
        seen.push(...response.page.entries.map((entry) => entry.runId));
        cursor = response.page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      assert.equal(seen.length, 500);
      assert.equal(new Set(seen).size, 500);
      assert.deepEqual(seen, Array.from({ length: 500 }, (_, index) => uuidOf(index + 1)));
    };
    pageAll(500);

    const world = makeWorld();
    cleanups.push(() => world.dispose());
    const itemId = uuidOf(9401);
    for (let attempt = 1; attempt <= 501; attempt += 1) {
      const base = runRecordOf({ seed: attempt, attempt });
      world.database.authority.runs.enqueue(RunRecordSchema.parse({
        ...base, envelope: { ...base.envelope, itemId },
      }));
    }
    const query = createItemAttemptHistoryQuery({
      database: world.database,
      reader: sqliteRunReader(world.database, world.clock),
    });
    assert.deepEqual(query.read(uuidOf(1), { limit: 50 }), {
      schemaVersion: 1,
      state: "refused",
      selectedRunId: uuidOf(1),
      reason: "item-history-bound-exceeded",
    });
  });

  it("rejects a run duplicated across live and archive candidate sources", () => {
    const world = makeWorld();
    cleanups.push(() => world.dispose());
    const itemId = uuidOf(9500);
    const base = runRecordOf({ seed: 501, attempt: 1 });
    const run = RunRecordSchema.parse({ ...base, envelope: { ...base.envelope, itemId } });
    world.database.authority.runs.enqueue(run);
    Object.defineProperty(world.database, "listItemAttemptHistorySources", {
      value: () => ({
        counts: { live: 1, archiveTransfers: 1, deleted: 0 },
        live: [run], archiveTransferIds: [run.envelope.runId], deleted: [],
      }),
    });
    const query = createItemAttemptHistoryQuery({
      database: world.database,
      reader: sqliteRunReader(world.database, world.clock),
    });
    assert.throws(() => query.read(run.envelope.runId, { limit: 25 }), /attempt-history-authority-collision/u);
  });
});
