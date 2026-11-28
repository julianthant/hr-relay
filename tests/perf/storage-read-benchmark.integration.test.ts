import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, it } from "vitest";
import { createActivityPopulationService } from "../../src/backend/runs/queries/activity-population.js";
import { createTransactionHistory } from "../../src/backend/storage/sqlite/transaction-history.js";
import { manualClock, systemClock } from "../../src/rules/time/clock.js";
import { growth, measureStorageRead, STORAGE_READS, storeCheck, type StorageReadId } from "./storage-read-benchmark.js";
import { seedStorageReadFixture, type StorageReadFixture } from "./storage-read-fixture.js";
import { traceSqliteStatements } from "./sqlite-statement-counter.js";

const RUNS = 10_000;

describe("the storage read benchmark at 10,000 runs", () => {
  let fixture: StorageReadFixture;
  let small: StorageReadFixture;

  beforeAll(async () => {
    fixture = await seedStorageReadFixture(RUNS);
    small = await seedStorageReadFixture(100);
  });

  afterAll(async () => {
    await fixture.close();
    await small.close();
  });

  for (const read of Object.keys(STORAGE_READS) as StorageReadId[]) {
    it(`times ${read} with the change check inside the timed read, preparing what it prepares at 100 runs`, () => {
      const appendMs: number[] = [];
      measureStorageRead(small, read, 1, []);
      measureStorageRead(fixture, read, 1, []);
      const measured = measureStorageRead(fixture, read, 1, appendMs), baseline = measureStorageRead(small, read, 1, []);
      assert.equal(appendMs.length, 1);
      assert.equal(measured.checkStatements.length, 1);
      assert.deepEqual(measured.checkStatements, baseline.checkStatements);
      assert.ok(measured.check.medianMs > 0 && measured.check.medianMs <= measured.total.medianMs);
    });
  }

  it("finds no check in a read that follows no commit, so a found check is the commit's", () => {
    fixture.reader.summaryWorkflows();
    const warm = traceSqliteStatements(() => fixture.reader.summaryWorkflows());
    assert.throws(() => storeCheck(warm.statements), /ran the store check 0 times/u);
  });
});

it("reads uncached 30- and 90-day Activity populations within budget with 10,000 older runs", async () => {
  const to = "2026-11-15";
  const ranges = [{ from: "2026-10-17", to, total: 100 }, { from: "2026-08-18", to, total: 200 }];
  const recentRuns = Array.from({ length: 200 }, (_, index) => ({
    seed: RUNS + 1 + index, day: index < 100 ? "2026-09-08" : "2026-11-08", title: `Synthetic Activity run ${index + 1}`,
  }));
  const fixture = await seedStorageReadFixture(RUNS, recentRuns);
  try {
    const countClock = manualClock(new Date(`${to}T20:00:00.000Z`));
    const newReader = () => createActivityPopulationService({ database: fixture.reader, clock: countClock,
      descriptors: { resolve: () => undefined }, ledger: createTransactionHistory(fixture.reader.authority) });
    for (const { from, total } of ranges) {
      const samples: number[] = [];
      for (let trial = 0; trial < 5; trial += 1) {
        const reader = newReader();
        const started = systemClock.monotonicMs();
        const selected = reader.read({ from, to });
        const elapsed = systemClock.monotonicMs() - started;
        assert.equal(selected.report.totalRuns, total);
        assert.equal(selected.population.length, total);
        samples.push(elapsed);
      }
      samples.sort((left, right) => left - right);
      assert.ok(samples[2] < 300, `Activity ${from}–${to} median must be under 300 ms: ${samples.join(", ")}`);
    }
    const { statements } = traceSqliteStatements(() => newReader().read({ from: ranges[0].from, to }));
    const populationSql = statements.find(({ sql }) => sql.includes("runs_day_idx"))?.sql;
    const confirmationsSql = statements.find(({ sql }) => sql.includes("GROUP BY system,instance"))?.sql;
    assert.ok(populationSql && confirmationsSql);
    const raw = new DatabaseSync(fixture.path, { readOnly: true });
    try {
      assert.match(JSON.stringify(raw.prepare(`EXPLAIN QUERY PLAN ${populationSql}`).all(ranges[0].from, to)), /SEARCH runs USING INDEX runs_day_idx/u);
      assert.match(JSON.stringify(raw.prepare(`EXPLAIN QUERY PLAN ${confirmationsSql}`).all(ranges[0].from, to)), /SEARCH write_intents USING INDEX write_intents_activity_confirmed_idx/u);
    } finally { raw.close(); }
  } finally { await fixture.close(); }
});

describe("the growth verdict", () => {
  it("names flat, linear and worse from the log-log slope", () => {
    assert.equal(growth([{ runCount: 100, medianMs: 5 }, { runCount: 10_000, medianMs: 6 }]).verdict, "flat");
    assert.equal(growth([{ runCount: 100, medianMs: 5 }, { runCount: 10_000, medianMs: 500 }]).verdict, "linear");
    assert.equal(growth([{ runCount: 100, medianMs: 5 }, { runCount: 10_000, medianMs: 50_000 }]).verdict, "worse than linear");
  });
});
