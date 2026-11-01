import { createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { afterAll, afterEach,describe,it,vi } from "vitest";
import { createItemAttemptHistoryQuery } from "../../../../src/backend/runs/queries/item-attempt-history.js";
import { DeletedRunRecordSchema } from "../../../../src/models/run/deleted-run.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { makeWorld,runRecordOf,uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { sqliteRunReader } from "../../../support/helpers/canonical-run-reader.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function historyFixture(){const world=await makeWorld({ profileFixture: profileFixtures.create });world.database.authority.configSnapshots.insert(CONFIG_SNAPSHOT);return world;}

describe("same-item attempt history", () => {
  it("keeps attempt one selected while returning a later retry from the same item", async () => {
    const world = await historyFixture();
    cleanups.push(async () => await world.dispose());
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

  it("keeps deleted history associated, orders attempts, and refuses a cursor after authority changes", async () => {
    const world = await historyFixture();
    cleanups.push(async () => await world.dispose());
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

    const service=testRunService(database,world.clock);
    const transition=service.transition({commandId:uuidOf(913),runId:first.envelope.runId,expectedVersion:first.version,
      lifecycle:{state:"terminal",outcome:"cancelled",endedAt:world.clock.now().toISOString()}});
    assert.equal(transition.state,"applied");
    if(transition.state!=="applied")throw new Error("fixture run did not terminalize");
    assert.equal(service.delete({runId:first.envelope.runId,commandId:uuidOf(912),expectedVersion:transition.run.version}).state,"deleted");
    const tombstone=database.authority.deletedRuns.get(first.envelope.runId);assert.ok(tombstone);
    assert.equal(tombstone.runId,first.envelope.runId);

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
    if (selectedDeleted.selected.state !== "deleted") throw new Error("deleted selected provenance missing");
    assert.equal(selectedDeleted.selected.commandId, tombstone.commandId);
    assert.equal(selectedDeleted.selected.commandId, uuidOf(912));
    assert.deepEqual(selectedDeleted.page.entries.map(({ attempt, disposition }) => ({ attempt, disposition })), [
      { attempt: 1, disposition: "deleted" },
      { attempt: 2, disposition: "live" },
    ]);
  });

  it("pages all 500 supported peers and refuses a 501st rather than returning a partial history", async () => {
    const pageAll = async (count: number) => {
      const world = await historyFixture();
      cleanups.push(async () => await world.dispose());
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
    await pageAll(500);

    const world = await historyFixture();
    cleanups.push(async () => await world.dispose());
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

  it("rejects a run duplicated across live and deleted candidate sources", async () => {
    const world = await historyFixture();
    cleanups.push(async () => await world.dispose());
    const itemId = uuidOf(9500);
    const base = runRecordOf({ seed: 501, attempt: 1 });
    const run = RunRecordSchema.parse({ ...base, envelope: { ...base.envelope, itemId } });
    world.database.authority.runs.enqueue(run);
    Object.defineProperty(world.database, "listItemAttemptHistorySources", {
      value: () => ({
        counts:{live:1,deleted:1},live:[run],deleted:[DeletedRunRecordSchema.parse({runId:run.envelope.runId,
          workflow:run.envelope.workflow,itemId:run.envelope.itemId,attempt:run.envelope.attempt,runNumber:null,
          traceId:run.envelope.traceId,commandId:uuidOf(9501),deletedAt:world.clock.now().toISOString(),origin:"queue",
          tallyVersion:3,ordinalSource:"tombstone",removed:[{table:"runs",rows:1}]})],
      }),
    });
    const query = createItemAttemptHistoryQuery({
      database: world.database,
      reader: sqliteRunReader(world.database, world.clock),
    });
    assert.throws(() => query.read(run.envelope.runId, { limit: 25 }), /attempt-history-authority-collision/u);
  });
});

it("refuses malformed supplied cursors before reading authority or a run", async () => {
  const world = await historyFixture(); cleanups.push(async () => await world.dispose());
  const actualReader = sqliteRunReader(world.database, world.clock);
  const read = vi.fn(actualReader.read); const reader = { ...actualReader, read };
  const snapshot = vi.spyOn(world.database, "withAuthorityReadSnapshot");
  const query = createItemAttemptHistoryQuery({ database: world.database, reader });
  for (const json of ["{", "{}", "null"]) {
    const result = query.read(uuidOf(890), { limit: 50, cursor: Buffer.from(json).toString("base64url") });
    assert.equal(result.state, "refused"); if (result.state !== "refused") throw new Error("cursor not refused");
    assert.equal(result.reason, "malformed-cursor");
  }
  assert.equal(snapshot.mock.calls.length, 0); assert.equal(read.mock.calls.length, 0);
  snapshot.mockRestore();
});
